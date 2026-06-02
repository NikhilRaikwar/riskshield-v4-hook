import fs from "fs";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  formatUnits,
  http,
  maxUint256,
  parseAbi,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const fileEnv = Object.fromEntries(
  fs
    .readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((line) => /^\s*[^#].*=/.test(line))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
    }),
);
const env = { ...fileEnv, ...process.env };

const chain = {
  id: 1301,
  name: "Unichain Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [env.UNICHAIN_SEPOLIA_RPC_URL || "https://sepolia.unichain.org"] } },
};

const deployment = {
  usdc: env.VITE_RISKSHIELD_USDC || "0x31d0220469e10c4E71834a79b1f276d740d3768F",
  risk: env.VITE_RISKSHIELD_RISK_ASSET || "0x312751138a3ae633b942b9a8fad8f12de9361dac",
  vault: env.VITE_RISKSHIELD_VAULT || "0x5f1190906d31eefd9afe43b6631b3b20d712e7b2",
  hook: env.VITE_RISKSHIELD_HOOK || "0x192D6906dC087978Fb86FbF4868D49144b7847C0",
  router: env.VITE_RISKSHIELD_ROUTER || "0xe4dc72b113ca3fb856a8b74da7d08410156513e1",
  poolId: env.VITE_RISKSHIELD_POOL_ID || "0x4647bc3b1532e12f33a997bccdf0e1f40c2a9d4e5216725de619a3619c4a82b8",
};

if (!env.PRIVATE_KEY) throw new Error("PRIVATE_KEY missing in .env");

const privateKey = env.PRIVATE_KEY.startsWith("0x") ? env.PRIVATE_KEY : `0x${env.PRIVATE_KEY}`;
const account = privateKeyToAccount(privateKey);
const publicClient = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) });
const walletClient = createWalletClient({ account, chain, transport: http(chain.rpcUrls.default.http[0]) });

const tokenAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function mint(address,uint256)",
]);
const vaultAbi = parseAbi([
  "function depositJunior(bytes32 poolId,uint256 amount)",
  "function setRouter(address router,bool approved)",
  "function approvedRouters(address router) view returns (bool)",
  "function reserveAvailable(bytes32 poolId) view returns (uint256)",
  "function juniorBalanceOf(bytes32 poolId,address account) view returns (uint256)",
  "function juniorSharePrice(bytes32 poolId) view returns (uint256)",
  "function activeProtectedLiability(bytes32 poolId) view returns (uint256)",
  "function withdrawableReserve(bytes32 poolId) view returns (uint256)",
  "function nextPositionId() view returns (uint256)",
]);
const hookAbi = parseAbi(["function lastPremiumBps(bytes32 poolId) view returns (uint256)"]);
const routerAbi = parseAbi([
  "function modifyLiquidity((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,(int24 tickLower,int24 tickUpper,int256 liquidityDelta,bytes32 salt) params,bytes hookData) returns (int256 delta,int256 feesAccrued)",
  "function swapAndFundPremium((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,(bool zeroForOne,int256 amountSpecified,uint160 sqrtPriceLimitX96) params,bytes hookData,uint256 reservePremiumAmount,bytes32 premiumPoolId) returns (int256 delta)",
  "function quotePremium((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,(bool zeroForOne,int256 amountSpecified,uint160 sqrtPriceLimitX96) params,bytes hookData,uint256 premiumBaseAmount) view returns (uint256 premiumBps,uint256 premiumAmount)",
  "function swapAndPayPremium((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,(bool zeroForOne,int256 amountSpecified,uint160 sqrtPriceLimitX96) params,bytes hookData,uint256 premiumBaseAmount,bytes32 premiumPoolId) returns (int256 delta,uint256 premiumAmount)",
]);

const MIN_SQRT_PRICE_PLUS_ONE = 4295128740n;
const MAX_SQRT_PRICE_MINUS_ONE = 1461446703485210103287273052203988822378723970341n;
const SQRT_PRICE_TICK_NEG_30 = 79109415290437042302807587396n;
const SQRT_PRICE_TICK_30 = 79347087983666005045280518415n;
const poolKey =
  BigInt(deployment.risk) < BigInt(deployment.usdc)
    ? {
        currency0: deployment.risk,
        currency1: deployment.usdc,
        fee: 0x800000,
        tickSpacing: 60,
        hooks: deployment.hook,
      }
    : {
        currency0: deployment.usdc,
        currency1: deployment.risk,
        fee: 0x800000,
        tickSpacing: 60,
        hooks: deployment.hook,
      };
const reserveIsCurrency0 = poolKey.currency0.toLowerCase() === deployment.usdc.toLowerCase();
const demoZeroForOne = !reserveIsCurrency0;
const demoSwapInputAmount = parseUnits("0.000000001", 18);
let demoPremiumBaseAmount = parseUnits("10", 6);

const txs = {};

async function write(label, address, abi, functionName, args) {
  const { request } = await publicClient.simulateContract({
    address,
    abi,
    functionName,
    args,
    account,
  });
  const nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
  const hash = await walletClient.writeContract({ ...request, nonce });
  console.log(`${label}: https://sepolia.uniscan.xyz/tx/${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`${label} reverted`);
  txs[label] = hash;
  return hash;
}

async function ensureApproval(token, spender, amount, label) {
  let allowance = await publicClient.readContract({
    address: token,
    abi: tokenAbi,
    functionName: "allowance",
    args: [account.address, spender],
  });
  if (allowance >= amount) return;
  await write(label, token, tokenAbi, "approve", [spender, maxUint256]);
  for (let i = 0; i < 12; i += 1) {
    allowance = await publicClient.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "allowance",
      args: [account.address, spender],
    });
    if (allowance >= amount) return;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`${label} confirmed, but allowance is still not visible from RPC`);
}

function seniorHookData(liquidityDelta) {
  return encodeAbiParameters(
    [{ type: "uint8" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    [1, account.address, parseUnits("1", 18), parseUnits("2", 6), parseUnits("2", 18)],
  );
}

async function pickLiquidityDelta() {
  for (const liquidityDelta of [1_000_000_000_000n, 100_000_000_000n, 10_000_000_000n, 1_000_000_000n, 100_000_000n]) {
    try {
      await publicClient.simulateContract({
        address: deployment.router,
        abi: routerAbi,
        functionName: "modifyLiquidity",
        args: [
          poolKey,
          { tickLower: -60, tickUpper: 60, liquidityDelta, salt: `0x${"0".repeat(64)}` },
          seniorHookData(liquidityDelta),
        ],
        account,
      });
      return liquidityDelta;
    } catch {
      continue;
    }
  }
  throw new Error("No tested liquidity delta could be simulated with current balances/allowances");
}

console.log(`Smoke wallet: ${account.address}`);
console.log(`Pool ID: ${deployment.poolId}`);
console.log(`Token order: currency0=${poolKey.currency0}, currency1=${poolKey.currency1}`);
console.log(
  `Demo swap input: ${formatUnits(demoSwapInputAmount, 18)} mRISK (${demoZeroForOne ? "currency0 -> currency1" : "currency1 -> currency0"})`,
);

const usdcBalanceBefore = await publicClient.readContract({
  address: deployment.usdc,
  abi: tokenAbi,
  functionName: "balanceOf",
  args: [account.address],
});
console.log(`USDC before: ${formatUnits(usdcBalanceBefore, 6)}`);
if (usdcBalanceBefore < parseUnits("1", 6)) {
  demoPremiumBaseAmount = parseUnits("0.01", 6);
}
console.log(`Premium base amount: ${formatUnits(demoPremiumBaseAmount, 6)} USDC`);

const routerApproved = await publicClient.readContract({
  address: deployment.vault,
  abi: vaultAbi,
  functionName: "approvedRouters",
  args: [deployment.router],
});
if (!routerApproved) {
  await write("Approve router on vault", deployment.vault, vaultAbi, "setRouter", [deployment.router, true]);
}

const targetJuniorReserve = parseUnits("2", 6);
const reserveBeforeDeposit = await publicClient.readContract({
  address: deployment.vault,
  abi: vaultAbi,
  functionName: "reserveAvailable",
  args: [deployment.poolId],
});
if (reserveBeforeDeposit < targetJuniorReserve) {
  const juniorDepositAmount = targetJuniorReserve - reserveBeforeDeposit;
  await ensureApproval(deployment.usdc, deployment.vault, juniorDepositAmount, "Approve USDC to vault");
  await write("Deposit junior USDC reserve", deployment.vault, vaultAbi, "depositJunior", [
    deployment.poolId,
    juniorDepositAmount,
  ]);
} else {
  console.log(`Junior reserve already funded: ${formatUnits(reserveBeforeDeposit, 6)} USDC`);
}

await write("Mint mRISK", deployment.risk, tokenAbi, "mint", [account.address, parseUnits("10000", 18)]);
await ensureApproval(deployment.risk, deployment.router, parseUnits("10000", 18), "Approve mRISK to router");
await ensureApproval(deployment.usdc, deployment.router, parseUnits("20", 6), "Approve USDC to router");

let liquidityDelta = 0n;
const nextPositionIdBefore = await publicClient.readContract({
  address: deployment.vault,
  abi: vaultAbi,
  functionName: "nextPositionId",
});
if (nextPositionIdBefore <= 1n) {
  liquidityDelta = await pickLiquidityDelta();
  console.log(`Selected liquidityDelta: ${liquidityDelta}`);
  await write("Add protected senior liquidity", deployment.router, routerAbi, "modifyLiquidity", [
    poolKey,
    { tickLower: -60, tickUpper: 60, liquidityDelta, salt: `0x${"0".repeat(64)}` },
    seniorHookData(liquidityDelta),
  ]);
} else {
  console.log(`Protected senior position already exists: ${nextPositionIdBefore - 1n} opened`);
}

const swapParams = {
  zeroForOne: demoZeroForOne,
  amountSpecified: -demoSwapInputAmount,
  sqrtPriceLimitX96: demoZeroForOne ? SQRT_PRICE_TICK_NEG_30 : SQRT_PRICE_TICK_30,
};
const swapHookData = encodeAbiParameters([{ type: "int24" }], [120]);
const [quotedPremiumBps, quotedPremiumAmount] = await publicClient.readContract({
  address: deployment.router,
  abi: routerAbi,
  functionName: "quotePremium",
  args: [poolKey, swapParams, swapHookData, demoPremiumBaseAmount],
});
console.log(`Quoted trader premium: ${formatUnits(quotedPremiumAmount, 6)} USDC at ${quotedPremiumBps} bps`);

await write("Swap and pay quoted premium", deployment.router, routerAbi, "swapAndPayPremium", [
  poolKey,
  swapParams,
  swapHookData,
  demoPremiumBaseAmount,
  deployment.poolId,
]);

await new Promise((resolve) => setTimeout(resolve, 4000));

const [
  reserveAvailable,
  juniorBalance,
  juniorSharePrice,
  activeProtectedLiability,
  withdrawableReserve,
  nextPositionId,
  lastPremiumBps,
  usdcBalanceAfter,
] = await Promise.all([
  publicClient.readContract({ address: deployment.vault, abi: vaultAbi, functionName: "reserveAvailable", args: [deployment.poolId] }),
  publicClient.readContract({
    address: deployment.vault,
    abi: vaultAbi,
    functionName: "juniorBalanceOf",
    args: [deployment.poolId, account.address],
  }),
  publicClient.readContract({ address: deployment.vault, abi: vaultAbi, functionName: "juniorSharePrice", args: [deployment.poolId] }),
  publicClient.readContract({ address: deployment.vault, abi: vaultAbi, functionName: "activeProtectedLiability", args: [deployment.poolId] }),
  publicClient.readContract({ address: deployment.vault, abi: vaultAbi, functionName: "withdrawableReserve", args: [deployment.poolId] }),
  publicClient.readContract({ address: deployment.vault, abi: vaultAbi, functionName: "nextPositionId" }),
  publicClient.readContract({ address: deployment.hook, abi: hookAbi, functionName: "lastPremiumBps", args: [deployment.poolId] }),
  publicClient.readContract({ address: deployment.usdc, abi: tokenAbi, functionName: "balanceOf", args: [account.address] }),
]);

console.log("REAL_USDC_SMOKE_RESULT_START");
console.log(
  JSON.stringify(
    {
      txs,
      liquidityDelta: liquidityDelta.toString(),
      reserveAvailable: formatUnits(reserveAvailable, 6),
      juniorBalance: formatUnits(juniorBalance, 6),
      juniorSharePrice: formatUnits(juniorSharePrice, 18),
      activeProtectedLiability: formatUnits(activeProtectedLiability, 6),
      withdrawableReserve: formatUnits(withdrawableReserve, 6),
      nextPositionId: nextPositionId.toString(),
      seniorPositionsOpened: (nextPositionId - 1n).toString(),
      lastPremiumBps: lastPremiumBps.toString(),
      quotedPremiumBps: quotedPremiumBps.toString(),
      quotedPremiumAmount: formatUnits(quotedPremiumAmount, 6),
      usdcBefore: formatUnits(usdcBalanceBefore, 6),
      usdcAfter: formatUnits(usdcBalanceAfter, 6),
    },
    null,
    2,
  ),
);
console.log("REAL_USDC_SMOKE_RESULT_END");

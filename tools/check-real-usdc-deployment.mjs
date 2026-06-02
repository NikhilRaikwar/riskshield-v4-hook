import fs from "fs";
import { createPublicClient, formatUnits, http, parseAbi } from "viem";

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
  stateView: env.VITE_RISKSHIELD_STATE_VIEW || "0xc199F1072a74D4e905ABa1A84d9a45E2546B6222",
  poolId: env.VITE_RISKSHIELD_POOL_ID || "0x4647bc3b1532e12f33a997bccdf0e1f40c2a9d4e5216725de619a3619c4a82b8",
};

const client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) });
const erc20Abi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
]);
const vaultAbi = parseAbi([
  "function reserveAvailable(bytes32 poolId) view returns (uint256)",
  "function nextPositionId() view returns (uint256)",
  "function hook() view returns (address)",
]);
const hookAbi = parseAbi(["function lastPremiumBps(bytes32 poolId) view returns (uint24)"]);
const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);

const [usdcCode, riskCode, vaultCode, hookCode, routerCode] = await Promise.all([
  client.getCode({ address: deployment.usdc }),
  client.getCode({ address: deployment.risk }),
  client.getCode({ address: deployment.vault }),
  client.getCode({ address: deployment.hook }),
  client.getCode({ address: deployment.router }),
]);

const [symbol, decimals, vaultTokenBalance, reserveAvailable, nextPositionId, vaultHook, lastPremiumBps, slot0, liquidity] =
  await Promise.all([
    client.readContract({ address: deployment.usdc, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address: deployment.usdc, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: deployment.usdc, abi: erc20Abi, functionName: "balanceOf", args: [deployment.vault] }),
    client.readContract({ address: deployment.vault, abi: vaultAbi, functionName: "reserveAvailable", args: [deployment.poolId] }),
    client.readContract({ address: deployment.vault, abi: vaultAbi, functionName: "nextPositionId" }),
    client.readContract({ address: deployment.vault, abi: vaultAbi, functionName: "hook" }),
    client.readContract({ address: deployment.hook, abi: hookAbi, functionName: "lastPremiumBps", args: [deployment.poolId] }),
    client.readContract({ address: deployment.stateView, abi: stateViewAbi, functionName: "getSlot0", args: [deployment.poolId] }),
    client.readContract({ address: deployment.stateView, abi: stateViewAbi, functionName: "getLiquidity", args: [deployment.poolId] }),
  ]);

console.log(
  JSON.stringify(
    {
      network: chain.name,
      deployment,
      codePresent: {
        usdc: Boolean(usdcCode),
        risk: Boolean(riskCode),
        vault: Boolean(vaultCode),
        hook: Boolean(hookCode),
        router: Boolean(routerCode),
      },
      hookPermissionBits: `0x${(BigInt(deployment.hook) & 0x3fffn).toString(16).padStart(4, "0")}`,
      vaultHook,
      token: { symbol, decimals },
      vaultTokenBalance: formatUnits(vaultTokenBalance, decimals),
      reserveAvailable: formatUnits(reserveAvailable, decimals),
      nextPositionId: nextPositionId.toString(),
      lastPremiumBps: lastPremiumBps.toString(),
      poolState: {
        sqrtPriceX96: slot0[0].toString(),
        tick: slot0[1].toString(),
        protocolFee: slot0[2].toString(),
        lpFee: slot0[3].toString(),
        liquidity: liquidity.toString(),
      },
    },
    null,
    2,
  ),
);

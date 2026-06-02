import fs from "fs";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeDeployData,
  getContractAddress,
  http,
  keccak256,
  parseAbi,
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

const ADDRESSES = {
  poolManager: "0x00B036B58a818B1BC34d502D3fE730Db729e62AC",
  usdc: env.UNICHAIN_SEPOLIA_USDC || "0x31d0220469e10c4E71834a79b1f276d740d3768F",
};

const HOOK_FLAGS = 0x07c0n;
const ALL_HOOK_MASK = (1n << 14n) - 1n;
const SQRT_PRICE_1_1 = 79228162514264337593543950336n;

const account = privateKeyToAccount(env.PRIVATE_KEY.startsWith("0x") ? env.PRIVATE_KEY : `0x${env.PRIVATE_KEY}`);
const publicClient = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) });
const walletClient = createWalletClient({ account, chain, transport: http(chain.rpcUrls.default.http[0]) });

function artifact(name) {
  return JSON.parse(fs.readFileSync(`out/${name}.sol/${name}.json`, "utf8"));
}

function normalizeBytecode(bytecode) {
  const rawBytecode = typeof bytecode === "string" ? bytecode : bytecode.object;
  return rawBytecode.startsWith("0x") ? rawBytecode : `0x${rawBytecode}`;
}

async function deploy(label, abi, bytecode, args = []) {
  const nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
  const hash = await walletClient.deployContract({
    abi,
    bytecode: normalizeBytecode(bytecode),
    args,
    nonce,
  });
  console.log(`${label} deploy tx: https://sepolia.uniscan.xyz/tx/${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`${label} deployment reverted`);
  console.log(`${label}: ${receipt.contractAddress}`);
  return { address: receipt.contractAddress, hash };
}

async function deployOrUse(label, envKey, abi, bytecode, args = []) {
  if (env[envKey]) {
    console.log(`${label}: ${env[envKey]} (reused from ${envKey})`);
    return { address: env[envKey], hash: env[`${envKey}_TX`] || "reused" };
  }
  return deploy(label, abi, bytecode, args);
}

async function write(label, address, abi, functionName, args) {
  const nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
  const hash = await walletClient.writeContract({ address, abi, functionName, args, nonce });
  console.log(`${label} tx: https://sepolia.uniscan.xyz/tx/${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`${label} reverted`);
  return hash;
}

function mineSalt(hookDeployer, initCodeHash) {
  for (let i = 0n; i < 1_000_000n; i += 1n) {
    const salt = `0x${i.toString(16).padStart(64, "0")}`;
    const predicted = BigInt(getContractAddress({ bytecodeHash: initCodeHash, from: hookDeployer, opcode: "CREATE2", salt }));
    if ((predicted & ALL_HOOK_MASK) === HOOK_FLAGS) return salt;
  }
  throw new Error("salt not found");
}

function poolKey(risk, usdc, hook) {
  const riskValue = BigInt(risk);
  const usdcValue = BigInt(usdc);
  return riskValue < usdcValue
    ? { currency0: risk, currency1: usdc, fee: 0x800000, tickSpacing: 60, hooks: hook }
    : { currency0: usdc, currency1: risk, fee: 0x800000, tickSpacing: 60, hooks: hook };
}

const riskArtifact = artifact("MockRiskAsset");
const vaultArtifact = artifact("RiskShieldVault");
const hookDeployerArtifact = artifact("HookDeployer");
const hookArtifact = artifact("RiskShieldHook");
const routerArtifact = artifact("RiskShieldPoolRouter");

console.log(`Deployer: ${account.address}`);
console.log(`USDC reserve token: ${ADDRESSES.usdc}`);

const risk = await deployOrUse("MockRiskAsset", "REAL_USDC_RISK_ASSET", riskArtifact.abi, riskArtifact.bytecode);
const vault = await deployOrUse("RiskShieldVault", "REAL_USDC_VAULT", vaultArtifact.abi, vaultArtifact.bytecode, [
  ADDRESSES.usdc,
  account.address,
]);
const hookDeployer = await deployOrUse(
  "HookDeployer",
  "REAL_USDC_HOOK_DEPLOYER",
  hookDeployerArtifact.abi,
  hookDeployerArtifact.bytecode,
);

const hookInitCode = encodeDeployData({
  abi: hookArtifact.abi,
  bytecode: normalizeBytecode(hookArtifact.bytecode),
  args: [ADDRESSES.poolManager, vault.address],
});
const hookInitCodeHash = keccak256(hookInitCode);
const hookSalt = mineSalt(hookDeployer.address, hookInitCodeHash);
const predictedHook = getContractAddress({
  bytecodeHash: hookInitCodeHash,
  from: hookDeployer.address,
  opcode: "CREATE2",
  salt: hookSalt,
});

const hookDeployAbi = parseAbi(["function deploy(bytes32 salt, bytes creationCode) payable returns (address)"]);
const hookDeployHash = await write("Deploy mined hook", hookDeployer.address, hookDeployAbi, "deploy", [hookSalt, hookInitCode]);
await write("Set hook on vault", vault.address, vaultArtifact.abi, "setHook", [predictedHook]);

const router = await deploy("RiskShieldPoolRouter", routerArtifact.abi, routerArtifact.bytecode, [
  ADDRESSES.poolManager,
  vault.address,
]);
const key = poolKey(risk.address, ADDRESSES.usdc, predictedHook);
const initializeHash = await write("Initialize real-USDC v4 pool", router.address, routerArtifact.abi, "initialize", [
  key,
  SQRT_PRICE_1_1,
]);

const poolId = keccak256(
  encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "uint24" },
      { type: "int24" },
      { type: "address" },
    ],
    [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
  ),
);

console.log("REAL_USDC_DEPLOYMENT_JSON_START");
console.log(
  JSON.stringify(
    {
      network: "Unichain Sepolia",
      chainId: 1301,
      usdc: ADDRESSES.usdc,
      mockRiskAsset: risk.address,
      riskShieldVault: vault.address,
      hookDeployer: hookDeployer.address,
      riskShieldHook: predictedHook,
      riskShieldPoolRouter: router.address,
      poolId,
      txs: {
        mockRiskAssetDeploy: risk.hash,
        vaultDeploy: vault.hash,
        hookDeployerDeploy: hookDeployer.hash,
        hookDeploy: hookDeployHash,
        routerDeploy: router.hash,
        initialize: initializeHash,
      },
    },
    null,
    2,
  ),
);
console.log("REAL_USDC_DEPLOYMENT_JSON_END");

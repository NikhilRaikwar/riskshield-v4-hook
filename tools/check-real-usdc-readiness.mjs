import fs from "fs";
import { createPublicClient, formatEther, formatUnits, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const env = Object.fromEntries(
  fs
    .readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((line) => /^\s*[^#].*=/.test(line))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
    }),
);

const chain = {
  id: 1301,
  name: "Unichain Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [env.UNICHAIN_SEPOLIA_RPC_URL || "https://sepolia.unichain.org"] } },
};

if (!env.PRIVATE_KEY) throw new Error("PRIVATE_KEY missing in .env");

const privateKey = env.PRIVATE_KEY.startsWith("0x") ? env.PRIVATE_KEY : `0x${env.PRIVATE_KEY}`;
const account = privateKeyToAccount(privateKey);
const client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) });
const usdc = env.UNICHAIN_SEPOLIA_USDC || "0x31d0220469e10c4E71834a79b1f276d740d3768F";
const abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

const [ethBalance, usdcCode, usdcBalance, usdcDecimals, usdcSymbol] = await Promise.all([
  client.getBalance({ address: account.address }),
  client.getCode({ address: usdc }),
  client.readContract({ address: usdc, abi, functionName: "balanceOf", args: [account.address] }),
  client.readContract({ address: usdc, abi, functionName: "decimals" }),
  client.readContract({ address: usdc, abi, functionName: "symbol" }),
]);

console.log(
  JSON.stringify(
    {
      network: chain.name,
      chainId: chain.id,
      deployer: account.address,
      ethBalance: formatEther(ethBalance),
      usdc,
      usdcCodePresent: Boolean(usdcCode),
      usdcSymbol,
      usdcDecimals,
      usdcBalance: formatUnits(usdcBalance, usdcDecimals),
      readyForDeploy: ethBalance > 0n,
      readyForRealUsdcSmoke: usdcBalance > 0n,
    },
    null,
    2,
  ),
);

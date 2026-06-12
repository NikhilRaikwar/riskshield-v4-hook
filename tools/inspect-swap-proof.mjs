import { createPublicClient, decodeEventLog, http, parseAbi } from "viem";

const txHash = "0xe49dc0e0b373a2ef507d25a4e1b35d0d2be19cab7b70459322b590a45ab0ffab";
const addresses = {
  poolManager: "0x00b036b58a818b1bc34d502d3fe730db729e62ac",
  router: "0xb4c8d25afac20572347977e9dc1d18c61d58c736",
  hook: "0x49026475bca9c0fdd778ddf143e7a596b4d6c7c0",
  vault: "0xe12b741707eb4b9a8762d58c2e36b909e345d5e4",
};

const client = createPublicClient({
  transport: http("https://sepolia.unichain.org"),
});

const abi = parseAbi([
  "event PremiumQuoted(bytes32 indexed poolId,uint256 premiumBps,uint24 feeOverride)",
  "event PremiumObserved(bytes32 indexed poolId,uint256 premiumAmount)",
  "event PremiumPaid(bytes32 indexed poolId,address indexed trader,uint256 premiumAmount,uint256 premiumBps)",
  "event SwapExecuted(address indexed payer,int256 delta,uint256 reservePremiumAmount)",
  "event PremiumFunded(bytes32 indexed poolId,address indexed funder,uint256 amount,uint256 premiumBps)",
  "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
]);

const transaction = await client.getTransaction({ hash: txHash });
const receipt = await client.getTransactionReceipt({ hash: txHash });

console.log("Transaction target:", transaction.to);
console.log("Expected router:    ", addresses.router);
console.log("Status:", receipt.status, "Logs:", receipt.logs.length);

for (const [index, log] of receipt.logs.entries()) {
  const owner = Object.entries(addresses).find(([, address]) => address.toLowerCase() === log.address.toLowerCase())?.[0] ?? "token/other";
  let event = "unknown";
  try {
    event = decodeEventLog({ abi, data: log.data, topics: log.topics }).eventName;
  } catch {}
  console.log(`${index}: ${owner.padEnd(11)} ${log.address} ${event}`);
}


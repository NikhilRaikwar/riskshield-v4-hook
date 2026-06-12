import "@rainbow-me/rainbowkit/styles.css";
import "./riskshield-design.css";

import React, { useEffect, useMemo } from "react";
import { Analytics } from "@vercel/analytics/react";
import { createRoot } from "react-dom/client";
import { connectorsForWallets, RainbowKitProvider, ConnectButton } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet } from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createConfig,
  http,
  WagmiProvider,
  useAccount,
  useDisconnect,
  usePublicClient,
  useSwitchChain,
  useWalletClient,
} from "wagmi";
import { unichainSepolia } from "wagmi/chains";
import { encodeAbiParameters, erc20Abi, formatEther, formatUnits, maxUint256, parseUnits } from "viem";
import { riskshieldMarkup } from "./riskshieldMarkup.js";

const MOCK_DEPLOYMENT = {
  poolManager: "0x00B036B58a818B1BC34d502D3fE730Db729e62AC",
  mockUSDC: "0xb0cD9Ec340036f47F4655d9BBfE1E172E3209A06",
  mockRiskAsset: "0x72290EB00a06c4a5582c64e8E336F6e4D242bE87",
  vault: "0xAE2fbD03F210206774BD2A43Bc96823a18022a5f",
  hook: "0xd9E54DB85EC7BbBFbFE1d47fae90b941aA4aC7C0",
  router: "0x11fB0B3C8355fF826a3BC9316ea5B0A46E2FF0C0",
  poolId: "0xf7ab8f4eeb4e9ae1a8bf02a06f9d65aeeabefe42d29c38473c354eaaad1d4ba5",
};

const REAL_USDC_DEPLOYMENT = {
  poolManager: MOCK_DEPLOYMENT.poolManager,
  mockUSDC: import.meta.env.VITE_RISKSHIELD_USDC || "0x31d0220469e10c4E71834a79b1f276d740d3768F",
  mockRiskAsset: import.meta.env.VITE_RISKSHIELD_RISK_ASSET || "0x0ca086118b4d1ff6599b75d9f14defbc3242ab78",
  vault: import.meta.env.VITE_RISKSHIELD_VAULT || "0xe12b741707eb4b9a8762d58c2e36b909e345d5e4",
  hook: import.meta.env.VITE_RISKSHIELD_HOOK || "0x49026475bca9C0FDD778dDF143E7a596b4D6C7C0",
  router: import.meta.env.VITE_RISKSHIELD_ROUTER || "0xb4c8d25afac20572347977e9dc1d18c61d58c736",
  poolId: import.meta.env.VITE_RISKSHIELD_POOL_ID || "0xb0dda0a853ae4eefb5ed690dc7de5cfefe01ef3572152e0170db69c3e57f71c4",
};

const IS_REAL_USDC_MODE = import.meta.env.VITE_RISKSHIELD_MODE === "real-usdc";
const ADDRESSES = IS_REAL_USDC_MODE ? REAL_USDC_DEPLOYMENT : MOCK_DEPLOYMENT;
const POOL_ID = ADDRESSES.poolId;
const STATE_VIEW = import.meta.env.VITE_RISKSHIELD_STATE_VIEW || "0xc199F1072a74D4e905ABa1A84d9a45E2546B6222";
const RESERVE_SYMBOL = IS_REAL_USDC_MODE ? "USDC" : "mUSDC";
const RESERVE_NAME = IS_REAL_USDC_MODE ? "Circle testnet USDC" : "MockUSDC";
const MIN_SQRT_PRICE_PLUS_ONE = 4295128740n;
const MAX_SQRT_PRICE_MINUS_ONE = 1461446703485210103287273052203988822378723970341n;
const SQRT_PRICE_TICK_NEG_30 = 79109415290437042302807587396n;
const SQRT_PRICE_TICK_30 = 79347087983666005045280518415n;

const [currency0, currency1] =
  BigInt(ADDRESSES.mockRiskAsset) < BigInt(ADDRESSES.mockUSDC)
    ? [ADDRESSES.mockRiskAsset, ADDRESSES.mockUSDC]
    : [ADDRESSES.mockUSDC, ADDRESSES.mockRiskAsset];

const poolKey = {
  currency0,
  currency1,
  fee: 8388608,
  tickSpacing: 60,
  hooks: ADDRESSES.hook,
};
const RISK_IS_CURRENCY0 = currency0.toLowerCase() === ADDRESSES.mockRiskAsset.toLowerCase();

const vaultAbi = [
  {
    type: "function",
    name: "depositJunior",
    stateMutability: "nonpayable",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    type: "function",
    name: "reserveAvailable",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "juniorBalanceOf",
    stateMutability: "view",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "account", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "juniorSharePrice",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "activeProtectedLiability",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "withdrawableReserve",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "poolReserves",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "juniorCapital", type: "uint256" },
      { name: "accruedPremiums", type: "uint256" },
      { name: "paidCoverage", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "nextPositionId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "seniorPositions",
    stateMutability: "view",
    inputs: [{ name: "positionId", type: "uint256" }],
    outputs: [
      { name: "poolId", type: "bytes32" },
      { name: "owner", type: "address" },
      { name: "entryAmount0", type: "uint256" },
      { name: "entryAmount1", type: "uint256" },
      { name: "entryPriceWad", type: "uint256" },
      { name: "liquidity", type: "uint256" },
      { name: "coverageLiability", type: "uint256" },
      { name: "closed", type: "bool" },
    ],
  },
];

const hookAbi = [
  {
    type: "function",
    name: "lastPremiumBps",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "lastPremiumAmount",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
];

const stateViewAbi = [
  {
    type: "function",
    name: "getSlot0",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
  {
    type: "function",
    name: "getLiquidity",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ type: "uint128" }],
  },
];

const mockTokenAbi = [
  ...erc20Abi,
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
];

const routerAbi = [
  {
    type: "function",
    name: "modifyLiquidity",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tickLower", type: "int24" },
          { name: "tickUpper", type: "int24" },
          { name: "liquidityDelta", type: "int256" },
          { name: "salt", type: "bytes32" },
        ],
      },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [
      { name: "delta", type: "int256" },
      { name: "feesAccrued", type: "int256" },
    ],
  },
  {
    type: "function",
    name: "swapAndFundPremium",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "zeroForOne", type: "bool" },
          { name: "amountSpecified", type: "int256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
      { name: "hookData", type: "bytes" },
      { name: "reservePremiumAmount", type: "uint256" },
      { name: "premiumPoolId", type: "bytes32" },
    ],
    outputs: [{ name: "delta", type: "int256" }],
  },
  {
    type: "function",
    name: "quotePremium",
    stateMutability: "view",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "zeroForOne", type: "bool" },
          { name: "amountSpecified", type: "int256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
      { name: "hookData", type: "bytes" },
      { name: "premiumBaseAmount", type: "uint256" },
    ],
    outputs: [
      { name: "premiumBps", type: "uint256" },
      { name: "premiumAmount", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "swapAndPayPremium",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "zeroForOne", type: "bool" },
          { name: "amountSpecified", type: "int256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
      { name: "hookData", type: "bytes" },
      { name: "premiumBaseAmount", type: "uint256" },
      { name: "premiumPoolId", type: "bytes32" },
    ],
    outputs: [
      { name: "delta", type: "int256" },
      { name: "premiumAmount", type: "uint256" },
    ],
  },
];

const connectors = connectorsForWallets([
  {
    groupName: "RiskShield",
    wallets: [injectedWallet, metaMaskWallet],
  },
], {
  appName: "RiskShield",
  projectId: "riskshield-local-demo",
});

const config = createConfig({
  chains: [unichainSepolia],
  ssr: false,
  connectors,
  transports: {
    [unichainSepolia.id]: http("https://sepolia.unichain.org"),
  },
});

const queryClient = new QueryClient();

function short(value) {
  if (!value) return "";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function fmtUsdc(value) {
  return `${Number(formatUnits(value ?? 0n, 6)).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })} ${RESERVE_SYMBOL}`;
}

function fmtRisk(value) {
  return `${Number(formatUnits(value ?? 0n, 18)).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  })} mRISK`;
}

function fmtAllowance(value, decimals, symbol) {
  const amount = value ?? 0n;
  if (amount === 0n) return `0 ${symbol}`;
  if (amount > maxUint256 / 2n) return `MaxUint allowance`;

  const normalized = Number(formatUnits(amount, decimals));
  if (normalized >= 1_000_000) {
    return `${normalized.toLocaleString(undefined, {
      notation: "compact",
      maximumFractionDigits: 2,
    })} ${symbol}`;
  }

  return `${normalized.toLocaleString(undefined, {
    maximumFractionDigits: decimals === 6 ? 2 : 4,
  })} ${symbol}`;
}

function fmtEth(value) {
  return `${Number(formatEther(value ?? 0n)).toLocaleString(undefined, {
    maximumFractionDigits: 5,
  })} ETH`;
}

function toast(msg, duration = 3600) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  container.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("show")));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 400);
  }, duration);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function applyDeploymentModeText() {
  document.querySelectorAll("[data-reserve-symbol]").forEach((el) => {
    el.textContent = RESERVE_SYMBOL;
  });
  document.querySelectorAll("[data-reserve-name]").forEach((el) => {
    el.textContent = RESERVE_NAME;
  });
  setText("deployment-mode-label", IS_REAL_USDC_MODE ? "Real USDC Mode" : "Mock Demo Mode");
  setText("j-btn1", IS_REAL_USDC_MODE ? "1 Check USDC Balance" : "1 Mint MockUSDC");
  setText("s-btn1", IS_REAL_USDC_MODE ? "1 Mint mRISK" : "1 Mint mUSDC + mRISK");
  setText("sw-btn", "Execute v4 Swap + Pay Trader Premium");
  setText("junior-step-mint-label", IS_REAL_USDC_MODE ? "Check wallet USDC balance" : "Mint mUSDC to connected wallet");
  setText(
    "junior-card-copy",
    IS_REAL_USDC_MODE
      ? "Deposit Circle testnet USDC as first-loss insurance capital. Get faucet USDC first, then approve and deposit."
      : "Deposit MockUSDC as first-loss insurance capital. Your capital absorbs covered losses before senior LPs are impacted.",
  );
  setText(
    "senior-card-copy",
    IS_REAL_USDC_MODE
      ? "Mint demo mRISK, then pair it with real testnet USDC. The hook records your protected entry when liquidity is added."
      : "Your position is benchmarked at entry price. On exit, the vault compares your actual LP value against the hold benchmark and pays covered IL from the reserve.",
  );
  if (IS_REAL_USDC_MODE) {
    const swapSize = document.getElementById("sw-size");
    const premiumBase = document.getElementById("sw-fund");
    if (swapSize && swapSize.value === "1000") swapSize.value = "0.001";
    if (premiumBase && premiumBase.value === "1000") premiumBase.value = "0.01";
  }
}

function getInput(id, fallback) {
  const value = Number(document.getElementById(id)?.value ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function markButton(id, state, label) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.classList.remove("state-pending", "state-done");
  if (state) btn.classList.add(state);
  if (label) btn.textContent = label;
  btn.disabled = state === "state-pending";
}

function markDone(dotId) {
  document.getElementById(dotId)?.classList.add("done");
}

function txUrl(hash) {
  return `https://sepolia.uniscan.xyz/tx/${hash}`;
}

function setTxLine(targetId, hash) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const link = document.createElement("a");
  link.className = "tx-hash";
  link.href = txUrl(hash);
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = `${hash.slice(0, 14)}...${hash.slice(-6)} open`;
  target.appendChild(document.createElement("br"));
  target.appendChild(link);
}

function addTxActivity(label, hash, status = "Submitted") {
  const list = document.getElementById("tx-activity-list");
  if (!list || !hash) return;
  list.querySelector(".tx-empty")?.remove();
  const existing = document.getElementById(`tx-${hash}`);
  if (existing) {
    existing.querySelector(".tx-status").textContent = status;
    return;
  }
  const row = document.createElement("div");
  row.className = "tx-activity-row";
  row.id = `tx-${hash}`;
  row.innerHTML = `
    <div>
      <div class="tx-label">${label}</div>
      <a class="tx-hash" href="${txUrl(hash)}" target="_blank" rel="noreferrer">${hash.slice(0, 14)}...${hash.slice(-6)} open</a>
    </div>
    <span class="tx-status">${status}</span>
  `;
  list.prepend(row);
}

function encodeSeniorHookData(account) {
  return encodeAbiParameters(
    [
      { type: "uint8" },
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    [1, account, parseUnits("1", 18), parseUnits("2000", 6), parseUnits("2000", 18)],
  );
}

function encodeTickHookData(tick) {
  return encodeAbiParameters([{ type: "int24" }], [tick]);
}

function RiskShieldShell() {
  const { address, chainId, isConnected, status } = useAccount();
  const { disconnect, disconnectAsync } = useDisconnect();
  const publicClient = usePublicClient({ chainId: unichainSepolia.id });
  const { data: walletClient } = useWalletClient({ chainId: unichainSepolia.id });
  const { switchChainAsync } = useSwitchChain();

  const live = useMemo(
    () => ({ address, chainId, disconnect, disconnectAsync, isConnected, status, publicClient, walletClient, switchChainAsync }),
    [address, chainId, disconnect, disconnectAsync, isConnected, status, publicClient, walletClient, switchChainAsync],
  );

  useEffect(() => {
    window.riskshield = { ...(window.riskshield || {}), ...live };
  }, [live]);

  useEffect(() => {
    const syncRoute = () => {
      if (isConnected && address) {
        showDashboard(address);
        refreshOnchainState();
      } else if (status === "disconnected") {
        showLanding();
      }
    };

    syncRoute();
    const animationFrame = requestAnimationFrame(syncRoute);
    const retry = setTimeout(syncRoute, 250);
    return () => {
      cancelAnimationFrame(animationFrame);
      clearTimeout(retry);
    };
  }, [isConnected, address, status]);

  useEffect(() => {
    installDomHandlers();
    injectLiveDashboardCards();
    applyDeploymentModeText();
    requestAnimationFrame(injectLiveDashboardCards);
    setTimeout(injectLiveDashboardCards, 0);
    setTimeout(injectLiveDashboardCards, 250);
    installFadeObservers();
    window.calcIL?.();
    window.updateSwapPreview?.();
    window.refreshOnchainState = refreshOnchainState;
    window.injectLiveDashboardCards = injectLiveDashboardCards;
  }, []);

  return (
    <>
      <ConnectButton.Custom>
        {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
          window.__riskshieldOpenConnect = openConnectModal;
          window.__riskshieldOpenAccount = openAccountModal;
          window.__riskshieldOpenChain = openChainModal;
          setTimeout(() => {
            setText("dash-wallet", account?.displayName ?? short(address ?? ""));
            setText("dash-chain", chain?.name ?? "Unichain Sepolia");
          }, 0);
          return <span style={{ display: "none" }} data-mounted={mounted ? "true" : "false"} />;
        }}
      </ConnectButton.Custom>
      <div dangerouslySetInnerHTML={{ __html: riskshieldMarkup }} />
    </>
  );
}

async function ensureReady() {
  const ctx = window.riskshield || {};
  if (!ctx.isConnected || !ctx.address) {
    window.__riskshieldOpenConnect?.();
    throw new Error("Connect wallet first.");
  }
  if (ctx.chainId !== unichainSepolia.id) {
    await ctx.switchChainAsync?.({ chainId: unichainSepolia.id });
  }
  if (!ctx.walletClient || !ctx.publicClient) throw new Error("Wallet client is not ready yet.");
  return ctx;
}

async function waitFor(hash, label = "Transaction") {
  const { publicClient } = window.riskshield;
  addTxActivity(label, hash, "Pending");
  toast(`Transaction submitted ${short(hash)}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  addTxActivity(label, hash, receipt.status === "success" ? "Confirmed" : "Reverted");
  toast(`${label} confirmed ${short(hash)}`);
  return receipt;
}

function friendlyError(error) {
  const message = error?.shortMessage || error?.message || "Transaction failed";
  if (message.toLowerCase().includes("nonce too low")) {
    return "Wallet nonce was stale. Wait a few seconds, refresh balances, then retry. The previous transaction may already be confirmed.";
  }
  return message;
}

async function refreshOnchainState() {
  const ctx = window.riskshield || {};
  if (!ctx.publicClient) return;
  injectLiveDashboardCards();
  try {
    const [reserve, premium, lastPremiumAmount, nextPosition, reserves, juniorSharePrice, activeLiability, withdrawableReserve] =
      await Promise.all([
      ctx.publicClient.readContract({
        address: ADDRESSES.vault,
        abi: vaultAbi,
        functionName: "reserveAvailable",
        args: [POOL_ID],
      }),
      ctx.publicClient.readContract({
        address: ADDRESSES.hook,
        abi: hookAbi,
        functionName: "lastPremiumBps",
        args: [POOL_ID],
      }),
      ctx.publicClient.readContract({
        address: ADDRESSES.hook,
        abi: hookAbi,
        functionName: "lastPremiumAmount",
        args: [POOL_ID],
      }),
      ctx.publicClient.readContract({
        address: ADDRESSES.vault,
        abi: vaultAbi,
        functionName: "nextPositionId",
      }),
      ctx.publicClient.readContract({
        address: ADDRESSES.vault,
        abi: vaultAbi,
        functionName: "poolReserves",
        args: [POOL_ID],
      }),
      ctx.publicClient.readContract({
        address: ADDRESSES.vault,
        abi: vaultAbi,
        functionName: "juniorSharePrice",
        args: [POOL_ID],
      }),
      ctx.publicClient.readContract({
        address: ADDRESSES.vault,
        abi: vaultAbi,
        functionName: "activeProtectedLiability",
        args: [POOL_ID],
      }),
      ctx.publicClient.readContract({
        address: ADDRESSES.vault,
        abi: vaultAbi,
        functionName: "withdrawableReserve",
        args: [POOL_ID],
      }),
    ]);

    const vaultTokenBalance = await ctx.publicClient.readContract({
      address: ADDRESSES.mockUSDC,
      abi: mockTokenAbi,
      functionName: "balanceOf",
      args: [ADDRESSES.vault],
    });

    setText("ov-reserve", fmtUsdc(reserve));
    setText("j-avail", fmtUsdc(reserve));
    setText("sw-reserve", fmtUsdc(reserve));
    setText("ov-premium", `${premium.toString()} bps`);
    setText("sw-lastbps", `${premium.toString()} bps`);
    setText("sw-paid-live", fmtUsdc(lastPremiumAmount));
    setText("ov-positions", (nextPosition - 1n).toString());
    setText("j-capital", fmtUsdc(reserves[0]));
    setText("j-premiums", fmtUsdc(reserves[1]));
    setText("j-paid", fmtUsdc(reserves[2]));
    setText("j-share-price", Number(formatUnits(juniorSharePrice, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 }));
    setText("j-active-liability", fmtUsdc(activeLiability));
    setText("j-withdrawable", fmtUsdc(withdrawableReserve));
    setText("live-vault-token", fmtUsdc(vaultTokenBalance));
    setText("live-active-liability", fmtUsdc(activeLiability));
    setText("live-withdrawable-reserve", fmtUsdc(withdrawableReserve));
    setText(
      "live-junior-share-price",
      Number(formatUnits(juniorSharePrice, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 }),
    );
    setText("live-next-position", (nextPosition - 1n).toString());
    setText("live-pool-id", `${POOL_ID.slice(0, 10)}...${POOL_ID.slice(-8)}`);

    try {
      const [slot0, liquidity] = await Promise.all([
        ctx.publicClient.readContract({
          address: STATE_VIEW,
          abi: stateViewAbi,
          functionName: "getSlot0",
          args: [POOL_ID],
        }),
        ctx.publicClient.readContract({
          address: STATE_VIEW,
          abi: stateViewAbi,
          functionName: "getLiquidity",
          args: [POOL_ID],
        }),
      ]);
      setText("live-pool-tick", slot0[1].toString());
      setText("live-pool-liquidity", liquidity.toString());
      setText("live-pool-lp-fee", `${slot0[3].toString()} pips`);
    } catch (stateError) {
      console.warn(stateError);
      setText("live-pool-tick", "Unavailable");
      setText("live-pool-liquidity", "Unavailable");
      setText("live-pool-lp-fee", "Unavailable");
    }

    if (ctx.address) {
      const [junior, nativeBalance, usdcBalance, riskBalance, vaultAllowance, routerUsdcAllowance, routerRiskAllowance] =
        await Promise.all([
          ctx.publicClient.readContract({
            address: ADDRESSES.vault,
            abi: vaultAbi,
            functionName: "juniorBalanceOf",
            args: [POOL_ID, ctx.address],
          }),
          ctx.publicClient.getBalance({ address: ctx.address }),
          ctx.publicClient.readContract({
            address: ADDRESSES.mockUSDC,
            abi: mockTokenAbi,
            functionName: "balanceOf",
            args: [ctx.address],
          }),
          ctx.publicClient.readContract({
            address: ADDRESSES.mockRiskAsset,
            abi: mockTokenAbi,
            functionName: "balanceOf",
            args: [ctx.address],
          }),
          ctx.publicClient.readContract({
            address: ADDRESSES.mockUSDC,
            abi: mockTokenAbi,
            functionName: "allowance",
            args: [ctx.address, ADDRESSES.vault],
          }),
          ctx.publicClient.readContract({
            address: ADDRESSES.mockUSDC,
            abi: mockTokenAbi,
            functionName: "allowance",
            args: [ctx.address, ADDRESSES.router],
          }),
          ctx.publicClient.readContract({
            address: ADDRESSES.mockRiskAsset,
            abi: mockTokenAbi,
            functionName: "allowance",
            args: [ctx.address, ADDRESSES.router],
          }),
        ]);
      setText("j-balance", fmtUsdc(junior));
      setText("s-owner", short(ctx.address));
      setText("dash-wallet", short(ctx.address));
      setText("live-wallet", short(ctx.address));
      setText("live-eth", fmtEth(nativeBalance));
      setText("live-usdc", fmtUsdc(usdcBalance));
      setText("live-risk", fmtRisk(riskBalance));
      setText("live-junior", fmtUsdc(junior));
      setText("live-vault-allowance", fmtAllowance(vaultAllowance, 6, RESERVE_SYMBOL));
      setText("live-router-usdc-allowance", fmtAllowance(routerUsdcAllowance, 6, RESERVE_SYMBOL));
      setText("live-router-risk-allowance", fmtAllowance(routerRiskAllowance, 18, "mRISK"));
    }
  } catch (error) {
    console.warn(error);
  }
}

async function write(address, abi, functionName, args, label = functionName) {
  if (window.__riskshieldTxInFlight) {
    throw new Error("A transaction is already pending. Wait for confirmation before submitting the next action.");
  }
  window.__riskshieldTxInFlight = true;
  try {
    const ctx = await ensureReady();
    const hash = await ctx.walletClient.writeContract({
      chain: unichainSepolia,
      account: ctx.address,
      address,
      abi,
      functionName,
      args,
    });
    await waitFor(hash, label);
    return hash;
  } finally {
    window.__riskshieldTxInFlight = false;
  }
}

function installDomHandlers() {
  window.copyAddr = async (addr) => {
    await navigator.clipboard?.writeText(addr);
    toast(`Copied ${short(addr)}`);
  };

  window.connectWallet = () => {
    const ctx = window.riskshield || {};
    if (ctx.isConnected && ctx.address) {
      showDashboard(ctx.address);
      refreshOnchainState();
      return;
    }
    window.__riskshieldOpenConnect?.();
  };

  window.disconnectWallet = async () => {
    const ctx = window.riskshield || {};
    try {
      await ctx.disconnectAsync?.();
      ctx.disconnect?.();
    } catch (error) {
      console.warn(error);
    }
    window.riskshield = { ...(window.riskshield || {}), isConnected: false, address: undefined };
    showLanding();
    toast("Wallet disconnected");
  };

  window.showPage = (id, el) => {
    const titles = {
      overview: "Overview",
      junior: "Junior Insurer",
      senior: "Senior LP",
      swap: "Swap Premium",
      coverage: "IL Coverage",
      deployment: "Deployment",
    };
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    document.getElementById(`panel-${id}`)?.classList.add("active");
    el?.classList.add("active");
    setText("topbar-page-title", titles[id] || id);
    window.closeSidebar();
  };

  window.toggleSidebar = () => {
    document.getElementById("sidebar")?.classList.toggle("open");
    document.getElementById("sidebarOverlay")?.classList.toggle("show");
  };

  window.closeSidebar = () => {
    document.getElementById("sidebar")?.classList.remove("open");
    document.getElementById("sidebarOverlay")?.classList.remove("show");
  };

  window.juniorStep = async (n) => {
    try {
      const ctx = await ensureReady();
      const amount = parseUnits(String(getInput("j-amount", 100)), 6);
      if (n === 1) {
        if (IS_REAL_USDC_MODE) {
          markButton("j-btn1", "state-done", "1 USDC Balance Checked");
          toast("Use Circle faucet USDC, then approve and deposit.");
        } else {
          markButton("j-btn1", "state-pending", "Submitting...");
          const hash = await write(ADDRESSES.mockUSDC, mockTokenAbi, "mint", [ctx.address, amount], "Mint mUSDC");
          markButton("j-btn1", "state-done", "1 Mint MockUSDC done");
          toast(`Mint confirmed ${short(hash)}`);
        }
        markDone("jd1");
        document.getElementById("j-btn2").disabled = false;
      } else if (n === 2) {
        markButton("j-btn2", "state-pending", "Submitting...");
        const hash = await write(
          ADDRESSES.mockUSDC,
          mockTokenAbi,
          "approve",
          [ADDRESSES.vault, amount],
          "Approve vault",
        );
        markButton("j-btn2", "state-done", "2 Approve RiskShieldVault done");
        markDone("jd2");
        document.getElementById("j-btn3").disabled = false;
        toast(`Approval confirmed ${short(hash)}`);
      } else {
        markButton("j-btn3", "state-pending", "Submitting...");
        const hash = await write(ADDRESSES.vault, vaultAbi, "depositJunior", [POOL_ID, amount], "Deposit junior reserve");
        markButton("j-btn3", "state-done", "3 Deposit Junior Reserve done");
        markDone("jd3");
        setTxLine("jd3-txt", hash);
        toast(`Junior reserve deposit confirmed ${short(hash)}`);
      }
      await refreshOnchainState();
    } catch (error) {
      resetPendingButtons();
      toast(friendlyError(error));
    }
  };

  window.seniorStep = async (n) => {
    try {
      const ctx = await ensureReady();
      if (n === 1) {
        markButton("s-btn1", "state-pending", "Submitting...");
        let usdcHash;
        if (!IS_REAL_USDC_MODE) {
          usdcHash = await write(
            ADDRESSES.mockUSDC,
            mockTokenAbi,
            "mint",
            [ctx.address, parseUnits("10000", 6)],
            "Mint senior mUSDC",
          );
        }
        const riskHash = await write(ADDRESSES.mockRiskAsset, mockTokenAbi, "mint", [
          ctx.address,
          parseUnits("10000", 18),
        ], "Mint senior mRISK");
        markButton("s-btn1", "state-done", IS_REAL_USDC_MODE ? "1 Mint mRISK done" : "1 Mint mUSDC + mRISK done");
        markDone("sd1");
        document.getElementById("s-btn2").disabled = false;
        toast(`Mint confirmed ${short(riskHash || usdcHash)}`);
      } else if (n === 2) {
        markButton("s-btn2", "state-pending", "Submitting...");
        await write(ADDRESSES.mockUSDC, mockTokenAbi, "approve", [ADDRESSES.router, maxUint256], "Approve router mUSDC");
        const hash = await write(
          ADDRESSES.mockRiskAsset,
          mockTokenAbi,
          "approve",
          [ADDRESSES.router, maxUint256],
          "Approve router mRISK",
        );
        markButton("s-btn2", "state-done", "2 Approve PoolRouter done");
        markDone("sd2");
        document.getElementById("s-btn3").disabled = false;
        toast(`Router approval confirmed ${short(hash)}`);
      } else {
        markButton("s-btn3", "state-pending", "Submitting...");
        const hookData = encodeSeniorHookData(ctx.address);
        const hash = await write(
          ADDRESSES.router,
          routerAbi,
          "modifyLiquidity",
          [
            poolKey,
            { tickLower: -60, tickUpper: 60, liquidityDelta: 1000000000000n, salt: `0x${"0".repeat(64)}` },
            hookData,
          ],
          "Open senior liquidity",
        );
        markButton("s-btn3", "state-done", "3 Senior Position Opened");
        markDone("sd3");
        setTxLine("sd3-txt", hash);
        toast(`Senior position opened ${short(hash)}`);
      }
      await refreshOnchainState();
    } catch (error) {
      resetPendingButtons();
      toast(friendlyError(error));
    }
  };

  window.updateSwapPreview = () => {
    const size = getInput("sw-size", 1000);
    const tick = getInput("sw-tick", 120);
    const premiumBase = getInput("sw-fund", 1000);
    const sizePremium = (size * 100) / 1_000_000;
    const volPremium = tick / 10;
    const total = Math.min(5 + sizePremium + volPremium, 100);
    setText("sw-size-prev", `${sizePremium.toFixed(2)} bps`);
    setText("sw-vol-prev", `${volPremium.toFixed(1)} bps`);
    setText("sw-total-prev", `${total.toFixed(1)} bps`);
    setText("sw-paid-preview", `${((premiumBase * total) / 10_000).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${RESERVE_SYMBOL}`);
  };

  window.executeSwap = async () => {
    try {
      await ensureReady();
      const tick = Math.trunc(getInput("sw-tick", 120));
      const swapInput = getInput("sw-size", IS_REAL_USDC_MODE ? 0.001 : 1000);
      const swapSize = IS_REAL_USDC_MODE ? parseUnits(String(swapInput), 18) : parseUnits(String(swapInput), 6);
      const premiumBase = parseUnits(String(getInput("sw-fund", IS_REAL_USDC_MODE ? 0.01 : 1000)), 6);
      const zeroForOne = IS_REAL_USDC_MODE ? RISK_IS_CURRENCY0 : true;
      const swapParams = {
        zeroForOne,
        amountSpecified: -swapSize,
        sqrtPriceLimitX96: IS_REAL_USDC_MODE
          ? zeroForOne
            ? SQRT_PRICE_TICK_NEG_30
            : SQRT_PRICE_TICK_30
          : zeroForOne
            ? MIN_SQRT_PRICE_PLUS_ONE
            : MAX_SQRT_PRICE_MINUS_ONE,
      };
      const hookData = encodeTickHookData(tick);
      markButton("sw-btn", "state-pending", "Executing swap...");
      if (IS_REAL_USDC_MODE) {
        await write(ADDRESSES.mockRiskAsset, mockTokenAbi, "approve", [ADDRESSES.router, maxUint256], "Approve swap mRISK");
      }
      await write(ADDRESSES.mockUSDC, mockTokenAbi, "approve", [ADDRESSES.router, maxUint256], "Approve premium USDC");
      const [premiumBps, premiumAmount] = await window.riskshield.publicClient.readContract({
        address: ADDRESSES.router,
        abi: routerAbi,
        functionName: "quotePremium",
        args: [poolKey, swapParams, hookData, premiumBase],
      });
      setText("sw-total-prev", `${premiumBps.toString()} bps`);
      setText("sw-paid-preview", fmtUsdc(premiumAmount));
      const hash = await write(ADDRESSES.router, routerAbi, "swapAndPayPremium", [
        poolKey,
        swapParams,
        hookData,
        premiumBase,
        POOL_ID,
      ], "Swap and pay premium");
      markButton("sw-btn", "state-done", "Swap Executed");
      toast(`Swap premium paid ${fmtUsdc(premiumAmount)} at ${premiumBps.toString()} bps: ${short(hash)}`);
      await refreshOnchainState();
      setTimeout(() => markButton("sw-btn", "", "Execute v4 Swap + Pay Trader Premium"), 2500);
    } catch (error) {
      resetPendingButtons();
      toast(friendlyError(error));
    }
  };

  window.calcIL = () => {
    const et0 = getInput("il-et0", 1);
    const et1 = getInput("il-et1", 2000);
    const xt0 = getInput("il-xt0", 0.5);
    const xt1 = getInput("il-xt1", 1000);
    const price = getInput("il-price", 2000);
    const reserve = getInput("il-reserve", 2000);
    const capBps = getInput("il-cap", 3000);
    const holdVal = et0 * price + et1;
    const exitVal = xt0 * price + xt1;
    const loss = Math.max(0, holdVal - exitVal);
    const coverCap = (holdVal * capBps) / 10000;
    const coverable = Math.min(loss, coverCap, reserve);
    const remaining = reserve - coverable;
    const fmt = (v) => `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${RESERVE_SYMBOL}`;
    const cap = document.getElementById("il-cappct");
    if (cap) cap.value = (capBps / 100).toFixed(0);
    setText("il-hold", fmt(holdVal));
    setText("il-exit", fmt(exitVal));
    setText("il-loss", fmt(loss));
    setText("il-covercap", fmt(coverCap));
    setText("il-coverable", fmt(coverable));
    setText("il-remaining", fmt(remaining));
    const vanilla = exitVal - holdVal;
    const shield = exitVal + coverable - holdVal;
    setText("il-vanilla", `${vanilla >= 0 ? "+" : ""}${fmt(vanilla)}`);
    setText("il-shield", `${shield >= 0 ? "+" : ""}${fmt(shield)}`);
  };

  document.addEventListener("input", (event) => {
    if (event.target?.id?.startsWith("il-")) window.calcIL();
    if (event.target?.id?.startsWith("sw-")) window.updateSwapPreview();
  });
}

function injectLiveDashboardCards() {
  if (document.getElementById("riskshield-live-metrics")) return;
  const overview = document.getElementById("panel-overview");

  const judgeFlow = document.createElement("div");
  judgeFlow.id = "riskshield-judge-flow";
  judgeFlow.className = "card judge-flow-card";
  judgeFlow.innerHTML = `
    <div class="card-title">Judge Demo Flow</div>
    <div class="card-sub">RiskShield turns IL into a priced risk market inside a real Uniswap v4 pool. Use these five checks to verify the full mechanism quickly.</div>
    <div class="judge-flow-grid">
      <div class="judge-step"><span class="judge-num">01</span><strong>Real v4 pool</strong><p>CREATE2-mined hook with permission bits 0x07c0, initialized through Unichain Sepolia PoolManager.</p></div>
      <div class="judge-step"><span class="judge-num">02</span><strong>Junior reserve</strong><p>Real Circle testnet USDC backs the first-loss insurance reserve and receives premium yield.</p></div>
      <div class="judge-step"><span class="judge-num">03</span><strong>Senior LP</strong><p>afterAddLiquidity records protected entry amounts, entry price, and coverage liability.</p></div>
      <div class="judge-step"><span class="judge-num">04</span><strong>Trader premium</strong><p>RiskShieldPoolRouter quotes the hook premium and pulls only the trader-paid USDC premium.</p></div>
      <div class="judge-step"><span class="judge-num">05</span><strong>IL settlement</strong><p>The vault compares hold value vs exit value and caps coverage by reserve, risk config, and liability.</p></div>
    </div>
  `;

  const metrics = document.createElement("div");
  metrics.id = "riskshield-live-metrics";
  metrics.className = "grid-2 live-metrics-grid";
  metrics.innerHTML = `
    <div class="card">
      <div class="card-title">Live Wallet Metrics</div>
      <div class="data-row"><span class="dr-key">Connected Wallet</span><span class="dr-val" id="live-wallet">Not connected</span></div>
      <div class="data-row"><span class="dr-key">Gas Balance</span><span class="dr-val" id="live-eth">0 ETH</span></div>
      <div class="data-row"><span class="dr-key">${RESERVE_SYMBOL} Balance</span><span class="dr-val green" id="live-usdc">0 ${RESERVE_SYMBOL}</span></div>
      <div class="data-row"><span class="dr-key">mRISK Balance</span><span class="dr-val" id="live-risk">0 mRISK</span></div>
      <div class="data-row"><span class="dr-key">Junior Shares</span><span class="dr-val" id="live-junior">0 ${RESERVE_SYMBOL}</span></div>
    </div>
    <div class="card">
      <div class="card-title">Live Protocol Metrics</div>
      <div class="data-row"><span class="dr-key">Vault Token Balance</span><span class="dr-val green" id="live-vault-token">0 ${RESERVE_SYMBOL}</span></div>
      <div class="data-row"><span class="dr-key">Vault Allowance</span><span class="dr-val" id="live-vault-allowance">0 ${RESERVE_SYMBOL}</span></div>
      <div class="data-row"><span class="dr-key">Router ${RESERVE_SYMBOL} Allowance</span><span class="dr-val" id="live-router-usdc-allowance">0 ${RESERVE_SYMBOL}</span></div>
      <div class="data-row"><span class="dr-key">Router mRISK Allowance</span><span class="dr-val" id="live-router-risk-allowance">0 mRISK</span></div>
      <div class="data-row"><span class="dr-key">Active Liability</span><span class="dr-val" id="live-active-liability">0 ${RESERVE_SYMBOL}</span></div>
      <div class="data-row"><span class="dr-key">Withdrawable Reserve</span><span class="dr-val" id="live-withdrawable-reserve">0 ${RESERVE_SYMBOL}</span></div>
      <div class="data-row"><span class="dr-key">Junior Share Price</span><span class="dr-val" id="live-junior-share-price">1.0000</span></div>
      <div class="data-row"><span class="dr-key">Senior Positions</span><span class="dr-val" id="live-next-position">0</span></div>
      <div class="data-row"><span class="dr-key">Pool ID</span><span class="dr-val" id="live-pool-id">0xf7ab8f...</span></div>
      <div class="data-row"><span class="dr-key">Pool Tick</span><span class="dr-val" id="live-pool-tick">Loading</span></div>
      <div class="data-row"><span class="dr-key">Pool Liquidity</span><span class="dr-val" id="live-pool-liquidity">Loading</span></div>
      <div class="data-row"><span class="dr-key">LP Fee</span><span class="dr-val" id="live-pool-lp-fee">Loading</span></div>
    </div>
  `;

  const activity = document.createElement("div");
  activity.id = "riskshield-tx-activity";
  activity.className = "card tx-activity-card";
  activity.innerHTML = `
    <div class="card-title">Confirmed Transaction Activity</div>
    <div class="card-sub">Every wallet action appears here with a Uniscan link after submission and confirmation.</div>
    <div id="tx-activity-list" class="tx-activity-list">
      <div class="tx-empty">No wallet transactions in this browser session yet.</div>
    </div>
  `;

  overview?.append(judgeFlow);
  overview?.append(metrics);
  overview?.append(activity);
}

function installFadeObservers() {
  const nodes = Array.from(document.querySelectorAll(".fade-up"));
  if (!nodes.length) return;

  if (!("IntersectionObserver" in window)) {
    nodes.forEach((node) => node.classList.add("in"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.08 },
  );

  nodes.forEach((node) => observer.observe(node));
  requestAnimationFrame(() => {
    nodes.slice(0, 4).forEach((node) => node.classList.add("in"));
  });
}

function resetPendingButtons() {
  document.querySelectorAll(".state-pending").forEach((btn) => {
    btn.classList.remove("state-pending");
    btn.disabled = false;
  });
}

function showDashboard(address) {
  injectLiveDashboardCards();
  const landing = document.getElementById("page-landing");
  const dashboard = document.getElementById("page-dashboard");
  const wasHidden = dashboard?.style.display !== "block";
  if (landing && dashboard) {
    landing.style.display = "none";
    dashboard.style.display = "block";
    window.scrollTo(0, 0);
  }
  setText("dash-wallet", short(address));
  setText("dash-chain", "Unichain Sepolia");
  if (wasHidden) toast(`Wallet connected ${short(address)}`);
}

function showLanding() {
  const landing = document.getElementById("page-landing");
  const dashboard = document.getElementById("page-dashboard");
  if (landing && dashboard) {
    dashboard.style.display = "none";
    landing.style.display = "block";
    window.scrollTo(0, 0);
  }
  setText("dash-wallet", "Not connected");
  setText("dash-chain", "Unichain Sepolia");
}

createRoot(document.getElementById("app")).render(
  <React.StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <RiskShieldShell />
          <Analytics />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);

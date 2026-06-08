# RiskShield Periphery and Routing

RiskShield uses a hook-aware router because the pool is not a plain v4 pool:

- the hook returns dynamic fee overrides in `beforeSwap`;
- senior LP accounting depends on hook data during liquidity changes;
- trader premiums must be paid into the insurance reserve as real USDC;
- the vault only accepts premium funding from approved routers.

## Current Hookathon Router

`RiskShieldPoolRouter` is the demo periphery used for the hookathon. It:

- initializes the v4 pool through PoolManager;
- adds/removes liquidity through PoolManager unlock flow;
- quotes premium bps from the hook before swap;
- pulls the quoted USDC premium from the trader;
- funds `RiskShieldVault` through an approved-router path;
- executes the v4 swap through PoolManager.

This keeps the demo deterministic and makes the insurance payment visible onchain.

## Why Normal Uniswap UI Routing Is Not Claimed

RiskShield uses a dynamic-fee hook and custom periphery behavior. A normal swap interface may not route through this pool natively because it does not know about the extra insurance premium payment and senior/junior accounting flow.

The correct production direction is a dedicated periphery path, or integration with Universal Router / Permit2 once the core risk engine is finalized.

For the UHI9 demo, "router quoteable" means the deployed `RiskShieldPoolRouter.quotePremium` function can quote the hook-aware premium path before execution. It does not mean the native Uniswap app or Universal Router has been extended to understand RiskShield's additional insurance-premium payment.

This distinction is intentional. The hookathon proof prioritizes a transparent, inspectable flow:

1. quote the premium from the hook;
2. pull only the calculated USDC premium from the trader;
3. fund the approved vault reserve path;
4. execute the v4 swap through PoolManager.

## Production Extension

A production version should add:

- Permit2 approvals for smoother token movement;
- Universal Router command support for hook-aware swaps;
- router allowlist governance;
- richer quote APIs for frontend routing;
- risk oracle adapters for production-grade exit pricing.

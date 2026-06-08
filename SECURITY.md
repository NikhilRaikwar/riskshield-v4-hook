# RiskShield Security Notes

RiskShield is a hookathon prototype, not production insurance. This file documents the current safety model and the areas that would need additional review before mainnet.

## Current Safety Model

- Hook callbacks verify `msg.sender == PoolManager`.
- The vault accepts premium funding only from approved routers.
- Router allowlisting is required because v4 hook `sender` is router context, not the original wallet.
- `beforeSwapReturnDelta` and `afterSwapReturnDelta` are disabled.
- Senior positions cannot open when reserve capacity is insufficient.
- Active protected liability tracks how much reserve backs open senior coverage.
- Junior withdrawals are blocked when they would drain reserve backing active senior protection.
- Senior coverage is capped by reserve balance, max coverage bps, and active position liability.
- The hook-aware router quotes the premium before execution and pulls only the calculated USDC premium from the trader.

## Hook Permissions

RiskShield uses permission bits `0x07c0`:

- `afterAddLiquidity`
- `beforeRemoveLiquidity`
- `afterRemoveLiquidity`
- `beforeSwap`
- `afterSwap`

RiskShield does not use return-delta swap permissions. This avoids the dangerous custom-delta path where a hook could claim to handle swap amounts without delivering expected output.

## Tested Risk Paths

The test suite covers:

- unauthorized router rejection;
- insufficient reserve blocking senior protection;
- junior share price increasing after trader-paid premium;
- junior share price decreasing after coverage payout;
- withdrawal blocked by active coverage buffer;
- trader-paid premium increasing actual reserve assets;
- premium scaling with trade size and tick movement;
- coverage capped by reserve, max coverage bps, and active liability;
- v4 hook permission mining;
- local PoolManager liquidity and swap integration.

## Production Hardening Needed

- Independent audit.
- Mainnet-grade oracle or pricing adapter for exit value inputs.
- Permit2 and Universal Router compatible periphery.
- Governance for router allowlist and risk config updates.
- Monitoring for reserve utilization, active liability, and premium inflows.
- More fuzz and invariant testing before real user funds.

# RiskShield Final Submission

## Project

RiskShield - Tranche-Based IL Insurance Hook

RiskShield turns impermanent loss into a priced, transferable risk market inside a Uniswap v4 pool. Senior LPs get protected liquidity. Junior insurers earn premium yield. Traders fund the reserve through hook-aware dynamic premiums.

## Theme Fit

UHI9: Impermanent Loss and Yield Systems

RiskShield directly targets LP impermanent-loss risk and creates a sustainable yield path for junior reserve providers.

## Repository

```text
https://github.com/NikhilRaikwar/riskshield-v4-hook
```

## Live Frontend

```text
https://riskshield.vercel.app/
```

## Canonical Deployment

```text
Network: Unichain Sepolia
Chain ID: 1301
USDC: 0x31d0220469e10c4E71834a79b1f276d740d3768F
MockRiskAsset: 0x0ca086118b4d1ff6599b75d9f14defbc3242ab78
RiskShieldVault: 0xe12b741707eb4b9a8762d58c2e36b909e345d5e4
RiskShieldHook: 0x49026475bca9C0FDD778dDF143E7a596b4D6C7C0
RiskShieldPoolRouter: 0xb4c8d25afac20572347977e9dc1d18c61d58c736
Pool ID: 0xb0dda0a853ae4eefb5ed690dc7de5cfefe01ef3572152e0170db69c3e57f71c4
Hook permission bits: 0x07c0
```

## Live Proof Transactions

```text
RiskShieldHook CREATE2 deploy:
https://sepolia.uniscan.xyz/tx/0x58c263d66c31c19722b6377ed24350b1aec01759cb708e3212b0c889e7a45f20

Pool initialize:
https://sepolia.uniscan.xyz/tx/0xc312b19a705727cf4381fc6adabd021ada1ff1cd9b4f8be560b4792e957c46a0

Deposit junior USDC reserve:
https://sepolia.uniscan.xyz/tx/0x0fb903ca579df3bb2459a101074e1be075ef1cf88f60ea3547c690b1d84d3390

Add protected senior liquidity:
https://sepolia.uniscan.xyz/tx/0x509383492f853e6e12213712f3ee677e8ab2449deeb182e55e87548c8c517b4d

Swap and pay quoted premium:
https://sepolia.uniscan.xyz/tx/0xe49dc0e0b373a2ef507d25a4e1b35d0d2be19cab7b70459322b590a45ab0ffab
```

## Verified State After Smoke Test

```text
Reserve available: 2.017 USDC
Junior balance: 2.017 USDC
Junior share price: 1.0085
Active protected liability: 0.6 USDC
Withdrawable reserve: 1.267 USDC
Senior positions opened: 1
Last premium: 17 bps
Quoted premium paid: 0.017 USDC
Pool tick: -30
Pool liquidity: 10000000000
```

## Demo Commands

```bash
npm run compile
npm run build
node tools/check-real-usdc-deployment.mjs
forge test -vv
forge test --gas-report
```

If `forge` is unavailable in a shell, use `npm run compile`, `npm run build`, and `node tools/check-real-usdc-deployment.mjs` for the live deployment proof, then point judges to the Foundry tests in `test/`.

## Honest Scope

RiskShield is deployed and demoable through a hook-aware `RiskShieldPoolRouter`. It is not claiming native Uniswap app routing or Universal Router / Permit2 integration yet. The production path is documented in `PERIPHERY.md`.

The reserve token is real Circle testnet USDC on Unichain Sepolia. The volatile asset is demo `mRISK` so the hookathon flow is deterministic and safe.

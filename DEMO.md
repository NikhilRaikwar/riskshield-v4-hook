# RiskShield Demo Script

Target length: 3 minutes.

Live app: `https://riskshield.vercel.app/`

## Core Pitch

RiskShield turns impermanent loss into a priced, transferable risk market inside a Uniswap v4 pool. Senior LPs get protected liquidity. Junior insurers earn premium yield. Traders fund the reserve through hook-aware dynamic premiums.

## Actors

- Alice: senior LP who wants protected liquidity exposure.
- Bob: junior insurer who accepts first-loss risk for premium yield.
- Trader: swaps through the RiskShield pool and pays the quoted USDC premium.

## Video Timeline

### 0:00-0:25 - Problem

Say:

```text
LPs earn swap fees, but they silently absorb impermanent loss and LVR. RiskShield makes that risk explicit, prices it on swaps, and lets different LPs choose different risk tranches.
```

Show:

- Landing hero.
- Problem section.
- Senior / junior / trader diagram.

### 0:25-0:55 - Mechanism

Say:

```text
Senior LPs provide protected liquidity and receive capped IL coverage. Junior insurers deposit first-loss USDC reserve capital and earn premium yield. Traders pay a small dynamic premium when swaps are larger or more volatile.
```

Show:

- Senior LP card.
- Junior reserve card.
- Trader premium card.

### 0:55-1:35 - Real v4 Proof

Show these exact proof points:

- Unichain Sepolia deployment.
- Hook address: `0x49026475bca9C0FDD778dDF143E7a596b4D6C7C0`.
- Hook permission bits: `0x07c0`.
- Pool ID: `0xb0dda0a853ae4eefb5ed690dc7de5cfefe01ef3572152e0170db69c3e57f71c4`.
- Add protected liquidity transaction:
  `https://sepolia.uniscan.xyz/tx/0x509383492f853e6e12213712f3ee677e8ab2449deeb182e55e87548c8c517b4d`
- Swap and pay premium transaction:
  `https://sepolia.uniscan.xyz/tx/0xe49dc0e0b373a2ef507d25a4e1b35d0d2be19cab7b70459322b590a45ab0ffab`

Say:

```text
This is not just local accounting. The hook address is mined with valid v4 permission bits, the pool is initialized through the real Unichain Sepolia PoolManager, senior liquidity was opened through modifyLiquidity, and a swap executed through PoolManager while the router pulled a trader-paid USDC premium into the reserve.
```

### 1:35-2:20 - Dashboard

Show:

- Open `https://riskshield.vercel.app/`.
- Click **Connect Wallet**.
- Choose MetaMask or the installed browser wallet.
- Approve the connection and switch to **Unichain Sepolia** if prompted.
- Overview live metrics.
- Reserve available: `2.017 USDC`.
- Junior share price: `1.0085`.
- Active protected liability: `0.6 USDC`.
- Last premium: `17 bps`.
- Trader premium quote.
- IL coverage simulator.

Say:

```text
I will connect my wallet and switch to Unichain Sepolia. The dashboard now reads live state from the deployed RiskShield contracts. The reserve has 2.017 USDC, the junior share price increased to 1.0085 after premium accrual, and 0.6 USDC is locked as active protected liability.
```

Then open each tab and say:

```text
In Junior Insurer, first-loss USDC capital earns trader-paid premium yield, while the withdrawal guard prevents reserve from being removed when it backs senior protection.

In Senior LP, afterAddLiquidity records the protected entry and creates a capped coverage liability.

In Trader Premium, the hook-aware router quotes the premium before execution, performs the real v4 swap through PoolManager, and transfers only the calculated USDC premium into the reserve.

In IL Coverage, the same insurance math compares hold value against LP exit value and caps the payout by reserve, coverage configuration, and position liability.
```

### 2:20-3:00 - Why It Wins

Say:

```text
RiskShield fits the UHI9 theme directly: impermanent-loss protection plus sustainable yield. The novel part is tranche-based LP risk separation inside the v4 pool lifecycle. It is deployed, tested, demoable with real testnet USDC, and honest about the production path: Universal Router and Permit2 support are next, while the hook-aware router proves the core mechanism now.
```

## Commands To Show If Time Allows

```bash
npm run compile
npm run build
node tools/check-real-usdc-deployment.mjs
forge test -vv
```

If Foundry is not available in the recording environment, say:

```text
The Foundry tests are included in the repo. In this shell, forge was not available, so I am showing npm compile/build plus the live deployment checker.
```

## Demo Checklist

- Landing page loads without horizontal overflow.
- Wallet connects on Unichain Sepolia.
- Disconnect returns to landing page.
- Overview shows live reserve, liability, junior share price, pool tick, and pool liquidity.
- Junior tab explains yield and locked reserve.
- Senior tab shows protected LP position and reserve-capacity concept.
- Trader Premium tab quotes premium before execution.
- IL Coverage tab compares vanilla LP loss vs RiskShield protected result.
- Deployment tab shows Uniscan links and honest MVP scope.

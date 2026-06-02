# RiskShield Real-USDC Deployment Plan

Network: Unichain Sepolia  
Reserve token: Circle testnet USDC  
USDC: `0x31d0220469e10c4E71834a79b1f276d740d3768F`  
PoolManager: `0x00B036B58a818B1BC34d502D3fE730Db729e62AC`  
StateView: `0xc199F1072a74D4e905ABa1A84d9a45E2546B6222`

## Why This Mode Exists

The first RiskShield deployment uses `MockUSDC` for deterministic local and testnet smoke tests.
The final demo should be stronger with real Circle testnet USDC as the insurance reserve token.

In real-USDC mode:

- Junior insurers deposit real faucet USDC into `RiskShieldVault`.
- Senior LPs use real USDC plus `MockRiskAsset` liquidity.
- Swap premium funding uses real USDC.
- `MockRiskAsset` remains a demo risk asset so the pool can be controlled for the hookathon.

## Deployment Command

```bash
forge script script/DeployV4RiskShieldRealUSDC.s.sol:DeployV4RiskShieldRealUSDC --rpc-url unichain_sepolia --broadcast
```

## Required Wallet Setup

Get Unichain Sepolia USDC from the Circle faucet before running the full smoke test:

```text
https://faucet.circle.com/
```

The deployer wallet needs:

- Unichain Sepolia ETH for gas.
- Unichain Sepolia USDC for junior deposits, pool liquidity, and premium funding.

## Post-Deployment Fields

Deployed June 2, 2026 on Unichain Sepolia:

```text
MockRiskAsset: 0x312751138a3ae633b942b9a8fad8f12de9361dac
RiskShieldVault: 0x5f1190906d31eefd9afe43b6631b3b20d712e7b2
HookDeployer: 0xa670d391658c9d54bbec9d1ff0b107e96a627abe
RiskShieldHook: 0x192D6906dC087978Fb86FbF4868D49144b7847C0
RiskShieldPoolRouter: 0xe4dc72b113ca3fb856a8b74da7d08410156513e1
Pool ID: 0x4647bc3b1532e12f33a997bccdf0e1f40c2a9d4e5216725de619a3619c4a82b8
Hook permission bits: 0x07c0
```

Transaction links:

```text
MockRiskAsset deploy: https://sepolia.uniscan.xyz/tx/0xe66f7f146a13fb0f1d8ab94d807dad0513f75890d903efa94a219465dd206de9
RiskShieldVault deploy: https://sepolia.uniscan.xyz/tx/0xc0f81f88a95b9c748c24f4fbb40d9a2bf2b9078a092838319d7524eacd963ec3
HookDeployer deploy: https://sepolia.uniscan.xyz/tx/0x52775ff7da2bfaf00b932385dde0997ec574d02d26fcfe85d5d1aa53a9ce07cb
RiskShieldHook CREATE2 deploy: https://sepolia.uniscan.xyz/tx/0x4e9597013a56a310491ca030506f2650a313c680e9e1639895f9099f0fc6dadf
Vault setHook: https://sepolia.uniscan.xyz/tx/0x5f6e5d7d8935715d654480975f575438c0c517ead7fcc1a373f773f2e7d4ef70
RiskShieldPoolRouter deploy: https://sepolia.uniscan.xyz/tx/0x4ec52d9e19ad3e4aaf02e9d71abe96bb3cf113a49fce86d30655c2bda310ce9e
Pool initialize: https://sepolia.uniscan.xyz/tx/0xdd8482a3fedaa582ca07893c12d579d5eeed5c35438828da57f14d6135dd638b
```

CLI smoke test transactions:

```text
Approve USDC to vault: https://sepolia.uniscan.xyz/tx/0xad13c7410cf1c10b19e2919fd01e76bfd15426e3e62e63bc6dc74a66b2f9f90d
Deposit junior USDC reserve: https://sepolia.uniscan.xyz/tx/0x9c3dc5f506d7c4f5afff2d42e558aca0a62891c906ec1411c2cc27f8fc36b0aa
Mint mRISK: https://sepolia.uniscan.xyz/tx/0x258739f1370bbcb42cd93976bfd7dee59cfd2dbc9aa4e43d3f8f0c5d2db81317
Approve mRISK to router: https://sepolia.uniscan.xyz/tx/0xd27700fe0b666f82501eb09668b722b8edacf2f729f166606296b77747768fc3
Approve USDC to router: https://sepolia.uniscan.xyz/tx/0x0bfa32ef928e1b21ce5eaf416f808125382e5e0ad4b8a9eb7c60a4e3571c53d5
Add protected senior liquidity: https://sepolia.uniscan.xyz/tx/0x18ceb2d6fa0dfefa9dc830c980f7240541e56ce1b7b22d20c3c2dd7f19284f37
Swap and fund premium: https://sepolia.uniscan.xyz/tx/0xe4b2dd8dac9f67493c06b45da40ee69379c1be48422456c71a6fd578266d9b91
```

Verified CLI smoke state:

```text
Vault USDC balance: 3 USDC
Reserve available: 3 USDC
Junior balance: 2 USDC
Senior positions opened: 1
Last premium: 17 bps
```

Frontend real-USDC mode:

```text
VITE_RISKSHIELD_MODE=real-usdc
VITE_RISKSHIELD_USDC=0x31d0220469e10c4E71834a79b1f276d740d3768F
VITE_RISKSHIELD_RISK_ASSET=0x312751138a3ae633b942b9a8fad8f12de9361dac
VITE_RISKSHIELD_VAULT=0x5f1190906d31eefd9afe43b6631b3b20d712e7b2
VITE_RISKSHIELD_HOOK=0x192D6906dC087978Fb86FbF4868D49144b7847C0
VITE_RISKSHIELD_ROUTER=0xe4dc72b113ca3fb856a8b74da7d08410156513e1
VITE_RISKSHIELD_POOL_ID=0x4647bc3b1532e12f33a997bccdf0e1f40c2a9d4e5216725de619a3619c4a82b8
```

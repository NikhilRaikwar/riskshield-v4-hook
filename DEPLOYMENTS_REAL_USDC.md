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

## Upgraded Deployment

Deployed June 2, 2026 on Unichain Sepolia after the risk-market upgrade:

```text
MockRiskAsset: 0x0ca086118b4d1ff6599b75d9f14defbc3242ab78
RiskShieldVault: 0xe12b741707eb4b9a8762d58c2e36b909e345d5e4
HookDeployer: 0xb3fc43699c0fea4de320cfbc1be75550558828f3
RiskShieldHook: 0x49026475bca9C0FDD778dDF143E7a596b4D6C7C0
RiskShieldPoolRouter: 0xb4c8d25afac20572347977e9dc1d18c61d58c736
Pool ID: 0xb0dda0a853ae4eefb5ed690dc7de5cfefe01ef3572152e0170db69c3e57f71c4
Hook permission bits: 0x07c0
```

The upgraded stack includes router allowlisting, active protected liability tracking, junior share accounting, junior withdrawal previews, and explicit `swapAndPayPremium` trader-paid premium funding.

Deployment transaction links:

```text
MockRiskAsset deploy: https://sepolia.uniscan.xyz/tx/0x93766ecaf015c09e597ad2e3446ee7231e69ac2ba04e6dad856a204e9313818b
RiskShieldVault deploy: https://sepolia.uniscan.xyz/tx/0x8c508188dae66aa031c9e0e5fb9e6c3aa8fd4f21e405e6995f0397b2559c7e4e
HookDeployer deploy: https://sepolia.uniscan.xyz/tx/0x04b72d824a75790040a4421d1bcda787d685ee956d052eacaff657c8b2abda53
RiskShieldHook CREATE2 deploy: https://sepolia.uniscan.xyz/tx/0x58c263d66c31c19722b6377ed24350b1aec01759cb708e3212b0c889e7a45f20
Vault setHook: https://sepolia.uniscan.xyz/tx/0xa98c0d708c491a1709c55e560ae2f63817e1a3473e6bfbd172b0723cdabe4329
RiskShieldPoolRouter deploy: https://sepolia.uniscan.xyz/tx/0x051133bf0b80cddfca0d730ed10ef1148def29437214d44ec726a2cf97862cb4
Vault setRouter: https://sepolia.uniscan.xyz/tx/0x4a04b60de7d1d8159c435736d999fde0f7f8f42b4a4a1261948ab4f9fab4ef3e
Pool initialize: https://sepolia.uniscan.xyz/tx/0xc312b19a705727cf4381fc6adabd021ada1ff1cd9b4f8be560b4792e957c46a0
```

CLI smoke test transactions:

```text
Approve USDC to vault: https://sepolia.uniscan.xyz/tx/0x9878b352b9ffb004931ea530e48f304d7b5a10ab88a09f174e08cb454b20f2ee
Deposit junior USDC reserve: https://sepolia.uniscan.xyz/tx/0x0fb903ca579df3bb2459a101074e1be075ef1cf88f60ea3547c690b1d84d3390
Mint mRISK: https://sepolia.uniscan.xyz/tx/0xaafaa7e56c111729e914d1fea0849aa8337c6611c4337e191055a4c0adc6ed35
Approve mRISK to router: https://sepolia.uniscan.xyz/tx/0x3aaa44f11c98f2c45a03f549ecdf94c7a4aec6c4c7603b5177bb73e76e6065b7
Approve USDC to router: https://sepolia.uniscan.xyz/tx/0x3ef7a97a3f08780e47983a9dae5957203b1d6ebfcfca8554369b232006ff78c0
Add protected senior liquidity: https://sepolia.uniscan.xyz/tx/0x509383492f853e6e12213712f3ee677e8ab2449deeb182e55e87548c8c517b4d
Swap and pay quoted premium: https://sepolia.uniscan.xyz/tx/0xe49dc0e0b373a2ef507d25a4e1b35d0d2be19cab7b70459322b590a45ab0ffab
```

Verified CLI smoke state:

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

Frontend real-USDC mode:

```text
VITE_RISKSHIELD_MODE=real-usdc
VITE_RISKSHIELD_USDC=0x31d0220469e10c4E71834a79b1f276d740d3768F
VITE_RISKSHIELD_RISK_ASSET=0x0ca086118b4d1ff6599b75d9f14defbc3242ab78
VITE_RISKSHIELD_VAULT=0xe12b741707eb4b9a8762d58c2e36b909e345d5e4
VITE_RISKSHIELD_HOOK=0x49026475bca9C0FDD778dDF143E7a596b4D6C7C0
VITE_RISKSHIELD_ROUTER=0xb4c8d25afac20572347977e9dc1d18c61d58c736
VITE_RISKSHIELD_POOL_ID=0xb0dda0a853ae4eefb5ed690dc7de5cfefe01ef3572152e0170db69c3e57f71c4
```

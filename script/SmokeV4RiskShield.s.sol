// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {IERC20} from "../src/IERC20.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockRiskAsset} from "../src/mocks/MockRiskAsset.sol";
import {RiskShieldHook} from "../src/RiskShieldHook.sol";
import {RiskShieldPoolRouter} from "../src/RiskShieldPoolRouter.sol";
import {RiskShieldVault} from "../src/RiskShieldVault.sol";

contract SmokeV4RiskShield is Script {
    using PoolIdLibrary for PoolKey;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        MockUSDC usdc = MockUSDC(vm.envAddress("V4_MOCK_USDC"));
        MockRiskAsset risk = MockRiskAsset(vm.envAddress("V4_MOCK_RISK_ASSET"));
        RiskShieldVault vault = RiskShieldVault(vm.envAddress("V4_RISKSHIELD_VAULT"));
        RiskShieldHook hook = RiskShieldHook(vm.envAddress("V4_RISKSHIELD_HOOK"));
        RiskShieldPoolRouter router = RiskShieldPoolRouter(vm.envAddress("V4_RISKSHIELD_ROUTER"));
        PoolKey memory key = _poolKey(risk, usdc, hook);
        bytes32 poolId = PoolId.unwrap(key.toId());

        vm.startBroadcast(deployerKey);

        vault.setRouter(address(router), true);
        usdc.mint(deployer, 10_000e6);
        risk.mint(deployer, 10_000 ether);
        IERC20(address(usdc)).approve(address(vault), type(uint256).max);
        vault.depositJunior(poolId, 1_000e6);
        IERC20(address(usdc)).approve(address(router), type(uint256).max);
        IERC20(address(risk)).approve(address(router), type(uint256).max);

        router.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: -60, tickUpper: 60, liquidityDelta: 1e12, salt: bytes32(0)}),
            abi.encode(uint8(1), deployer, 1 ether, 2_000e6, 2_000e18)
        );

        (, uint256 premiumAmount) = router.swapAndPayPremium(
            key,
            SwapParams({zeroForOne: true, amountSpecified: -1e9, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            abi.encode(int24(120)),
            1_000e6,
            poolId
        );

        require(hook.lastPremiumBps(key.toId()) > 0, "premium missing");
        require(premiumAmount > 0, "premium unpaid");
        require(vault.reserveAvailable(poolId) >= 1_000e6 + premiumAmount, "reserve missing");

        vm.stopBroadcast();
    }

    function _poolKey(MockRiskAsset risk, MockUSDC usdc, RiskShieldHook hook)
        internal
        pure
        returns (PoolKey memory key)
    {
        (Currency currency0, Currency currency1) = address(risk) < address(usdc)
            ? (Currency.wrap(address(risk)), Currency.wrap(address(usdc)))
            : (Currency.wrap(address(usdc)), Currency.wrap(address(risk)));

        key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
    }
}

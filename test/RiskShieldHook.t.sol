// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "v4-core/src/libraries/LPFeeLibrary.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {BalanceDeltaLibrary} from "v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";

import {RiskShieldHook} from "../src/RiskShieldHook.sol";
import {RiskShieldVault} from "../src/RiskShieldVault.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockRiskAsset} from "../src/mocks/MockRiskAsset.sol";

contract UnauthorizedHookCaller {
    function callBeforeSwap(RiskShieldHook hook, PoolKey calldata key, SwapParams calldata params) external {
        hook.beforeSwap(address(this), key, params, "");
    }
}

contract RiskShieldHookTest {
    using PoolIdLibrary for PoolKey;

    MockUSDC internal usdc;
    MockRiskAsset internal risk;
    RiskShieldVault internal vault;
    RiskShieldHook internal hook;
    PoolKey internal key;

    uint256 internal constant USDC = 1e6;

    constructor() {
        usdc = new MockUSDC();
        risk = new MockRiskAsset();
        vault = new RiskShieldVault(usdc, address(this));
        hook = new RiskShieldHook(address(this), vault);
        vault.setHook(address(hook));
        vault.setRouter(address(this), true);

        key = PoolKey({
            currency0: Currency.wrap(address(risk)),
            currency1: Currency.wrap(address(usdc)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });

        usdc.mint(address(this), 10_000_000 * USDC);
        usdc.approve(address(vault), 10_000_000 * USDC);
        vault.depositJunior(PoolId.unwrap(key.toId()), 10_000_000 * USDC);
    }

    function testBeforeSwapReturnsDynamicPremiumFee() external {
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -100_000 * int256(USDC),
            sqrtPriceLimitX96: 0
        });

        (, , uint24 feeOverride) = hook.beforeSwap(address(this), key, params, abi.encode(int24(120)));

        require(feeOverride & LPFeeLibrary.OVERRIDE_FEE_FLAG != 0, "override flag missing");
        require((feeOverride & LPFeeLibrary.REMOVE_OVERRIDE_MASK) > 0, "fee missing");
    }

    function testLargerTickMoveCreatesHigherPremium() external {
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -10_000 * int256(USDC),
            sqrtPriceLimitX96: 0
        });

        hook.beforeSwap(address(this), key, params, abi.encode(int24(10)));
        uint256 lowVolPremium = hook.lastPremiumBps(key.toId());

        hook.beforeSwap(address(this), key, params, abi.encode(int24(1_000)));
        uint256 highVolPremium = hook.lastPremiumBps(key.toId());

        require(highVolPremium > lowVolPremium, "premium did not rise");
    }

    function testPremiumIsCappedAtMaxPremium() external {
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -100_000_000 * int256(USDC),
            sqrtPriceLimitX96: 0
        });

        hook.beforeSwap(address(this), key, params, abi.encode(int24(100_000)));

        require(hook.lastPremiumBps(key.toId()) == hook.maxPremiumBps(), "premium not capped");
    }

    function testAfterSwapRecordsPremiumAnalytics() external {
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -100_000 * int256(USDC),
            sqrtPriceLimitX96: 0
        });

        hook.beforeSwap(address(this), key, params, abi.encode(int24(120)));
        hook.afterSwap(address(this), key, params, BalanceDeltaLibrary.ZERO_DELTA, "");

        require(hook.lastPremiumAmount(key.toId()) > 0, "premium amount missing");
        require(hook.totalPremiumObserved(key.toId()) > 0, "premium analytics missing");
    }

    function testOnlyPoolManagerCanCallHookCallbacks() external {
        UnauthorizedHookCaller caller = new UnauthorizedHookCaller();
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -100_000 * int256(USDC),
            sqrtPriceLimitX96: 0
        });

        try caller.callBeforeSwap(hook, key, params) {
            revert("unauthorized call succeeded");
        } catch {}
    }

    function testAfterAddLiquidityOpensSeniorPosition() external {
        ModifyLiquidityParams memory params =
            ModifyLiquidityParams({tickLower: -60, tickUpper: 60, liquidityDelta: 100, salt: bytes32(0)});

        hook.afterAddLiquidity(
            address(0xA11CE),
            key,
            params,
            BalanceDeltaLibrary.ZERO_DELTA,
            BalanceDeltaLibrary.ZERO_DELTA,
            abi.encode(uint8(1), 1 ether, 2_000 * USDC, 2_000e18)
        );

        (, address owner,,,,,,) = vault.seniorPositions(1);
        require(owner == address(0xA11CE), "senior owner mismatch");
    }

    function testAfterAddLiquidityIgnoresNonSeniorHookData() external {
        ModifyLiquidityParams memory params =
            ModifyLiquidityParams({tickLower: -60, tickUpper: 60, liquidityDelta: 100, salt: bytes32(0)});

        hook.afterAddLiquidity(
            address(0xB0B),
            key,
            params,
            BalanceDeltaLibrary.ZERO_DELTA,
            BalanceDeltaLibrary.ZERO_DELTA,
            abi.encode(uint8(0), 1 ether, 2_000 * USDC, 2_000e18)
        );

        require(vault.nextPositionId() == 1, "non-senior opened");
    }

    function testBeforeRemoveLiquidityReturnsSelector() external view {
        ModifyLiquidityParams memory params =
            ModifyLiquidityParams({tickLower: -60, tickUpper: 60, liquidityDelta: -100, salt: bytes32(0)});

        bytes4 selector = hook.beforeRemoveLiquidity(address(this), key, params, "");

        require(selector == IHooks.beforeRemoveLiquidity.selector, "bad selector");
    }
}

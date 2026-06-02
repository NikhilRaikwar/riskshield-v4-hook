// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";

import {InsuranceMath} from "./InsuranceMath.sol";
import {RiskShieldVault} from "./RiskShieldVault.sol";

contract RiskShieldHook is IHooks {
    using PoolIdLibrary for PoolKey;
    using BalanceDeltaLibrary for BalanceDelta;

    uint256 internal constant BPS = 10_000;
    uint8 internal constant TRANCHE_NONE = 0;
    uint8 internal constant TRANCHE_SENIOR = 1;

    address public immutable poolManager;
    RiskShieldVault public immutable vault;

    uint256 public basePremiumBps = 5;
    uint256 public maxPremiumBps = 100;
    uint256 public referenceLiquidity = 1_000_000e6;

    mapping(PoolId poolId => uint256 premiumBps) public lastPremiumBps;
    mapping(PoolId poolId => uint256 premiumAmount) public lastPremiumAmount;
    mapping(PoolId poolId => uint256 premiumAmount) public totalPremiumObserved;
    mapping(PoolId poolId => int24 tick) public lastObservedTick;

    event PremiumQuoted(PoolId indexed poolId, uint256 premiumBps, uint24 feeOverride);
    event PremiumObserved(PoolId indexed poolId, uint256 premiumAmount);

    error NotPoolManager();
    error UnsupportedCallback();

    modifier onlyPoolManager() {
        if (msg.sender != poolManager) revert NotPoolManager();
        _;
    }

    constructor(address poolManager_, RiskShieldVault vault_) {
        poolManager = poolManager_;
        vault = vault_;
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: true,
            beforeRemoveLiquidity: true,
            afterRemoveLiquidity: true,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function afterAddLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        BalanceDelta,
        BalanceDelta,
        bytes calldata hookData
    ) external onlyPoolManager returns (bytes4, BalanceDelta) {
        if (hookData.length != 0) {
            uint8 tranche;
            address owner;
            uint256 amount0;
            uint256 amount1;
            uint256 entryPriceWad;

            if (hookData.length == 160) {
                (tranche, owner, amount0, amount1, entryPriceWad) =
                    abi.decode(hookData, (uint8, address, uint256, uint256, uint256));
            } else {
                (tranche, amount0, amount1, entryPriceWad) =
                    abi.decode(hookData, (uint8, uint256, uint256, uint256));
                owner = sender;
            }

            if (tranche == TRANCHE_SENIOR) {
                vault.openSeniorPosition(
                    PoolId.unwrap(key.toId()),
                    owner,
                    amount0,
                    amount1,
                    entryPriceWad,
                    uint256(params.liquidityDelta)
                );
            }
        }

        return (IHooks.afterAddLiquidity.selector, BalanceDeltaLibrary.ZERO_DELTA);
    }

    function beforeRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        bytes calldata
    ) external view onlyPoolManager returns (bytes4) {
        return IHooks.beforeRemoveLiquidity.selector;
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata hookData
    ) external onlyPoolManager returns (bytes4, BalanceDelta) {
        if (hookData.length != 0) {
            (uint256 positionId, uint256 exitAmount0, uint256 exitAmount1, uint256 exitPriceWad) =
                abi.decode(hookData, (uint256, uint256, uint256, uint256));
            vault.closeSeniorPosition(positionId, exitAmount0, exitAmount1, exitPriceWad);
        }

        return (IHooks.afterRemoveLiquidity.selector, BalanceDeltaLibrary.ZERO_DELTA);
    }

    function beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        uint256 premium = previewPremiumBps(key, params, hookData);
        if (hookData.length != 0) {
            (int24 observedTick) = abi.decode(hookData, (int24));
            PoolId poolId = key.toId();
            lastObservedTick[poolId] = observedTick;
        }

        PoolId id = key.toId();
        lastPremiumBps[id] = premium;

        uint24 feeOverride = uint24(premium * 100) | LPFeeLibrary.OVERRIDE_FEE_FLAG;
        emit PremiumQuoted(id, premium, feeOverride);

        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, feeOverride);
    }

    function previewPremiumBps(PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        public
        view
        returns (uint256 premium)
    {
        uint256 tickMove = 0;
        if (hookData.length != 0) {
            (int24 observedTick) = abi.decode(hookData, (int24));
            PoolId poolId = key.toId();
            tickMove = InsuranceMath.abs(int256(observedTick) - int256(lastObservedTick[poolId]));
        }

        uint256 tradeAmount = InsuranceMath.abs(params.amountSpecified);
        premium = InsuranceMath.premiumBps(basePremiumBps, tradeAmount, referenceLiquidity, tickMove, maxPremiumBps);
    }

    function afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta,
        bytes calldata
    ) external onlyPoolManager returns (bytes4, int128) {
        PoolId id = key.toId();
        uint256 premium = (InsuranceMath.abs(params.amountSpecified) * lastPremiumBps[id]) / BPS;
        lastPremiumAmount[id] = premium;
        totalPremiumObserved[id] += premium;
        emit PremiumObserved(id, premium);
        return (IHooks.afterSwap.selector, 0);
    }

    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        revert UnsupportedCallback();
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert UnsupportedCallback();
    }

    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert UnsupportedCallback();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert UnsupportedCallback();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert UnsupportedCallback();
    }
}

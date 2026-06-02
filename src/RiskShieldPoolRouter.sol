// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";

import {IERC20} from "./IERC20.sol";
import {RiskShieldHook} from "./RiskShieldHook.sol";
import {RiskShieldVault} from "./RiskShieldVault.sol";

contract RiskShieldPoolRouter is IUnlockCallback {
    using BalanceDeltaLibrary for BalanceDelta;
    using CurrencyLibrary for Currency;

    uint256 internal constant BPS = 10_000;

    enum Action {
        ModifyLiquidity,
        Swap
    }

    struct CallbackData {
        Action action;
        address payer;
        PoolKey key;
        ModifyLiquidityParams liquidityParams;
        SwapParams swapParams;
        bytes hookData;
        uint256 reservePremiumAmount;
        bytes32 premiumPoolId;
    }

    IPoolManager public immutable poolManager;
    RiskShieldVault public immutable vault;
    IERC20 public immutable reserveToken;

    event LiquidityModified(address indexed payer, BalanceDelta delta, BalanceDelta feesAccrued);
    event PremiumPaid(bytes32 indexed poolId, address indexed trader, uint256 premiumAmount, uint256 premiumBps);
    event SwapExecuted(address indexed payer, BalanceDelta delta, uint256 reservePremiumAmount);

    error NotPoolManager();
    error TransferFailed();

    constructor(IPoolManager poolManager_, RiskShieldVault vault_) {
        poolManager = poolManager_;
        vault = vault_;
        reserveToken = vault_.reserveToken();
    }

    function initialize(PoolKey calldata key, uint160 sqrtPriceX96) external returns (int24 tick) {
        return poolManager.initialize(key, sqrtPriceX96);
    }

    function modifyLiquidity(PoolKey calldata key, ModifyLiquidityParams calldata params, bytes calldata hookData)
        external
        returns (BalanceDelta delta, BalanceDelta feesAccrued)
    {
        bytes memory result = poolManager.unlock(
            abi.encode(
                CallbackData({
                    action: Action.ModifyLiquidity,
                    payer: msg.sender,
                    key: key,
                    liquidityParams: params,
                    swapParams: SwapParams({zeroForOne: false, amountSpecified: 0, sqrtPriceLimitX96: 0}),
                    hookData: hookData,
                    reservePremiumAmount: 0,
                    premiumPoolId: bytes32(0)
                })
            )
        );

        (delta, feesAccrued) = abi.decode(result, (BalanceDelta, BalanceDelta));
    }

    function swapAndFundPremium(
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata hookData,
        uint256 reservePremiumAmount,
        bytes32 premiumPoolId
    ) external returns (BalanceDelta delta) {
        if (reservePremiumAmount != 0) {
            _fundPremium(msg.sender, premiumPoolId, reservePremiumAmount, 0);
        }

        bytes memory result = poolManager.unlock(
            abi.encode(
                CallbackData({
                    action: Action.Swap,
                    payer: msg.sender,
                    key: key,
                    liquidityParams: ModifyLiquidityParams({
                        tickLower: 0,
                        tickUpper: 0,
                        liquidityDelta: 0,
                        salt: bytes32(0)
                    }),
                    swapParams: params,
                    hookData: hookData,
                    reservePremiumAmount: reservePremiumAmount,
                    premiumPoolId: premiumPoolId
                })
            )
        );

        delta = abi.decode(result, (BalanceDelta));
    }

    function quotePremium(PoolKey calldata key, SwapParams calldata params, bytes calldata hookData, uint256 premiumBaseAmount)
        public
        view
        returns (uint256 premiumBps, uint256 premiumAmount)
    {
        premiumBps = RiskShieldHook(address(key.hooks)).previewPremiumBps(key, params, hookData);
        premiumAmount = (premiumBaseAmount * premiumBps) / BPS;
    }

    function swapAndPayPremium(
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata hookData,
        uint256 premiumBaseAmount,
        bytes32 premiumPoolId
    ) external returns (BalanceDelta delta, uint256 premiumAmount) {
        (uint256 premiumBps, uint256 quotedPremiumAmount) = quotePremium(key, params, hookData, premiumBaseAmount);
        premiumAmount = quotedPremiumAmount;
        if (premiumAmount != 0) {
            _fundPremium(msg.sender, premiumPoolId, premiumAmount, premiumBps);
            emit PremiumPaid(premiumPoolId, msg.sender, premiumAmount, premiumBps);
        }

        bytes memory result = poolManager.unlock(
            abi.encode(
                CallbackData({
                    action: Action.Swap,
                    payer: msg.sender,
                    key: key,
                    liquidityParams: ModifyLiquidityParams({
                        tickLower: 0,
                        tickUpper: 0,
                        liquidityDelta: 0,
                        salt: bytes32(0)
                    }),
                    swapParams: params,
                    hookData: hookData,
                    reservePremiumAmount: premiumAmount,
                    premiumPoolId: premiumPoolId
                })
            )
        );

        delta = abi.decode(result, (BalanceDelta));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();

        CallbackData memory callbackData = abi.decode(data, (CallbackData));
        if (callbackData.action == Action.ModifyLiquidity) {
            (BalanceDelta delta, BalanceDelta feesAccrued) =
                poolManager.modifyLiquidity(callbackData.key, callbackData.liquidityParams, callbackData.hookData);
            _settleDelta(callbackData.key, delta, callbackData.payer);
            emit LiquidityModified(callbackData.payer, delta, feesAccrued);
            return abi.encode(delta, feesAccrued);
        }

        BalanceDelta swapDelta = poolManager.swap(callbackData.key, callbackData.swapParams, callbackData.hookData);
        _settleDelta(callbackData.key, swapDelta, callbackData.payer);
        emit SwapExecuted(callbackData.payer, swapDelta, callbackData.reservePremiumAmount);
        return abi.encode(swapDelta);
    }

    function _settleDelta(PoolKey memory key, BalanceDelta delta, address payer) internal {
        _settleCurrency(key.currency0, delta.amount0(), payer);
        _settleCurrency(key.currency1, delta.amount1(), payer);
    }

    function _settleCurrency(Currency currency, int128 delta, address payer) internal {
        if (delta < 0) {
            uint256 amount = uint128(-delta);
            poolManager.sync(currency);
            bool ok = IERC20(Currency.unwrap(currency)).transferFrom(payer, address(poolManager), amount);
            if (!ok) revert TransferFailed();
            poolManager.settle();
        } else if (delta > 0) {
            poolManager.take(currency, payer, uint128(delta));
        }
    }

    function _fundPremium(address trader, bytes32 poolId, uint256 amount, uint256 premiumBps) internal {
        bool pulled = reserveToken.transferFrom(trader, address(this), amount);
        if (!pulled) revert TransferFailed();

        bool approved = reserveToken.approve(address(vault), amount);
        if (!approved) revert TransferFailed();
        vault.fundPremiumWithBps(poolId, amount, premiumBps);
    }
}

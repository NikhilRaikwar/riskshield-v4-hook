// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";

import {HookDeployer} from "../src/HookDeployer.sol";
import {RiskShieldHook} from "../src/RiskShieldHook.sol";
import {RiskShieldPoolRouter} from "../src/RiskShieldPoolRouter.sol";
import {RiskShieldVault} from "../src/RiskShieldVault.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockRiskAsset} from "../src/mocks/MockRiskAsset.sol";

contract RiskShieldV4IntegrationTest {
    using PoolIdLibrary for PoolKey;

    uint160 internal constant HOOK_FLAGS = 0x07c0;
    uint160 internal constant ALL_HOOK_MASK = uint160((1 << 14) - 1);
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint256 internal constant USDC = 1e6;

    PoolManager internal manager;
    MockUSDC internal usdc;
    MockRiskAsset internal risk;
    RiskShieldVault internal vault;
    RiskShieldHook internal hook;
    RiskShieldPoolRouter internal router;
    PoolKey internal key;

    constructor() {
        manager = new PoolManager(address(this));
        usdc = new MockUSDC();
        risk = new MockRiskAsset();
        vault = new RiskShieldVault(usdc, address(this));

        HookDeployer deployer = new HookDeployer();
        bytes memory initCode = abi.encodePacked(
            type(RiskShieldHook).creationCode, abi.encode(address(manager), vault)
        );
        bytes32 salt = _mineSalt(address(deployer), keccak256(initCode));
        hook = RiskShieldHook(deployer.deploy(salt, initCode));
        vault.setHook(address(hook));
        router = new RiskShieldPoolRouter(manager, vault);
        vault.setRouter(address(router), true);

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

    function testMinedHookHasExactPermissionBits() external view {
        require(uint160(address(hook)) & ALL_HOOK_MASK == HOOK_FLAGS, "bad hook flags");
    }

    function testPoolInitializesWithMinedRiskShieldHook() external {
        int24 tick = router.initialize(key, SQRT_PRICE_1_1);
        require(tick == 0, "unexpected initial tick");
    }

    function testRealPoolManagerAddLiquidityOpensSeniorPosition() external {
        router.initialize(key, SQRT_PRICE_1_1);

        risk.mint(address(this), 10_000 ether);
        usdc.mint(address(this), 10_000_000 * USDC);
        usdc.approve(address(vault), type(uint256).max);
        vault.depositJunior(PoolId.unwrap(key.toId()), 1_000_000 * USDC);
        risk.approve(address(router), type(uint256).max);
        usdc.approve(address(router), type(uint256).max);

        ModifyLiquidityParams memory params =
            ModifyLiquidityParams({tickLower: -60, tickUpper: 60, liquidityDelta: 1e12, salt: bytes32(0)});
        router.modifyLiquidity(
            key,
            params,
            abi.encode(uint8(1), address(this), 1 ether, 2_000 * USDC, 2_000e18)
        );

        (, address owner,,,,,,) = vault.seniorPositions(1);
        require(owner == address(this), "senior owner mismatch");
    }

    function testRealPoolManagerSwapUpdatesPremiumAndFundsReserve() external {
        router.initialize(key, SQRT_PRICE_1_1);

        risk.mint(address(this), 10_000 ether);
        usdc.mint(address(this), 10_000_000 * USDC);
        usdc.approve(address(vault), type(uint256).max);
        vault.depositJunior(PoolId.unwrap(key.toId()), 1_000_000 * USDC);
        risk.approve(address(router), type(uint256).max);
        usdc.approve(address(router), type(uint256).max);

        ModifyLiquidityParams memory params =
            ModifyLiquidityParams({tickLower: -60, tickUpper: 60, liquidityDelta: 1e12, salt: bytes32(0)});
        router.modifyLiquidity(
            key,
            params,
            abi.encode(uint8(1), address(this), 1 ether, 2_000 * USDC, 2_000e18)
        );

        SwapParams memory swapParams = SwapParams({
            zeroForOne: true,
            amountSpecified: -1e9,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        });
        bytes32 poolId = PoolId.unwrap(key.toId());
        router.swapAndFundPremium(key, swapParams, abi.encode(int24(120)), 10 * USDC, poolId);

        require(hook.lastPremiumBps(key.toId()) > 0, "premium not quoted");
        require(vault.reserveAvailable(poolId) >= 10 * USDC, "reserve not funded");
    }

    function testRealPoolManagerSwapPaysQuotedPremiumFromTrader() external {
        router.initialize(key, SQRT_PRICE_1_1);

        risk.mint(address(this), 10_000 ether);
        usdc.mint(address(this), 10_000_000 * USDC);
        usdc.approve(address(vault), type(uint256).max);
        vault.depositJunior(PoolId.unwrap(key.toId()), 1_000_000 * USDC);
        risk.approve(address(router), type(uint256).max);
        usdc.approve(address(router), type(uint256).max);

        ModifyLiquidityParams memory params =
            ModifyLiquidityParams({tickLower: -60, tickUpper: 60, liquidityDelta: 1e12, salt: bytes32(0)});
        router.modifyLiquidity(
            key,
            params,
            abi.encode(uint8(1), address(this), 1 ether, 2_000 * USDC, 2_000e18)
        );

        SwapParams memory swapParams = SwapParams({
            zeroForOne: true,
            amountSpecified: -1e9,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        });
        bytes memory hookData = abi.encode(int24(120));
        bytes32 poolId = PoolId.unwrap(key.toId());
        (, uint256 premiumAmount) = router.quotePremium(key, swapParams, hookData, 1_000 * USDC);
        uint256 reserveBefore = vault.reserveAvailable(poolId);

        router.swapAndPayPremium(key, swapParams, hookData, 1_000 * USDC, poolId);

        require(premiumAmount > 0, "premium not quoted");
        require(vault.reserveAvailable(poolId) == reserveBefore + premiumAmount, "premium not paid");
    }

    function _mineSalt(address deployer, bytes32 initCodeHash) internal pure returns (bytes32 salt) {
        for (uint256 i = 0; i < 1_000_000; i++) {
            salt = bytes32(i);
            address predicted = address(
                uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash))))
            );
            if (uint160(predicted) & ALL_HOOK_MASK == HOOK_FLAGS) return salt;
        }

        revert("salt not found");
    }
}

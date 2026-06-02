// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "v4-core/src/libraries/LPFeeLibrary.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";

import {HookDeployer} from "../src/HookDeployer.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockRiskAsset} from "../src/mocks/MockRiskAsset.sol";
import {RiskShieldHook} from "../src/RiskShieldHook.sol";
import {RiskShieldPoolRouter} from "../src/RiskShieldPoolRouter.sol";
import {RiskShieldVault} from "../src/RiskShieldVault.sol";

contract DeployV4RiskShield is Script {
    address public constant UNICHAIN_SEPOLIA_POOL_MANAGER = 0x00B036B58a818B1BC34d502D3fE730Db729e62AC;
    uint160 public constant HOOK_FLAGS = 0x07c0;
    uint160 public constant ALL_HOOK_MASK = uint160((1 << 14) - 1);
    uint160 public constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    function run()
        external
        returns (
            MockUSDC usdc,
            MockRiskAsset risk,
            RiskShieldVault vault,
            HookDeployer hookDeployer,
            RiskShieldHook hook,
            RiskShieldPoolRouter router
        )
    {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        usdc = new MockUSDC();
        risk = new MockRiskAsset();
        vault = new RiskShieldVault(usdc, deployer);
        hookDeployer = new HookDeployer();

        bytes memory initCode = abi.encodePacked(
            type(RiskShieldHook).creationCode, abi.encode(UNICHAIN_SEPOLIA_POOL_MANAGER, vault)
        );
        bytes32 salt = _mineSalt(address(hookDeployer), keccak256(initCode));
        hook = RiskShieldHook(hookDeployer.deploy(salt, initCode));
        vault.setHook(address(hook));

        router = new RiskShieldPoolRouter(IPoolManager(UNICHAIN_SEPOLIA_POOL_MANAGER), vault);
        vault.setRouter(address(router), true);
        router.initialize(_poolKey(risk, usdc, hook), SQRT_PRICE_1_1);

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

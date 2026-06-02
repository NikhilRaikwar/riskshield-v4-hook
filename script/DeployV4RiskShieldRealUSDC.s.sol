// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "v4-core/src/libraries/LPFeeLibrary.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";

import {HookDeployer} from "../src/HookDeployer.sol";
import {IERC20} from "../src/IERC20.sol";
import {MockRiskAsset} from "../src/mocks/MockRiskAsset.sol";
import {RiskShieldHook} from "../src/RiskShieldHook.sol";
import {RiskShieldPoolRouter} from "../src/RiskShieldPoolRouter.sol";
import {RiskShieldVault} from "../src/RiskShieldVault.sol";

contract DeployV4RiskShieldRealUSDC is Script {
    address public constant UNICHAIN_SEPOLIA_POOL_MANAGER = 0x00B036B58a818B1BC34d502D3fE730Db729e62AC;
    address public constant DEFAULT_UNICHAIN_SEPOLIA_USDC = 0x31d0220469e10c4E71834a79b1f276d740d3768F;
    uint160 public constant HOOK_FLAGS = 0x07c0;
    uint160 public constant ALL_HOOK_MASK = uint160((1 << 14) - 1);
    uint160 public constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    function run()
        external
        returns (
            IERC20 usdc,
            MockRiskAsset risk,
            RiskShieldVault vault,
            HookDeployer hookDeployer,
            RiskShieldHook hook,
            RiskShieldPoolRouter router
        )
    {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address usdcAddress = DEFAULT_UNICHAIN_SEPOLIA_USDC;

        vm.startBroadcast(deployerKey);

        usdc = IERC20(usdcAddress);
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
        router.initialize(_poolKey(address(risk), usdcAddress, address(hook)), SQRT_PRICE_1_1);

        vm.stopBroadcast();
    }

    function _poolKey(address risk, address usdc, address hook) internal pure returns (PoolKey memory key) {
        (Currency currency0, Currency currency1) = risk < usdc
            ? (Currency.wrap(risk), Currency.wrap(usdc))
            : (Currency.wrap(usdc), Currency.wrap(risk));

        key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(hook)
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

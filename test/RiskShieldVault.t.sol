// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {InsuranceMath} from "../src/InsuranceMath.sol";
import {RiskShieldVault} from "../src/RiskShieldVault.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

contract RiskShieldVaultTest {
    MockUSDC internal usdc;
    RiskShieldVault internal vault;
    bytes32 internal constant POOL_ID = keccak256("RISK/USDC");

    uint256 internal constant USDC = 1e6;
    uint256 internal constant WAD = 1e18;

    constructor() {
        usdc = new MockUSDC();
        vault = new RiskShieldVault(usdc, address(this));
        vault.setHook(address(this));
        vault.setRouter(address(this), true);
    }

    function testSeniorDepositTracksEntryAmounts() external {
        _depositJunior(10_000 * USDC);

        uint256 id = vault.openSeniorPosition(POOL_ID, address(0xA11CE), 10 ether, 20_000 * USDC, 2_000 * WAD, 100);
        (
            bytes32 poolId,
            address owner,
            uint256 entryAmount0,
            uint256 entryAmount1,
            uint256 entryPriceWad,
            uint256 liquidity,
            uint256 coverageLiability,
            bool closed
        ) = vault.seniorPositions(id);

        _assertEqBytes32(poolId, POOL_ID);
        _assertEq(owner, address(0xA11CE));
        _assertEq(entryAmount0, 10 ether);
        _assertEq(entryAmount1, 20_000 * USDC);
        _assertEq(entryPriceWad, 2_000 * WAD);
        _assertEq(liquidity, 100);
        _assertEq(coverageLiability, 6_000 * USDC);
        _assertFalse(closed);
    }

    function testJuniorDepositMintsSharesAndIncreasesReserve() external {
        _depositJunior(5_000 * USDC);

        _assertEq(vault.juniorSharesOf(POOL_ID, address(this)), 5_000 * USDC);
        _assertEq(vault.juniorBalanceOf(POOL_ID, address(this)), 5_000 * USDC);
        _assertEq(vault.reserveAvailable(POOL_ID), 5_000 * USDC);
    }

    function testRouterPaidPremiumIncreasesReserveAndSharePrice() external {
        _depositJunior(1_000 * USDC);
        uint256 priceBefore = vault.juniorSharePrice(POOL_ID);

        _fundPremium(100 * USDC, 20);

        _assertEq(vault.reserveAvailable(POOL_ID), 1_100 * USDC);
        _assertGt(vault.juniorSharePrice(POOL_ID), priceBefore);
        _assertEq(vault.juniorBalanceOf(POOL_ID, address(this)), 1_100 * USDC);
    }

    function testUnauthorizedRouterCannotFundPremium() external {
        UnauthorizedPremiumFunder funder = new UnauthorizedPremiumFunder(usdc);
        usdc.mint(address(funder), 100 * USDC);

        try funder.fund(vault, POOL_ID, 100 * USDC) {
            revert("unauthorized premium funded");
        } catch {}
    }

    function testSeniorOpenRequiresReserveCapacity() external {
        _depositJunior(100 * USDC);

        try vault.openSeniorPosition(POOL_ID, address(0xA11CE), 1 ether, 1_000 * USDC, 2_000 * WAD, 100) {
            revert("opened without reserve capacity");
        } catch {}
    }

    function testLargerSwapPaysHigherPremium() external pure {
        uint256 small = InsuranceMath.premiumBps(5, 1_000 * USDC, 1_000_000 * USDC, 0, 100);
        uint256 large = InsuranceMath.premiumBps(5, 100_000 * USDC, 1_000_000 * USDC, 0, 100);
        _assertGt(large, small);
    }

    function testSeniorWithdrawalReceivesCoverageWhenILExists() external {
        _depositJunior(2_000 * USDC);

        uint256 id = vault.openSeniorPosition(POOL_ID, address(0xA11CE), 1 ether, 2_000 * USDC, 2_000 * WAD, 100);
        uint256 aliceBefore = usdc.balanceOf(address(0xA11CE));

        (, uint256 coverage) = vault.closeSeniorPosition(id, 0.5 ether, 1_000 * USDC, 2_000 * WAD);

        _assertGt(coverage, 0);
        _assertEq(coverage, 600 * USDC);
        _assertEq(usdc.balanceOf(address(0xA11CE)), aliceBefore + coverage);
    }

    function testSeniorCoverageIsCappedByReserveAndLiability() external {
        vault.setPoolRiskConfig(POOL_ID, 10_000, 10_000, type(uint256).max, 0, 100);
        _depositJunior(100 * USDC);

        uint256 id = vault.openSeniorPosition(POOL_ID, address(0xA11CE), 10 ether, 100 * USDC, 2_000 * WAD, 100);
        (, uint256 coverage) = vault.closeSeniorPosition(id, 1 ether, 10 * USDC, 2_000 * WAD);

        _assertEq(coverage, 100 * USDC);
        _assertEq(vault.reserveAvailable(POOL_ID), 0);
    }

    function testCoverageLiabilityUsesMaxCoverageBps() external {
        _depositJunior(10_000 * USDC);

        uint256 id = vault.openSeniorPosition(POOL_ID, address(0xA11CE), 10 ether, 20_000 * USDC, 2_000 * WAD, 100);
        (,,,,,, uint256 coverageLiability,) = vault.seniorPositions(id);

        _assertEq(coverageLiability, 6_000 * USDC);
    }

    function testJuniorCapitalAbsorbsLossAfterPremiums() external {
        _depositJunior(1_000 * USDC);
        _fundPremium(500 * USDC, 20);

        uint256 id = vault.openSeniorPosition(POOL_ID, address(0xA11CE), 1 ether, 4_000 * USDC, 2_000 * WAD, 100);
        (, uint256 coverage) = vault.closeSeniorPosition(id, 0.5 ether, 1_000 * USDC, 2_000 * WAD);

        _assertGt(coverage, 500 * USDC);
        _assertEq(vault.reserveAvailable(POOL_ID), 1_500 * USDC - coverage);
        _assertLt(vault.juniorSharePrice(POOL_ID), 15 * 1e17);
    }

    function testJuniorSharePriceFallsAfterCoveragePayout() external {
        _depositJunior(2_000 * USDC);
        uint256 priceBefore = vault.juniorSharePrice(POOL_ID);

        uint256 id = vault.openSeniorPosition(POOL_ID, address(0xA11CE), 1 ether, 2_000 * USDC, 2_000 * WAD, 100);
        vault.closeSeniorPosition(id, 0.5 ether, 1_000 * USDC, 2_000 * WAD);

        _assertLt(vault.juniorSharePrice(POOL_ID), priceBefore);
    }

    function testJuniorWithdrawBlockedByActiveCoverageBuffer() external {
        _depositJunior(1_000 * USDC);
        vault.openSeniorPosition(POOL_ID, address(0xA11CE), 1 ether, 2_000 * USDC, 2_000 * WAD, 100);

        try vault.withdrawJunior(POOL_ID, 900 * USDC, address(this)) {
            revert("withdrew locked reserve");
        } catch {}
    }

    function testJuniorWithdrawReceivesPremiumYieldWhenUnlocked() external {
        _depositJunior(1_000 * USDC);
        _fundPremium(100 * USDC, 20);

        uint256 beforeBalance = usdc.balanceOf(address(this));
        vault.withdrawJunior(POOL_ID, vault.juniorSharesOf(POOL_ID, address(this)), address(this));

        _assertEq(usdc.balanceOf(address(this)), beforeBalance + 1_100 * USDC);
        _assertEq(vault.reserveAvailable(POOL_ID), 0);
    }

    function testNoCompensationWhenNoIL() external {
        _depositJunior(1_000 * USDC);

        uint256 id = vault.openSeniorPosition(POOL_ID, address(0xA11CE), 1 ether, 2_000 * USDC, 2_000 * WAD, 100);
        (uint256 loss, uint256 coverage) = vault.closeSeniorPosition(id, 1 ether, 2_000 * USDC, 2_000 * WAD);

        _assertEq(loss, 0);
        _assertEq(coverage, 0);
        _assertEq(vault.reserveAvailable(POOL_ID), 1_000 * USDC);
    }

    function testNoCompensationWhenExitBeatsHoldBenchmark() external {
        _depositJunior(1_000 * USDC);

        uint256 id = vault.openSeniorPosition(POOL_ID, address(0xA11CE), 1 ether, 2_000 * USDC, 2_000 * WAD, 100);
        (uint256 loss, uint256 coverage) = vault.closeSeniorPosition(id, 2 ether, 4_000 * USDC, 2_000 * WAD);

        _assertEq(loss, 0);
        _assertEq(coverage, 0);
        _assertEq(vault.reserveAvailable(POOL_ID), 1_000 * USDC);
    }

    function testSeniorPositionCannotBeClosedTwice() external {
        _depositJunior(1_000 * USDC);

        uint256 id = vault.openSeniorPosition(POOL_ID, address(0xA11CE), 1 ether, 2_000 * USDC, 2_000 * WAD, 100);
        vault.closeSeniorPosition(id, 1 ether, 2_000 * USDC, 2_000 * WAD);

        try vault.closeSeniorPosition(id, 1 ether, 2_000 * USDC, 2_000 * WAD) {
            revert("closed twice");
        } catch {}
    }

    function testCloseMySeniorPositionRequiresOwner() external {
        _depositJunior(1_000 * USDC);
        uint256 id = vault.openSeniorPosition(POOL_ID, address(0xA11CE), 1 ether, 2_000 * USDC, 2_000 * WAD, 100);

        UnauthorizedVaultCloser closer = new UnauthorizedVaultCloser();
        try closer.close(vault, id) {
            revert("non-owner closed");
        } catch {}
    }

    function testPositionValuesPreviewMatchesCloseCoverage() external {
        _depositJunior(2_000 * USDC);

        uint256 id = vault.openSeniorPosition(POOL_ID, address(0xA11CE), 1 ether, 2_000 * USDC, 2_000 * WAD, 100);
        (, , uint256 previewLoss, uint256 previewCoverage) =
            vault.positionValues(id, 0.5 ether, 1_000 * USDC, 2_000 * WAD);
        (uint256 loss, uint256 coverage) = vault.closeSeniorPosition(id, 0.5 ether, 1_000 * USDC, 2_000 * WAD);

        _assertEq(previewLoss, loss);
        _assertEq(previewCoverage, coverage);
    }

    function testAdminCanUpdateMaxCoverageBps() external {
        vault.setMaxCoverageBps(5_000);
        _assertEq(vault.maxCoverageBps(), 5_000);
    }

    function testPremiumAccountingCannotOverdrawReserve() external {
        _depositJunior(100 * USDC);
        vault.accruePremium(POOL_ID, 1_000 * USDC);

        _assertEq(vault.reserveAvailable(POOL_ID), 100 * USDC);
    }

    function testPaidCoveragePlusReserveNeverExceedsAccountedReserve() external {
        _depositJunior(2_000 * USDC);
        _fundPremium(100 * USDC, 20);

        uint256 id = vault.openSeniorPosition(POOL_ID, address(0xA11CE), 1 ether, 2_000 * USDC, 2_000 * WAD, 100);
        vault.closeSeniorPosition(id, 0.5 ether, 1_000 * USDC, 2_000 * WAD);
        (uint256 juniorCapital, uint256 accruedPremiums, uint256 paidCoverage) = vault.poolReserves(POOL_ID);

        _assertLe(paidCoverage + vault.reserveAvailable(POOL_ID), juniorCapital + accruedPremiums);
    }

    function _depositJunior(uint256 amount) internal {
        usdc.mint(address(this), amount);
        usdc.approve(address(vault), amount);
        vault.depositJunior(POOL_ID, amount);
    }

    function _fundPremium(uint256 amount, uint256 premiumBps) internal {
        usdc.mint(address(this), amount);
        usdc.approve(address(vault), amount);
        vault.fundPremiumWithBps(POOL_ID, amount, premiumBps);
    }

    function _assertEq(uint256 a, uint256 b) internal pure {
        require(a == b, "uint neq");
    }

    function _assertEq(address a, address b) internal pure {
        require(a == b, "address neq");
    }

    function _assertEqBytes32(bytes32 a, bytes32 b) internal pure {
        require(a == b, "bytes32 neq");
    }

    function _assertGt(uint256 a, uint256 b) internal pure {
        require(a > b, "uint !gt");
    }

    function _assertLt(uint256 a, uint256 b) internal pure {
        require(a < b, "uint !lt");
    }

    function _assertLe(uint256 a, uint256 b) internal pure {
        require(a <= b, "uint !le");
    }

    function _assertFalse(bool value) internal pure {
        require(!value, "not false");
    }
}

contract UnauthorizedVaultCloser {
    function close(RiskShieldVault vault, uint256 id) external {
        vault.closeMySeniorPosition(id, 1 ether, 2_000e6, 2_000e18);
    }
}

contract UnauthorizedPremiumFunder {
    MockUSDC internal immutable usdc;

    constructor(MockUSDC usdc_) {
        usdc = usdc_;
    }

    function fund(RiskShieldVault vault, bytes32 poolId, uint256 amount) external {
        usdc.approve(address(vault), amount);
        vault.fundPremium(poolId, amount);
    }
}

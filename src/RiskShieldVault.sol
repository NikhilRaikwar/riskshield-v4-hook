// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "./IERC20.sol";
import {InsuranceMath} from "./InsuranceMath.sol";

contract RiskShieldVault {
    using InsuranceMath for uint256;

    uint256 internal constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;
    uint256 internal constant DEFAULT_RESERVE_UTILIZATION_BPS = 8_000;
    uint256 internal constant DEFAULT_MAX_PREMIUM_BPS = 100;

    struct PoolReserve {
        uint256 juniorCapital;
        uint256 accruedPremiums;
        uint256 paidCoverage;
    }

    struct PoolRiskConfig {
        uint256 maxCoverageBps;
        uint256 reserveUtilizationBps;
        uint256 maxSeniorExposure;
        uint256 minReserve;
        uint256 maxPremiumBps;
        bool configured;
    }

    struct SeniorPosition {
        bytes32 poolId;
        address owner;
        uint256 entryAmount0;
        uint256 entryAmount1;
        uint256 entryPriceWad;
        uint256 liquidity;
        uint256 coverageLiability;
        bool closed;
    }

    IERC20 public immutable reserveToken;
    address public admin;
    address public hook;
    uint256 public nextPositionId = 1;
    uint256 public maxCoverageBps = 3_000;

    mapping(bytes32 poolId => PoolReserve) public poolReserves;
    mapping(bytes32 poolId => PoolRiskConfig) public poolRiskConfigs;
    mapping(bytes32 poolId => mapping(address account => uint256 shares)) public juniorSharesOf;
    mapping(bytes32 poolId => uint256 shares) public totalJuniorShares;
    mapping(bytes32 poolId => uint256 liability) public activeProtectedLiability;
    mapping(address router => bool approved) public approvedRouters;
    mapping(uint256 positionId => SeniorPosition position) public seniorPositions;

    event HookUpdated(address indexed hook);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);
    event RouterUpdated(address indexed router, bool approved);
    event PoolRiskConfigUpdated(
        bytes32 indexed poolId,
        uint256 maxCoverageBps,
        uint256 reserveUtilizationBps,
        uint256 maxSeniorExposure,
        uint256 minReserve,
        uint256 maxPremiumBps
    );
    event JuniorDeposited(bytes32 indexed poolId, address indexed insurer, uint256 amount, uint256 shares);
    event JuniorWithdrawn(bytes32 indexed poolId, address indexed insurer, address indexed receiver, uint256 amount, uint256 shares);
    event PremiumFunded(bytes32 indexed poolId, address indexed funder, uint256 amount, uint256 premiumBps);
    event PremiumAccrued(bytes32 indexed poolId, uint256 amount);
    event SeniorPositionOpened(
        uint256 indexed positionId,
        bytes32 indexed poolId,
        address indexed owner,
        uint256 amount0,
        uint256 amount1,
        uint256 entryPriceWad,
        uint256 liquidity,
        uint256 coverageLiability
    );
    event SeniorPositionClosed(
        uint256 indexed positionId,
        bytes32 indexed poolId,
        address indexed owner,
        uint256 holdValue,
        uint256 exitValue,
        uint256 loss,
        uint256 coveragePaid
    );

    error NotAuthorized();
    error NotApprovedRouter();
    error InvalidAmount();
    error InvalidConfig();
    error InsufficientReserveCapacity();
    error ReserveLocked();
    error PositionClosed();
    error NotPositionOwner();
    error TransferFailed();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAuthorized();
        _;
    }

    modifier onlyHookOrAdmin() {
        if (msg.sender != hook && msg.sender != admin) revert NotAuthorized();
        _;
    }

    modifier onlyApprovedRouter() {
        if (!approvedRouters[msg.sender]) revert NotApprovedRouter();
        _;
    }

    constructor(IERC20 reserveToken_, address admin_) {
        reserveToken = reserveToken_;
        admin = admin_;
    }

    function setHook(address hook_) external onlyAdmin {
        hook = hook_;
        emit HookUpdated(hook_);
    }

    function setRouter(address router, bool approved) external onlyAdmin {
        if (router == address(0)) revert InvalidAmount();
        approvedRouters[router] = approved;
        emit RouterUpdated(router, approved);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert InvalidAmount();
        address oldAdmin = admin;
        admin = newAdmin;
        emit AdminTransferred(oldAdmin, newAdmin);
    }

    function setMaxCoverageBps(uint256 maxCoverageBps_) external onlyAdmin {
        if (maxCoverageBps_ > BPS) revert InvalidAmount();
        maxCoverageBps = maxCoverageBps_;
    }

    function setPoolRiskConfig(
        bytes32 poolId,
        uint256 maxCoverageBps_,
        uint256 reserveUtilizationBps_,
        uint256 maxSeniorExposure_,
        uint256 minReserve_,
        uint256 maxPremiumBps_
    ) external onlyAdmin {
        if (maxCoverageBps_ > BPS || reserveUtilizationBps_ == 0 || reserveUtilizationBps_ > BPS) {
            revert InvalidConfig();
        }
        if (maxPremiumBps_ > BPS) revert InvalidConfig();

        poolRiskConfigs[poolId] = PoolRiskConfig({
            maxCoverageBps: maxCoverageBps_,
            reserveUtilizationBps: reserveUtilizationBps_,
            maxSeniorExposure: maxSeniorExposure_,
            minReserve: minReserve_,
            maxPremiumBps: maxPremiumBps_,
            configured: true
        });

        emit PoolRiskConfigUpdated(
            poolId, maxCoverageBps_, reserveUtilizationBps_, maxSeniorExposure_, minReserve_, maxPremiumBps_
        );
    }

    function resolvedRiskConfig(bytes32 poolId)
        public
        view
        returns (
            uint256 maxCoverageBps_,
            uint256 reserveUtilizationBps_,
            uint256 maxSeniorExposure_,
            uint256 minReserve_,
            uint256 maxPremiumBps_
        )
    {
        PoolRiskConfig memory config = poolRiskConfigs[poolId];
        maxCoverageBps_ = config.configured ? config.maxCoverageBps : maxCoverageBps;
        reserveUtilizationBps_ =
            config.configured ? config.reserveUtilizationBps : DEFAULT_RESERVE_UTILIZATION_BPS;
        maxSeniorExposure_ = config.configured && config.maxSeniorExposure != 0
            ? config.maxSeniorExposure
            : type(uint256).max;
        minReserve_ = config.configured ? config.minReserve : 0;
        maxPremiumBps_ = config.configured ? config.maxPremiumBps : DEFAULT_MAX_PREMIUM_BPS;
    }

    function depositJunior(bytes32 poolId, uint256 amount) external returns (uint256 shares) {
        if (amount == 0) revert InvalidAmount();

        uint256 assetsBefore = reserveAvailable(poolId);
        uint256 supply = totalJuniorShares[poolId];
        shares = supply == 0 || assetsBefore == 0 ? amount : (amount * supply) / assetsBefore;
        if (shares == 0) revert InvalidAmount();

        _pullReserve(msg.sender, amount);

        juniorSharesOf[poolId][msg.sender] += shares;
        totalJuniorShares[poolId] = supply + shares;
        poolReserves[poolId].juniorCapital += amount;

        emit JuniorDeposited(poolId, msg.sender, amount, shares);
    }

    function previewJuniorWithdraw(bytes32 poolId, address account, uint256 shares)
        public
        view
        returns (uint256 amount)
    {
        uint256 supply = totalJuniorShares[poolId];
        if (shares == 0 || supply == 0 || shares > juniorSharesOf[poolId][account]) return 0;
        amount = (shares * reserveAvailable(poolId)) / supply;
    }

    function withdrawableReserve(bytes32 poolId) public view returns (uint256 amount) {
        uint256 available = reserveAvailable(poolId);
        uint256 locked = lockedReserve(poolId);
        if (available <= locked) return 0;
        amount = available - locked;
    }

    function lockedReserve(bytes32 poolId) public view returns (uint256 amount) {
        uint256 liability = activeProtectedLiability[poolId];
        if (liability == 0) return 0;

        (, uint256 reserveUtilizationBps_,,,) = resolvedRiskConfig(poolId);
        amount = (liability * BPS + reserveUtilizationBps_ - 1) / reserveUtilizationBps_;
    }

    function withdrawJunior(bytes32 poolId, uint256 shares, address receiver) external returns (uint256 amount) {
        if (receiver == address(0) || shares == 0 || shares > juniorSharesOf[poolId][msg.sender]) {
            revert InvalidAmount();
        }

        amount = previewJuniorWithdraw(poolId, msg.sender, shares);
        if (amount == 0) revert InvalidAmount();
        if (amount > withdrawableReserve(poolId)) revert ReserveLocked();

        juniorSharesOf[poolId][msg.sender] -= shares;
        totalJuniorShares[poolId] -= shares;
        _debitReserveAccounting(poolId, amount);
        _pushReserve(receiver, amount);

        emit JuniorWithdrawn(poolId, msg.sender, receiver, amount, shares);
    }

    function juniorBalanceOf(bytes32 poolId, address account) public view returns (uint256) {
        return previewJuniorWithdraw(poolId, account, juniorSharesOf[poolId][account]);
    }

    function juniorAssets(bytes32 poolId, address account) external view returns (uint256) {
        return juniorBalanceOf(poolId, account);
    }

    function juniorSharePrice(bytes32 poolId) external view returns (uint256) {
        uint256 supply = totalJuniorShares[poolId];
        if (supply == 0) return WAD;
        return (reserveAvailable(poolId) * WAD) / supply;
    }

    function fundPremium(bytes32 poolId, uint256 amount) external onlyApprovedRouter {
        _fundPremium(poolId, msg.sender, amount, 0);
    }

    function fundPremiumWithBps(bytes32 poolId, uint256 amount, uint256 premiumBps) external onlyApprovedRouter {
        _fundPremium(poolId, msg.sender, amount, premiumBps);
    }

    function accruePremium(bytes32 poolId, uint256 amount) external onlyHookOrAdmin {
        if (amount == 0) return;
        poolReserves[poolId].accruedPremiums += amount;
        emit PremiumAccrued(poolId, amount);
    }

    function openSeniorPosition(
        bytes32 poolId,
        address owner,
        uint256 amount0,
        uint256 amount1,
        uint256 entryPriceWad,
        uint256 liquidity
    ) external onlyHookOrAdmin returns (uint256 positionId) {
        if (owner == address(0) || entryPriceWad == 0 || liquidity == 0) revert InvalidAmount();

        (uint256 maxCoverageBps_, uint256 reserveUtilizationBps_, uint256 maxSeniorExposure_, uint256 minReserve_,) =
            resolvedRiskConfig(poolId);
        uint256 coverageLiability = (amount1 * maxCoverageBps_) / BPS;
        uint256 reserve = reserveAvailable(poolId);
        if (reserve < minReserve_) revert InsufficientReserveCapacity();

        uint256 nextLiability = activeProtectedLiability[poolId] + coverageLiability;
        uint256 capacity = (reserve * reserveUtilizationBps_) / BPS;
        if (nextLiability > capacity || nextLiability > maxSeniorExposure_) {
            revert InsufficientReserveCapacity();
        }

        activeProtectedLiability[poolId] = nextLiability;
        positionId = nextPositionId++;
        seniorPositions[positionId] = SeniorPosition({
            poolId: poolId,
            owner: owner,
            entryAmount0: amount0,
            entryAmount1: amount1,
            entryPriceWad: entryPriceWad,
            liquidity: liquidity,
            coverageLiability: coverageLiability,
            closed: false
        });

        emit SeniorPositionOpened(
            positionId, poolId, owner, amount0, amount1, entryPriceWad, liquidity, coverageLiability
        );
    }

    function closeSeniorPosition(uint256 positionId, uint256 exitAmount0, uint256 exitAmount1, uint256 exitPriceWad)
        external
        onlyHookOrAdmin
        returns (uint256 loss, uint256 coveragePaid)
    {
        return _closeSeniorPosition(positionId, exitAmount0, exitAmount1, exitPriceWad);
    }

    function closeMySeniorPosition(uint256 positionId, uint256 exitAmount0, uint256 exitAmount1, uint256 exitPriceWad)
        external
        returns (uint256 loss, uint256 coveragePaid)
    {
        SeniorPosition storage position = seniorPositions[positionId];
        if (msg.sender != position.owner) revert NotPositionOwner();
        return _closeSeniorPosition(positionId, exitAmount0, exitAmount1, exitPriceWad);
    }

    function _closeSeniorPosition(uint256 positionId, uint256 exitAmount0, uint256 exitAmount1, uint256 exitPriceWad)
        internal
        returns (uint256 loss, uint256 coveragePaid)
    {
        SeniorPosition storage position = seniorPositions[positionId];
        if (position.closed) revert PositionClosed();
        position.closed = true;

        uint256 activeLiability = activeProtectedLiability[position.poolId];
        activeProtectedLiability[position.poolId] =
            activeLiability > position.coverageLiability ? activeLiability - position.coverageLiability : 0;

        uint256 holdValue =
            InsuranceMath.valueInToken1(position.entryAmount0, position.entryAmount1, exitPriceWad);
        uint256 exitValue = InsuranceMath.valueInToken1(exitAmount0, exitAmount1, exitPriceWad);
        (uint256 maxCoverageBps_,,,,) = resolvedRiskConfig(position.poolId);

        (loss, coveragePaid) =
            InsuranceMath.coveredLoss(holdValue, exitValue, reserveAvailable(position.poolId), maxCoverageBps_);
        if (coveragePaid > position.coverageLiability) coveragePaid = position.coverageLiability;
        if (coveragePaid != 0) {
            poolReserves[position.poolId].paidCoverage += coveragePaid;
            _pushReserve(position.owner, coveragePaid);
        }

        emit SeniorPositionClosed(
            positionId, position.poolId, position.owner, holdValue, exitValue, loss, coveragePaid
        );
    }

    function reserveAvailable(bytes32 poolId) public view returns (uint256) {
        PoolReserve memory reserve = poolReserves[poolId];
        uint256 accountedReserve = reserve.juniorCapital + reserve.accruedPremiums;
        if (accountedReserve <= reserve.paidCoverage) return 0;
        accountedReserve -= reserve.paidCoverage;

        uint256 balance = reserveToken.balanceOf(address(this));
        return balance < accountedReserve ? balance : accountedReserve;
    }

    function positionValues(uint256 positionId, uint256 exitAmount0, uint256 exitAmount1, uint256 exitPriceWad)
        external
        view
        returns (uint256 holdValue, uint256 exitValue, uint256 loss, uint256 coverable)
    {
        SeniorPosition memory position = seniorPositions[positionId];
        holdValue = InsuranceMath.valueInToken1(position.entryAmount0, position.entryAmount1, exitPriceWad);
        exitValue = InsuranceMath.valueInToken1(exitAmount0, exitAmount1, exitPriceWad);
        (uint256 maxCoverageBps_,,,,) = resolvedRiskConfig(position.poolId);
        (loss, coverable) =
            InsuranceMath.coveredLoss(holdValue, exitValue, reserveAvailable(position.poolId), maxCoverageBps_);
        if (coverable > position.coverageLiability) coverable = position.coverageLiability;
    }

    function _fundPremium(bytes32 poolId, address funder, uint256 amount, uint256 premiumBps) internal {
        if (amount == 0) revert InvalidAmount();
        (,,,, uint256 maxPremiumBps_) = resolvedRiskConfig(poolId);
        if (premiumBps > maxPremiumBps_) revert InvalidConfig();

        _pullReserve(funder, amount);
        poolReserves[poolId].accruedPremiums += amount;
        emit PremiumFunded(poolId, funder, amount, premiumBps);
    }

    function _debitReserveAccounting(bytes32 poolId, uint256 amount) internal {
        PoolReserve storage reserve = poolReserves[poolId];
        uint256 premiumDebit = amount < reserve.accruedPremiums ? amount : reserve.accruedPremiums;
        reserve.accruedPremiums -= premiumDebit;

        uint256 capitalDebit = amount - premiumDebit;
        if (capitalDebit != 0) {
            reserve.juniorCapital = reserve.juniorCapital > capitalDebit ? reserve.juniorCapital - capitalDebit : 0;
        }
    }

    function _pullReserve(address from, uint256 amount) internal {
        bool ok = reserveToken.transferFrom(from, address(this), amount);
        if (!ok) revert TransferFailed();
    }

    function _pushReserve(address to, uint256 amount) internal {
        bool ok = reserveToken.transfer(to, amount);
        if (!ok) revert TransferFailed();
    }
}

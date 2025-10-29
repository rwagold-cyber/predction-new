// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "../ctf/ConditionalTokensV2.sol";
import "../libs/Types.sol";

/**
 * @title SettlementV2
 * @notice Order settlement contract that integrates with CTF for position management.
 *
 * Key improvements over V1:
 * - Delegates position tracking to CTF (ERC1155)
 * - Supports millions of users without gas explosion
 * - Users self-redeem after market resolution
 * - Batch settlement optimization
 * - Collateral custody for trading
 */
contract SettlementV2 is EIP712, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    ConditionalTokensV2 public immutable ctf;

    uint256 private constant BPS = 10_000;

    // Collateral management
    mapping(address => mapping(address => uint256)) public collateralBalances; // user => token => amount
    mapping(address => bool) public supportedCollateral;

    // Order tracking
    mapping(bytes32 => uint256) public filled;
    mapping(address => mapping(uint256 => uint256)) public nonceBitmap;

    // Fee management
    mapping(address => uint256) public protocolFees;
    address public feeCollector;

    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address maker,uint256 marketId,bytes32 conditionId,uint8 outcome,address collateral,uint128 pricePips,uint128 amount,uint16 makerFeeBps,uint16 takerFeeBps,uint256 expiry,uint256 salt,uint256 nonce,bool mintOnFill,address allowedTaker)"
    );

    event CollateralSupportUpdated(address indexed token, bool supported);
    event FeeCollectorUpdated(address indexed newCollector);
    event CollateralDeposited(address indexed account, address indexed token, uint256 amount);
    event CollateralWithdrawn(address indexed account, address indexed token, uint256 amount);

    event TradeExecuted(
        bytes32 indexed orderHash,
        uint256 indexed marketId,
        bytes32 indexed conditionId,
        uint8 outcome,
        address maker,
        address taker,
        uint128 amount,
        uint128 pricePips,
        uint256 makerFee,
        uint256 takerFee,
        bool mintOnFill
    );

    event OrderCancelled(bytes32 indexed orderHash, address indexed maker);

    error UnsupportedCollateral();
    error InvalidAmount();
    error InvalidOutcome();
    error OrderExpired();
    error InvalidNonce();
    error Overfill();
    error InvalidSignature();
    error UnauthorizedTaker();
    error InsufficientBalance();
    error Unauthorized();

    constructor(ConditionalTokensV2 _ctf) EIP712("PredictXSettlementV2", "1") Ownable(msg.sender) {
        ctf = _ctf;
        feeCollector = msg.sender;
    }

    // ---------------------------------------------------------------------
    // Admin Functions
    // ---------------------------------------------------------------------

    function setCollateralSupport(address token, bool isSupported) external onlyOwner {
        supportedCollateral[token] = isSupported;
        emit CollateralSupportUpdated(token, isSupported);
    }

    function setFeeCollector(address newCollector) external onlyOwner {
        require(newCollector != address(0), "invalid collector");
        feeCollector = newCollector;
        emit FeeCollectorUpdated(newCollector);
    }

    // ---------------------------------------------------------------------
    // Collateral Management
    // ---------------------------------------------------------------------

    function depositCollateral(address token, uint256 amount) external nonReentrant {
        if (!supportedCollateral[token]) revert UnsupportedCollateral();
        if (amount == 0) revert InvalidAmount();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        collateralBalances[msg.sender][token] += amount;

        emit CollateralDeposited(msg.sender, token, amount);
    }

    function withdrawCollateral(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();

        uint256 balance = collateralBalances[msg.sender][token];
        if (balance < amount) revert InsufficientBalance();

        collateralBalances[msg.sender][token] = balance - amount;
        IERC20(token).safeTransfer(msg.sender, amount);

        emit CollateralWithdrawn(msg.sender, token, amount);
    }

    function withdrawFees(address token, uint256 amount, address to) external nonReentrant {
        if (msg.sender != feeCollector) revert Unauthorized();
        if (amount == 0) revert InvalidAmount();
        if (to == address(0)) revert Unauthorized();

        uint256 accrued = protocolFees[token];
        if (accrued < amount) revert InsufficientBalance();

        protocolFees[token] = accrued - amount;
        IERC20(token).safeTransfer(to, amount);
    }

    // ---------------------------------------------------------------------
    // Settlement Logic (with CTF integration)
    // ---------------------------------------------------------------------

    /**
     * @notice Execute a single fill, integrating with CTF for position management
     */
    function executeFill(Types.FillV2 calldata fill) external nonReentrant {
        _executeFill(fill);
    }

    /**
     * @notice Batch execute multiple fills
     */
    function batchFill(Types.FillV2[] calldata fills) external nonReentrant {
        for (uint256 i = 0; i < fills.length; i++) {
            _executeFill(fills[i]);
        }
    }

    function _executeFill(Types.FillV2 calldata fill) internal {
        if (fill.fillAmount == 0) revert InvalidAmount();
        if (fill.taker == address(0)) revert UnauthorizedTaker();

        Types.OrderV2 calldata order = fill.order;

        // Basic validations
        if (order.maker == address(0)) revert InvalidSignature();
        if (order.collateral == address(0)) revert UnsupportedCollateral();
        if (!supportedCollateral[order.collateral]) revert UnsupportedCollateral();
        if (order.outcome >= 2) revert InvalidOutcome();
        if (order.pricePips > BPS) revert InvalidAmount();
        if (order.amount == 0) revert InvalidAmount();
        if (order.makerFeeBps > BPS || order.takerFeeBps > BPS) revert InvalidAmount();
        if (block.timestamp > order.expiry) revert OrderExpired();

        // Check allowed taker
        if (order.allowedTaker != address(0) && order.allowedTaker != fill.taker) {
            revert UnauthorizedTaker();
        }

        // Check nonce
        if (!_isNonceValid(order.maker, order.nonce)) revert InvalidNonce();

        // Verify signature
        bytes32 orderHash = _hashOrder(order);
        uint256 currentFilled = filled[orderHash];
        uint256 newFilled = currentFilled + uint256(fill.fillAmount);
        if (newFilled > order.amount) revert Overfill();

        address signer = ECDSA.recover(orderHash, fill.signature);
        if (signer != order.maker) revert InvalidSignature();

        // Update filled amount
        filled[orderHash] = newFilled;

        // Calculate amounts
        uint256 fillAmount = uint256(fill.fillAmount);
        uint256 takerCollateral = (fillAmount * uint256(order.pricePips)) / BPS;
        uint256 makerFee = (takerCollateral * uint256(order.makerFeeBps)) / BPS;
        uint256 takerFee = (takerCollateral * uint256(order.takerFeeBps)) / BPS;
        uint256 takerTotal = takerCollateral + takerFee;

        // Check taker balance
        if (collateralBalances[fill.taker][order.collateral] < takerTotal) revert InsufficientBalance();

        // Transfer collateral from taker to this contract
        collateralBalances[fill.taker][order.collateral] -= takerTotal;

        // Collect fees
        if (makerFee + takerFee > 0) {
            protocolFees[order.collateral] += makerFee + takerFee;
        }

        // Calculate net collateral to maker (after fee)
        uint256 makerReceive = takerCollateral > makerFee ? takerCollateral - makerFee : 0;

        IERC20 collateral = IERC20(order.collateral);

        if (order.mintOnFill) {
            // Maker is minting positions (selling outcome tokens)
            // Need to split position via CTF

            // Check maker has enough collateral
            if (collateralBalances[order.maker][order.collateral] < fillAmount) revert InsufficientBalance();

            // Deduct maker's collateral
            collateralBalances[order.maker][order.collateral] -= fillAmount;

            // Approve CTF to take collateral from this contract
            collateral.approve(address(ctf), fillAmount);

            // Split position: this will mint outcome tokens
            // We split into both outcomes, give maker the opposite, give taker the desired
            uint256[] memory partition = new uint256[](2);
            partition[0] = 1; // outcome 0
            partition[1] = 2; // outcome 1

            // Transfer collateral to CTF and split
            ctf.splitPosition(
                collateral,
                order.conditionId,
                partition,
                fillAmount
            );

            // Now this contract holds both outcome tokens
            // Transfer taker's outcome to taker
            bytes32 takerCollectionId = ctf.getCollectionId(order.conditionId, 1 << order.outcome);
            uint256 takerPositionId = ctf.getPositionId(collateral, takerCollectionId);

            // Transfer maker's opposite outcome to maker
            uint8 makerOutcome = 1 - order.outcome;
            bytes32 makerCollectionId = ctf.getCollectionId(order.conditionId, 1 << makerOutcome);
            uint256 makerPositionId = ctf.getPositionId(collateral, makerCollectionId);

            // Transfer outcome tokens
            ctf.safeTransferFrom(address(this), fill.taker, takerPositionId, fillAmount, "");
            ctf.safeTransferFrom(address(this), order.maker, makerPositionId, fillAmount, "");

            // Give maker the payment
            if (makerReceive > 0) {
                collateralBalances[order.maker][order.collateral] += makerReceive;
            }

        } else {
            // Maker already has outcome tokens, just transfer them
            bytes32 collectionId = ctf.getCollectionId(order.conditionId, 1 << order.outcome);
            uint256 positionId = ctf.getPositionId(collateral, collectionId);

            // Transfer from maker to taker
            ctf.safeTransferFrom(order.maker, fill.taker, positionId, fillAmount, "");

            // Give maker the payment
            if (makerReceive > 0) {
                collateralBalances[order.maker][order.collateral] += makerReceive;
            }
        }

        emit TradeExecuted(
            orderHash,
            order.marketId,
            order.conditionId,
            order.outcome,
            order.maker,
            fill.taker,
            fill.fillAmount,
            order.pricePips,
            makerFee,
            takerFee,
            order.mintOnFill
        );
    }

    // ---------------------------------------------------------------------
    // Order Cancellation
    // ---------------------------------------------------------------------

    function cancelOrder(uint256 nonce) external {
        uint256 slot = nonce / 256;
        uint256 bit = nonce % 256;
        nonceBitmap[msg.sender][slot] |= (1 << bit);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function getFilledAmount(bytes32 orderHash) external view returns (uint256) {
        return filled[orderHash];
    }

    // ---------------------------------------------------------------------
    // Internal Helpers
    // ---------------------------------------------------------------------

    function _hashOrder(Types.OrderV2 calldata order) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                ORDER_TYPEHASH,
                order.maker,
                order.marketId,
                order.conditionId,
                order.outcome,
                order.collateral,
                order.pricePips,
                order.amount,
                order.makerFeeBps,
                order.takerFeeBps,
                order.expiry,
                order.salt,
                order.nonce,
                order.mintOnFill,
                order.allowedTaker
            )
        );
        return _hashTypedDataV4(structHash);
    }

    function _isNonceValid(address user, uint256 nonce) internal view returns (bool) {
        uint256 slot = nonce / 256;
        uint256 bit = nonce % 256;
        return (nonceBitmap[user][slot] & (1 << bit)) == 0;
    }

    // ---------------------------------------------------------------------
    // ERC1155 Receiver (required for CTF transfers)
    // ---------------------------------------------------------------------

    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }
}

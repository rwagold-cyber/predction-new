// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../libs/Errors.sol";

/**
 * @title ConditionalTokensV2
 * @notice Core CTF implementation for prediction markets
 * Based on Gnosis Conditional Tokens Framework
 */
contract ConditionalTokensV2 is ERC1155 {
    using SafeERC20 for IERC20;

    // Condition struct
    struct Condition {
        address oracle;
        bytes32 questionId;
        uint256 outcomeSlotCount;
        uint256 payoutNumerator;
        uint256 payoutDenominator;
    }

    mapping(bytes32 => Condition) public conditions;
    mapping(bytes32 => bool) public isConditionResolved;
    mapping(bytes32 => uint256[]) public payoutVectors;

    // Position balances: collectionId => user => balance
    // CollectionId = keccak256(conditionId, indexSet)
    mapping(uint256 => mapping(address => uint256)) private _balances;

    event ConditionPreparation(
        bytes32 indexed conditionId,
        address indexed oracle,
        bytes32 indexed questionId,
        uint256 outcomeSlotCount
    );

    event ConditionResolution(
        bytes32 indexed conditionId,
        address indexed oracle,
        bytes32 indexed questionId,
        uint256 outcomeSlotCount,
        uint256[] payoutNumerators
    );

    event PositionSplit(
        address indexed stakeholder,
        IERC20 indexed collateralToken,
        bytes32 indexed conditionId,
        uint256[] partition,
        uint256 amount
    );

    event PositionsMerge(
        address indexed stakeholder,
        IERC20 indexed collateralToken,
        bytes32 indexed conditionId,
        uint256[] partition,
        uint256 amount
    );

    event PayoutRedemption(
        address indexed redeemer,
        IERC20 indexed collateralToken,
        bytes32 indexed conditionId,
        uint256[] indexSets,
        uint256 payout
    );

    constructor() ERC1155("") {}

    /**
     * @notice Prepare a condition for a prediction market
     * @dev This function is intentionally permissionless (no access control).
     * Security considerations:
     * - Conditions are uniquely identified by (oracle, questionId, outcomeSlotCount)
     * - If the same parameters are used, it produces the same conditionId (idempotent)
     * - Only the designated oracle can report payouts (enforced in reportPayouts)
     * - MarketRegistryV2 tracks which conditionId belongs to which market
     * - This matches the original Gnosis CTF design
     *
     * @param oracle The address that can report the result
     * @param questionId Unique identifier for the question
     * @param outcomeSlotCount Number of possible outcomes (usually 2 for binary)
     */
    function prepareCondition(
        address oracle,
        bytes32 questionId,
        uint256 outcomeSlotCount
    ) external returns (bytes32 conditionId) {
        require(outcomeSlotCount > 1 && outcomeSlotCount <= 256, "Invalid outcome count");

        conditionId = getConditionId(oracle, questionId, outcomeSlotCount);

        require(conditions[conditionId].outcomeSlotCount == 0, "Condition already prepared");

        conditions[conditionId] = Condition({
            oracle: oracle,
            questionId: questionId,
            outcomeSlotCount: outcomeSlotCount,
            payoutNumerator: 0,
            payoutDenominator: 0
        });

        emit ConditionPreparation(conditionId, oracle, questionId, outcomeSlotCount);
    }

    /**
     * @notice Report the result of a condition
     * @dev This function HAS access control - only the designated oracle can call it.
     * The oracle is determined by msg.sender and must match the oracle set during prepareCondition.
     *
     * @param questionId The question identifier
     * @param payoutNumerators Array of payout weights for each outcome
     */
    function reportPayouts(bytes32 questionId, uint256[] calldata payoutNumerators) external {
        uint256 outcomeSlotCount = payoutNumerators.length;
        bytes32 conditionId = getConditionId(msg.sender, questionId, outcomeSlotCount);

        Condition storage condition = conditions[conditionId];
        require(condition.oracle == msg.sender, "Not the oracle");
        require(condition.outcomeSlotCount == outcomeSlotCount, "Mismatched outcome count");
        require(!isConditionResolved[conditionId], "Already resolved");

        uint256 den = 0;
        for (uint256 i = 0; i < outcomeSlotCount; i++) {
            den += payoutNumerators[i];
        }
        require(den > 0, "Invalid payout vector");

        condition.payoutNumerator = payoutNumerators[0]; // For binary, just store first
        condition.payoutDenominator = den;

        payoutVectors[conditionId] = payoutNumerators;
        isConditionResolved[conditionId] = true;

        emit ConditionResolution(conditionId, msg.sender, questionId, outcomeSlotCount, payoutNumerators);
    }

    /**
     * @notice Split collateral into outcome tokens
     * @param collateralToken The ERC20 collateral token
     * @param conditionId The condition to split for
     * @param partition The partition of outcomes (for binary: [1,2] means both outcomes)
     * @param amount Amount of collateral to split
     */
    function splitPosition(
        IERC20 collateralToken,
        bytes32 conditionId,
        uint256[] calldata partition,
        uint256 amount
    ) external {
        require(amount > 0, "Amount must be positive");
        require(conditions[conditionId].outcomeSlotCount > 0, "Condition not prepared");

        // Transfer collateral from user
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);

        // Mint outcome tokens for each index in partition
        uint256 fullIndexSet = 0;
        for (uint256 i = 0; i < partition.length; i++) {
            fullIndexSet |= partition[i];
        }

        for (uint256 i = 0; i < partition.length; i++) {
            uint256 indexSet = partition[i];
            bytes32 collectionId = getCollectionId(conditionId, indexSet);
            uint256 positionId = getPositionId(collateralToken, collectionId);

            _mint(msg.sender, positionId, amount, "");
        }

        emit PositionSplit(msg.sender, collateralToken, conditionId, partition, amount);
    }

    /**
     * @notice Merge outcome tokens back into collateral
     * @param collateralToken The ERC20 collateral token
     * @param conditionId The condition to merge for
     * @param partition The partition of outcomes
     * @param amount Amount to merge
     */
    function mergePositions(
        IERC20 collateralToken,
        bytes32 conditionId,
        uint256[] calldata partition,
        uint256 amount
    ) external {
        require(amount > 0, "Amount must be positive");

        // Burn outcome tokens
        for (uint256 i = 0; i < partition.length; i++) {
            uint256 indexSet = partition[i];
            bytes32 collectionId = getCollectionId(conditionId, indexSet);
            uint256 positionId = getPositionId(collateralToken, collectionId);

            _burn(msg.sender, positionId, amount);
        }

        // Return collateral to user
        collateralToken.safeTransfer(msg.sender, amount);

        emit PositionsMerge(msg.sender, collateralToken, conditionId, partition, amount);
    }

    /**
     * @notice Redeem winning outcome tokens for collateral
     * @param collateralToken The ERC20 collateral token
     * @param conditionId The condition to redeem for
     * @param indexSets Array of index sets to redeem
     */
    function redeemPositions(
        IERC20 collateralToken,
        bytes32 conditionId,
        uint256[] calldata indexSets
    ) external {
        require(isConditionResolved[conditionId], "Condition not resolved");

        uint256 totalPayout = 0;
        uint256[] storage payouts = payoutVectors[conditionId];
        uint256 den = conditions[conditionId].payoutDenominator;

        for (uint256 i = 0; i < indexSets.length; i++) {
            uint256 indexSet = indexSets[i];
            bytes32 collectionId = getCollectionId(conditionId, indexSet);
            uint256 positionId = getPositionId(collateralToken, collectionId);

            uint256 balance = balanceOf(msg.sender, positionId);
            if (balance > 0) {
                // Calculate payout for this index set
                uint256 payoutNumerator = 0;
                for (uint256 j = 0; j < payouts.length; j++) {
                    if (indexSet & (1 << j) != 0) {
                        payoutNumerator += payouts[j];
                    }
                }

                uint256 payout = (balance * payoutNumerator) / den;
                totalPayout += payout;

                // Burn the tokens
                _burn(msg.sender, positionId, balance);
            }
        }

        require(totalPayout > 0, "No payout");

        // Transfer payout
        collateralToken.safeTransfer(msg.sender, totalPayout);

        emit PayoutRedemption(msg.sender, collateralToken, conditionId, indexSets, totalPayout);
    }

    // View functions

    function getConditionId(
        address oracle,
        bytes32 questionId,
        uint256 outcomeSlotCount
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(oracle, questionId, outcomeSlotCount));
    }

    function getCollectionId(bytes32 conditionId, uint256 indexSet) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(conditionId, indexSet));
    }

    function getPositionId(IERC20 collateralToken, bytes32 collectionId) public pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(collateralToken, collectionId)));
    }

    function getOutcomeSlotCount(bytes32 conditionId) external view returns (uint256) {
        return conditions[conditionId].outcomeSlotCount;
    }

    function getCondition(bytes32 conditionId) external view returns (Condition memory) {
        return conditions[conditionId];
    }
}

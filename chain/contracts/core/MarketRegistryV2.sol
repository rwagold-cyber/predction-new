// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../ctf/ConditionalTokensV2.sol";
import "../oracle/IMinuteOracle.sol";
import "../libs/Types.sol";
import "../libs/Errors.sol";

/**
 * @title MarketRegistryV2
 * @notice Market creation and resolution using CTF
 */
contract MarketRegistryV2 is Ownable {
    ConditionalTokensV2 public immutable ctf;

    uint256 public nextMarketId = 1;
    mapping(uint256 => Types.Market) public markets;
    mapping(bytes32 => uint256) public conditionToMarket;

    uint256 public resolveBuffer = 60; // seconds after endTime before resolution allowed

    event ResolveBufferUpdated(uint256 newBuffer);

    event MarketCreated(
        uint256 indexed marketId,
        bytes32 indexed conditionId,
        address collateral,
        address oracle,
        uint256 startTime,
        uint256 endTime,
        Types.MarketKind kind,
        uint8 timeframe
    );

    event MarketResolved(
        uint256 indexed marketId,
        bytes32 indexed conditionId,
        uint8 winningOutcome,
        int256 startPrice,
        int256 endPrice
    );

    constructor(ConditionalTokensV2 _ctf) Ownable(msg.sender) {
        ctf = _ctf;
    }

    function setResolveBuffer(uint256 newBuffer) external onlyOwner {
        resolveBuffer = newBuffer;
        emit ResolveBufferUpdated(newBuffer);
    }

    /**
     * @notice Create a new prediction market and prepare condition in CTF
     */
    function createMarket(
        address collateral,
        address oracle,
        uint256 startTime,
        Types.MarketKind kind,
        uint8 timeframe
    ) external onlyOwner returns (uint256 marketId, bytes32 conditionId) {
        require(startTime % 60 == 0, "Start time must be minute-aligned");
        require(timeframe == 1 || timeframe == 3 || timeframe == 5, "Invalid timeframe");
        require(startTime > block.timestamp, "Start time must be in future");

        uint256 endTime = startTime + (uint256(timeframe) * 60);

        // Create unique question ID
        bytes32 questionId = keccak256(
            abi.encodePacked(
                "PRICE_PREDICTION",
                kind,
                startTime,
                endTime,
                block.timestamp
            )
        );

        // Prepare condition in CTF (this contract is the oracle)
        conditionId = ctf.prepareCondition(address(this), questionId, 2);

        marketId = nextMarketId++;

        markets[marketId] = Types.Market({
            id: marketId,
            conditionId: conditionId,
            collateral: collateral,
            oracle: oracle,
            startTime: startTime,
            endTime: endTime,
            outcomeCount: 2,
            kind: kind,
            timeframe: timeframe,
            resolved: false,
            winningOutcome: 0
        });

        conditionToMarket[conditionId] = marketId;

        emit MarketCreated(
            marketId,
            conditionId,
            collateral,
            oracle,
            startTime,
            endTime,
            kind,
            timeframe
        );
    }

    /**
     * @notice Resolve market and report payouts to CTF
     */
    function resolveMarket(uint256 marketId) external {
        Types.Market storage market = markets[marketId];
        require(market.startTime > 0, "Market not found");
        require(!market.resolved, "Already resolved");
        require(block.timestamp >= market.endTime + resolveBuffer, "Too early to resolve");

        IMinuteOracle oracle = IMinuteOracle(market.oracle);

        // Get start and end prices
        (int256 startPrice, bool startValid) = oracle.getPriceAt(uint64(market.startTime));
        (int256 endPrice, bool endValid) = oracle.getPriceAt(uint64(market.endTime));

        require(startValid && endValid, "Price not available");

        // Determine winner: 0 = DOWN/SAME, 1 = UP
        uint8 winningOutcome;
        if (endPrice > startPrice) {
            winningOutcome = 1; // UP wins
        } else {
            winningOutcome = 0; // DOWN/SAME wins
        }

        // Prepare payout vector for CTF
        uint256[] memory payouts = new uint256[](2);
        payouts[winningOutcome] = 1;
        payouts[1 - winningOutcome] = 0;

        // Get the question ID from CTF
        ConditionalTokensV2.Condition memory condition = ctf.getCondition(market.conditionId);
        bytes32 questionId = condition.questionId;

        // Report payouts to CTF
        ctf.reportPayouts(questionId, payouts);

        market.resolved = true;
        market.winningOutcome = winningOutcome;

        emit MarketResolved(marketId, market.conditionId, winningOutcome, startPrice, endPrice);
    }

    /**
     * @notice Check if market can be resolved
     */
    function canResolve(uint256 marketId) external view returns (bool) {
        Types.Market storage market = markets[marketId];
        if (market.startTime == 0 || market.resolved) {
            return false;
        }
        if (block.timestamp < market.endTime + resolveBuffer) {
            return false;
        }

        IMinuteOracle oracle = IMinuteOracle(market.oracle);

        try oracle.getPriceAt(uint64(market.startTime)) returns (int256, bool startValid) {
            if (!startValid) return false;
        } catch {
            return false;
        }

        try oracle.getPriceAt(uint64(market.endTime)) returns (int256, bool endValid) {
            if (!endValid) return false;
        } catch {
            return false;
        }

        return true;
    }

    /**
     * @notice Get market details
     */
    function getMarket(uint256 marketId) external view returns (Types.Market memory) {
        Types.Market memory market = markets[marketId];
        require(market.startTime > 0, "Market not found");
        return market;
    }

    /**
     * @notice Get market by condition ID
     */
    function getMarketByCondition(bytes32 conditionId) external view returns (Types.Market memory) {
        uint256 marketId = conditionToMarket[conditionId];
        require(marketId > 0, "Market not found");
        return markets[marketId];
    }
}

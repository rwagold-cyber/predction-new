// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library Types {
    struct Market {
        uint256 id;
        bytes32 conditionId;
        address collateral;
        address oracle;
        uint256 startTime;
        uint256 endTime;
        uint8 outcomeCount;
        MarketKind kind;
        uint8 timeframe; // 1, 3, 5 minutes
        bool resolved;
        uint8 winningOutcome;
    }

    enum MarketKind {
        BTC_UPDOWN,
        ETH_UPDOWN
    }

    struct Order {
        address maker;
        uint256 marketId;
        uint8 outcome;
        address collateral;
        uint128 pricePips; // Price in basis points (10000 = 1.0)
        uint128 amount;
        uint16 makerFeeBps;
        uint16 takerFeeBps;
        uint256 expiry;
        uint256 salt;
        uint256 nonce;
        bool mintOnFill;
        address allowedTaker;
    }

    struct Fill {
        Order order;
        bytes signature;
        uint128 fillAmount;
        address taker;
    }

    // V2 structures with CTF integration
    struct OrderV2 {
        address maker;
        uint256 marketId;
        bytes32 conditionId;  // CTF condition ID
        uint8 outcome;
        address collateral;
        uint128 pricePips;
        uint128 amount;
        uint16 makerFeeBps;
        uint16 takerFeeBps;
        uint256 expiry;
        uint256 salt;
        uint256 nonce;
        bool mintOnFill;
        address allowedTaker;
    }

    struct FillV2 {
        OrderV2 order;
        bytes signature;
        uint128 fillAmount;
        address taker;
    }
}

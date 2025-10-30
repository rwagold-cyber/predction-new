// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPyth.sol";
import "./IMinuteOracle.sol";
import "../libs/Errors.sol";

/**
 * @title PythOracleAdapter
 * @notice Adapts Pyth oracle to IMinuteOracle interface
 */
contract PythOracleAdapter is IMinuteOracle {
    IPyth public immutable pyth;
    bytes32 public immutable feedId;
    uint256 public immutable coolDownPeriod; // Seconds to wait after minute timestamp
    int32 public constant EXPECTED_EXPO = -8; // Price has 8 decimal places

    constructor(address _pyth, bytes32 _feedId, uint256 _coolDownPeriod) {
        pyth = IPyth(_pyth);
        feedId = _feedId;
        coolDownPeriod = _coolDownPeriod;
    }

    /**
     * @notice Get price at a specific minute timestamp using historical data
     */
    function getPriceAt(uint64 minuteTs) external view override returns (int256 price, bool valid) {
        // Validate minute alignment
        if (minuteTs % 60 != 0) {
            revert Errors.Oracle_InvalidTimestamp();
        }

        // Wait until cool down period has passed to ensure price is finalized
        if (block.timestamp < uint256(minuteTs) + coolDownPeriod) {
            return (0, false);
        }

        // Try to get historical price at the exact minute
        try pyth.getPriceAtZeroTimestamp(feedId, uint256(minuteTs)) returns (IPyth.Price memory priceData) {
            // Verify the price is for the exact minute we requested
            if (
                priceData.publishTime == uint256(minuteTs) &&
                priceData.publishTime % 60 == 0 &&
                priceData.price > 0 &&
                priceData.expo == EXPECTED_EXPO
            ) {
                return (int256(priceData.price), true);
            }
        } catch {
            // Price not available
        }

        return (0, false);
    }

    /**
     * @notice Get the latest minute-aligned price
     */
    function getLatestPrice() external view override returns (int256 price, uint256 timestamp, bool valid) {
        IPyth.Price memory priceData = pyth.getPrice(feedId);

        // Verify it's a minute-aligned price
        if (priceData.publishTime % 60 != 0) {
            return (0, 0, false);
        }

        // Ensure expected exponent
        if (priceData.expo != EXPECTED_EXPO || priceData.price <= 0) {
            return (0, 0, false);
        }

        // Verify price is not too old
        if (block.timestamp - priceData.publishTime > 300) {
            // Price older than 5 minutes
            return (0, 0, false);
        }

        // Ensure we have waited for the cool down period
        if (block.timestamp < priceData.publishTime + coolDownPeriod) {
            return (0, 0, false);
        }

        return (int256(priceData.price), priceData.publishTime, true);
    }

    /**
     * @notice Helper: Convert timestamp to minute-aligned timestamp
     */
    function toMinuteTimestamp(uint256 timestamp) public pure returns (uint256) {
        return (timestamp / 60) * 60;
    }

    /**
     * @notice Helper: Check if a price can be retrieved for a given timestamp
     */
    function canGetPrice(uint256 timestamp) external view returns (bool) {
        if (timestamp % 60 != 0) return false;
        if (timestamp > block.timestamp) return false;
        if (block.timestamp < timestamp + coolDownPeriod) return false;

        try pyth.getPriceAtZeroTimestamp(feedId, timestamp) returns (IPyth.Price memory priceData) {
            return
                priceData.publishTime == timestamp &&
                priceData.publishTime % 60 == 0 &&
                priceData.price > 0 &&
                priceData.expo == EXPECTED_EXPO;
        } catch {
            return false;
        }
    }
}

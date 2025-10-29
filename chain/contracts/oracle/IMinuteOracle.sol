// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IMinuteOracle
 * @notice Interface for accessing minute-aligned price data
 */
interface IMinuteOracle {
    /**
     * @notice Get price at a specific minute timestamp
     * @param minuteTs Minute-aligned timestamp (must be divisible by 60)
     * @return price Price value
     * @return valid Whether the price is valid
     */
    function getPriceAt(uint64 minuteTs) external view returns (int256 price, bool valid);

    /**
     * @notice Get the latest minute-aligned price
     * @return price Price value
     * @return timestamp Timestamp of the price
     * @return valid Whether the price is valid
     */
    function getLatestPrice() external view returns (int256 price, uint256 timestamp, bool valid);
}

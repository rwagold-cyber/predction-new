// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IPyth Interface
 * @notice Interface for Pyth-like price oracle
 */
interface IPyth {
    struct Price {
        int64 price;          // Price with expo decimal places
        uint64 conf;          // Confidence interval
        int32 expo;           // Exponent
        uint publishTime;     // Unix timestamp
    }

    struct PriceFeed {
        bytes32 id;           // Price feed identifier
        Price price;          // Current price
        Price emaPrice;       // Exponential moving average price
    }

    /**
     * @notice Returns the price feed for the given price feed ID
     * @param id The price feed ID
     * @return priceFeed The price feed struct
     */
    function getPriceFeed(bytes32 id) external view returns (PriceFeed memory priceFeed);

    /**
     * @notice Returns the price for the given price feed ID
     * @param id The price feed ID
     * @return price The price struct
     */
    function getPrice(bytes32 id) external view returns (Price memory price);

    /**
     * @notice Returns the EMA price for the given price feed ID
     * @param id The price feed ID
     * @return price The EMA price struct
     */
    function getEmaPrice(bytes32 id) external view returns (Price memory price);

    /**
     * @notice Returns the price no older than the given age
     * @param id The price feed ID
     * @param age Maximum age of the price in seconds
     * @return price The price struct
     */
    function getPriceNoOlderThan(bytes32 id, uint age) external view returns (Price memory price);

    /**
     * @notice Returns the EMA price no older than the given age
     * @param id The price feed ID
     * @param age Maximum age of the price in seconds
     * @return price The EMA price struct
     */
    function getEmaPriceNoOlderThan(bytes32 id, uint age) external view returns (Price memory price);

    /**
     * @notice Returns the price unsafe (may be stale)
     * @param id The price feed ID
     * @return price The price struct
     */
    function getPriceUnsafe(bytes32 id) external view returns (Price memory price);

    /**
     * @notice Returns the EMA price unsafe (may be stale)
     * @param id The price feed ID
     * @return price The EMA price struct
     */
    function getEmaPriceUnsafe(bytes32 id) external view returns (Price memory price);

    /**
     * @notice Returns the price at an exact minute-aligned timestamp
     * @dev Timestamp must be a multiple of 60 (whole minute)
     * @param id The price feed ID
     * @param timestamp Minute-aligned timestamp to query
     * @return price The price struct
     */
    function getPriceAtZeroTimestamp(bytes32 id, uint256 timestamp) external view returns (Price memory price);

    /**
     * @notice Returns the latest minute-aligned price
     * @param id The price feed ID
     * @return price The price struct
     */
    function getLastZeroPrice(bytes32 id) external view returns (Price memory price);

    /**
     * @notice Returns all recorded minute-aligned timestamps for a feed
     * @param id The price feed ID
     * @return timestamps Array of minute-aligned timestamps
     */
    function getZeroTimestamps(bytes32 id) external view returns (uint256[] memory timestamps);

    /**
     * @notice Returns a page of minute-aligned timestamps for a feed
     * @param id The price feed ID
     * @param offset The starting index
     * @param limit Maximum number of timestamps to return
     * @return timestamps Array of minute-aligned timestamps
     */
    function getZeroTimestampsPaginated(bytes32 id, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory timestamps);

    /**
     * @notice Returns prices for multiple minute-aligned timestamps
     * @param id The price feed ID
     * @param timestamps Array of minute-aligned timestamps
     * @return prices Array of price structs corresponding to the timestamps
     */
    function getBatchPricesAtZero(bytes32 id, uint256[] calldata timestamps)
        external
        view
        returns (Price[] memory prices);

    /**
     * @notice Checks whether a price can be set at the given minute-aligned timestamp
     * @param id The price feed ID
     * @param timestamp Minute-aligned timestamp
     * @return canSet True if a price can be set
     * @return reason Reason string when price cannot be set
     */
    function canSetPriceAtZero(bytes32 id, uint256 timestamp)
        external
        view
        returns (bool canSet, string memory reason);

    /**
     * @notice Returns the update fee for updating price feeds
     * @param updateDataArray Array of price update data
     * @return feeAmount The fee amount in wei
     */
    function getUpdateFee(bytes[] calldata updateDataArray) external view returns (uint feeAmount);

    /**
     * @notice Updates price feeds with the given update data
     * @param updateData Array of price update data
     */
    function updatePriceFeeds(bytes[] calldata updateData) external payable;

    /**
     * @notice Updates price feeds if necessary with the given update data
     * @param updateData Array of price update data
     * @param priceIds Array of price feed IDs to update
     * @param publishTimes Array of publish times for each price feed
     */
    function updatePriceFeedsIfNecessary(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64[] calldata publishTimes
    ) external payable;

    /**
     * @notice Checks if the price feed exists
     * @param id The price feed ID
     * @return exists True if the price feed exists
     */
    function priceFeedExists(bytes32 id) external view returns (bool exists);

    /**
     * @notice Returns the valid time period for price feeds
     * @return validTimePeriod The valid time period in seconds
     */
    function getValidTimePeriod() external view returns (uint validTimePeriod);

    // Events
    event PriceFeedUpdate(bytes32 indexed id, uint64 publishTime, int64 price, uint64 conf);
    event BatchPriceFeedUpdate(bytes32[] ids, uint64[] publishTimes);
}

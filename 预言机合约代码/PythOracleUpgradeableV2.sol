// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./IPyth.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title PythOracleUpgradeableV2
 * @notice Upgraded version with permanent storage for prices at zero-second timestamps
 * @dev V2 adds functionality to store and retrieve prices at exact minute boundaries (0 seconds)
 */
contract PythOracleUpgradeableV2 is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable,
    IPyth
{
    // Constants (can remain as constants in upgradeable contracts)
    uint256 public constant VALID_TIME_PERIOD = 120; // 120 seconds for minute-based updates
    uint256 public constant MAX_PRICE_FEEDS = 100;

    // State variables from V1 (DO NOT MODIFY ORDER)
    mapping(bytes32 => PriceFeed) private priceFeeds;
    mapping(bytes32 => bool) public priceFeedExists;
    mapping(address => bool) public authorizedUpdaters;

    bytes32[] public activePriceFeeds;
    uint256 public updateFee; // Zero fee for updates by default

    // V2 NEW State Variables - Added before __gap
    /// @notice Permanent storage for prices at zero-second timestamps (minute boundaries)
    /// @dev Maps priceId => timestamp => Price. Timestamp must be divisible by 60
    mapping(bytes32 => mapping(uint256 => Price)) public priceAtZeroStorage;

    /// @notice Track all zero timestamps that have been set for each price feed
    /// @dev This allows iteration through historical zero-second prices
    mapping(bytes32 => uint256[]) private zeroTimestamps;

    /// @notice Last zero-second timestamp that was set for each price feed
    /// @dev Used to prevent duplicate pushes and track latest data
    mapping(bytes32 => uint256) public lastZeroTimestamp;

    /// @notice Count of zero-second prices stored for each price feed
    /// @dev Useful for pagination and stats
    mapping(bytes32 => uint256) public zeroTimestampCount;

    /// @notice Flag to allow price override (for fixing errors)
    /// @dev Only owner can enable this, and it's per price feed
    mapping(bytes32 => bool) public allowPriceOverride;

    /**
     * @dev Storage gap for future upgrades (reduced from 50 to 45 to accommodate V2 variables)
     * This allows us to add new state variables in future versions
     * without affecting the storage layout of existing variables
     */
    uint256[45] private __gap;

    // V2 NEW Events
    event PriceAtZeroSet(bytes32 indexed id, uint256 indexed timestamp, int64 price, uint64 conf);
    event PriceAtZeroOverridden(bytes32 indexed id, uint256 indexed timestamp, int64 oldPrice, int64 newPrice);
    event PriceOverrideEnabled(bytes32 indexed id, bool enabled);

    // Events from V1 (removed unused events)

    // Modifiers
    modifier onlyAuthorized() {
        require(authorizedUpdaters[msg.sender] || msg.sender == owner(), "Not authorized");
        _;
    }

    modifier validPriceFeed(bytes32 id) {
        require(priceFeedExists[id], "Price feed does not exist");
        _;
    }

    modifier validZeroTimestamp(uint256 timestamp) {
        require(timestamp % 60 == 0, "Timestamp must be at zero seconds (divisible by 60)");
        require(timestamp > 0, "Timestamp must be greater than 0");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract (replaces constructor)
     * @param initialOwner The address that will be set as the owner
     */
    function initialize(address initialOwner) public initializer {
        __Ownable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        // Transfer ownership if initialOwner is different from msg.sender
        if (initialOwner != _msgSender()) {
            _transferOwnership(initialOwner);
        }

        authorizedUpdaters[initialOwner] = true;
        updateFee = 0 ether;
    }

    /**
     * @notice Reinitializer for V2 upgrade
     * @dev Called once during upgrade to V2, initializes new state variables if needed
     */
    function initializeV2() public reinitializer(2) {
        // V2 initialization logic
        // New mappings are automatically initialized to default values
        // No additional setup needed unless we want to set default values
    }

    // ==================== V2 NEW FUNCTIONS ====================

    /**
     * @notice Set price at a specific zero-second timestamp (minute boundary)
     * @dev Only authorized updaters can call. Timestamp must be divisible by 60.
     * @param id The price feed identifier
     * @param price The price value
     * @param conf The confidence interval
     * @param timestamp The zero-second timestamp (must be divisible by 60)
     */
    function setPriceAtZero(
        bytes32 id,
        int64 price,
        uint64 conf,
        uint256 timestamp
    ) external onlyAuthorized validPriceFeed(id) validZeroTimestamp(timestamp) nonReentrant {
        // Check if price already exists at this timestamp
        bool priceExists = priceAtZeroStorage[id][timestamp].publishTime != 0;

        if (priceExists && !allowPriceOverride[id]) {
            revert("Price already exists at this timestamp. Enable override to replace.");
        }

        // Get the exponent from existing price feed
        int32 expo = priceFeeds[id].price.expo;

        // Create the price struct
        Price memory newPrice = Price({
            price: price,
            conf: conf,
            expo: expo,
            publishTime: timestamp
        });

        // Store the price
        int64 oldPrice = priceAtZeroStorage[id][timestamp].price;
        priceAtZeroStorage[id][timestamp] = newPrice;

        // If this is a new timestamp (not an override), update tracking
        if (!priceExists) {
            zeroTimestamps[id].push(timestamp);
            zeroTimestampCount[id]++;
            lastZeroTimestamp[id] = timestamp;

            emit PriceAtZeroSet(id, timestamp, price, conf);
        } else {
            emit PriceAtZeroOverridden(id, timestamp, oldPrice, price);
        }
    }

    /**
     * @notice Batch set prices at zero-second timestamps
     * @dev More gas efficient for multiple updates
     * @param ids Array of price feed identifiers
     * @param prices Array of price values
     * @param confs Array of confidence intervals
     * @param timestamps Array of zero-second timestamps
     */
    function batchSetPriceAtZero(
        bytes32[] calldata ids,
        int64[] calldata prices,
        uint64[] calldata confs,
        uint256[] calldata timestamps
    ) external onlyAuthorized nonReentrant {
        require(
            ids.length == prices.length &&
            prices.length == confs.length &&
            confs.length == timestamps.length,
            "Array length mismatch"
        );

        for (uint i = 0; i < ids.length; i++) {
            require(priceFeedExists[ids[i]], "Price feed does not exist");
            require(timestamps[i] % 60 == 0, "Timestamp must be at zero seconds");
            require(timestamps[i] > 0, "Timestamp must be greater than 0");

            bool priceExists = priceAtZeroStorage[ids[i]][timestamps[i]].publishTime != 0;

            if (priceExists && !allowPriceOverride[ids[i]]) {
                continue; // Skip this entry instead of reverting
            }

            int32 expo = priceFeeds[ids[i]].price.expo;

            Price memory newPrice = Price({
                price: prices[i],
                conf: confs[i],
                expo: expo,
                publishTime: timestamps[i]
            });

            int64 oldPrice = priceAtZeroStorage[ids[i]][timestamps[i]].price;
            priceAtZeroStorage[ids[i]][timestamps[i]] = newPrice;

            if (!priceExists) {
                zeroTimestamps[ids[i]].push(timestamps[i]);
                zeroTimestampCount[ids[i]]++;
                lastZeroTimestamp[ids[i]] = timestamps[i];

                emit PriceAtZeroSet(ids[i], timestamps[i], prices[i], confs[i]);
            } else {
                emit PriceAtZeroOverridden(ids[i], timestamps[i], oldPrice, prices[i]);
            }
        }
    }

    /**
     * @notice Get price at a specific zero-second timestamp
     * @dev Returns the exact price stored at the given timestamp
     * @param id The price feed identifier
     * @param timestamp The zero-second timestamp
     * @return price The price at the specified timestamp
     */
    function getPriceAtZeroTimestamp(
        bytes32 id,
        uint256 timestamp
    ) external view validPriceFeed(id) validZeroTimestamp(timestamp) returns (Price memory) {
        Price memory price = priceAtZeroStorage[id][timestamp];
        require(price.publishTime != 0, "No price available at this timestamp");
        return price;
    }

    /**
     * @notice Get the most recent zero-second price
     * @dev Returns the price at the last recorded zero-second timestamp
     * @param id The price feed identifier
     * @return price The most recent zero-second price
     */
    function getLastZeroPrice(bytes32 id) external view validPriceFeed(id) returns (Price memory) {
        uint256 lastTimestamp = lastZeroTimestamp[id];
        require(lastTimestamp != 0, "No zero-second prices recorded yet");

        Price memory price = priceAtZeroStorage[id][lastTimestamp];
        require(price.publishTime != 0, "Price data corrupted");

        return price;
    }

    /**
     * @notice Get all zero-second timestamps for a price feed
     * @dev Returns array of all timestamps where prices have been stored
     * @param id The price feed identifier
     * @return timestamps Array of zero-second timestamps
     */
    function getZeroTimestamps(bytes32 id) external view validPriceFeed(id) returns (uint256[] memory) {
        return zeroTimestamps[id];
    }

    /**
     * @notice Get paginated zero-second timestamps
     * @dev Useful for large datasets, returns a slice of timestamps
     * @param id The price feed identifier
     * @param offset Starting index
     * @param limit Maximum number of items to return
     * @return timestamps Array of timestamps
     */
    function getZeroTimestampsPaginated(
        bytes32 id,
        uint256 offset,
        uint256 limit
    ) external view validPriceFeed(id) returns (uint256[] memory) {
        uint256[] storage allTimestamps = zeroTimestamps[id];
        uint256 total = allTimestamps.length;

        require(offset < total, "Offset out of bounds");

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }

        uint256 resultLength = end - offset;
        uint256[] memory result = new uint256[](resultLength);

        for (uint256 i = 0; i < resultLength; i++) {
            result[i] = allTimestamps[offset + i];
        }

        return result;
    }

    /**
     * @notice Get multiple zero-second prices in one call
     * @dev Gas efficient way to retrieve multiple historical prices
     * @param id The price feed identifier
     * @param timestamps Array of zero-second timestamps to query
     * @return prices Array of prices at the specified timestamps
     */
    function getBatchPricesAtZero(
        bytes32 id,
        uint256[] calldata timestamps
    ) external view validPriceFeed(id) returns (Price[] memory) {
        Price[] memory prices = new Price[](timestamps.length);

        for (uint256 i = 0; i < timestamps.length; i++) {
            require(timestamps[i] % 60 == 0, "Timestamp must be at zero seconds");
            prices[i] = priceAtZeroStorage[id][timestamps[i]];
        }

        return prices;
    }

    /**
     * @notice Check if a zero-second price can be set at the given timestamp
     * @dev Useful for off-chain checks before attempting to set price
     * @param id The price feed identifier
     * @param timestamp The zero-second timestamp to check
     * @return canSet Whether the price can be set
     * @return reason Human-readable reason if cannot set
     */
    function canSetPriceAtZero(
        bytes32 id,
        uint256 timestamp
    ) external view returns (bool canSet, string memory reason) {
        if (!priceFeedExists[id]) {
            return (false, "Price feed does not exist");
        }

        if (timestamp % 60 != 0) {
            return (false, "Timestamp must be at zero seconds (divisible by 60)");
        }

        if (timestamp == 0) {
            return (false, "Timestamp must be greater than 0");
        }

        bool priceExists = priceAtZeroStorage[id][timestamp].publishTime != 0;

        if (priceExists && !allowPriceOverride[id]) {
            return (false, "Price already exists and override is not enabled");
        }

        return (true, "Can set price");
    }

    /**
     * @notice Enable or disable price override for a specific price feed
     * @dev Only owner can call. Useful for fixing incorrect prices.
     * @param id The price feed identifier
     * @param enabled Whether to enable override
     */
    function setAllowPriceOverride(bytes32 id, bool enabled) external onlyOwner validPriceFeed(id) {
        allowPriceOverride[id] = enabled;
        emit PriceOverrideEnabled(id, enabled);
    }

    /**
     * @notice Force set a price at zero-second timestamp (owner only, bypass checks)
     * @dev Emergency function to fix incorrect prices. Only owner can call.
     * @param id The price feed identifier
     * @param price The price value
     * @param conf The confidence interval
     * @param timestamp The zero-second timestamp
     */
    function forceSetPriceAtZero(
        bytes32 id,
        int64 price,
        uint64 conf,
        uint256 timestamp
    ) external onlyOwner validPriceFeed(id) validZeroTimestamp(timestamp) {
        int32 expo = priceFeeds[id].price.expo;

        Price memory newPrice = Price({
            price: price,
            conf: conf,
            expo: expo,
            publishTime: timestamp
        });

        bool priceExists = priceAtZeroStorage[id][timestamp].publishTime != 0;
        int64 oldPrice = priceAtZeroStorage[id][timestamp].price;

        priceAtZeroStorage[id][timestamp] = newPrice;

        if (!priceExists) {
            zeroTimestamps[id].push(timestamp);
            zeroTimestampCount[id]++;
            if (timestamp > lastZeroTimestamp[id]) {
                lastZeroTimestamp[id] = timestamp;
            }
            emit PriceAtZeroSet(id, timestamp, price, conf);
        } else {
            emit PriceAtZeroOverridden(id, timestamp, oldPrice, price);
        }
    }

    // ==================== V1 FUNCTIONS (UNCHANGED) ====================

    /**
     * @notice Add a new price feed
     * @param id The price feed identifier
     * @param expo Price exponent
     */
    function addPriceFeed(bytes32 id, int32 expo) external onlyOwner {
        require(!priceFeedExists[id], "Price feed already exists");
        require(activePriceFeeds.length < MAX_PRICE_FEEDS, "Too many price feeds");

        // Create empty price structure - prices will be set via setPriceAtZero
        Price memory emptyPrice = Price({
            price: 0,
            conf: 0,
            expo: expo,
            publishTime: 0
        });

        priceFeeds[id] = PriceFeed({
            id: id,
            price: emptyPrice,
            emaPrice: emptyPrice
        });

        priceFeedExists[id] = true;
        activePriceFeeds.push(id);
    }





    // IPyth interface implementations
    function getPriceFeed(bytes32 id) external view override validPriceFeed(id) returns (PriceFeed memory) {
        return priceFeeds[id];
    }

    function getPrice(bytes32 id) external view override validPriceFeed(id) returns (Price memory) {
        // Return the most recent zero-second price if available
        uint256 lastTimestamp = lastZeroTimestamp[id];
        if (lastTimestamp != 0) {
            return priceAtZeroStorage[id][lastTimestamp];
        }
        // Fallback to stored price feed data
        return priceFeeds[id].price;
    }

    function getEmaPrice(bytes32 id) external view override validPriceFeed(id) returns (Price memory) {
        // For minute-based updates, EMA is the same as current price
        return this.getPrice(id);
    }

    function getPriceNoOlderThan(bytes32 id, uint age) external view override validPriceFeed(id) returns (Price memory) {
        Price memory price = this.getPrice(id);
        require(block.timestamp - price.publishTime <= age, "Price too old");
        return price;
    }

    function getEmaPriceNoOlderThan(bytes32 id, uint age) external view override validPriceFeed(id) returns (Price memory) {
        Price memory price = this.getEmaPrice(id);
        require(block.timestamp - price.publishTime <= age, "Price too old");
        return price;
    }

    function getPriceUnsafe(bytes32 id) external view override validPriceFeed(id) returns (Price memory) {
        return this.getPrice(id);
    }

    function getEmaPriceUnsafe(bytes32 id) external view override validPriceFeed(id) returns (Price memory) {
        return this.getEmaPrice(id);
    }













    function getUpdateFee(bytes[] calldata updateDataArray) external view override returns (uint) {
        return updateFee * updateDataArray.length;
    }

    function updatePriceFeeds(bytes[] calldata updateData) external payable override {
        require(msg.value >= this.getUpdateFee(updateData), "Insufficient fee");
        // Implementation would decode updateData and update prices
        // For simplicity, this is left as a placeholder
    }

    function updatePriceFeedsIfNecessary(
        bytes[] calldata updateData,
        bytes32[] calldata /* priceIds */,
        uint64[] calldata /* publishTimes */
    ) external payable override {
        require(msg.value >= this.getUpdateFee(updateData), "Insufficient fee");
        // Implementation would check if updates are necessary
        // For simplicity, this is left as a placeholder
    }

    function getValidTimePeriod() external pure override returns (uint) {
        return VALID_TIME_PERIOD;
    }

    // Additional utility functions





    function getActivePriceFeeds() external view returns (bytes32[] memory) {
        return activePriceFeeds;
    }

    // Admin functions
    function setAuthorizedUpdater(address updater, bool authorized) external onlyOwner {
        authorizedUpdaters[updater] = authorized;
        // Event removed for simplified contract
    }

    function setUpdateFee(uint256 newFee) external onlyOwner {
        updateFee = newFee;
        // Event removed for simplified contract
    }

    function withdrawFees() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    // Emergency functions

    /**
     * @dev Function that authorizes an upgrade to a new implementation
     * @param newImplementation Address of the new implementation
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /**
     * @notice Get the implementation version
     * @return version string
     */
    function version() external pure returns (string memory) {
        return "2.0.0";
    }
}

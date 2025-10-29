// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./OutcomeERC20.sol";
import "./ConditionalTokensV2.sol";

/**
 * @title Wrapped1155Factory
 * @notice Factory for creating ERC20 wrappers for conditional tokens
 */
contract Wrapped1155Factory {
    ConditionalTokensV2 public immutable ctf;

    // Mapping from position ID to wrapper address
    mapping(uint256 => address) public wrappers;

    event WrapperCreated(
        address indexed wrapper,
        IERC20 indexed collateralToken,
        bytes32 indexed conditionId,
        uint256 indexSet,
        uint256 positionId
    );

    constructor(ConditionalTokensV2 _ctf) {
        ctf = _ctf;
    }

    /**
     * @notice Create an ERC20 wrapper for a conditional token position
     * @param collateralToken The collateral token
     * @param conditionId The condition ID
     * @param indexSet The outcome index set (1 for outcome 0, 2 for outcome 1, etc.)
     * @param name Token name
     * @param symbol Token symbol
     */
    function createWrapper(
        IERC20 collateralToken,
        bytes32 conditionId,
        uint256 indexSet,
        string memory name,
        string memory symbol
    ) external returns (address wrapper) {
        bytes32 collectionId = ctf.getCollectionId(conditionId, indexSet);
        uint256 positionId = ctf.getPositionId(collateralToken, collectionId);

        require(wrappers[positionId] == address(0), "Wrapper already exists");

        wrapper = address(
            new OutcomeERC20(
                ctf,
                collateralToken,
                conditionId,
                indexSet,
                name,
                symbol
            )
        );

        wrappers[positionId] = wrapper;

        emit WrapperCreated(wrapper, collateralToken, conditionId, indexSet, positionId);
    }

    /**
     * @notice Get wrapper address for a position
     * @param collateralToken The collateral token
     * @param conditionId The condition ID
     * @param indexSet The outcome index set
     */
    function getWrapper(
        IERC20 collateralToken,
        bytes32 conditionId,
        uint256 indexSet
    ) external view returns (address) {
        bytes32 collectionId = ctf.getCollectionId(conditionId, indexSet);
        uint256 positionId = ctf.getPositionId(collateralToken, collectionId);
        return wrappers[positionId];
    }

    /**
     * @notice Check if wrapper exists for a position
     */
    function hasWrapper(
        IERC20 collateralToken,
        bytes32 conditionId,
        uint256 indexSet
    ) external view returns (bool) {
        bytes32 collectionId = ctf.getCollectionId(conditionId, indexSet);
        uint256 positionId = ctf.getPositionId(collateralToken, collectionId);
        return wrappers[positionId] != address(0);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./ConditionalTokensV2.sol";

/**
 * @title OutcomeERC20
 * @notice ERC20 wrapper for conditional tokens (ERC1155 positions)
 */
contract OutcomeERC20 is ERC20 {
    ConditionalTokensV2 public immutable ctf;
    IERC20 public immutable collateralToken;
    bytes32 public immutable conditionId;
    uint256 public immutable indexSet;
    uint256 public immutable positionId;

    constructor(
        ConditionalTokensV2 _ctf,
        IERC20 _collateralToken,
        bytes32 _conditionId,
        uint256 _indexSet,
        string memory _name,
        string memory _symbol
    ) ERC20(_name, _symbol) {
        ctf = _ctf;
        collateralToken = _collateralToken;
        conditionId = _conditionId;
        indexSet = _indexSet;

        bytes32 collectionId = _ctf.getCollectionId(_conditionId, _indexSet);
        positionId = _ctf.getPositionId(_collateralToken, collectionId);
    }

    /**
     * @notice Wrap ERC1155 conditional tokens into ERC20
     * @param amount Amount to wrap
     */
    function wrap(uint256 amount) external {
        require(amount > 0, "Amount must be positive");

        // Transfer ERC1155 from user to this contract
        ctf.safeTransferFrom(msg.sender, address(this), positionId, amount, "");

        // Mint ERC20 to user
        _mint(msg.sender, amount);
    }

    /**
     * @notice Unwrap ERC20 back to ERC1155 conditional tokens
     * @param amount Amount to unwrap
     */
    function unwrap(uint256 amount) external {
        require(amount > 0, "Amount must be positive");
        require(balanceOf(msg.sender) >= amount, "Insufficient balance");

        // Burn ERC20 from user
        _burn(msg.sender, amount);

        // Transfer ERC1155 to user
        ctf.safeTransferFrom(address(this), msg.sender, positionId, amount, "");
    }

    /**
     * @notice Required for ERC1155 receiver
     */
    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    /**
     * @notice Required for batch ERC1155 receiver
     */
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

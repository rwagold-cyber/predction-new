import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { SettlementV2, ConditionalTokensV2, MockUSDC } from "../typechain-types";

/**
 * SettlementV2 Order Matching Logic Tests
 *
 * Covers:
 * 1. Order creation and EIP712 signature
 * 2. executeFill with mintOnFill=true (maker mints positions)
 * 3. executeFill with mintOnFill=false (maker has existing positions)
 * 4. batchFill execution
 * 5. Error cases:
 *    - Invalid nonce (already used or cancelled)
 *    - Expired orders
 *    - Invalid signatures
 *    - Insufficient balance (maker and taker)
 *    - Overfill attempts
 *    - Unauthorized takers
 *    - Invalid outcomes
 *    - Unsupported collateral
 */
describe("SettlementV2 - Order Matching Logic", function () {

  const BPS = 10000n;
  const MAKER_FEE_BPS = 10; // 0.1%
  const TAKER_FEE_BPS = 20; // 0.2%

  async function deployFixture() {
    const [owner, maker, taker, otherUser, feeCollector] = await ethers.getSigners();

    // Deploy MockUSDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();

    // Deploy CTF
    const CTF = await ethers.getContractFactory("ConditionalTokensV2");
    const ctf = await CTF.deploy();

    // Deploy Settlement
    const Settlement = await ethers.getContractFactory("SettlementV2");
    const settlement = await Settlement.deploy(await ctf.getAddress());

    // Set fee collector
    await settlement.setFeeCollector(feeCollector.address);

    // Whitelist USDC
    await settlement.setCollateralSupport(await usdc.getAddress(), true);

    // Mint USDC to test users
    const mintAmount = ethers.parseUnits("10000", 6);
    await usdc.mint(maker.address, mintAmount);
    await usdc.mint(taker.address, mintAmount);
    await usdc.mint(otherUser.address, mintAmount);

    // Users deposit collateral to settlement
    const depositAmount = ethers.parseUnits("5000", 6);
    await usdc.connect(maker).approve(await settlement.getAddress(), depositAmount);
    await settlement.connect(maker).depositCollateral(await usdc.getAddress(), depositAmount);

    await usdc.connect(taker).approve(await settlement.getAddress(), depositAmount);
    await settlement.connect(taker).depositCollateral(await usdc.getAddress(), depositAmount);

    await usdc.connect(otherUser).approve(await settlement.getAddress(), depositAmount);
    await settlement.connect(otherUser).depositCollateral(await usdc.getAddress(), depositAmount);

    // Prepare a test market condition in CTF
    const marketId = 1;
    const questionId = ethers.keccak256(ethers.toUtf8Bytes("test-market-1"));

    // IMPORTANT: Prepare condition in CTF (settlement is the oracle)
    const conditionId = await ctf.prepareCondition(await settlement.getAddress(), questionId, 2);

    // Get domain separator for EIP712
    const domain = {
      name: "PredictXSettlementV2",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await settlement.getAddress(),
    };

    const types = {
      Order: [
        { name: "maker", type: "address" },
        { name: "marketId", type: "uint256" },
        { name: "conditionId", type: "bytes32" },
        { name: "outcome", type: "uint8" },
        { name: "collateral", type: "address" },
        { name: "pricePips", type: "uint128" },
        { name: "amount", type: "uint128" },
        { name: "makerFeeBps", type: "uint16" },
        { name: "takerFeeBps", type: "uint16" },
        { name: "expiry", type: "uint256" },
        { name: "salt", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "mintOnFill", type: "bool" },
        { name: "allowedTaker", type: "address" },
      ],
    };

    return {
      settlement,
      usdc,
      ctf,
      owner,
      maker,
      taker,
      otherUser,
      feeCollector,
      marketId,
      conditionId,
      questionId,
      domain,
      types,
    };
  }

  // Helper to create and sign an order
  async function createSignedOrder(
    signer: SignerWithAddress,
    orderParams: any,
    domain: any,
    types: any
  ) {
    const signature = await signer.signTypedData(domain, types, orderParams);
    return { order: orderParams, signature };
  }

  // ============================================
  // Test Suite 1: mintOnFill=true (Maker mints positions)
  // ============================================
  describe("Order Matching - mintOnFill=true", function () {

    it("Should execute fill with maker minting positions", async function () {
      const {
        settlement,
        usdc,
        ctf,
        maker,
        taker,
        marketId,
        conditionId,
        domain,
        types,
      } = await loadFixture(deployFixture);

      const currentTime = await time.latest();
      const orderParams = {
        maker: maker.address,
        marketId,
        conditionId,
        outcome: 0, // YES
        collateral: await usdc.getAddress(),
        pricePips: 5500, // 55% probability
        amount: ethers.parseUnits("100", 6),
        makerFeeBps: MAKER_FEE_BPS,
        takerFeeBps: TAKER_FEE_BPS,
        expiry: currentTime + 3600,
        salt: 12345,
        nonce: 1,
        mintOnFill: true,
        allowedTaker: ethers.ZeroAddress,
      };

      const { order, signature } = await createSignedOrder(maker, orderParams, domain, types);

      const fillAmount = ethers.parseUnits("100", 6);
      const fill = {
        order,
        signature,
        fillAmount,
        taker: taker.address,
      };

      // Calculate expected amounts
      const takerCollateral = (fillAmount * BigInt(order.pricePips)) / BPS;
      const makerFee = (takerCollateral * BigInt(order.makerFeeBps)) / BPS;
      const takerFee = (takerCollateral * BigInt(order.takerFeeBps)) / BPS;

      const makerBalanceBefore = await settlement.collateralBalances(maker.address, await usdc.getAddress());
      const takerBalanceBefore = await settlement.collateralBalances(taker.address, await usdc.getAddress());

      // Execute fill
      // Execute fill and get order hash
      const orderHash = ethers.TypedDataEncoder.hash(domain, types, order);

      await expect(settlement.connect(taker).executeFill(fill))
        .to.emit(settlement, "TradeExecuted")
        .withArgs(
          orderHash,
          marketId,
          conditionId,
          0,
          maker.address,
          taker.address,
          fillAmount,
          order.pricePips,
          makerFee,
          takerFee,
          true
        );

      // Check balances updated correctly
      const makerBalanceAfter = await settlement.collateralBalances(maker.address, await usdc.getAddress());
      const takerBalanceAfter = await settlement.collateralBalances(taker.address, await usdc.getAddress());

      // Maker should have:
      // - Lost fillAmount (used to mint positions)
      // + Received (takerCollateral - makerFee)
      const makerReceive = takerCollateral - makerFee;
      expect(makerBalanceAfter).to.equal(makerBalanceBefore - fillAmount + makerReceive);

      // Taker should have:
      // - Lost (takerCollateral + takerFee)
      const takerTotal = takerCollateral + takerFee;
      expect(takerBalanceAfter).to.equal(takerBalanceBefore - takerTotal);

      // Check CTF positions created
      const takerCollectionId = await ctf.getCollectionId(conditionId, 1 << order.outcome);
      const takerPositionId = await ctf.getPositionId(await usdc.getAddress(), takerCollectionId);
      const takerPosition = await ctf.balanceOf(taker.address, takerPositionId);
      expect(takerPosition).to.equal(fillAmount);

      // Maker should have opposite outcome
      const makerOutcome = 1 - order.outcome;
      const makerCollectionId = await ctf.getCollectionId(conditionId, 1 << makerOutcome);
      const makerPositionId = await ctf.getPositionId(await usdc.getAddress(), makerCollectionId);
      const makerPosition = await ctf.balanceOf(maker.address, makerPositionId);
      expect(makerPosition).to.equal(fillAmount);

      // Check protocol fees accumulated
      const accruedFees = await settlement.protocolFees(await usdc.getAddress());
      expect(accruedFees).to.equal(makerFee + takerFee);
    });

    it("Should reject mintOnFill=true when maker has insufficient collateral", async function () {
      const {
        settlement,
        usdc,
        maker,
        taker,
        marketId,
        conditionId,
        domain,
        types,
      } = await loadFixture(deployFixture);

      // Withdraw most of maker's collateral
      const makerBalance = await settlement.collateralBalances(maker.address, await usdc.getAddress());
      await settlement.connect(maker).withdrawCollateral(await usdc.getAddress(), makerBalance - ethers.parseUnits("10", 6));

      const currentTime = await time.latest();
      const orderParams = {
        maker: maker.address,
        marketId,
        conditionId,
        outcome: 0,
        collateral: await usdc.getAddress(),
        pricePips: 5500,
        amount: ethers.parseUnits("100", 6), // More than maker has
        makerFeeBps: MAKER_FEE_BPS,
        takerFeeBps: TAKER_FEE_BPS,
        expiry: currentTime + 3600,
        salt: 12346,
        nonce: 2,
        mintOnFill: true,
        allowedTaker: ethers.ZeroAddress,
      };

      const { order, signature } = await createSignedOrder(maker, orderParams, domain, types);

      const fill = {
        order,
        signature,
        fillAmount: orderParams.amount,
        taker: taker.address,
      };

      await expect(
        settlement.connect(taker).executeFill(fill)
      ).to.be.revertedWithCustomError(settlement, "InsufficientBalance");
    });
  });

  // ============================================
  // Test Suite 2: mintOnFill=false (Maker has existing positions)
  // ============================================
  describe("Order Matching - mintOnFill=false", function () {

    it("Should execute fill when maker has existing positions", async function () {
      const {
        settlement,
        usdc,
        ctf,
        maker,
        taker,
        marketId,
        conditionId,
        domain,
        types,
      } = await loadFixture(deployFixture);

      // First, maker needs to get some outcome tokens
      // We'll mint them by splitting a position
      const splitAmount = ethers.parseUnits("200", 6);

      // Approve CTF to take maker's USDC
      await usdc.connect(maker).approve(await ctf.getAddress(), splitAmount);

      // Split position to get outcome tokens
      const partition = [1, 2]; // Both outcomes
      await ctf.connect(maker).splitPosition(
        await usdc.getAddress(),
        conditionId,
        partition,
        splitAmount
      );

      // Now maker has 200 USDC worth of each outcome token
      // Maker approves settlement to transfer outcome tokens
      const outcome = 0;
      const collectionId = await ctf.getCollectionId(conditionId, 1 << outcome);
      const positionId = await ctf.getPositionId(await usdc.getAddress(), collectionId);

      await ctf.connect(maker).setApprovalForAll(await settlement.getAddress(), true);

      // Create order to sell existing positions
      const currentTime = await time.latest();
      const orderParams = {
        maker: maker.address,
        marketId,
        conditionId,
        outcome,
        collateral: await usdc.getAddress(),
        pricePips: 6000, // 60%
        amount: ethers.parseUnits("100", 6),
        makerFeeBps: MAKER_FEE_BPS,
        takerFeeBps: TAKER_FEE_BPS,
        expiry: currentTime + 3600,
        salt: 12347,
        nonce: 3,
        mintOnFill: false, // Maker already has positions
        allowedTaker: ethers.ZeroAddress,
      };

      const { order, signature } = await createSignedOrder(maker, orderParams, domain, types);

      const fillAmount = ethers.parseUnits("100", 6);
      const fill = {
        order,
        signature,
        fillAmount,
        taker: taker.address,
      };

      const makerBalanceBefore = await settlement.collateralBalances(maker.address, await usdc.getAddress());
      const takerBalanceBefore = await settlement.collateralBalances(taker.address, await usdc.getAddress());
      const makerPositionBefore = await ctf.balanceOf(maker.address, positionId);

      // Execute fill
      await expect(settlement.connect(taker).executeFill(fill))
        .to.emit(settlement, "TradeExecuted");

      // Calculate expected amounts
      const takerCollateral = (fillAmount * BigInt(order.pricePips)) / BPS;
      const makerFee = (takerCollateral * BigInt(order.makerFeeBps)) / BPS;
      const takerFee = (takerCollateral * BigInt(order.takerFeeBps)) / BPS;
      const makerReceive = takerCollateral - makerFee;
      const takerTotal = takerCollateral + takerFee;

      // Check balances
      const makerBalanceAfter = await settlement.collateralBalances(maker.address, await usdc.getAddress());
      const takerBalanceAfter = await settlement.collateralBalances(taker.address, await usdc.getAddress());

      expect(makerBalanceAfter).to.equal(makerBalanceBefore + makerReceive);
      expect(takerBalanceAfter).to.equal(takerBalanceBefore - takerTotal);

      // Check positions transferred
      const makerPositionAfter = await ctf.balanceOf(maker.address, positionId);
      const takerPosition = await ctf.balanceOf(taker.address, positionId);

      expect(makerPositionAfter).to.equal(makerPositionBefore - fillAmount);
      expect(takerPosition).to.equal(fillAmount);
    });

    it("Should reject mintOnFill=false when maker has insufficient positions", async function () {
      const {
        settlement,
        usdc,
        ctf,
        maker,
        taker,
        marketId,
        conditionId,
        domain,
        types,
      } = await loadFixture(deployFixture);

      // Maker approves settlement but doesn't have positions
      await ctf.connect(maker).setApprovalForAll(await settlement.getAddress(), true);

      const currentTime = await time.latest();
      const orderParams = {
        maker: maker.address,
        marketId,
        conditionId,
        outcome: 0,
        collateral: await usdc.getAddress(),
        pricePips: 6000,
        amount: ethers.parseUnits("100", 6),
        makerFeeBps: MAKER_FEE_BPS,
        takerFeeBps: TAKER_FEE_BPS,
        expiry: currentTime + 3600,
        salt: 12348,
        nonce: 4,
        mintOnFill: false,
        allowedTaker: ethers.ZeroAddress,
      };

      const { order, signature } = await createSignedOrder(maker, orderParams, domain, types);

      const fill = {
        order,
        signature,
        fillAmount: orderParams.amount,
        taker: taker.address,
      };

      // This should fail because maker doesn't have the positions
      await expect(
        settlement.connect(taker).executeFill(fill)
      ).to.be.reverted; // Will revert from ERC1155 transfer
    });
  });

  // ============================================
  // Test Suite 3: Batch Fills
  // ============================================
  describe("Batch Execution", function () {

    it("Should execute multiple fills in batch", async function () {
      const {
        settlement,
        usdc,
        maker,
        taker,
        marketId,
        conditionId,
        domain,
        types,
      } = await loadFixture(deployFixture);

      const currentTime = await time.latest();

      // Create two orders
      const order1Params = {
        maker: maker.address,
        marketId,
        conditionId,
        outcome: 0,
        collateral: await usdc.getAddress(),
        pricePips: 5500,
        amount: ethers.parseUnits("50", 6),
        makerFeeBps: MAKER_FEE_BPS,
        takerFeeBps: TAKER_FEE_BPS,
        expiry: currentTime + 3600,
        salt: 12349,
        nonce: 5,
        mintOnFill: true,
        allowedTaker: ethers.ZeroAddress,
      };

      const order2Params = {
        maker: maker.address,
        marketId,
        conditionId,
        outcome: 1,
        collateral: await usdc.getAddress(),
        pricePips: 4500,
        amount: ethers.parseUnits("50", 6),
        makerFeeBps: MAKER_FEE_BPS,
        takerFeeBps: TAKER_FEE_BPS,
        expiry: currentTime + 3600,
        salt: 12350,
        nonce: 6,
        mintOnFill: true,
        allowedTaker: ethers.ZeroAddress,
      };

      const { order: order1, signature: sig1 } = await createSignedOrder(maker, order1Params, domain, types);
      const { order: order2, signature: sig2 } = await createSignedOrder(maker, order2Params, domain, types);

      const fills = [
        {
          order: order1,
          signature: sig1,
          fillAmount: order1Params.amount,
          taker: taker.address,
        },
        {
          order: order2,
          signature: sig2,
          fillAmount: order2Params.amount,
          taker: taker.address,
        },
      ];

      await expect(settlement.connect(taker).batchFill(fills))
        .to.emit(settlement, "TradeExecuted");

      // Both orders should be fully filled
      const hash1 = ethers.TypedDataEncoder.hash(domain, types, order1);
      const hash2 = ethers.TypedDataEncoder.hash(domain, types, order2);

      expect(await settlement.getFilledAmount(hash1)).to.equal(order1Params.amount);
      expect(await settlement.getFilledAmount(hash2)).to.equal(order2Params.amount);
    });
  });

  // ============================================
  // Test Suite 4: Error Cases
  // ============================================
  describe("Error Handling", function () {

    it("Should reject expired order", async function () {
      const {
        settlement,
        usdc,
        maker,
        taker,
        marketId,
        conditionId,
        domain,
        types,
      } = await loadFixture(deployFixture);

      const currentTime = await time.latest();
      const orderParams = {
        maker: maker.address,
        marketId,
        conditionId,
        outcome: 0,
        collateral: await usdc.getAddress(),
        pricePips: 5500,
        amount: ethers.parseUnits("100", 6),
        makerFeeBps: MAKER_FEE_BPS,
        takerFeeBps: TAKER_FEE_BPS,
        expiry: currentTime + 10, // Expires soon
        salt: 12351,
        nonce: 7,
        mintOnFill: true,
        allowedTaker: ethers.ZeroAddress,
      };

      const { order, signature } = await createSignedOrder(maker, orderParams, domain, types);

      // Fast forward past expiry
      await time.increase(20);

      const fill = {
        order,
        signature,
        fillAmount: orderParams.amount,
        taker: taker.address,
      };

      await expect(
        settlement.connect(taker).executeFill(fill)
      ).to.be.revertedWithCustomError(settlement, "OrderExpired");
    });

    it("Should reject invalid signature", async function () {
      const {
        settlement,
        usdc,
        maker,
        taker,
        otherUser,
        marketId,
        conditionId,
        domain,
        types,
      } = await loadFixture(deployFixture);

      const currentTime = await time.latest();
      const orderParams = {
        maker: maker.address,
        marketId,
        conditionId,
        outcome: 0,
        collateral: await usdc.getAddress(),
        pricePips: 5500,
        amount: ethers.parseUnits("100", 6),
        makerFeeBps: MAKER_FEE_BPS,
        takerFeeBps: TAKER_FEE_BPS,
        expiry: currentTime + 3600,
        salt: 12352,
        nonce: 8,
        mintOnFill: true,
        allowedTaker: ethers.ZeroAddress,
      };

      // Sign with wrong signer
      const { order, signature } = await createSignedOrder(otherUser, orderParams, domain, types);

      const fill = {
        order,
        signature,
        fillAmount: orderParams.amount,
        taker: taker.address,
      };

      await expect(
        settlement.connect(taker).executeFill(fill)
      ).to.be.revertedWithCustomError(settlement, "InvalidSignature");
    });

    it("Should reject overfill", async function () {
      const {
        settlement,
        usdc,
        maker,
        taker,
        marketId,
        conditionId,
        domain,
        types,
      } = await loadFixture(deployFixture);

      const currentTime = await time.latest();
      const orderParams = {
        maker: maker.address,
        marketId,
        conditionId,
        outcome: 0,
        collateral: await usdc.getAddress(),
        pricePips: 5500,
        amount: ethers.parseUnits("100", 6),
        makerFeeBps: MAKER_FEE_BPS,
        takerFeeBps: TAKER_FEE_BPS,
        expiry: currentTime + 3600,
        salt: 12353,
        nonce: 9,
        mintOnFill: true,
        allowedTaker: ethers.ZeroAddress,
      };

      const { order, signature } = await createSignedOrder(maker, orderParams, domain, types);

      // First fill partially
      const firstFill = {
        order,
        signature,
        fillAmount: ethers.parseUnits("60", 6),
        taker: taker.address,
      };

      await settlement.connect(taker).executeFill(firstFill);

      // Try to fill more than remaining
      const secondFill = {
        order,
        signature,
        fillAmount: ethers.parseUnits("50", 6), // Would exceed 100
        taker: taker.address,
      };

      await expect(
        settlement.connect(taker).executeFill(secondFill)
      ).to.be.revertedWithCustomError(settlement, "Overfill");
    });

    it("Should reject when taker has insufficient balance", async function () {
      const {
        settlement,
        usdc,
        maker,
        taker,
        marketId,
        conditionId,
        domain,
        types,
      } = await loadFixture(deployFixture);

      // Withdraw taker's collateral
      const takerBalance = await settlement.collateralBalances(taker.address, await usdc.getAddress());
      await settlement.connect(taker).withdrawCollateral(await usdc.getAddress(), takerBalance);

      const currentTime = await time.latest();
      const orderParams = {
        maker: maker.address,
        marketId,
        conditionId,
        outcome: 0,
        collateral: await usdc.getAddress(),
        pricePips: 5500,
        amount: ethers.parseUnits("100", 6),
        makerFeeBps: MAKER_FEE_BPS,
        takerFeeBps: TAKER_FEE_BPS,
        expiry: currentTime + 3600,
        salt: 12354,
        nonce: 10,
        mintOnFill: true,
        allowedTaker: ethers.ZeroAddress,
      };

      const { order, signature } = await createSignedOrder(maker, orderParams, domain, types);

      const fill = {
        order,
        signature,
        fillAmount: orderParams.amount,
        taker: taker.address,
      };

      await expect(
        settlement.connect(taker).executeFill(fill)
      ).to.be.revertedWithCustomError(settlement, "InsufficientBalance");
    });

    it("Should reject cancelled nonce", async function () {
      const {
        settlement,
        usdc,
        maker,
        taker,
        marketId,
        conditionId,
        domain,
        types,
      } = await loadFixture(deployFixture);

      const nonce = 11;

      // Maker cancels nonce
      await settlement.connect(maker).cancelOrder(nonce);

      const currentTime = await time.latest();
      const orderParams = {
        maker: maker.address,
        marketId,
        conditionId,
        outcome: 0,
        collateral: await usdc.getAddress(),
        pricePips: 5500,
        amount: ethers.parseUnits("100", 6),
        makerFeeBps: MAKER_FEE_BPS,
        takerFeeBps: TAKER_FEE_BPS,
        expiry: currentTime + 3600,
        salt: 12355,
        nonce,
        mintOnFill: true,
        allowedTaker: ethers.ZeroAddress,
      };

      const { order, signature } = await createSignedOrder(maker, orderParams, domain, types);

      const fill = {
        order,
        signature,
        fillAmount: orderParams.amount,
        taker: taker.address,
      };

      await expect(
        settlement.connect(taker).executeFill(fill)
      ).to.be.revertedWithCustomError(settlement, "InvalidNonce");
    });

    it("Should reject unauthorized taker", async function () {
      const {
        settlement,
        usdc,
        maker,
        taker,
        otherUser,
        marketId,
        conditionId,
        domain,
        types,
      } = await loadFixture(deployFixture);

      const currentTime = await time.latest();
      const orderParams = {
        maker: maker.address,
        marketId,
        conditionId,
        outcome: 0,
        collateral: await usdc.getAddress(),
        pricePips: 5500,
        amount: ethers.parseUnits("100", 6),
        makerFeeBps: MAKER_FEE_BPS,
        takerFeeBps: TAKER_FEE_BPS,
        expiry: currentTime + 3600,
        salt: 12356,
        nonce: 12,
        mintOnFill: true,
        allowedTaker: taker.address, // Only taker allowed
      };

      const { order, signature } = await createSignedOrder(maker, orderParams, domain, types);

      const fill = {
        order,
        signature,
        fillAmount: orderParams.amount,
        taker: otherUser.address, // Different taker trying to fill
      };

      await expect(
        settlement.connect(otherUser).executeFill(fill)
      ).to.be.revertedWithCustomError(settlement, "UnauthorizedTaker");
    });

    it("Should reject invalid outcome (>=2)", async function () {
      const {
        settlement,
        usdc,
        maker,
        taker,
        marketId,
        conditionId,
        domain,
        types,
      } = await loadFixture(deployFixture);

      const currentTime = await time.latest();
      const orderParams = {
        maker: maker.address,
        marketId,
        conditionId,
        outcome: 2, // Invalid for binary market
        collateral: await usdc.getAddress(),
        pricePips: 5500,
        amount: ethers.parseUnits("100", 6),
        makerFeeBps: MAKER_FEE_BPS,
        takerFeeBps: TAKER_FEE_BPS,
        expiry: currentTime + 3600,
        salt: 12357,
        nonce: 13,
        mintOnFill: true,
        allowedTaker: ethers.ZeroAddress,
      };

      const { order, signature } = await createSignedOrder(maker, orderParams, domain, types);

      const fill = {
        order,
        signature,
        fillAmount: orderParams.amount,
        taker: taker.address,
      };

      await expect(
        settlement.connect(taker).executeFill(fill)
      ).to.be.revertedWithCustomError(settlement, "InvalidOutcome");
    });

    it("Should reject unsupported collateral", async function () {
      const {
        settlement,
        maker,
        taker,
        marketId,
        conditionId,
        domain,
        types,
      } = await loadFixture(deployFixture);

      const fakeToken = ethers.Wallet.createRandom().address;

      const currentTime = await time.latest();
      const orderParams = {
        maker: maker.address,
        marketId,
        conditionId,
        outcome: 0,
        collateral: fakeToken, // Not whitelisted
        pricePips: 5500,
        amount: ethers.parseUnits("100", 6),
        makerFeeBps: MAKER_FEE_BPS,
        takerFeeBps: TAKER_FEE_BPS,
        expiry: currentTime + 3600,
        salt: 12358,
        nonce: 14,
        mintOnFill: true,
        allowedTaker: ethers.ZeroAddress,
      };

      const { order, signature } = await createSignedOrder(maker, orderParams, domain, types);

      const fill = {
        order,
        signature,
        fillAmount: orderParams.amount,
        taker: taker.address,
      };

      await expect(
        settlement.connect(taker).executeFill(fill)
      ).to.be.revertedWithCustomError(settlement, "UnsupportedCollateral");
    });

    it("Should reject zero fill amount", async function () {
      const {
        settlement,
        usdc,
        maker,
        taker,
        marketId,
        conditionId,
        domain,
        types,
      } = await loadFixture(deployFixture);

      const currentTime = await time.latest();
      const orderParams = {
        maker: maker.address,
        marketId,
        conditionId,
        outcome: 0,
        collateral: await usdc.getAddress(),
        pricePips: 5500,
        amount: ethers.parseUnits("100", 6),
        makerFeeBps: MAKER_FEE_BPS,
        takerFeeBps: TAKER_FEE_BPS,
        expiry: currentTime + 3600,
        salt: 12359,
        nonce: 15,
        mintOnFill: true,
        allowedTaker: ethers.ZeroAddress,
      };

      const { order, signature } = await createSignedOrder(maker, orderParams, domain, types);

      const fill = {
        order,
        signature,
        fillAmount: 0,
        taker: taker.address,
      };

      await expect(
        settlement.connect(taker).executeFill(fill)
      ).to.be.revertedWithCustomError(settlement, "InvalidAmount");
    });
  });

  // ============================================
  // Test Suite 5: Partial Fills
  // ============================================
  describe("Partial Fills", function () {

    it("Should allow multiple partial fills until order is complete", async function () {
      const {
        settlement,
        usdc,
        maker,
        taker,
        marketId,
        conditionId,
        domain,
        types,
      } = await loadFixture(deployFixture);

      const currentTime = await time.latest();
      const totalAmount = ethers.parseUnits("100", 6);
      const orderParams = {
        maker: maker.address,
        marketId,
        conditionId,
        outcome: 0,
        collateral: await usdc.getAddress(),
        pricePips: 5500,
        amount: totalAmount,
        makerFeeBps: MAKER_FEE_BPS,
        takerFeeBps: TAKER_FEE_BPS,
        expiry: currentTime + 3600,
        salt: 12360,
        nonce: 16,
        mintOnFill: true,
        allowedTaker: ethers.ZeroAddress,
      };

      const { order, signature } = await createSignedOrder(maker, orderParams, domain, types);
      const orderHash = ethers.TypedDataEncoder.hash(domain, types, order);

      // Fill in three parts: 30, 40, 30
      const fill1 = {
        order,
        signature,
        fillAmount: ethers.parseUnits("30", 6),
        taker: taker.address,
      };

      await settlement.connect(taker).executeFill(fill1);
      expect(await settlement.getFilledAmount(orderHash)).to.equal(ethers.parseUnits("30", 6));

      const fill2 = {
        order,
        signature,
        fillAmount: ethers.parseUnits("40", 6),
        taker: taker.address,
      };

      await settlement.connect(taker).executeFill(fill2);
      expect(await settlement.getFilledAmount(orderHash)).to.equal(ethers.parseUnits("70", 6));

      const fill3 = {
        order,
        signature,
        fillAmount: ethers.parseUnits("30", 6),
        taker: taker.address,
      };

      await settlement.connect(taker).executeFill(fill3);
      expect(await settlement.getFilledAmount(orderHash)).to.equal(totalAmount);
    });
  });
});

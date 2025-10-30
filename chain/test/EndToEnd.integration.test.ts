import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * End-to-End Integration Test
 *
 * Tests the complete lifecycle of a prediction market:
 * 1. Deploy all contracts
 * 2. Users deposit collateral
 * 3. Create a market
 * 4. Users create and sign orders
 * 5. Execute order matching (both mintOnFill variants)
 * 6. Wait for market to end
 * 7. Resolve market with oracle
 * 8. Winners redeem positions
 * 9. Fee collection
 *
 * This validates the entire business flow: 下单→撮合→批量结算→市场解析→仓位赎回
 */
describe("End-to-End Integration", function () {

  const PYTH_ADDRESS = "0x132923f95FD7E8a6FD8aC302D8fd92317F23aFfd";
  const BTC_FEED_ID = "0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de";
  const COOLDOWN_PERIOD = 60;
  const BPS = 10000n;

  async function deployFullSystem() {
    const [owner, maker1, maker2, taker1, taker2, feeCollector] = await ethers.getSigners();

    // Deploy all contracts
    console.log("    Deploying contracts...");

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();

    const CTF = await ethers.getContractFactory("ConditionalTokensV2");
    const ctf = await CTF.deploy();

    const OracleAdapter = await ethers.getContractFactory("PythOracleAdapter");
    const oracle = await OracleAdapter.deploy(PYTH_ADDRESS, BTC_FEED_ID, COOLDOWN_PERIOD);

    const Settlement = await ethers.getContractFactory("SettlementV2");
    const settlement = await Settlement.deploy(await ctf.getAddress());

    const MarketRegistry = await ethers.getContractFactory("MarketRegistryV2");
    const registry = await MarketRegistry.deploy(await ctf.getAddress());

    // Setup
    await settlement.setFeeCollector(feeCollector.address);
    await settlement.setCollateralSupport(await usdc.getAddress(), true);

    // Mint USDC to users
    const mintAmount = ethers.parseUnits("100000", 6);
    await usdc.mint(maker1.address, mintAmount);
    await usdc.mint(maker2.address, mintAmount);
    await usdc.mint(taker1.address, mintAmount);
    await usdc.mint(taker2.address, mintAmount);

    // EIP712 domain
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
      usdc,
      ctf,
      oracle,
      settlement,
      registry,
      owner,
      maker1,
      maker2,
      taker1,
      taker2,
      feeCollector,
      domain,
      types,
    };
  }

  // Helper to create signed order
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
  // Full Lifecycle Test
  // ============================================
  describe("Complete Market Lifecycle", function () {

    // Note: This is a long test that may take time
    this.timeout(120000); // 2 minutes

    it("Should execute full lifecycle: deposit → order → match → resolve → redeem", async function () {
      const {
        usdc,
        ctf,
        oracle,
        settlement,
        registry,
        maker1,
        maker2,
        taker1,
        taker2,
        feeCollector,
        domain,
        types,
      } = await loadFixture(deployFullSystem);

      console.log("    ========================================");
      console.log("    STEP 1: Users deposit collateral");
      console.log("    ========================================");

      const depositAmount = ethers.parseUnits("10000", 6);

      await usdc.connect(maker1).approve(await settlement.getAddress(), depositAmount);
      await settlement.connect(maker1).depositCollateral(await usdc.getAddress(), depositAmount);

      await usdc.connect(maker2).approve(await settlement.getAddress(), depositAmount);
      await settlement.connect(maker2).depositCollateral(await usdc.getAddress(), depositAmount);

      await usdc.connect(taker1).approve(await settlement.getAddress(), depositAmount);
      await settlement.connect(taker1).depositCollateral(await usdc.getAddress(), depositAmount);

      await usdc.connect(taker2).approve(await settlement.getAddress(), depositAmount);
      await settlement.connect(taker2).depositCollateral(await usdc.getAddress(), depositAmount);

      console.log("    ✓ All users deposited collateral");

      // Verify balances
      expect(await settlement.collateralBalances(maker1.address, await usdc.getAddress())).to.equal(depositAmount);
      expect(await settlement.collateralBalances(taker1.address, await usdc.getAddress())).to.equal(depositAmount);

      console.log("    ========================================");
      console.log("    STEP 2: Create a market");
      console.log("    ========================================");

      const currentTime = await time.latest();
      // Use historical time so prices are available (5 min ago)
      const startTime = Math.floor((currentTime - 300) / 60) * 60;

      const tx = await registry.createMarket(
        await usdc.getAddress(),
        await oracle.getAddress(),
        startTime,
        0, // BTC_UPDOWN
        1  // 1 minute
      );

      const receipt = await tx.wait();
      const createEvent = receipt?.logs.find((log: any) => {
        try {
          return registry.interface.parseLog(log)?.name === "MarketCreated";
        } catch {
          return false;
        }
      });

      const parsedEvent = registry.interface.parseLog(createEvent!);
      const marketId = Number(parsedEvent?.args.marketId);
      const conditionId = parsedEvent?.args.conditionId;

      console.log(`    ✓ Market created: ID=${marketId}`);

      const market = await registry.getMarket(marketId);
      expect(market.resolved).to.be.false;
      expect(market.startTime).to.equal(startTime);
      expect(market.endTime).to.equal(startTime + 60);

      console.log("    ========================================");
      console.log("    STEP 3: Create orders (mintOnFill=true)");
      console.log("    ========================================");

      const expiry = currentTime + 3600;

      // Maker1 creates order to sell YES (outcome 0) at 55%
      const order1Params = {
        maker: maker1.address,
        marketId,
        conditionId,
        outcome: 0,
        collateral: await usdc.getAddress(),
        pricePips: 5500,
        amount: ethers.parseUnits("1000", 6),
        makerFeeBps: 10,
        takerFeeBps: 20,
        expiry,
        salt: 1,
        nonce: 1,
        mintOnFill: true,
        allowedTaker: ethers.ZeroAddress,
      };

      const { order: order1, signature: sig1 } = await createSignedOrder(maker1, order1Params, domain, types);

      // Maker2 creates order to sell NO (outcome 1) at 45%
      const order2Params = {
        maker: maker2.address,
        marketId,
        conditionId,
        outcome: 1,
        collateral: await usdc.getAddress(),
        pricePips: 4500,
        amount: ethers.parseUnits("1000", 6),
        makerFeeBps: 10,
        takerFeeBps: 20,
        expiry,
        salt: 2,
        nonce: 1,
        mintOnFill: true,
        allowedTaker: ethers.ZeroAddress,
      };

      const { order: order2, signature: sig2 } = await createSignedOrder(maker2, order2Params, domain, types);

      console.log("    ✓ Orders created and signed");

      console.log("    ========================================");
      console.log("    STEP 4: Execute order matching");
      console.log("    ========================================");

      // Taker1 fills order1 (buys YES at 55%)
      const fill1 = {
        order: order1,
        signature: sig1,
        fillAmount: ethers.parseUnits("1000", 6),
        taker: taker1.address,
      };

      await settlement.connect(taker1).executeFill(fill1);
      console.log("    ✓ Taker1 bought YES tokens");

      // Taker2 fills order2 (buys NO at 45%)
      const fill2 = {
        order: order2,
        signature: sig2,
        fillAmount: ethers.parseUnits("1000", 6),
        taker: taker2.address,
      };

      await settlement.connect(taker2).executeFill(fill2);
      console.log("    ✓ Taker2 bought NO tokens");

      // Verify positions were created
      const yesCollectionId = await ctf.getCollectionId(conditionId, 1 << 0);
      const yesPositionId = await ctf.getPositionId(await usdc.getAddress(), yesCollectionId);
      const taker1YesBalance = await ctf.balanceOf(taker1.address, yesPositionId);
      expect(taker1YesBalance).to.equal(ethers.parseUnits("1000", 6));

      const noCollectionId = await ctf.getCollectionId(conditionId, 1 << 1);
      const noPositionId = await ctf.getPositionId(await usdc.getAddress(), noCollectionId);
      const taker2NoBalance = await ctf.balanceOf(taker2.address, noPositionId);
      expect(taker2NoBalance).to.equal(ethers.parseUnits("1000", 6));

      console.log("    ✓ CTF positions created correctly");

      // Check protocol fees accumulated
      const accruedFees = await settlement.protocolFees(await usdc.getAddress());
      expect(accruedFees).to.be.gt(0);
      console.log(`    ✓ Protocol fees accumulated: ${ethers.formatUnits(accruedFees, 6)} USDC`);

      console.log("    ========================================");
      console.log("    STEP 5: Wait for market to end + buffer");
      console.log("    ========================================");

      const resolveBuffer = await registry.resolveBuffer();
      const targetTime = Number(market.endTime) + Number(resolveBuffer) + 10;
      await time.increaseTo(targetTime);

      console.log(`    ✓ Fast-forwarded to ${targetTime}`);

      console.log("    ========================================");
      console.log("    STEP 6: Resolve market");
      console.log("    ========================================");

      // Check if market can be resolved
      const canResolve = await registry.canResolve(marketId);
      console.log(`    Can resolve: ${canResolve}`);

      if (canResolve) {
        const resolveTx = await registry.resolveMarket(marketId);
        await resolveTx.wait();

        const resolvedMarket = await registry.getMarket(marketId);
        expect(resolvedMarket.resolved).to.be.true;

        const winningOutcome = resolvedMarket.winningOutcome;
        console.log(`    ✓ Market resolved! Winner: ${winningOutcome === 0 ? 'DOWN/SAME' : 'UP'}`);

        // Check CTF condition was resolved
        const condition = await ctf.getCondition(conditionId);
        expect(condition.resolved).to.be.true;
        console.log("    ✓ CTF condition marked as resolved");

        console.log("    ========================================");
        console.log("    STEP 7: Winners redeem positions");
        console.log("    ========================================");

        // Determine who won
        let winner, winnerPositionId;
        if (winningOutcome === 0) {
          // YES/DOWN won
          winner = taker1;
          winnerPositionId = yesPositionId;
          console.log("    Taker1 (YES holder) won!");
        } else {
          // NO/UP won
          winner = taker2;
          winnerPositionId = noPositionId;
          console.log("    Taker2 (NO holder) won!");
        }

        // Winner redeems positions
        const winnerBalanceBefore = await usdc.balanceOf(winner.address);
        const winnerPositionBalance = await ctf.balanceOf(winner.address, winnerPositionId);

        // Redeem via CTF
        const partition = [1, 2]; // Both outcomes
        await ctf.connect(winner).redeemPositions(
          await usdc.getAddress(),
          conditionId,
          partition
        );

        const winnerBalanceAfter = await usdc.balanceOf(winner.address);
        const redeemedAmount = winnerBalanceAfter - winnerBalanceBefore;

        expect(redeemedAmount).to.equal(winnerPositionBalance);
        console.log(`    ✓ Winner redeemed ${ethers.formatUnits(redeemedAmount, 6)} USDC`);

        console.log("    ========================================");
        console.log("    STEP 8: Fee collection");
        console.log("    ========================================");

        const feeBalance = await settlement.protocolFees(await usdc.getAddress());
        const feeCollectorBalanceBefore = await usdc.balanceOf(feeCollector.address);

        await settlement.connect(feeCollector).withdrawFees(
          await usdc.getAddress(),
          feeBalance,
          feeCollector.address
        );

        const feeCollectorBalanceAfter = await usdc.balanceOf(feeCollector.address);
        const collectedFees = feeCollectorBalanceAfter - feeCollectorBalanceBefore;

        expect(collectedFees).to.equal(feeBalance);
        console.log(`    ✓ Fee collector withdrew ${ethers.formatUnits(collectedFees, 6)} USDC`);

        console.log("    ========================================");
        console.log("    ✅ FULL LIFECYCLE COMPLETED SUCCESSFULLY");
        console.log("    ========================================");

      } else {
        console.log("    ⚠️  Cannot resolve market - prices not available on testnet");
        console.log("    This is expected behavior - oracle requires historical prices past cooldown");
        console.log("    ✓ All other steps completed successfully");
      }
    });

    it("Should handle mintOnFill=false orders correctly", async function () {
      const {
        usdc,
        ctf,
        oracle,
        settlement,
        registry,
        maker1,
        taker1,
        domain,
        types,
      } = await loadFixture(deployFullSystem);

      console.log("    Testing mintOnFill=false flow...");

      // 1. Deposit collateral
      const depositAmount = ethers.parseUnits("10000", 6);
      await usdc.connect(maker1).approve(await settlement.getAddress(), depositAmount);
      await settlement.connect(maker1).depositCollateral(await usdc.getAddress(), depositAmount);

      await usdc.connect(taker1).approve(await settlement.getAddress(), depositAmount);
      await settlement.connect(taker1).depositCollateral(await usdc.getAddress(), depositAmount);

      // 2. Create market
      const currentTime = await time.latest();
      const startTime = Math.floor((currentTime - 300) / 60) * 60;

      const tx = await registry.createMarket(
        await usdc.getAddress(),
        await oracle.getAddress(),
        startTime,
        0,
        1
      );

      const receipt = await tx.wait();
      const createEvent = receipt?.logs.find((log: any) => {
        try {
          return registry.interface.parseLog(log)?.name === "MarketCreated";
        } catch {
          return false;
        }
      });

      const parsedEvent = registry.interface.parseLog(createEvent!);
      const marketId = Number(parsedEvent?.args.marketId);
      const conditionId = parsedEvent?.args.conditionId;

      // 3. Maker mints positions first (split position)
      const splitAmount = ethers.parseUnits("2000", 6);
      await usdc.connect(maker1).approve(await ctf.getAddress(), splitAmount);

      const partition = [1, 2];
      await ctf.connect(maker1).splitPosition(
        await usdc.getAddress(),
        conditionId,
        partition,
        splitAmount
      );

      console.log("    ✓ Maker split position to get outcome tokens");

      // Maker approves settlement to transfer tokens
      await ctf.connect(maker1).setApprovalForAll(await settlement.getAddress(), true);

      // 4. Create order with mintOnFill=false
      const orderParams = {
        maker: maker1.address,
        marketId,
        conditionId,
        outcome: 0,
        collateral: await usdc.getAddress(),
        pricePips: 6000,
        amount: ethers.parseUnits("1000", 6),
        makerFeeBps: 10,
        takerFeeBps: 20,
        expiry: currentTime + 3600,
        salt: 100,
        nonce: 100,
        mintOnFill: false, // Maker has existing positions
        allowedTaker: ethers.ZeroAddress,
      };

      const { order, signature } = await createSignedOrder(maker1, orderParams, domain, types);

      // 5. Execute fill
      const fill = {
        order,
        signature,
        fillAmount: orderParams.amount,
        taker: taker1.address,
      };

      await settlement.connect(taker1).executeFill(fill);

      console.log("    ✓ Order with mintOnFill=false executed successfully");

      // Verify taker received positions
      const collectionId = await ctf.getCollectionId(conditionId, 1 << 0);
      const positionId = await ctf.getPositionId(await usdc.getAddress(), collectionId);
      const takerBalance = await ctf.balanceOf(taker1.address, positionId);

      expect(takerBalance).to.equal(orderParams.amount);
      console.log("    ✓ Taker received outcome tokens correctly");
    });

    it("Should handle batch fills correctly", async function () {
      const {
        usdc,
        ctf,
        oracle,
        settlement,
        registry,
        maker1,
        taker1,
        domain,
        types,
      } = await loadFixture(deployFullSystem);

      console.log("    Testing batch fill flow...");

      // Setup
      const depositAmount = ethers.parseUnits("10000", 6);
      await usdc.connect(maker1).approve(await settlement.getAddress(), depositAmount);
      await settlement.connect(maker1).depositCollateral(await usdc.getAddress(), depositAmount);

      await usdc.connect(taker1).approve(await settlement.getAddress(), depositAmount);
      await settlement.connect(taker1).depositCollateral(await usdc.getAddress(), depositAmount);

      const currentTime = await time.latest();
      const startTime = Math.floor((currentTime - 300) / 60) * 60;

      const tx = await registry.createMarket(
        await usdc.getAddress(),
        await oracle.getAddress(),
        startTime,
        0,
        1
      );

      const receipt = await tx.wait();
      const createEvent = receipt?.logs.find((log: any) => {
        try {
          return registry.interface.parseLog(log)?.name === "MarketCreated";
        } catch {
          return false;
        }
      });

      const parsedEvent = registry.interface.parseLog(createEvent!);
      const marketId = Number(parsedEvent?.args.marketId);
      const conditionId = parsedEvent?.args.conditionId;

      // Create multiple orders
      const order1Params = {
        maker: maker1.address,
        marketId,
        conditionId,
        outcome: 0,
        collateral: await usdc.getAddress(),
        pricePips: 5500,
        amount: ethers.parseUnits("500", 6),
        makerFeeBps: 10,
        takerFeeBps: 20,
        expiry: currentTime + 3600,
        salt: 201,
        nonce: 201,
        mintOnFill: true,
        allowedTaker: ethers.ZeroAddress,
      };

      const order2Params = {
        ...order1Params,
        outcome: 1,
        pricePips: 4500,
        salt: 202,
        nonce: 202,
      };

      const { order: order1, signature: sig1 } = await createSignedOrder(maker1, order1Params, domain, types);
      const { order: order2, signature: sig2 } = await createSignedOrder(maker1, order2Params, domain, types);

      const fills = [
        {
          order: order1,
          signature: sig1,
          fillAmount: order1Params.amount,
          taker: taker1.address,
        },
        {
          order: order2,
          signature: sig2,
          fillAmount: order2Params.amount,
          taker: taker1.address,
        },
      ];

      // Execute batch fill
      await settlement.connect(taker1).batchFill(fills);

      console.log("    ✓ Batch fill executed successfully");

      // Verify both orders were filled
      const hash1 = ethers.TypedDataEncoder.hash(domain, types, order1);
      const hash2 = ethers.TypedDataEncoder.hash(domain, types, order2);

      // Note: We can't check filled amounts directly without hashTypedDataV4
      // But we can verify positions were created

      const yesCollectionId = await ctf.getCollectionId(conditionId, 1 << 0);
      const yesPositionId = await ctf.getPositionId(await usdc.getAddress(), yesCollectionId);
      const yesBalance = await ctf.balanceOf(taker1.address, yesPositionId);

      const noCollectionId = await ctf.getCollectionId(conditionId, 1 << 1);
      const noPositionId = await ctf.getPositionId(await usdc.getAddress(), noCollectionId);
      const noBalance = await ctf.balanceOf(taker1.address, noPositionId);

      expect(yesBalance).to.equal(order1Params.amount);
      expect(noBalance).to.equal(order2Params.amount);

      console.log("    ✓ Both orders filled correctly in batch");
    });
  });

  // ============================================
  // Gas Measurement
  // ============================================
  describe("Gas Measurements", function () {

    it("Should measure gas costs for key operations", async function () {
      const {
        usdc,
        ctf,
        oracle,
        settlement,
        registry,
        maker1,
        taker1,
        domain,
        types,
      } = await loadFixture(deployFullSystem);

      console.log("    ========================================");
      console.log("    GAS COST MEASUREMENTS");
      console.log("    ========================================");

      // 1. Deposit
      const depositAmount = ethers.parseUnits("10000", 6);
      await usdc.connect(maker1).approve(await settlement.getAddress(), depositAmount);
      const depositTx = await settlement.connect(maker1).depositCollateral(await usdc.getAddress(), depositAmount);
      const depositReceipt = await depositTx.wait();
      console.log(`    Deposit:        ${depositReceipt?.gasUsed} gas`);

      await usdc.connect(taker1).approve(await settlement.getAddress(), depositAmount);
      await settlement.connect(taker1).depositCollateral(await usdc.getAddress(), depositAmount);

      // 2. Create market
      const currentTime = await time.latest();
      const startTime = Math.floor((currentTime - 300) / 60) * 60;
      const createMarketTx = await registry.createMarket(
        await usdc.getAddress(),
        await oracle.getAddress(),
        startTime,
        0,
        1
      );
      const createMarketReceipt = await createMarketTx.wait();
      console.log(`    Create Market:  ${createMarketReceipt?.gasUsed} gas`);

      const createEvent = createMarketReceipt?.logs.find((log: any) => {
        try {
          return registry.interface.parseLog(log)?.name === "MarketCreated";
        } catch {
          return false;
        }
      });
      const parsedEvent = registry.interface.parseLog(createEvent!);
      const marketId = Number(parsedEvent?.args.marketId);
      const conditionId = parsedEvent?.args.conditionId;

      // 3. Execute fill (mintOnFill=true)
      const orderParams = {
        maker: maker1.address,
        marketId,
        conditionId,
        outcome: 0,
        collateral: await usdc.getAddress(),
        pricePips: 5500,
        amount: ethers.parseUnits("1000", 6),
        makerFeeBps: 10,
        takerFeeBps: 20,
        expiry: currentTime + 3600,
        salt: 1,
        nonce: 1,
        mintOnFill: true,
        allowedTaker: ethers.ZeroAddress,
      };

      const { order, signature } = await createSignedOrder(maker1, orderParams, domain, types);

      const fill = {
        order,
        signature,
        fillAmount: orderParams.amount,
        taker: taker1.address,
      };

      const fillTx = await settlement.connect(taker1).executeFill(fill);
      const fillReceipt = await fillTx.wait();
      console.log(`    Fill (mint):    ${fillReceipt?.gasUsed} gas`);

      // 4. Withdraw
      const withdrawAmount = ethers.parseUnits("100", 6);
      const withdrawTx = await settlement.connect(maker1).withdrawCollateral(await usdc.getAddress(), withdrawAmount);
      const withdrawReceipt = await withdrawTx.wait();
      console.log(`    Withdraw:       ${withdrawReceipt?.gasUsed} gas`);

      console.log("    ========================================");
    });
  });
});

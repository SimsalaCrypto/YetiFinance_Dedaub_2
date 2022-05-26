const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const BorrowerOperationsTester = artifacts.require("./BorrowerOperationsTester.sol")
const TroveManagerLiquidations = artifacts.require("./TroveManagerLiquidations.sol")
const PUSDTokenTester = artifacts.require("./PUSDTokenTester")

const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN
const mv = testHelpers.MoneyValues
const timeValues = testHelpers.TimeValues

const TroveManagerTester = artifacts.require("TroveManagerTester")
const PUSDToken = artifacts.require("PUSDToken")
const NonPayable = artifacts.require('NonPayable.sol')

const ZERO = toBN('0')
const ZERO_ADDRESS = th.ZERO_ADDRESS
const maxBytes32 = th.maxBytes32

const getFrontEndTag = async (stabilityPool, depositor) => {
  return (await stabilityPool.deposits(depositor))[1]
}

contract('StabilityPool', async accounts => {

  const [owner,
    defaulter_1, defaulter_2, defaulter_3,
    whale,
    alice, bob, carol, dennis, erin, flyn,
    A, B, C, D, E, F,
    frontEnd_1, frontEnd_2, frontEnd_3,
  ] = accounts;

  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

  const frontEnds = [frontEnd_1, frontEnd_2, frontEnd_3]
  let contracts
  let priceFeed
  let pusdToken
  let sortedTroves
  let troveManager
  let activePool
  let stabilityPool
  let defaultPool
  let borrowerOperations
  let preonToken
  let communityIssuance
  let weth

  let gasPriceInWei

  const getOpenTrovePUSDAmount = async (totalDebt) => th.getOpenTrovePUSDAmount(contracts, totalDebt)
  const openTrove = async (params) => th.openTrove(contracts, params)
  const assertRevert = th.assertRevert

  describe("Stability Pool Mechanisms", async () => {

    before(async () => {
      gasPriceInWei = await web3.eth.getGasPrice()
    })

    beforeEach(async () => {
      contracts = await deploymentHelper.deployLiquityCore()
      contracts.borrowerOperations = await BorrowerOperationsTester.new()
      contracts.troveManager = await TroveManagerTester.new()
      const troveManagerLiquidations = await TroveManagerLiquidations.new()
      contracts.pusdToken = await PUSDTokenTester.new(contracts.troveManager.address,
          contracts.troveManagerLiquidations.address,
          contracts.troveManagerRedemptions.address,
          contracts.stabilityPool.address,
          contracts.borrowerOperations.address),
      contracts = await deploymentHelper.deployPUSDTokenTester(contracts)
      const PREONContracts = await deploymentHelper.deployPREONContracts(bountyAddress, lpRewardsAddress, multisig)

      priceFeed = contracts.priceFeedETH
      pusdToken = contracts.pusdToken
      sortedTroves = contracts.sortedTroves
      troveManager = contracts.troveManager
      activePool = contracts.activePool
      stabilityPool = contracts.stabilityPool
      defaultPool = contracts.defaultPool
      borrowerOperations = contracts.borrowerOperations
      hintHelpers = contracts.hintHelpers
      weth = contracts.weth

      preonToken = PREONContracts.preonToken
      communityIssuance = PREONContracts.communityIssuance

      await deploymentHelper.connectPREONContracts(PREONContracts)
      await deploymentHelper.connectCoreContracts(contracts, PREONContracts)
      await deploymentHelper.connectPREONContractsToCore(PREONContracts, contracts)

      // Register 3 front ends
      await th.registerFrontEnds(frontEnds, stabilityPool)
    })

    // --- provideToSP() ---
    // increases recorded PUSD at Stability Pool
    it("provideToSP(): increases the Stability Pool PUSD balance", async () => {
      // --- SETUP --- Give Alice a least 200
      await openTrove({ extraPUSDAmount: toBN(200), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

      // --- TEST ---

      // provideToSP()
      await stabilityPool.provideToSP(200, ZERO_ADDRESS, { from: alice })

      // check PUSD balances after
      const stabilityPool_PUSD_After = await stabilityPool.getTotalPUSDDeposits()
      assert.equal(stabilityPool_PUSD_After, 200)
    })

    it("provideToSP(): updates the user's deposit record in StabilityPool", async () => {
      // --- SETUP --- Give Alice a least 200
      await openTrove({ extraPUSDAmount: toBN(200), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

      // --- TEST ---
      // check user's deposit record before
      const alice_depositRecord_Before = await stabilityPool.deposits(alice)
      assert.equal(alice_depositRecord_Before[0], 0)

      // provideToSP()
      await stabilityPool.provideToSP(200, frontEnd_1, { from: alice })

      // check user's deposit record after
      const alice_depositRecord_After = (await stabilityPool.deposits(alice))[0]
      assert.equal(alice_depositRecord_After, 200)
    })

    it("provideToSP(): reduces the user's PUSD balance by the correct amount", async () => {
      // --- SETUP --- Give Alice a least 200
      await openTrove({ extraPUSDAmount: toBN(200), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

      // --- TEST ---
      // get user's deposit record before
      const alice_PUSDBalance_Before = await pusdToken.balanceOf(alice)

      // provideToSP()
      await stabilityPool.provideToSP(200, frontEnd_1, { from: alice })

      // check user's PUSD balance change
      const alice_PUSDBalance_After = await pusdToken.balanceOf(alice)
      assert.equal(alice_PUSDBalance_Before.sub(alice_PUSDBalance_After), '200')
    })

    it("provideToSP(): increases totalPUSDDeposits by correct amount", async () => {
      // --- SETUP ---

      // Whale opens Trove with 50 ETH, adds 2000 PUSD to StabilityPool
      await openTrove({ extraPUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })
      await stabilityPool.provideToSP(dec(2000, 18), frontEnd_1, { from: whale })

      const totalPUSDDeposits = await stabilityPool.getTotalPUSDDeposits()
      assert.equal(totalPUSDDeposits, dec(2000, 18))
    })

    it('provideToSP(): Correctly updates user snapshots of accumulated rewards per unit staked', async () => {
      // --- SETUP ---

      // Whale opens Trove and deposits to SP
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })
      const whalePUSD = await pusdToken.balanceOf(whale)
      await stabilityPool.provideToSP(whalePUSD, frontEnd_1, { from: whale })

      // 2 Troves opened, each withdraws minimum debt
      await openTrove({ extraPUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1, } })
      await openTrove({ extraPUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2, } })

      // Alice makes Trove and withdraws 100 PUSD
      await openTrove({ extraPUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(5, 18)), extraParams: { from: alice, value: dec(50, 'ether') } })


      // price drops: defaulter's Troves fall below MCR, whale doesn't
      await priceFeed.setPrice(dec(105, 18));

      const SPPUSD_Before = await stabilityPool.getTotalPUSDDeposits()

      // Troves are closed
      await troveManager.liquidate(defaulter_1, { from: owner })
      await troveManager.liquidate(defaulter_2, { from: owner })
      assert.isFalse(await sortedTroves.contains(defaulter_1))
      assert.isFalse(await sortedTroves.contains(defaulter_2))

      // Confirm SP has decreased
      const SPPUSD_After = await stabilityPool.getTotalPUSDDeposits()
      assert.isTrue(SPPUSD_After.lt(SPPUSD_Before))

      // --- TEST ---
      const P_Before = (await stabilityPool.P())
      const S_Before = (await stabilityPool.epochToScaleToSum(contracts.weth.address, 0, 0))
      const G_Before = (await stabilityPool.epochToScaleToG(0, 0))
      assert.isTrue(P_Before.gt(toBN('0')))
      assert.isTrue(S_Before.gt(toBN('0')))

      // Check 'Before' snapshots
      const alice_snapshot_Before = await stabilityPool.depositSnapshots(alice) // snapshots
      // console.log(alice_snapshot_Before);
      // console.log("Snapshot taken");
      const alice_snapshot_S_Before = (await stabilityPool.getDepositSnapshotS(alice, contracts.weth.address)).toString();
      const alice_snapshot_P_Before = alice_snapshot_Before.P.toString()
      const alice_snapshot_G_Before = alice_snapshot_Before.G.toString()
      assert.equal(alice_snapshot_S_Before, '0')
      assert.equal(alice_snapshot_P_Before, '0')
      assert.equal(alice_snapshot_G_Before, '0')

      // Make deposit
      await stabilityPool.provideToSP(dec(100, 18), frontEnd_1, { from: alice })

      // Check 'After' snapshots
      const alice_snapshot_After = await stabilityPool.depositSnapshots(alice)

      const alice_snapshot_S_After = (await stabilityPool.getDepositSnapshotS(alice, contracts.weth.address)).toString()
      const alice_snapshot_P_After = alice_snapshot_After.P.toString()
      const alice_snapshot_G_After = alice_snapshot_After.G.toString()

      assert.equal(alice_snapshot_S_After, S_Before)
      assert.equal(alice_snapshot_P_After, P_Before)
      assert.equal(alice_snapshot_G_After, G_Before)
    })

    // TODO: rewrite this test case to reflect multi-col
    it("provideToSP(), multiple deposits: updates user's deposit and snapshots", async () => {
      // --- SETUP ---
      // Whale opens Trove and deposits to SP
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })
      const whalePUSD = await pusdToken.balanceOf(whale)
      await stabilityPool.provideToSP(whalePUSD, frontEnd_1, { from: whale })

      // 3 Troves opened. Two users withdraw 160 PUSD each
      await openTrove({ extraPUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1, value: dec(50, 'ether') } })
      await openTrove({ extraPUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2, value: dec(50, 'ether') } })
      await openTrove({ extraPUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_3, value: dec(50, 'ether') } })

      // --- TEST ---

      // Alice makes deposit #1: 150 PUSD
      await openTrove({ extraPUSDAmount: toBN(dec(250, 18)), ICR: toBN(dec(3, 18)), extraParams: { from: alice } })
      await stabilityPool.provideToSP(dec(150, 18), frontEnd_1, { from: alice })

      const alice_Snapshot_0 = await stabilityPool.depositSnapshots(alice)
      const alice_Snapshot_S_0 = (await stabilityPool.getDepositSnapshotS(alice, contracts.weth.address)).toString()
      const alice_Snapshot_P_0 = alice_Snapshot_0.P.toString()
      assert.equal(alice_Snapshot_S_0, 0)
      assert.equal(alice_Snapshot_P_0, '1000000000000000000')

      // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(dec(105, 18));

      // 2 users with Trove with 180 PUSD drawn are closed
      await troveManager.liquidate(defaulter_1, { from: owner })  // 180 PUSD closed
      await troveManager.liquidate(defaulter_2, { from: owner }) // 180 PUSD closed

      const alice_compoundedDeposit_1 = await stabilityPool.getCompoundedPUSDDeposit(alice)

      // Alice makes deposit #2
      const alice_topUp_1 = toBN(dec(100, 18))
      await stabilityPool.provideToSP(alice_topUp_1, frontEnd_1, { from: alice })

      const alice_newDeposit_1 = ((await stabilityPool.deposits(alice))[0]).toString()
      assert.equal(alice_compoundedDeposit_1.add(alice_topUp_1), alice_newDeposit_1)

      // get system reward terms
      const P_1 = await stabilityPool.P()
      const S_1 = await stabilityPool.epochToScaleToSum(contracts.weth.address, 0, 0)
      assert.isTrue(P_1.lt(toBN(dec(1, 18))))
      assert.isTrue(S_1.gt(toBN('0')))

      // check Alice's new snapshot is correct
      const alice_Snapshot_1 = await stabilityPool.depositSnapshots(alice)
      const alice_Snapshot_S_1 = (await stabilityPool.getDepositSnapshotS(alice, contracts.weth.address)).toString()
      const alice_Snapshot_P_1 = alice_Snapshot_1.P.toString()
      assert.equal(alice_Snapshot_S_1, S_1)
      assert.equal(alice_Snapshot_P_1, P_1)

      // Bob withdraws PUSD and deposits to StabilityPool
      await openTrove({ extraPUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await stabilityPool.provideToSP(dec(427, 18), frontEnd_1, { from: alice })

      // Defaulter 3 Trove is closed
      await troveManager.liquidate(defaulter_3, { from: owner })

      const alice_compoundedDeposit_2 = await stabilityPool.getCompoundedPUSDDeposit(alice)

      const P_2 = await stabilityPool.P()
      const S_2 = await stabilityPool.epochToScaleToSum(contracts.weth.address, 0, 0)
      assert.isTrue(P_2.lt(P_1))
      assert.isTrue(S_2.gt(S_1))

      // Alice makes deposit #3:  100PUSD
      await stabilityPool.provideToSP(dec(100, 18), frontEnd_1, { from: alice })

      // check Alice's new snapshot is correct
      const alice_Snapshot_2 = await stabilityPool.depositSnapshots(alice)
      const alice_Snapshot_S_2 = (await stabilityPool.getDepositSnapshotS(alice, contracts.weth.address)).toString()
      const alice_Snapshot_P_2 = alice_Snapshot_2.P.toString()
      assert.equal(alice_Snapshot_S_2, S_2)
      assert.equal(alice_Snapshot_P_2, P_2)
    })

    it("provideToSP(): reverts if user tries to provide more than their PUSD balance", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })

      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice, value: dec(50, 'ether') } })
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob, value: dec(50, 'ether') } })
      const alicePUSDbal = await pusdToken.balanceOf(alice)
      const bobPUSDbal = await pusdToken.balanceOf(bob)

      // Alice, attempts to deposit 1 wei more than her balance

      const aliceTxPromise = stabilityPool.provideToSP(alicePUSDbal.add(toBN(1)), frontEnd_1, { from: alice })
      await assertRevert(aliceTxPromise, "revert")

      // Bob, attempts to deposit 235534 more than his balance

      const bobTxPromise = stabilityPool.provideToSP(bobPUSDbal.add(toBN(dec(235534, 18))), frontEnd_1, { from: bob })
      await assertRevert(bobTxPromise, "revert")
    })

    it("provideToSP(): reverts if user tries to provide 2^256-1 PUSD, which exceeds their balance", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice, value: dec(50, 'ether') } })
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob, value: dec(50, 'ether') } })

      const maxBytes32 = web3.utils.toBN("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")

      // Alice attempts to deposit 2^256-1 PUSD
      try {
        aliceTx = await stabilityPool.provideToSP(maxBytes32, frontEnd_1, { from: alice })
        assert.isFalse(tx.receipt.status)
      } catch (error) {
        assert.include(error.message, "revert")
      }
    })

    it("provideToSP(): reverts if cannot receive ETH Gain", async () => {
      // --- SETUP ---
      // Whale deposits 1850 PUSD in StabilityPool
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })
      await stabilityPool.provideToSP(dec(1850, 18), frontEnd_1, { from: whale })

      // Defaulter Troves opened
      await openTrove({ extraPUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ extraPUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // --- TEST ---

      const nonPayable = await NonPayable.new()
      await pusdToken.transfer(nonPayable.address, dec(250, 18), { from: whale })

      // NonPayable makes deposit #1: 150 PUSD
      const txData1 = th.getTransactionData('provideToSP(uint256,address)', [web3.utils.toHex(dec(150, 18)), frontEnd_1])
      const tx1 = await nonPayable.forward(stabilityPool.address, txData1)

      const gains_0 = await stabilityPool.getDepositorGains(nonPayable.address)
      const wethIDX = gains_0[0].indexOf(contracts.weth.address)
      const gain_0 = gains_0[1][wethIDX];
      
      assert.isTrue(gain_0.eq(toBN(0)), 'NonPayable should not have accumulated gains')

      // price drops: defaulters' Troves fall below MCR, nonPayable and whale Trove remain active
      await priceFeed.setPrice(dec(105, 18));

      // 2 defaulters are closed
      await troveManager.liquidate(defaulter_1, { from: owner })
      await troveManager.liquidate(defaulter_2, { from: owner })

      const gains_1 = await stabilityPool.getDepositorGains(nonPayable.address)
      const wethIDX_1 = gains_1[0].indexOf(contracts.weth.address)
      const gain_1 =  gains_1[1][wethIDX];

      assert.isTrue(gain_1.gt(toBN(0)), 'NonPayable should have some accumulated gains')

      // Liquity Test (in our case, the nonpayable address can receive gains):
      // NonPayable tries to make deposit #2: 100PUSD (which also attempts to withdraw ETH gain)
      // const txData2 = th.getTransactionData('provideToSP(uint256,address)', [web3.utils.toHex(dec(100, 18)), frontEnd_1])
      // await th.assertRevert(nonPayable.forward(stabilityPool.address, txData2), 'StabilityPool: sending ETH failed')
    })


    it("provideToSP(): doesn't impact other users' deposits or ETH gains", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraPUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraPUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraPUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      await stabilityPool.provideToSP(dec(1000, 18), frontEnd_1, { from: alice })
      await stabilityPool.provideToSP(dec(2000, 18), frontEnd_1, { from: bob })
      await stabilityPool.provideToSP(dec(3000, 18), frontEnd_1, { from: carol })

      // D opens a trove
      await openTrove({ extraPUSDAmount: toBN(dec(300, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: dennis } })

      // Would-be defaulters open troves
      await openTrove({ extraPUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ extraPUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // Price drops
      await priceFeed.setPrice(dec(105, 18))

      // Defaulters are liquidated
      await troveManager.liquidate(defaulter_1)
      await troveManager.liquidate(defaulter_2)
      assert.isFalse(await sortedTroves.contains(defaulter_1))
      assert.isFalse(await sortedTroves.contains(defaulter_2))

      const alice_PUSDDeposit_Before = (await stabilityPool.getCompoundedPUSDDeposit(alice)).toString()
      const bob_PUSDDeposit_Before = (await stabilityPool.getCompoundedPUSDDeposit(bob)).toString()
      const carol_PUSDDeposit_Before = (await stabilityPool.getCompoundedPUSDDeposit(carol)).toString()

      const alice_ETHGain_Before = ((await stabilityPool.getDepositorGains(alice))[1][0]).toString()
      const bob_ETHGain_Before = ((await stabilityPool.getDepositorGains(bob))[1][0]).toString()
      const carol_ETHGain_Before = ((await stabilityPool.getDepositorGains(carol))[1][0]).toString()

      //check non-zero PUSD and ETHGain in the Stability Pool
      const PUSDinSP = await stabilityPool.getTotalPUSDDeposits()
      const ETHinSP = await stabilityPool.getCollateral(weth.address)
      assert.isTrue(PUSDinSP.gt(mv._zeroBN))
      assert.isTrue(ETHinSP.gt(mv._zeroBN))

      // D makes an SP deposit
      await stabilityPool.provideToSP(dec(1000, 18), frontEnd_1, { from: dennis })
      assert.equal((await stabilityPool.getCompoundedPUSDDeposit(dennis)).toString(), dec(1000, 18))

      const alice_PUSDDeposit_After = (await stabilityPool.getCompoundedPUSDDeposit(alice)).toString()
      const bob_PUSDDeposit_After = (await stabilityPool.getCompoundedPUSDDeposit(bob)).toString()
      const carol_PUSDDeposit_After = (await stabilityPool.getCompoundedPUSDDeposit(carol)).toString()

      const alice_ETHGain_After = ((await stabilityPool.getDepositorGains(alice))[1][0]).toString()
      const bob_ETHGain_After = ((await stabilityPool.getDepositorGains(bob))[1][0]).toString()
      const carol_ETHGain_After = ((await stabilityPool.getDepositorGains(carol))[1][0]).toString()

      // Check compounded deposits and ETH gains for A, B and C have not changed
      assert.equal(alice_PUSDDeposit_Before, alice_PUSDDeposit_After)
      assert.equal(bob_PUSDDeposit_Before, bob_PUSDDeposit_After)
      assert.equal(carol_PUSDDeposit_Before, carol_PUSDDeposit_After)

      assert.equal(alice_ETHGain_Before, alice_ETHGain_After)
      assert.equal(bob_ETHGain_Before, bob_ETHGain_After)
      assert.equal(carol_ETHGain_Before, carol_ETHGain_After)
    })

    it("provideToSP(): doesn't impact system debt, collateral or TCR", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraPUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraPUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraPUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      await stabilityPool.provideToSP(dec(1000, 18), frontEnd_1, { from: alice })
      await stabilityPool.provideToSP(dec(2000, 18), frontEnd_1, { from: bob })
      await stabilityPool.provideToSP(dec(3000, 18), frontEnd_1, { from: carol })

      // D opens a trove
      await openTrove({ extraPUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: dennis } })

      // Would-be defaulters open troves
      await openTrove({ extraPUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ extraPUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // Price drops
      await priceFeed.setPrice(dec(105, 18))

      // Defaulters are liquidated
      await troveManager.liquidate(defaulter_1)
      await troveManager.liquidate(defaulter_2)
      assert.isFalse(await sortedTroves.contains(defaulter_1))
      assert.isFalse(await sortedTroves.contains(defaulter_2))

      const activeDebt_Before = (await activePool.getPUSDDebt()).toString()
      const defaultedDebt_Before = (await defaultPool.getPUSDDebt()).toString()
      const activeColl_Before = (await activePool.getCollateral(contracts.weth.address)).toString()
      const defaultedColl_Before = (await defaultPool.getCollateral(contracts.weth.address)).toString()
      const TCR_Before = (await th.getTCR(contracts)).toString()

      // D makes an SP deposit
      await stabilityPool.provideToSP(dec(1000, 18), frontEnd_1, { from: dennis })
      assert.equal((await stabilityPool.getCompoundedPUSDDeposit(dennis)).toString(), dec(1000, 18))

      const activeDebt_After = (await activePool.getPUSDDebt()).toString()
      const defaultedDebt_After = (await defaultPool.getPUSDDebt()).toString()
      const activeColl_After = (await activePool.getCollateral(contracts.weth.address)).toString()
      const defaultedColl_After = (await defaultPool.getCollateral(contracts.weth.address)).toString()
      const TCR_After = (await th.getTCR(contracts)).toString()

      // Check total system debt, collateral and TCR have not changed after a Stability deposit is made
      assert.equal(activeDebt_Before, activeDebt_After)
      assert.equal(defaultedDebt_Before, defaultedDebt_After)
      assert.equal(activeColl_Before, activeColl_After)
      assert.equal(defaultedColl_Before, defaultedColl_After)
      assert.equal(TCR_Before, TCR_After)
    })

    // TODO: TypeError: troveManager.Troves is not a function
    it("provideToSP(): doesn't impact any troves, including the caller's trove", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraPUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraPUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraPUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      // A and B provide to SP
      await stabilityPool.provideToSP(dec(1000, 18), frontEnd_1, { from: alice })
      await stabilityPool.provideToSP(dec(2000, 18), frontEnd_1, { from: bob })

      // D opens a trove
      await openTrove({ extraPUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: dennis } })

      // Price drops
      await priceFeed.setPrice(dec(105, 18))
      const price = await priceFeed.getPrice()

      // Get debt, collateral and ICR of all existing troves
      const whale_Debt_Before = (await troveManager.getTroveDebt(whale)).toString()
      const alice_Debt_Before = (await troveManager.getTroveDebt(alice)).toString()
      const bob_Debt_Before = (await troveManager.getTroveDebt(bob)).toString()
      const carol_Debt_Before = (await troveManager.getTroveDebt(carol)).toString()
      const dennis_Debt_Before = (await troveManager.getTroveDebt(dennis)).toString()

      const wethIDX = await contracts.whitelist.getIndex(contracts.weth.address)
      const whale_Coll_Before = (await troveManager.getTroveColls(whale))[1][wethIDX].toString()
      const alice_Coll_Before = (await troveManager.getTroveColls(alice))[1][wethIDX].toString()
      const bob_Coll_Before = (await troveManager.getTroveColls(bob))[1][wethIDX].toString()
      const carol_Coll_Before = (await troveManager.getTroveColls(carol))[1][wethIDX].toString()
      const dennis_Coll_Before = (await troveManager.getTroveColls(dennis))[1][wethIDX].toString()

      const whale_ICR_Before = (await troveManager.getCurrentICR(whale)).toString()
      const alice_ICR_Before = (await troveManager.getCurrentICR(alice)).toString()
      const bob_ICR_Before = (await troveManager.getCurrentICR(bob)).toString()
      const carol_ICR_Before = (await troveManager.getCurrentICR(carol)).toString()
      const dennis_ICR_Before = (await troveManager.getCurrentICR(dennis)).toString()

      // D makes an SP deposit
      await stabilityPool.provideToSP(dec(1000, 18), frontEnd_1, { from: dennis })
      assert.equal((await stabilityPool.getCompoundedPUSDDeposit(dennis)).toString(), dec(1000, 18))

      const whale_Debt_After = (await troveManager.getTroveDebt(whale)).toString()
      const alice_Debt_After = (await troveManager.getTroveDebt(alice)).toString()
      const bob_Debt_After = (await troveManager.getTroveDebt(bob)).toString()
      const carol_Debt_After = (await troveManager.getTroveDebt(carol)).toString()
      const dennis_Debt_After = (await troveManager.getTroveDebt(dennis)).toString()

      const whale_Coll_After = (await troveManager.getTroveColls(whale))[1][wethIDX].toString()
      const alice_Coll_After = (await troveManager.getTroveColls(alice))[1][wethIDX].toString()
      const bob_Coll_After = (await troveManager.getTroveColls(bob))[1][wethIDX].toString()
      const carol_Coll_After = (await troveManager.getTroveColls(carol))[1][wethIDX].toString()
      const dennis_Coll_After = (await troveManager.getTroveColls(dennis))[1][wethIDX].toString()

      const whale_ICR_After = (await troveManager.getCurrentICR(whale)).toString()
      const alice_ICR_After = (await troveManager.getCurrentICR(alice)).toString()
      const bob_ICR_After = (await troveManager.getCurrentICR(bob)).toString()
      const carol_ICR_After = (await troveManager.getCurrentICR(carol)).toString()
      const dennis_ICR_After = (await troveManager.getCurrentICR(dennis)).toString()

      assert.equal(whale_Debt_Before, whale_Debt_After)
      assert.equal(alice_Debt_Before, alice_Debt_After)
      assert.equal(bob_Debt_Before, bob_Debt_After)
      assert.equal(carol_Debt_Before, carol_Debt_After)
      assert.equal(dennis_Debt_Before, dennis_Debt_After)

      assert.equal(whale_Coll_Before, whale_Coll_After)
      assert.equal(alice_Coll_Before, alice_Coll_After)
      assert.equal(bob_Coll_Before, bob_Coll_After)
      assert.equal(carol_Coll_Before, carol_Coll_After)
      assert.equal(dennis_Coll_Before, dennis_Coll_After)

      assert.equal(whale_ICR_Before, whale_ICR_After)
      assert.equal(alice_ICR_Before, alice_ICR_After)
      assert.equal(bob_ICR_Before, bob_ICR_After)
      assert.equal(carol_ICR_Before, carol_ICR_After)
      assert.equal(dennis_ICR_Before, dennis_ICR_After)
    })

    // TODO: rewrite this test case to reflect multi-col
    it("provideToSP(): doesn't protect the depositor's trove from liquidation", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraPUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraPUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraPUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      // A, B provide 100 PUSD to SP
      await stabilityPool.provideToSP(dec(1000, 18), frontEnd_1, { from: alice })
      await stabilityPool.provideToSP(dec(1000, 18), frontEnd_1, { from: bob })

      // Confirm Bob has an active trove in the system
      assert.isTrue(await sortedTroves.contains(bob))
      assert.equal((await troveManager.getTroveStatus(bob)).toString(), '1')  // Confirm Bob's trove status is active

      // Confirm Bob has a Stability deposit
      assert.equal((await stabilityPool.getCompoundedPUSDDeposit(bob)).toString(), dec(1000, 18))

      // Price drops
      await priceFeed.setPrice(dec(105, 18))
      const price = await priceFeed.getPrice()

      // Liquidate bob
      await troveManager.liquidate(bob)

      // Check Bob's trove has been removed from the system
      assert.isFalse(await sortedTroves.contains(bob))
      assert.equal((await troveManager.getTroveStatus(bob)).toString(), '3')  // check Bob's trove status was closed by liquidation
    })

    it("provideToSP(): providing 0 PUSD reverts", async () => {
      // --- SETUP ---
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraPUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraPUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraPUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      // A, B, C provides 100, 50, 30 PUSD to SP
      await stabilityPool.provideToSP(dec(100, 18), frontEnd_1, { from: alice })
      await stabilityPool.provideToSP(dec(50, 18), frontEnd_1, { from: bob })
      await stabilityPool.provideToSP(dec(30, 18), frontEnd_1, { from: carol })

      const bob_Deposit_Before = (await stabilityPool.getCompoundedPUSDDeposit(bob)).toString()
      const PUSDinSP_Before = (await stabilityPool.getTotalPUSDDeposits()).toString()

      assert.equal(PUSDinSP_Before, dec(180, 18))

      // Bob provides 0 PUSD to the Stability Pool
      const txPromise_B = stabilityPool.provideToSP(0, frontEnd_1, { from: bob })
      await th.assertRevert(txPromise_B)
    })

    // --- PREON functionality ---
    it("provideToSP(), new deposit: when SP > 0, triggers PREON reward event - increases the sum G", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraPUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraPUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraPUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // A provides to SP
      await stabilityPool.provideToSP(dec(1000, 18), frontEnd_1, { from: A })

      let currentEpoch = await stabilityPool.currentEpoch()
      let currentScale = await stabilityPool.currentScale()
      const G_Before = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // B provides to SP
      await stabilityPool.provideToSP(dec(1000, 18), frontEnd_1, { from: B })

      currentEpoch = await stabilityPool.currentEpoch()
      currentScale = await stabilityPool.currentScale()
      const G_After = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

      // Expect G has increased from the PREON reward event triggered
      assert.isTrue(G_After.gt(G_Before))
    })

    it("provideToSP(), new deposit: when SP is empty, doesn't update G", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraPUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraPUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraPUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // A provides to SP
      await stabilityPool.provideToSP(dec(1000, 18), frontEnd_1, { from: A })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // A withdraws
      await stabilityPool.withdrawFromSP(dec(1000, 18), { from: A })

      // Check SP is empty
      assert.equal((await stabilityPool.getTotalPUSDDeposits()), '0')

      // Check G is non-zero
      let currentEpoch = await stabilityPool.currentEpoch()
      let currentScale = await stabilityPool.currentScale()
      const G_Before = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

      assert.isTrue(G_Before.gt(toBN('0')))

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // B provides to SP
      await stabilityPool.provideToSP(dec(1000, 18), frontEnd_1, { from: B })

      currentEpoch = await stabilityPool.currentEpoch()
      currentScale = await stabilityPool.currentScale()
      const G_After = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

      // Expect G has not changed
      assert.isTrue(G_After.eq(G_Before))
    })

    it("provideToSP(), new deposit: sets the correct front end tag", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })

      // A, B, C, D open troves and make Stability Pool deposits
      await openTrove({ extraPUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraPUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraPUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ extraPUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

      // Check A, B, C D have no front end tags
      const A_tagBefore = await getFrontEndTag(stabilityPool, A)
      const B_tagBefore = await getFrontEndTag(stabilityPool, B)
      const C_tagBefore = await getFrontEndTag(stabilityPool, C)
      const D_tagBefore = await getFrontEndTag(stabilityPool, D)

      assert.equal(A_tagBefore, ZERO_ADDRESS)
      assert.equal(B_tagBefore, ZERO_ADDRESS)
      assert.equal(C_tagBefore, ZERO_ADDRESS)
      assert.equal(D_tagBefore, ZERO_ADDRESS)

      // A, B, C, D provides to SP
      await stabilityPool.provideToSP(dec(1000, 18), frontEnd_1, { from: A })
      await stabilityPool.provideToSP(dec(2000, 18), frontEnd_2, { from: B })
      await stabilityPool.provideToSP(dec(3000, 18), frontEnd_3, { from: C })
      await stabilityPool.provideToSP(dec(4000, 18), ZERO_ADDRESS, { from: D })  // transacts directly, no front end

      // Check A, B, C D have no front end tags
      const A_tagAfter = await getFrontEndTag(stabilityPool, A)
      const B_tagAfter = await getFrontEndTag(stabilityPool, B)
      const C_tagAfter = await getFrontEndTag(stabilityPool, C)
      const D_tagAfter = await getFrontEndTag(stabilityPool, D)

      // Check front end tags are correctly set
      assert.equal(A_tagAfter, frontEnd_1)
      assert.equal(B_tagAfter, frontEnd_2)
      assert.equal(C_tagAfter, frontEnd_3)
      assert.equal(D_tagAfter, ZERO_ADDRESS)
    })

    it("provideToSP(), new deposit: depositor does not receive any PREON rewards", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })

      // A, B, open troves 
      await openTrove({ extraPUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraPUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })

      // Get A, B, C PREON balances before and confirm they're zero
      const A_PREONBalance_Before = await preonToken.balanceOf(A)
      const B_PREONBalance_Before = await preonToken.balanceOf(B)

      assert.equal(A_PREONBalance_Before, '0')
      assert.equal(B_PREONBalance_Before, '0')

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // A, B provide to SP
      await stabilityPool.provideToSP(dec(1000, 18), frontEnd_1, { from: A })
      await stabilityPool.provideToSP(dec(2000, 18), ZERO_ADDRESS, { from: B })

      // Get A, B, C PREON balances after, and confirm they're still zero
      const A_PREONBalance_After = await preonToken.balanceOf(A)
      const B_PREONBalance_After = await preonToken.balanceOf(B)

      assert.equal(A_PREONBalance_After, '0')
      assert.equal(B_PREONBalance_After, '0')
    })

    it("provideToSP(), new deposit after past full withdrawal: depositor does not receive any PREON rewards", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C, open troves 
      await openTrove({ extraPUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraPUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraPUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ extraPUSDAmount: toBN(dec(4000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // --- SETUP --- 

      const initialDeposit_A = await pusdToken.balanceOf(A)
      const initialDeposit_B = await pusdToken.balanceOf(B)
      // A, B provide to SP
      await stabilityPool.provideToSP(initialDeposit_A, frontEnd_1, { from: A })
      await stabilityPool.provideToSP(initialDeposit_B, frontEnd_2, { from: B })

      // time passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // C deposits. A, and B earn PREON
      await stabilityPool.provideToSP(dec(5, 18), ZERO_ADDRESS, { from: C })

      // Price drops, defaulter is liquidated, A, B and C earn ETH
      await priceFeed.setPrice(dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))

      await troveManager.liquidate(defaulter_1)

      // price bounces back to 200 
      await priceFeed.setPrice(dec(200, 18))

      // A and B fully withdraw from the pool
      await stabilityPool.withdrawFromSP(initialDeposit_A, { from: A })
      await stabilityPool.withdrawFromSP(initialDeposit_B, { from: B })

      // --- TEST --- 

      // Get A, B, C PREON balances before and confirm they're non-zero
      const A_PREONBalance_Before = await preonToken.balanceOf(A)
      const B_PREONBalance_Before = await preonToken.balanceOf(B)
      assert.isTrue(A_PREONBalance_Before.gt(toBN('0')))
      assert.isTrue(B_PREONBalance_Before.gt(toBN('0')))

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // A, B provide to SP
      await stabilityPool.provideToSP(dec(100, 18), frontEnd_1, { from: A })
      await stabilityPool.provideToSP(dec(200, 18), ZERO_ADDRESS, { from: B })

      // Get A, B, C PREON balances after, and confirm they have not changed
      const A_PREONBalance_After = await preonToken.balanceOf(A)
      const B_PREONBalance_After = await preonToken.balanceOf(B)

      assert.isTrue(A_PREONBalance_After.eq(A_PREONBalance_Before))
      assert.isTrue(B_PREONBalance_After.eq(B_PREONBalance_Before))
    })

    it("provideToSP(), new eligible deposit: tagged front end receives PREON rewards", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C, open troves 
      await openTrove({ extraPUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraPUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraPUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ extraPUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })
      await openTrove({ extraPUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })
      await openTrove({ extraPUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: F } })

      // D, E, F provide to SP
      await stabilityPool.provideToSP(dec(1000, 18), frontEnd_1, { from: D })
      await stabilityPool.provideToSP(dec(2000, 18), frontEnd_2, { from: E })
      await stabilityPool.provideToSP(dec(3000, 18), frontEnd_3, { from: F })

      // Get F1, F2, F3 PREON balances before, and confirm they're zero
      const frontEnd_1_PREONBalance_Before = await preonToken.balanceOf(frontEnd_1)
      const frontEnd_2_PREONBalance_Before = await preonToken.balanceOf(frontEnd_2)
      const frontEnd_3_PREONBalance_Before = await preonToken.balanceOf(frontEnd_3)

      assert.equal(frontEnd_1_PREONBalance_Before, '0')
      assert.equal(frontEnd_2_PREONBalance_Before, '0')
      assert.equal(frontEnd_3_PREONBalance_Before, '0')

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // console.log(`PREONSupplyCap before: ${await communityIssuance.PREONSupplyCap()}`)
      // console.log(`totalPREONIssued before: ${await communityIssuance.totalPREONIssued()}`)
      // console.log(`PREON balance of CI before: ${await preonToken.balanceOf(communityIssuance.address)}`)

      // A, B, C provide to SP
      await stabilityPool.provideToSP(dec(1000, 18), frontEnd_1, { from: A })
      await stabilityPool.provideToSP(dec(2000, 18), frontEnd_2, { from: B })
      await stabilityPool.provideToSP(dec(3000, 18), frontEnd_3, { from: C })

      // console.log(`PREONSupplyCap after: ${await communityIssuance.PREONSupplyCap()}`)
      // console.log(`totalPREONIssued after: ${await communityIssuance.totalPREONIssued()}`)
      // console.log(`PREON balance of CI after: ${await preonToken.balanceOf(communityIssuance.address)}`)

      // Get F1, F2, F3 PREON balances after, and confirm they have increased
      const frontEnd_1_PREONBalance_After = await preonToken.balanceOf(frontEnd_1)
      const frontEnd_2_PREONBalance_After = await preonToken.balanceOf(frontEnd_2)
      const frontEnd_3_PREONBalance_After = await preonToken.balanceOf(frontEnd_3)

      assert.isTrue(frontEnd_1_PREONBalance_After.gt(frontEnd_1_PREONBalance_Before))
      assert.isTrue(frontEnd_2_PREONBalance_After.gt(frontEnd_2_PREONBalance_Before))
      assert.isTrue(frontEnd_3_PREONBalance_After.gt(frontEnd_3_PREONBalance_Before))
    })

    it("provideToSP(), new eligible deposit: tagged front end's stake increases", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C, open troves 
      await openTrove({ extraPUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraPUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraPUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // Get front ends' stakes before
      const F1_Stake_Before = await stabilityPool.frontEndStakes(frontEnd_1)
      const F2_Stake_Before = await stabilityPool.frontEndStakes(frontEnd_2)
      const F3_Stake_Before = await stabilityPool.frontEndStakes(frontEnd_3)

      const deposit_A = dec(1000, 18)
      const deposit_B = dec(2000, 18)
      const deposit_C = dec(3000, 18)

      // A, B, C provide to SP
      await stabilityPool.provideToSP(deposit_A, frontEnd_1, { from: A })
      await stabilityPool.provideToSP(deposit_B, frontEnd_2, { from: B })
      await stabilityPool.provideToSP(deposit_C, frontEnd_3, { from: C })

      // Get front ends' stakes after
      const F1_Stake_After = await stabilityPool.frontEndStakes(frontEnd_1)
      const F2_Stake_After = await stabilityPool.frontEndStakes(frontEnd_2)
      const F3_Stake_After = await stabilityPool.frontEndStakes(frontEnd_3)

      const F1_Diff = F1_Stake_After.sub(F1_Stake_Before)
      const F2_Diff = F2_Stake_After.sub(F2_Stake_Before)
      const F3_Diff = F3_Stake_After.sub(F3_Stake_Before)

      // Check front ends' stakes have increased by amount equal to the deposit made through them 
      assert.equal(F1_Diff, deposit_A)
      assert.equal(F2_Diff, deposit_B)
      assert.equal(F3_Diff, deposit_C)
    })

    it.only("provideToSP(), new deposit: depositor does not receive ETH gains", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // Whale transfers PUSD to A, B
      await pusdToken.transfer(A, dec(100, 18), { from: whale })
      await pusdToken.transfer(B, dec(200, 18), { from: whale })

      // C, D open troves
      await openTrove({ extraPUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ extraPUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

      // --- TEST ---

      // get current ETH balances
      const A_ETHBalance_Before = await weth.balanceOf(A);
      const B_ETHBalance_Before = await weth.balanceOf(B);
      const C_ETHBalance_Before = await weth.balanceOf(C);
      const D_ETHBalance_Before = await weth.balanceOf(D);

      // A, B, C, D provide to SP
      await stabilityPool.provideToSP(dec(100, 18), frontEnd_1, { from: A })
      await stabilityPool.provideToSP(dec(200, 18), ZERO_ADDRESS, { from: B })
      await stabilityPool.provideToSP(dec(300, 18), frontEnd_2, { from: C })
      await stabilityPool.provideToSP(dec(400, 18), ZERO_ADDRESS, { from: D })

      // Get  ETH balances after
      const A_ETHBalance_After = await weth.balanceOf(A);
      const B_ETHBalance_After = await weth.balanceOf(B);
      const C_ETHBalance_After = await weth.balanceOf(C);
      const D_ETHBalance_After = await weth.balanceOf(D);

      // Check ETH balances have not changed
      assert.equal(A_ETHBalance_After.toString(), A_ETHBalance_Before.toString())
      assert.equal(B_ETHBalance_After.toString(), B_ETHBalance_Before.toString())
      assert.equal(C_ETHBalance_After.toString(), C_ETHBalance_Before.toString())
      assert.equal(D_ETHBalance_After.toString(), D_ETHBalance_Before.toString())
    })

    it("provideToSP(), new deposit after past full withdrawal: depositor does not receive ETH gains", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // Whale transfers PUSD to A, B
      await pusdToken.transfer(A, dec(1000, 18), { from: whale })
      await pusdToken.transfer(B, dec(1000, 18), { from: whale })

      // C, D open troves
      await openTrove({ extraPUSDAmount: toBN(dec(4000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ extraPUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // --- SETUP ---
      // A, B, C, D provide to SP
      await stabilityPool.provideToSP(dec(105, 18), frontEnd_1, { from: A })
      await stabilityPool.provideToSP(dec(105, 18), ZERO_ADDRESS, { from: B })
      await stabilityPool.provideToSP(dec(105, 18), frontEnd_1, { from: C })
      await stabilityPool.provideToSP(dec(105, 18), ZERO_ADDRESS, { from: D })

      // time passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // B deposits. A,B,C,D earn PREON
      await stabilityPool.provideToSP(dec(5, 18), ZERO_ADDRESS, { from: B })

      // Price drops, defaulter is liquidated, A, B, C, D earn ETH
      await priceFeed.setPrice(dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))

      await troveManager.liquidate(defaulter_1)

      // Price bounces back
      await priceFeed.setPrice(dec(200, 18))

      // A B,C, D fully withdraw from the pool
      await stabilityPool.withdrawFromSP(dec(105, 18), { from: A })
      await stabilityPool.withdrawFromSP(dec(105, 18), { from: B })
      await stabilityPool.withdrawFromSP(dec(105, 18), { from: C })
      await stabilityPool.withdrawFromSP(dec(105, 18), { from: D })

      // --- TEST ---

      // get current ETH balances
      const A_ETHBalance_Before = await web3.eth.getBalance(A)
      const B_ETHBalance_Before = await web3.eth.getBalance(B)
      const C_ETHBalance_Before = await web3.eth.getBalance(C)
      const D_ETHBalance_Before = await web3.eth.getBalance(D)

      // A, B, C, D provide to SP
      await stabilityPool.provideToSP(dec(100, 18), frontEnd_1, { from: A })
      await stabilityPool.provideToSP(dec(200, 18), ZERO_ADDRESS, { from: B })
      await stabilityPool.provideToSP(dec(300, 18), frontEnd_2, { from: C })
      await stabilityPool.provideToSP(dec(400, 18), ZERO_ADDRESS, { from: D })

      // Get  ETH balances after
      const A_ETHBalance_After = await web3.eth.getBalance(A)
      const B_ETHBalance_After = await web3.eth.getBalance(B)
      const C_ETHBalance_After = await web3.eth.getBalance(C)
      const D_ETHBalance_After = await web3.eth.getBalance(D)

      // Check ETH balances have not changed
      assert.equal(A_ETHBalance_After, A_ETHBalance_Before)
      assert.equal(B_ETHBalance_After, B_ETHBalance_Before)
      assert.equal(C_ETHBalance_After, C_ETHBalance_Before)
      assert.equal(D_ETHBalance_After, D_ETHBalance_Before)
    })

    it("provideToSP(), topup: triggers PREON reward event - increases the sum G", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves 
      await openTrove({ extraPUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraPUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraPUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // A, B, C provide to SP
      await stabilityPool.provideToSP(dec(100, 18), frontEnd_1, { from: A })
      await stabilityPool.provideToSP(dec(50, 18), frontEnd_1, { from: B })
      await stabilityPool.provideToSP(dec(50, 18), frontEnd_1, { from: C })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      const G_Before = await stabilityPool.epochToScaleToG(0, 0)

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // B tops up
      await stabilityPool.provideToSP(dec(100, 18), frontEnd_1, { from: B })

      const G_After = await stabilityPool.epochToScaleToG(0, 0)

      // Expect G has increased from the PREON reward event triggered by B's topup
      assert.isTrue(G_After.gt(G_Before))
    })

    it("provideToSP(), topup from different front end: doesn't change the front end tag", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // whale transfer to troves D and E
      await pusdToken.transfer(D, dec(100, 18), { from: whale })
      await pusdToken.transfer(E, dec(200, 18), { from: whale })

      // A, B, C open troves 
      await openTrove({ extraPUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraPUSDAmount: toBN(dec(200, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraPUSDAmount: toBN(dec(300, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })


      // A, B, C, D, E provide to SP
      await stabilityPool.provideToSP(dec(10, 18), frontEnd_1, { from: A })
      await stabilityPool.provideToSP(dec(20, 18), frontEnd_2, { from: B })
      await stabilityPool.provideToSP(dec(30, 18), ZERO_ADDRESS, { from: C })
      await stabilityPool.provideToSP(dec(40, 18), frontEnd_1, { from: D })
      await stabilityPool.provideToSP(dec(50, 18), ZERO_ADDRESS, { from: E })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // A, B, C, D, E top up, from different front ends
      await stabilityPool.provideToSP(dec(10, 18), frontEnd_2, { from: A })
      await stabilityPool.provideToSP(dec(20, 18), frontEnd_1, { from: B })
      await stabilityPool.provideToSP(dec(15, 18), frontEnd_3, { from: C })
      await stabilityPool.provideToSP(dec(20, 18), frontEnd_2, { from: D })
      await stabilityPool.provideToSP(dec(30, 18), frontEnd_3, { from: E })

      const frontEndTag_A = (await stabilityPool.deposits(A))[1]
      const frontEndTag_B = (await stabilityPool.deposits(B))[1]
      const frontEndTag_C = (await stabilityPool.deposits(C))[1]
      const frontEndTag_D = (await stabilityPool.deposits(D))[1]
      const frontEndTag_E = (await stabilityPool.deposits(E))[1]

      // Check deposits are still tagged with their original front end
      assert.equal(frontEndTag_A, frontEnd_1)
      assert.equal(frontEndTag_B, frontEnd_2)
      assert.equal(frontEndTag_C, ZERO_ADDRESS)
      assert.equal(frontEndTag_D, frontEnd_1)
      assert.equal(frontEndTag_E, ZERO_ADDRESS)
    })

    it("provideToSP(), topup: depositor receives PREON rewards", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves 
      await openTrove({ extraPUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraPUSDAmount: toBN(dec(200, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraPUSDAmount: toBN(dec(300, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // A, B, C, provide to SP
      await stabilityPool.provideToSP(dec(10, 18), frontEnd_1, { from: A })
      await stabilityPool.provideToSP(dec(20, 18), frontEnd_2, { from: B })
      await stabilityPool.provideToSP(dec(30, 18), ZERO_ADDRESS, { from: C })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // Get A, B, C PREON balance before
      const A_PREONBalance_Before = await preonToken.balanceOf(A)
      const B_PREONBalance_Before = await preonToken.balanceOf(B)
      const C_PREONBalance_Before = await preonToken.balanceOf(C)

      // A, B, C top up
      await stabilityPool.provideToSP(dec(10, 18), frontEnd_1, { from: A })
      await stabilityPool.provideToSP(dec(20, 18), frontEnd_2, { from: B })
      await stabilityPool.provideToSP(dec(30, 18), ZERO_ADDRESS, { from: C })

      // Get PREON balance after
      const A_PREONBalance_After = await preonToken.balanceOf(A)
      const B_PREONBalance_After = await preonToken.balanceOf(B)
      const C_PREONBalance_After = await preonToken.balanceOf(C)

      // Check PREON Balance of A, B, C has increased
      assert.isTrue(A_PREONBalance_After.gt(A_PREONBalance_Before))
      assert.isTrue(B_PREONBalance_After.gt(B_PREONBalance_Before))
      assert.isTrue(C_PREONBalance_After.gt(C_PREONBalance_Before))
    })

    it("provideToSP(), topup: tagged front end receives PREON rewards", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves 
      await openTrove({ extraPUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraPUSDAmount: toBN(dec(200, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraPUSDAmount: toBN(dec(300, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // A, B, C, provide to SP
      await stabilityPool.provideToSP(dec(10, 18), frontEnd_1, { from: A })
      await stabilityPool.provideToSP(dec(20, 18), frontEnd_2, { from: B })
      await stabilityPool.provideToSP(dec(30, 18), frontEnd_3, { from: C })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // Get front ends' PREON balance before
      const F1_PREONBalance_Before = await preonToken.balanceOf(frontEnd_1)
      const F2_PREONBalance_Before = await preonToken.balanceOf(frontEnd_2)
      const F3_PREONBalance_Before = await preonToken.balanceOf(frontEnd_3)

      // A, B, C top up  (front end param passed here is irrelevant)
      await stabilityPool.provideToSP(dec(10, 18), ZERO_ADDRESS, { from: A })  // provides no front end param
      await stabilityPool.provideToSP(dec(20, 18), frontEnd_1, { from: B })  // provides front end that doesn't match his tag
      await stabilityPool.provideToSP(dec(30, 18), frontEnd_3, { from: C }) // provides front end that matches his tag

      // Get front ends' PREON balance after
      const F1_PREONBalance_After = await preonToken.balanceOf(A)
      const F2_PREONBalance_After = await preonToken.balanceOf(B)
      const F3_PREONBalance_After = await preonToken.balanceOf(C)

      // Check PREON Balance of front ends has increased
      assert.isTrue(F1_PREONBalance_After.gt(F1_PREONBalance_Before))
      assert.isTrue(F2_PREONBalance_After.gt(F2_PREONBalance_Before))
      assert.isTrue(F3_PREONBalance_After.gt(F3_PREONBalance_Before))
    })

    it("provideToSP(), topup: tagged front end's stake increases", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C, D, E, F open troves 
      await openTrove({ extraPUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraPUSDAmount: toBN(dec(200, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraPUSDAmount: toBN(dec(300, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ extraPUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })
      await openTrove({ extraPUSDAmount: toBN(dec(200, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })
      await openTrove({ extraPUSDAmount: toBN(dec(300, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: F } })

      // A, B, C, D, E, F provide to SP
      await stabilityPool.provideToSP(dec(10, 18), frontEnd_1, { from: A })
      await stabilityPool.provideToSP(dec(20, 18), frontEnd_2, { from: B })
      await stabilityPool.provideToSP(dec(30, 18), frontEnd_3, { from: C })
      await stabilityPool.provideToSP(dec(10, 18), frontEnd_1, { from: D })
      await stabilityPool.provideToSP(dec(20, 18), frontEnd_2, { from: E })
      await stabilityPool.provideToSP(dec(30, 18), frontEnd_3, { from: F })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // Get front ends' stake before
      const F1_Stake_Before = await stabilityPool.frontEndStakes(frontEnd_1)
      const F2_Stake_Before = await stabilityPool.frontEndStakes(frontEnd_2)
      const F3_Stake_Before = await stabilityPool.frontEndStakes(frontEnd_3)

      // A, B, C top up  (front end param passed here is irrelevant)
      await stabilityPool.provideToSP(dec(10, 18), ZERO_ADDRESS, { from: A })  // provides no front end param
      await stabilityPool.provideToSP(dec(20, 18), frontEnd_1, { from: B })  // provides front end that doesn't match his tag
      await stabilityPool.provideToSP(dec(30, 18), frontEnd_3, { from: C }) // provides front end that matches his tag

      // Get front ends' stakes after
      const F1_Stake_After = await stabilityPool.frontEndStakes(frontEnd_1)
      const F2_Stake_After = await stabilityPool.frontEndStakes(frontEnd_2)
      const F3_Stake_After = await stabilityPool.frontEndStakes(frontEnd_3)

      // Check front ends' stakes have increased
      assert.isTrue(F1_Stake_After.gt(F1_Stake_Before))
      assert.isTrue(F2_Stake_After.gt(F2_Stake_Before))
      assert.isTrue(F3_Stake_After.gt(F3_Stake_Before))
    })

    it("provideToSP(): reverts when amount is zero", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      await openTrove({ extraPUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraPUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })

      // Whale transfers PUSD to C, D
      await pusdToken.transfer(C, dec(100, 18), { from: whale })
      await pusdToken.transfer(D, dec(100, 18), { from: whale })

      txPromise_A = stabilityPool.provideToSP(0, frontEnd_1, { from: A })
      txPromise_B = stabilityPool.provideToSP(0, ZERO_ADDRESS, { from: B })
      txPromise_C = stabilityPool.provideToSP(0, frontEnd_2, { from: C })
      txPromise_D = stabilityPool.provideToSP(0, ZERO_ADDRESS, { from: D })

      await th.assertRevert(txPromise_A, 'StabilityPool: Amount must be non-zero')
      await th.assertRevert(txPromise_B, 'StabilityPool: Amount must be non-zero')
      await th.assertRevert(txPromise_C, 'StabilityPool: Amount must be non-zero')
      await th.assertRevert(txPromise_D, 'StabilityPool: Amount must be non-zero')
    })

    it("provideToSP(): reverts if user is a registered front end", async () => {
      // C, D, E, F open troves 
      await openTrove({ extraPUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ extraPUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })
      await openTrove({ extraPUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })
      await openTrove({ extraPUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: F } })

      // C, E, F registers as front end
      await stabilityPool.registerFrontEnd(dec(1, 18), { from: C })
      await stabilityPool.registerFrontEnd(dec(1, 18), { from: E })
      await stabilityPool.registerFrontEnd(dec(1, 18), { from: F })

      const txPromise_C = stabilityPool.provideToSP(dec(10, 18), ZERO_ADDRESS, { from: C })
      const txPromise_E = stabilityPool.provideToSP(dec(10, 18), frontEnd_1, { from: E })
      const txPromise_F = stabilityPool.provideToSP(dec(10, 18), F, { from: F })
      await th.assertRevert(txPromise_C, "StabilityPool: must not already be a registered front end")
      await th.assertRevert(txPromise_E, "StabilityPool: must not already be a registered front end")
      await th.assertRevert(txPromise_F, "StabilityPool: must not already be a registered front end")

      const txD = await stabilityPool.provideToSP(dec(10, 18), frontEnd_1, { from: D })
      assert.isTrue(txD.receipt.status)
    })

    it("provideToSP(): reverts if provided tag is not a registered front end", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ extraPUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })
      await openTrove({ extraPUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })

      const txPromise_C = stabilityPool.provideToSP(dec(10, 18), A, { from: C })  // passes another EOA
      const txPromise_D = stabilityPool.provideToSP(dec(10, 18), troveManager.address, { from: D })
      const txPromise_E = stabilityPool.provideToSP(dec(10, 18), stabilityPool.address, { from: E })
      const txPromise_F = stabilityPool.provideToSP(dec(10, 18), F, { from: F }) // passes itself

      await th.assertRevert(txPromise_C, "StabilityPool: Tag must be a registered front end, or the zero address")
      await th.assertRevert(txPromise_D, "StabilityPool: Tag must be a registered front end, or the zero address")
      await th.assertRevert(txPromise_E, "StabilityPool: Tag must be a registered front end, or the zero address")
      await th.assertRevert(txPromise_F, "StabilityPool: Tag must be a registered front end, or the zero address")
    })

    // --- withdrawFromSP ---

    it("withdrawFromSP(): reverts when user has no active deposit", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraPUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })

      await stabilityPool.provideToSP(dec(100, 18), frontEnd_1, { from: alice })

      const alice_initialDeposit = ((await stabilityPool.deposits(alice))[0]).toString()
      const bob_initialDeposit = ((await stabilityPool.deposits(bob))[0]).toString()

      assert.equal(alice_initialDeposit, dec(100, 18))
      assert.equal(bob_initialDeposit, '0')

      const txAlice = await stabilityPool.withdrawFromSP(dec(100, 18), { from: alice })
      assert.isTrue(txAlice.receipt.status)


      try {
        const txBob = await stabilityPool.withdrawFromSP(dec(100, 18), { from: bob })
        assert.isFalse(txBob.receipt.status)
      } catch (err) {
        assert.include(err.message, "revert")
        // TODO: infamous issue #99
        //assert.include(err.message, "User must have a non-zero deposit")

      }
    })

    it("withdrawFromSP(): reverts when amount > 0 and system has an undercollateralized trove", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

      await stabilityPool.provideToSP(dec(100, 18), frontEnd_1, { from: alice })

      const alice_initialDeposit = ((await stabilityPool.deposits(alice))[0]).toString()
      assert.equal(alice_initialDeposit, dec(100, 18))

      // defaulter opens trove
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // ETH drops, defaulter is in liquidation range (but not liquidated yet)
      await priceFeed.setPrice(dec(100, 18))

      await th.assertRevert(stabilityPool.withdrawFromSP(dec(100, 18), { from: alice }))
    })

    it("withdrawFromSP(): partial retrieval - retrieves correct PUSD amount and the entire ETH Gain, and updates deposit", async () => {
      // --- SETUP ---
      // Whale deposits 185000 PUSD in StabilityPool
      await openTrove({ extraPUSDAmount: toBN(dec(1, 24)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
      await stabilityPool.provideToSP(dec(185000, 18), frontEnd_1, { from: whale })

      // 2 Troves opened
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // --- TEST ---

      // Alice makes deposit #1: 15000 PUSD
      await openTrove({ extraPUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
      await stabilityPool.provideToSP(dec(15000, 18), frontEnd_1, { from: alice })

      // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(dec(105, 18));

      // 2 users with Trove with 170 PUSD drawn are closed
      const liquidationTX_1 = await troveManager.liquidate(defaulter_1, { from: owner })  // 170 PUSD closed
      const liquidationTX_2 = await troveManager.liquidate(defaulter_2, { from: owner }) // 170 PUSD closed

      const [liquidatedDebt_1] = await th.getEmittedLiquidationValues(liquidationTX_1)
      const [liquidatedDebt_2] = await th.getEmittedLiquidationValues(liquidationTX_2)

      // Alice PUSDLoss is ((15000/200000) * liquidatedDebt), for each liquidation
      const expectedPUSDLoss_A = (liquidatedDebt_1.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18))))
        .add(liquidatedDebt_2.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18))))

      const expectedCompoundedPUSDDeposit_A = toBN(dec(15000, 18)).sub(expectedPUSDLoss_A)
      const compoundedPUSDDeposit_A = await stabilityPool.getCompoundedPUSDDeposit(alice)

      assert.isAtMost(th.getDifference(expectedCompoundedPUSDDeposit_A, compoundedPUSDDeposit_A), 100000)

      // Alice retrieves part of her entitled PUSD: 9000 PUSD
      await stabilityPool.withdrawFromSP(dec(9000, 18), { from: alice })

      const expectedNewDeposit_A = (compoundedPUSDDeposit_A.sub(toBN(dec(9000, 18))))

      // check Alice's deposit has been updated to equal her compounded deposit minus her withdrawal */
      const newDeposit = ((await stabilityPool.deposits(alice))[0]).toString()
      assert.isAtMost(th.getDifference(newDeposit, expectedNewDeposit_A), 100000)

      // Expect Alice has withdrawn all ETH gain
      const alice_pendingETHGain = (await stabilityPool.getDepositorGains(alice))[1][0]
      assert.equal(alice_pendingETHGain, 0)
    })


    it("withdrawFromSP(): partial retrieval - leaves the correct amount of PUSD in the Stability Pool", async () => {
      // --- SETUP ---
      // Whale deposits 185000 PUSD in StabilityPool
      await openTrove({ extraPUSDAmount: toBN(dec(1, 24)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
      await stabilityPool.provideToSP(dec(185000, 18), frontEnd_1, { from: whale })

      // 2 Troves opened
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })
      // --- TEST ---

      // Alice makes deposit #1: 15000 PUSD
      await openTrove({ extraPUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
      await stabilityPool.provideToSP(dec(15000, 18), frontEnd_1, { from: alice })

      const SP_PUSD_Before = await stabilityPool.getTotalPUSDDeposits()
      assert.equal(SP_PUSD_Before, dec(200000, 18))

      // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(dec(105, 18));

      // 2 users liquidated
      const liquidationTX_1 = await troveManager.liquidate(defaulter_1, { from: owner })
      const liquidationTX_2 = await troveManager.liquidate(defaulter_2, { from: owner })

      const [liquidatedDebt_1] = await th.getEmittedLiquidationValues(liquidationTX_1)
      const [liquidatedDebt_2] = await th.getEmittedLiquidationValues(liquidationTX_2)

      // Alice retrieves part of her entitled PUSD: 9000 PUSD
      await stabilityPool.withdrawFromSP(dec(9000, 18), { from: alice })

      /* Check SP has reduced from 2 liquidations and Alice's withdrawal
      Expect PUSD in SP = (200000 - liquidatedDebt_1 - liquidatedDebt_2 - 9000) */
      const expectedSPPUSD = toBN(dec(200000, 18))
        .sub(toBN(liquidatedDebt_1))
        .sub(toBN(liquidatedDebt_2))
        .sub(toBN(dec(9000, 18)))

      const SP_PUSD_After = (await stabilityPool.getTotalPUSDDeposits()).toString()

      th.assertIsApproximatelyEqual(SP_PUSD_After, expectedSPPUSD)
    })

    it("withdrawFromSP(): full retrieval - leaves the correct amount of PUSD in the Stability Pool", async () => {
      // --- SETUP ---
      // Whale deposits 185000 PUSD in StabilityPool
      await openTrove({ extraPUSDAmount: toBN(dec(1000000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
      await stabilityPool.provideToSP(dec(185000, 18), frontEnd_1, { from: whale })

      // 2 Troves opened
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // --- TEST ---

      // Alice makes deposit #1
      await openTrove({ extraPUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
      await stabilityPool.provideToSP(dec(15000, 18), frontEnd_1, { from: alice })

      const SP_PUSD_Before = await stabilityPool.getTotalPUSDDeposits()
      assert.equal(SP_PUSD_Before, dec(200000, 18))

      // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(dec(105, 18));

      // 2 defaulters liquidated
      const liquidationTX_1 = await troveManager.liquidate(defaulter_1, { from: owner })
      const liquidationTX_2 = await troveManager.liquidate(defaulter_2, { from: owner })

      const [liquidatedDebt_1] = await th.getEmittedLiquidationValues(liquidationTX_1)
      const [liquidatedDebt_2] = await th.getEmittedLiquidationValues(liquidationTX_2)

      // Alice PUSDLoss is ((15000/200000) * liquidatedDebt), for each liquidation
      const expectedPUSDLoss_A = (liquidatedDebt_1.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18))))
        .add(liquidatedDebt_2.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18))))

      const expectedCompoundedPUSDDeposit_A = toBN(dec(15000, 18)).sub(expectedPUSDLoss_A)
      const compoundedPUSDDeposit_A = await stabilityPool.getCompoundedPUSDDeposit(alice)

      assert.isAtMost(th.getDifference(expectedCompoundedPUSDDeposit_A, compoundedPUSDDeposit_A), 100000)

      const PUSDinSPBefore = await stabilityPool.getTotalPUSDDeposits()

      // Alice retrieves all of her entitled PUSD:
      await stabilityPool.withdrawFromSP(dec(15000, 18), { from: alice })

      const expectedPUSDinSPAfter = PUSDinSPBefore.sub(compoundedPUSDDeposit_A)

      const PUSDinSPAfter = await stabilityPool.getTotalPUSDDeposits()
      assert.isAtMost(th.getDifference(expectedPUSDinSPAfter, PUSDinSPAfter), 100000)
    })

    // TypeError: stabilityPool.getDepositorETHGain is not a function
    it("withdrawFromSP(): Subsequent deposit and withdrawal attempt from same account, with no intermediate liquidations, withdraws zero ETH", async () => {
      // --- SETUP ---
      // Whale deposits 18500 PUSD in StabilityPool
      await openTrove({ extraPUSDAmount: toBN(dec(1000000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
      await stabilityPool.provideToSP(dec(18500, 18), frontEnd_1, { from: whale })

      // 2 defaulters open
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // --- TEST ---

      // Alice makes deposit #1: 15000 PUSD
      await openTrove({ extraPUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
      await stabilityPool.provideToSP(dec(15000, 18), frontEnd_1, { from: alice })

      // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(dec(105, 18));

      // defaulters liquidated
      await troveManager.liquidate(defaulter_1, { from: owner })
      await troveManager.liquidate(defaulter_2, { from: owner })

      // Alice retrieves all of her entitled PUSD:
      await stabilityPool.withdrawFromSP(dec(15000, 18), { from: alice })

      const aliceGains = (await stabilityPool.getDepositorGains(alice));

      // @KingPreon: await stabilityPool.getDepositorGains(alice) returns 
      // empty lists for tokens and amounts in the event that alice has no deposit in the pool
      assert.equal(((await stabilityPool.getDepositorGains(alice))[1]).length, 0)

      // Alice makes second deposit
      await stabilityPool.provideToSP(dec(10000, 18), frontEnd_1, { from: alice })
      assert.equal((await stabilityPool.getDepositorGains(alice))[1][0], 0)

      const ETHinSP_Before = (await stabilityPool.getCollateral(weth.address)).toString()

      // Alice attempts second withdrawal
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: alice })
      // @KingPreon: await stabilityPool.getDepositorGains(alice) returns 
      // empty lists for tokens and amounts in the event that alice has no deposit in the pool
      assert.equal((await stabilityPool.getDepositorGains(alice))[1].length, 0)

      // Check ETH in pool does not change
      const ETHinSP_1 = (await stabilityPool.getCollateral(weth.address)).toString()
      assert.equal(ETHinSP_Before, ETHinSP_1)

      // Third deposit
      await stabilityPool.provideToSP(dec(10000, 18), frontEnd_1, { from: alice })
      assert.equal((await stabilityPool.getDepositorGains(alice))[1][0], 0)

      // @KingPreon: No longer have this function
      // const txPromise_A = stabilityPool.withdrawETHGainToTrove(alice, alice, { from: alice })
      // await th.assertRevert(txPromise_A)
    })

    it("withdrawFromSP(): it correctly updates the user's PUSD and ETH snapshots of entitled reward per unit staked", async () => {
      // --- SETUP ---
      // Whale deposits 185000 PUSD in StabilityPool
      await openTrove({ extraPUSDAmount: toBN(dec(1000000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
      await stabilityPool.provideToSP(dec(185000, 18), frontEnd_1, { from: whale })

      // 2 defaulters open
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // --- TEST ---

      // Alice makes deposit #1: 15000 PUSD
      await openTrove({ extraPUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
      await stabilityPool.provideToSP(dec(15000, 18), frontEnd_1, { from: alice })

      // check 'Before' snapshots
      const alice_snapshot_Before = await stabilityPool.depositSnapshots(alice)
      const alice_snapshot_S_Before = (await stabilityPool.getDepositSnapshotS(alice, contracts.weth.address)).toString();
      const alice_snapshot_P_Before = alice_snapshot_Before.P.toString()
      assert.equal(alice_snapshot_S_Before, 0)
      assert.equal(alice_snapshot_P_Before, '1000000000000000000')

      // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(dec(105, 18));

      // 2 defaulters liquidated
      await troveManager.liquidate(defaulter_1, { from: owner })
      await troveManager.liquidate(defaulter_2, { from: owner });

      // Alice retrieves part of her entitled PUSD: 9000 PUSD
      await stabilityPool.withdrawFromSP(dec(9000, 18), { from: alice })

      const P = (await stabilityPool.P()).toString()
      const S = (await stabilityPool.epochToScaleToSum(contracts.weth.address, 0, 0)).toString()
      // check 'After' snapshots
      const alice_snapshot_After = await stabilityPool.depositSnapshots(alice)
      const alice_snapshot_S_After = (await stabilityPool.getDepositSnapshotS(alice, contracts.weth.address)).toString();
      const alice_snapshot_P_After = alice_snapshot_After.P.toString()
      assert.equal(alice_snapshot_S_After, S)
      assert.equal(alice_snapshot_P_After, P)
    })


    it("withdrawFromSP(): decreases StabilityPool ETH", async () => {
      // --- SETUP ---
      // Whale deposits 185000 PUSD in StabilityPool
      await openTrove({ extraPUSDAmount: toBN(dec(1000000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
      await stabilityPool.provideToSP(dec(185000, 18), frontEnd_1, { from: whale })

      // 1 defaulter opens
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // --- TEST ---

      // Alice makes deposit #1: 15000 PUSD
      await openTrove({ extraPUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
      await stabilityPool.provideToSP(dec(15000, 18), frontEnd_1, { from: alice })

      // price drops: defaulter's Trove falls below MCR, alice and whale Trove remain active
      await priceFeed.setPrice('100000000000000000000');

      // defaulter's Trove is closed.
      const liquidationTx_1 = await troveManager.liquidate(defaulter_1, { from: owner });  // 180 PUSD closed

      // const values = await th.getEmittedLiquidationValues(liquidationTx_1)
      
      const wethIDX = await contracts.whitelist.getIndex(contracts.weth.address);

      [liquidatedDebt, liquidatedColl, gasComp] = th.getEmittedLiquidationValues(liquidationTx_1, wethIDX);
      
      //Get ActivePool and StabilityPool Ether before retrieval:
      const active_ETH_Before = await activePool.getCollateral(weth.address)
      const stability_ETH_Before = await stabilityPool.getCollateral(weth.address)

      // Expect alice to be entitled to 15000/200000 of the liquidated coll
      const aliceExpectedETHGain = liquidatedColl.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18)))
      const aliceETHGain = (await stabilityPool.getDepositorGains(alice))[1][0];
      assert.isTrue(aliceExpectedETHGain.eq(aliceETHGain))

      // Alice retrieves all of her deposit
      await stabilityPool.withdrawFromSP(dec(15000, 18), { from: alice })

      const active_ETH_After = await activePool.getCollateral(weth.address)
      const stability_ETH_After = await stabilityPool.getCollateral(weth.address)

      const active_ETH_Difference = (active_ETH_Before.sub(active_ETH_After))
      const stability_ETH_Difference = (stability_ETH_Before.sub(stability_ETH_After))

      assert.equal(active_ETH_Difference, '0')

      // Expect StabilityPool to have decreased by Alice's ETHGain
      assert.isAtMost(th.getDifference(stability_ETH_Difference, aliceETHGain), 10000)
    })

    it("withdrawFromSP(): All depositors are able to withdraw from the SP to their account", async () => {
      // Whale opens trove 
      await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // 1 defaulter open
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // 6 Accounts open troves and provide to SP
      const depositors = [alice, bob, carol, dennis, erin, flyn]
      for (account of depositors) {
        await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: account } })
        await stabilityPool.provideToSP(dec(10000, 18), frontEnd_1, { from: account })
      }

      await priceFeed.setPrice(dec(105, 18))
      await troveManager.liquidate(defaulter_1)

      await priceFeed.setPrice(dec(200, 18))

      // All depositors attempt to withdraw
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: alice })
      assert.equal(((await stabilityPool.deposits(alice))[0]).toString(), '0')
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: bob })
      assert.equal(((await stabilityPool.deposits(alice))[0]).toString(), '0')
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: carol })
      assert.equal(((await stabilityPool.deposits(alice))[0]).toString(), '0')
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: dennis })
      assert.equal(((await stabilityPool.deposits(alice))[0]).toString(), '0')
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: erin })
      assert.equal(((await stabilityPool.deposits(alice))[0]).toString(), '0')
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: flyn })
      assert.equal(((await stabilityPool.deposits(alice))[0]).toString(), '0')

      const totalDeposits = (await stabilityPool.getTotalPUSDDeposits()).toString()

      assert.isAtMost(th.getDifference(totalDeposits, '0'), 100000)
    })


    it("withdrawFromSP(): increases depositor's PUSD token balance by the expected amount", async () => {
      // Whale opens trove 
      await weth.approve(borrowerOperations.address, dec(100000000, 18), { from: whale })
      await openTrove({ extraPUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // 1 defaulter opens trove
      await weth.approve(borrowerOperations.address, dec(100000000, 18), { from: defaulter_1 })
      await weth.mint(defaulter_1, dec(100000, 18));
      await borrowerOperations.openTrove(th._100pct, await getOpenTrovePUSDAmount(dec(10000, 18)), defaulter_1, defaulter_1, [weth.address], [dec(100, 'ether')],  { from: defaulter_1 })

      const defaulterDebt = (await troveManager.getEntireDebtAndColls(defaulter_1))[0]

      // 6 Accounts open troves and provide to SP
      const depositors = [alice, bob, carol, dennis, erin, flyn]
      for (account of depositors) {
        await weth.approve(borrowerOperations.address, dec(100000000, 18), { from: account })
        await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: account } })
        await stabilityPool.provideToSP(dec(10000, 18), frontEnd_1, { from: account })
      }

      await priceFeed.setPrice(dec(105, 18))
      await troveManager.liquidate(defaulter_1)

      const aliceBalBefore = await pusdToken.balanceOf(alice)
      const bobBalBefore = await pusdToken.balanceOf(bob)

      /* From an offset of 10000 PUSD, each depositor receives
      PUSDLoss = 1666.6666666666666666 PUSD

      and thus with a deposit of 10000 PUSD, each should withdraw 8333.3333333333333333 PUSD (in practice, slightly less due to rounding error)
      */

      // Price bounces back to $200 per ETH
      await priceFeed.setPrice(dec(200, 18))

      // Bob issues a further 5000 PUSD from his trove
      await borrowerOperations.withdrawPUSD(th._100pct, dec(5000, 18), bob, bob, { from: bob })

      // Expect Alice's PUSD balance increase be very close to 8333.3333333333333333 PUSD
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: alice })
      const aliceBalance = (await pusdToken.balanceOf(alice))

      assert.isAtMost(th.getDifference(aliceBalance.sub(aliceBalBefore), '8333333333333333333333'), 100000)

      // expect Bob's PUSD balance increase to be very close to  13333.33333333333333333 PUSD
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: bob })
      const bobBalance = (await pusdToken.balanceOf(bob))
      assert.isAtMost(th.getDifference(bobBalance.sub(bobBalBefore), '13333333333333333333333'), 100000)
    })

    it("withdrawFromSP(): doesn't impact other users Stability deposits or ETH gains", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      await stabilityPool.provideToSP(dec(10000, 18), frontEnd_1, { from: alice })
      await stabilityPool.provideToSP(dec(20000, 18), frontEnd_1, { from: bob })
      await stabilityPool.provideToSP(dec(30000, 18), frontEnd_1, { from: carol })

      // Would-be defaulters open troves
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // Price drops
      await priceFeed.setPrice(dec(105, 18))

      // Defaulters are liquidated
      await troveManager.liquidate(defaulter_1)
      await troveManager.liquidate(defaulter_2)
      assert.isFalse(await sortedTroves.contains(defaulter_1))
      assert.isFalse(await sortedTroves.contains(defaulter_2))

      const alice_PUSDDeposit_Before = (await stabilityPool.getCompoundedPUSDDeposit(alice)).toString()
      const bob_PUSDDeposit_Before = (await stabilityPool.getCompoundedPUSDDeposit(bob)).toString()

      const alice_ETHGain_Before = ((await stabilityPool.getDepositorGains(alice))[1][0]).toString()
      const bob_ETHGain_Before = ((await stabilityPool.getDepositorGains(bob))[1][0]).toString()

      //check non-zero PUSD and ETHGain in the Stability Pool
      const PUSDinSP = await stabilityPool.getTotalPUSDDeposits()
      const ETHinSP = await stabilityPool.getCollateral(weth.address)
      assert.isTrue(PUSDinSP.gt(mv._zeroBN))
      assert.isTrue(ETHinSP.gt(mv._zeroBN))

      // Price rises
      await priceFeed.setPrice(dec(200, 18))

      // Carol withdraws her Stability deposit 
      assert.equal(((await stabilityPool.deposits(carol))[0]).toString(), dec(30000, 18))
      await stabilityPool.withdrawFromSP(dec(30000, 18), { from: carol })
      assert.equal(((await stabilityPool.deposits(carol))[0]).toString(), '0')

      const alice_PUSDDeposit_After = (await stabilityPool.getCompoundedPUSDDeposit(alice)).toString()
      const bob_PUSDDeposit_After = (await stabilityPool.getCompoundedPUSDDeposit(bob)).toString()

      const alice_ETHGain_After = ((await stabilityPool.getDepositorGains(alice))[1][0]).toString()
      const bob_ETHGain_After = ((await stabilityPool.getDepositorGains(bob))[1][0]).toString()

      // Check compounded deposits and ETH gains for A and B have not changed
      assert.equal(alice_PUSDDeposit_Before, alice_PUSDDeposit_After)
      assert.equal(bob_PUSDDeposit_Before, bob_PUSDDeposit_After)

      assert.equal(alice_ETHGain_Before, alice_ETHGain_After)
      assert.equal(bob_ETHGain_Before, bob_ETHGain_After)
    })

    it("withdrawFromSP(): doesn't impact system debt, collateral or TCR ", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      await stabilityPool.provideToSP(dec(10000, 18), frontEnd_1, { from: alice })
      await stabilityPool.provideToSP(dec(20000, 18), frontEnd_1, { from: bob })
      await stabilityPool.provideToSP(dec(30000, 18), frontEnd_1, { from: carol })

      // Would-be defaulters open troves
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // Price drops
      await priceFeed.setPrice(dec(105, 18))

      // Defaulters are liquidated
      await troveManager.liquidate(defaulter_1)
      await troveManager.liquidate(defaulter_2)
      assert.isFalse(await sortedTroves.contains(defaulter_1))
      assert.isFalse(await sortedTroves.contains(defaulter_2))

      // Price rises
      await priceFeed.setPrice(dec(200, 18))

      const activeDebt_Before = (await activePool.getPUSDDebt()).toString()
      const defaultedDebt_Before = (await defaultPool.getPUSDDebt()).toString()
      const activeColl_Before = (await activePool.getCollateral(contracts.weth.address)).toString()
      const defaultedColl_Before = (await defaultPool.getCollateral(contracts.weth.address)).toString()
      const TCR_Before = (await th.getTCR(contracts)).toString()

      // Carol withdraws her Stability deposit 
      assert.equal(((await stabilityPool.deposits(carol))[0]).toString(), dec(30000, 18))
      await stabilityPool.withdrawFromSP(dec(30000, 18), { from: carol })
      assert.equal(((await stabilityPool.deposits(carol))[0]).toString(), '0')

      const activeDebt_After = (await activePool.getPUSDDebt()).toString()
      const defaultedDebt_After = (await defaultPool.getPUSDDebt()).toString()
      const activeColl_After = (await activePool.getCollateral(contracts.weth.address)).toString()
      const defaultedColl_After = (await defaultPool.getCollateral(contracts.weth.address)).toString()
      const TCR_After = (await th.getTCR(contracts)).toString()

      // Check total system debt, collateral and TCR have not changed after a Stability deposit is made
      assert.equal(activeDebt_Before, activeDebt_After)
      assert.equal(defaultedDebt_Before, defaultedDebt_After)
      assert.equal(activeColl_Before, activeColl_After)
      assert.equal(defaultedColl_Before, defaultedColl_After)
      assert.equal(TCR_Before, TCR_After)
    })

    it("withdrawFromSP(): doesn't impact any troves, including the caller's trove", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      // A, B and C provide to SP
      await stabilityPool.provideToSP(dec(10000, 18), frontEnd_1, { from: alice })
      await stabilityPool.provideToSP(dec(20000, 18), frontEnd_1, { from: bob })
      await stabilityPool.provideToSP(dec(30000, 18), frontEnd_1, { from: carol })

      // Price drops
      await priceFeed.setPrice(dec(105, 18))
      const price = await priceFeed.getPrice()

      // Get debt, collateral and ICR of all existing troves
      const whale_Debt_Before = (await troveManager.getTroveDebt(whale)).toString()
      const alice_Debt_Before = (await troveManager.getTroveDebt(alice)).toString()
      const bob_Debt_Before = (await troveManager.getTroveDebt(bob)).toString()
      const carol_Debt_Before = (await troveManager.getTroveDebt(carol)).toString()

      const wethIDX = await contracts.whitelist.getIndex(contracts.weth.address)
      const whale_Coll_Before = (await troveManager.getTroveColls(whale))[1][wethIDX].toString()
      const alice_Coll_Before = (await troveManager.getTroveColls(alice))[1][wethIDX].toString()
      const bob_Coll_Before = (await troveManager.getTroveColls(bob))[1][wethIDX].toString()
      const carol_Coll_Before = (await troveManager.getTroveColls(carol))[1][wethIDX].toString()

      const whale_ICR_Before = (await troveManager.getCurrentICR(whale)).toString()
      const alice_ICR_Before = (await troveManager.getCurrentICR(alice)).toString()
      const bob_ICR_Before = (await troveManager.getCurrentICR(bob)).toString()
      const carol_ICR_Before = (await troveManager.getCurrentICR(carol)).toString()

      // price rises
      await priceFeed.setPrice(dec(200, 18))

      // Carol withdraws her Stability deposit 
      assert.equal(((await stabilityPool.deposits(carol))[0]).toString(), dec(30000, 18))
      await stabilityPool.withdrawFromSP(dec(30000, 18), { from: carol })
      assert.equal(((await stabilityPool.deposits(carol))[0]).toString(), '0')

      const whale_Debt_After = (await troveManager.getTroveDebt(whale)).toString()
      const alice_Debt_After = (await troveManager.getTroveDebt(alice)).toString()
      const bob_Debt_After = (await troveManager.getTroveDebt(bob)).toString()
      const carol_Debt_After = (await troveManager.getTroveDebt(carol)).toString()

      const whale_Coll_After = (await troveManager.getTroveColls(whale))[1][wethIDX].toString()
      const alice_Coll_After = (await troveManager.getTroveColls(alice))[1][wethIDX].toString()
      const bob_Coll_After = (await troveManager.getTroveColls(bob))[1][wethIDX].toString()
      const carol_Coll_After = (await troveManager.getTroveColls(carol))[1][wethIDX].toString()

      // @KingPreon: because ICR is dynamically calculated, function calls to getCurrentICR will consider the latest price
      // const whale_ICR_After = (await troveManager.getCurrentICR(whale)).toString()
      // const alice_ICR_After = (await troveManager.getCurrentICR(alice)).toString()
      // const bob_ICR_After = (await troveManager.getCurrentICR(bob)).toString()
      // const carol_ICR_After = (await troveManager.getCurrentICR(carol)).toString()

      // Check all troves are unaffected by Carol's Stability deposit withdrawal
      assert.equal(whale_Debt_Before, whale_Debt_After)
      assert.equal(alice_Debt_Before, alice_Debt_After)
      assert.equal(bob_Debt_Before, bob_Debt_After)
      assert.equal(carol_Debt_Before, carol_Debt_After)

      assert.equal(whale_Coll_Before, whale_Coll_After)
      assert.equal(alice_Coll_Before, alice_Coll_After)
      assert.equal(bob_Coll_Before, bob_Coll_After)
      assert.equal(carol_Coll_Before, carol_Coll_After)

      // assert.equal(whale_ICR_Before, whale_ICR_After)
      // assert.equal(alice_ICR_Before, alice_ICR_After)
      // assert.equal(bob_ICR_Before, bob_ICR_After)
      // assert.equal(carol_ICR_Before, carol_ICR_After)
    })


    it("withdrawFromSP(): succeeds when amount is 0 and system has an undercollateralized trove", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })

      await stabilityPool.provideToSP(dec(100, 18), frontEnd_1, { from: A })

      const A_initialDeposit = ((await stabilityPool.deposits(A))[0]).toString()
      assert.equal(A_initialDeposit, dec(100, 18))

      // defaulters opens trove
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // ETH drops, defaulters are in liquidation range
      await priceFeed.setPrice(dec(105, 18))
      const price = await priceFeed.getPrice()
      assert.isTrue(await th.ICRbetween100and110(defaulter_1, troveManager, price))

      await th.fastForwardTime(timeValues.MINUTES_IN_ONE_WEEK, web3.currentProvider)

      // Liquidate d1
      await troveManager.liquidate(defaulter_1)
      assert.isFalse(await sortedTroves.contains(defaulter_1))

      // Check d2 is undercollateralized
      assert.isTrue(await th.ICRbetween100and110(defaulter_2, troveManager, price))
      assert.isTrue(await sortedTroves.contains(defaulter_2))

      const A_ETHBalBefore = toBN(await weth.balanceOf(A))
      const A_PREONBalBefore = await preonToken.balanceOf(A)

      // Check Alice has gains to withdraw
      const A_pendingETHGain = (await stabilityPool.getDepositorGains(A))[1][0]
      const A_pendingPREONGain = await stabilityPool.getDepositorPREONGain(A)
      assert.isTrue(A_pendingETHGain.gt(toBN('0')))
      assert.isTrue(A_pendingPREONGain.gt(toBN('0')))

      // Check withdrawal of 0 succeeds
      const tx = await stabilityPool.withdrawFromSP(0, { from: A })
      assert.isTrue(tx.receipt.status)

      const A_ETHBalAfter = toBN(await weth.balanceOf(A));

      const A_PREONBalAfter = await preonToken.balanceOf(A)
      const A_PREONBalDiff = A_PREONBalAfter.sub(A_PREONBalBefore)

      // Check A's ETH and PREON balances have increased correctly
      assert.isTrue(A_ETHBalAfter.sub(A_ETHBalBefore).eq(A_pendingETHGain))
      assert.isAtMost(th.getDifference(A_PREONBalDiff, A_pendingPREONGain), 1000)
    })

    it("withdrawFromSP(): withdrawing 0 PUSD doesn't alter the caller's deposit or the total PUSD in the Stability Pool", async () => {
      // --- SETUP ---
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      // A, B, C provides 100, 50, 30 PUSD to SP
      await stabilityPool.provideToSP(dec(100, 18), frontEnd_1, { from: alice })
      await stabilityPool.provideToSP(dec(50, 18), frontEnd_1, { from: bob })
      await stabilityPool.provideToSP(dec(30, 18), frontEnd_1, { from: carol })

      const bob_Deposit_Before = (await stabilityPool.getCompoundedPUSDDeposit(bob)).toString()
      const PUSDinSP_Before = (await stabilityPool.getTotalPUSDDeposits()).toString()

      assert.equal(PUSDinSP_Before, dec(180, 18))

      // Bob withdraws 0 PUSD from the Stability Pool
      await stabilityPool.withdrawFromSP(0, { from: bob })

      // check Bob's deposit and total PUSD in Stability Pool has not changed
      const bob_Deposit_After = (await stabilityPool.getCompoundedPUSDDeposit(bob)).toString()
      const PUSDinSP_After = (await stabilityPool.getTotalPUSDDeposits()).toString()

      assert.equal(bob_Deposit_Before, bob_Deposit_After)
      assert.equal(PUSDinSP_Before, PUSDinSP_After)
    })

    it("withdrawFromSP(): withdrawing 0 ETH Gain does not alter the caller's ETH balance, their trove collateral, or the ETH  in the Stability Pool", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      // Would-be defaulter open trove
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // Price drops
      await priceFeed.setPrice(dec(105, 18))

      assert.isFalse(await th.checkRecoveryMode(contracts))

      // Defaulter 1 liquidated, full offset
      await troveManager.liquidate(defaulter_1)

      // Dennis opens trove and deposits to Stability Pool
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: dennis } })
      await stabilityPool.provideToSP(dec(100, 18), frontEnd_1, { from: dennis })

      // Check Dennis has 0 ETHGain
      const dennis_ETHGain = ((await stabilityPool.getDepositorGains(dennis))[1][0]).toString()
      assert.equal(dennis_ETHGain, '0')

      const wethIDX = await contracts.whitelist.getIndex(contracts.weth.address)
      const dennis_ETHBalance_Before = (await weth.balanceOf(dennis)).toString()
      const dennis_Collateral_Before = ((await troveManager.getTroveColls(dennis))[1][wethIDX]).toString()
      const ETHinSP_Before = (await stabilityPool.getCollateral(weth.address)).toString()

      await priceFeed.setPrice(dec(200, 18))

      // Dennis withdraws his full deposit and ETHGain to his account
      await stabilityPool.withdrawFromSP(dec(100, 18), { from: dennis })

      // Check withdrawal does not alter Dennis' ETH balance or his trove's collateral
      const dennis_ETHBalance_After = (await weth.balanceOf(dennis)).toString()
      const dennis_Collateral_After = ((await troveManager.getTroveColls(dennis))[1][wethIDX]).toString()
      const ETHinSP_After = (await stabilityPool.getCollateral(weth.address)).toString()

      assert.equal(dennis_ETHBalance_Before, dennis_ETHBalance_After)
      assert.equal(dennis_Collateral_Before, dennis_Collateral_After)

      // Check withdrawal has not altered the ETH in the Stability Pool
      assert.equal(ETHinSP_Before, ETHinSP_After)
    })

    it("withdrawFromSP(): Request to withdraw > caller's deposit only withdraws the caller's compounded deposit", async () => {
      // --- SETUP ---
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // A, B, C provide PUSD to SP
      await stabilityPool.provideToSP(dec(10000, 18), frontEnd_1, { from: alice })
      await stabilityPool.provideToSP(dec(20000, 18), frontEnd_1, { from: bob })
      await stabilityPool.provideToSP(dec(30000, 18), frontEnd_1, { from: carol })

      // Price drops
      await priceFeed.setPrice(dec(105, 18))

      // Liquidate defaulter 1
      await troveManager.liquidate(defaulter_1)

      const alice_PUSD_Balance_Before = await pusdToken.balanceOf(alice)
      const bob_PUSD_Balance_Before = await pusdToken.balanceOf(bob)

      const alice_Deposit_Before = await stabilityPool.getCompoundedPUSDDeposit(alice)
      const bob_Deposit_Before = await stabilityPool.getCompoundedPUSDDeposit(bob)

      const PUSDinSP_Before = await stabilityPool.getTotalPUSDDeposits()

      await priceFeed.setPrice(dec(200, 18))

      // Bob attempts to withdraws 1 wei more than his compounded deposit from the Stability Pool
      await stabilityPool.withdrawFromSP(bob_Deposit_Before.add(toBN(1)), { from: bob })

      // Check Bob's PUSD balance has risen by only the value of his compounded deposit
      const bob_expectedPUSDBalance = (bob_PUSD_Balance_Before.add(bob_Deposit_Before)).toString()
      const bob_PUSD_Balance_After = (await pusdToken.balanceOf(bob)).toString()
      assert.equal(bob_PUSD_Balance_After, bob_expectedPUSDBalance)

      // Alice attempts to withdraws 2309842309.000000000000000000 PUSD from the Stability Pool
      await stabilityPool.withdrawFromSP('2309842309000000000000000000', { from: alice })

      // Check Alice's PUSD balance has risen by only the value of her compounded deposit
      const alice_expectedPUSDBalance = (alice_PUSD_Balance_Before.add(alice_Deposit_Before)).toString()
      const alice_PUSD_Balance_After = (await pusdToken.balanceOf(alice)).toString()
      assert.equal(alice_PUSD_Balance_After, alice_expectedPUSDBalance)

      // Check PUSD in Stability Pool has been reduced by only Alice's compounded deposit and Bob's compounded deposit
      const expectedPUSDinSP = (PUSDinSP_Before.sub(alice_Deposit_Before).sub(bob_Deposit_Before)).toString()
      const PUSDinSP_After = (await stabilityPool.getTotalPUSDDeposits()).toString()
      assert.equal(PUSDinSP_After, expectedPUSDinSP)
    })

    it("withdrawFromSP(): Request to withdraw 2^256-1 PUSD only withdraws the caller's compounded deposit", async () => {
      // --- SETUP ---
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves 
      // A, B, C open troves 
      // A, B, C open troves 
      // A, B, C open troves 
      // A, B, C open troves 
      // A, B, C open troves 
      // A, B, C open troves 
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // A, B, C provides 100, 50, 30 PUSD to SP
      await stabilityPool.provideToSP(dec(100, 18), frontEnd_1, { from: alice })
      await stabilityPool.provideToSP(dec(50, 18), frontEnd_1, { from: bob })
      await stabilityPool.provideToSP(dec(30, 18), frontEnd_1, { from: carol })

      // Price drops
      await priceFeed.setPrice(dec(100, 18))

      // Liquidate defaulter 1
      await troveManager.liquidate(defaulter_1)

      const bob_PUSD_Balance_Before = await pusdToken.balanceOf(bob)

      const bob_Deposit_Before = await stabilityPool.getCompoundedPUSDDeposit(bob)

      const PUSDinSP_Before = await stabilityPool.getTotalPUSDDeposits()

      const maxBytes32 = web3.utils.toBN("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")

      // Price drops
      await priceFeed.setPrice(dec(200, 18))

      // Bob attempts to withdraws maxBytes32 PUSD from the Stability Pool
      await stabilityPool.withdrawFromSP(maxBytes32, { from: bob })

      // Check Bob's PUSD balance has risen by only the value of his compounded deposit
      const bob_expectedPUSDBalance = (bob_PUSD_Balance_Before.add(bob_Deposit_Before)).toString()
      const bob_PUSD_Balance_After = (await pusdToken.balanceOf(bob)).toString()
      assert.equal(bob_PUSD_Balance_After, bob_expectedPUSDBalance)

      // Check PUSD in Stability Pool has been reduced by only  Bob's compounded deposit
      const expectedPUSDinSP = (PUSDinSP_Before.sub(bob_Deposit_Before)).toString()
      const PUSDinSP_After = (await stabilityPool.getTotalPUSDDeposits()).toString()
      assert.equal(PUSDinSP_After, expectedPUSDinSP)
    })

    // Error: Invalid number of parameters for "openTrove". Got 5 expected 6!
    it("withdrawFromSP(): caller can withdraw full deposit and ETH gain during Recovery Mode", async () => {
      // --- SETUP ---

      // Price doubles
      await priceFeed.setPrice(dec(400, 18))
      await openTrove({ extraPUSDAmount: toBN(dec(1000000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })
      // Price halves
      await priceFeed.setPrice(dec(200, 18))

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(4, 18)), extraParams: { from: alice } })
      await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(4, 18)), extraParams: { from: bob } })
      await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(4, 18)), extraParams: { from: carol } })

      await weth.approve(borrowerOperations.address, dec(10000, 18), {from: defaulter_1});
      await weth.mint(defaulter_1, dec(200, 18));

      await borrowerOperations.openTrove(th._100pct, await getOpenTrovePUSDAmount(dec(10000, 18)), defaulter_1, defaulter_1, [weth.address], [dec(100, 'ether')], { from: defaulter_1 })

      // A, B, C provides 10000, 5000, 3000 PUSD to SP
      await stabilityPool.provideToSP(dec(10000, 18), frontEnd_1, { from: alice })
      await stabilityPool.provideToSP(dec(5000, 18), frontEnd_1, { from: bob })
      await stabilityPool.provideToSP(dec(3000, 18), frontEnd_1, { from: carol })

      // Price drops
      await priceFeed.setPrice(dec(105, 18))
      const price = await priceFeed.getPrice()

      assert.isTrue(await th.checkRecoveryMode(contracts))

      // Liquidate defaulter 1
      await troveManager.liquidate(defaulter_1)
      assert.isFalse(await sortedTroves.contains(defaulter_1))

      const alice_PUSD_Balance_Before = await pusdToken.balanceOf(alice)
      const bob_PUSD_Balance_Before = await pusdToken.balanceOf(bob)
      const carol_PUSD_Balance_Before = await pusdToken.balanceOf(carol)

      const alice_ETH_Balance_Before = web3.utils.toBN(await weth.balanceOf(alice))
      const bob_ETH_Balance_Before = web3.utils.toBN(await weth.balanceOf(bob))
      const carol_ETH_Balance_Before = web3.utils.toBN(await weth.balanceOf(carol))

      const alice_Deposit_Before = await stabilityPool.getCompoundedPUSDDeposit(alice)
      const bob_Deposit_Before = await stabilityPool.getCompoundedPUSDDeposit(bob)
      const carol_Deposit_Before = await stabilityPool.getCompoundedPUSDDeposit(carol)

      const alice_ETHGain_Before = (await stabilityPool.getDepositorGains(alice))[1][0]
      const bob_ETHGain_Before = (await stabilityPool.getDepositorGains(bob))[1][0]
      const carol_ETHGain_Before = (await stabilityPool.getDepositorGains(carol))[1][0]

      const PUSDinSP_Before = await stabilityPool.getTotalPUSDDeposits()

      // Price rises
      await priceFeed.setPrice(dec(220, 18))

      assert.isTrue(await th.checkRecoveryMode(contracts))

      // A, B, C withdraw their full deposits from the Stability Pool
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: alice})
      await stabilityPool.withdrawFromSP(dec(5000, 18), { from: bob })
      await stabilityPool.withdrawFromSP(dec(3000, 18), { from: carol })

      // Check PUSD balances of A, B, C have risen by the value of their compounded deposits, respectively
      const alice_expectedPUSDBalance = (alice_PUSD_Balance_Before.add(alice_Deposit_Before)).toString()
     
      const bob_expectedPUSDBalance = (bob_PUSD_Balance_Before.add(bob_Deposit_Before)).toString()
      const carol_expectedPUSDBalance = (carol_PUSD_Balance_Before.add(carol_Deposit_Before)).toString()

      const alice_PUSD_Balance_After = (await pusdToken.balanceOf(alice)).toString()
 
      const bob_PUSD_Balance_After = (await pusdToken.balanceOf(bob)).toString()
      const carol_PUSD_Balance_After = (await pusdToken.balanceOf(carol)).toString()

      assert.equal(alice_PUSD_Balance_After, alice_expectedPUSDBalance)
      assert.equal(bob_PUSD_Balance_After, bob_expectedPUSDBalance)
      assert.equal(carol_PUSD_Balance_After, carol_expectedPUSDBalance)

      // Check ETH balances of A, B, C have increased by the value of their ETH gain from liquidations, respectively
      const alice_expectedETHBalance = (alice_ETH_Balance_Before.add(alice_ETHGain_Before)).toString()
      const bob_expectedETHBalance = (bob_ETH_Balance_Before.add(bob_ETHGain_Before)).toString()
      const carol_expectedETHBalance = (carol_ETH_Balance_Before.add(carol_ETHGain_Before)).toString()

      const alice_ETHBalance_After = (await weth.balanceOf(alice)).toString()
      const bob_ETHBalance_After = (await weth.balanceOf(bob)).toString()
      const carol_ETHBalance_After = (await weth.balanceOf(carol)).toString()

      assert.equal(alice_expectedETHBalance, alice_ETHBalance_After)
      assert.equal(bob_expectedETHBalance, bob_ETHBalance_After)
      assert.equal(carol_expectedETHBalance, carol_ETHBalance_After)

      // Check PUSD in Stability Pool has been reduced by A, B and C's compounded deposit
      const expectedPUSDinSP = (PUSDinSP_Before
        .sub(alice_Deposit_Before)
        .sub(bob_Deposit_Before)
        .sub(carol_Deposit_Before))
        .toString()
      const PUSDinSP_After = (await stabilityPool.getTotalPUSDDeposits()).toString()
      assert.equal(PUSDinSP_After, expectedPUSDinSP)

      // Check ETH in SP has reduced to zero
      const ETHinSP_After = (await stabilityPool.getCollateral(weth.address)).toString()
      assert.isAtMost(th.getDifference(ETHinSP_After, '0'), 100000)
    })

    it("getDepositorETHGain(): depositor does not earn further ETH gains from liquidations while their compounded deposit == 0: ", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(1, 24)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      // defaulters open troves 
      await openTrove({ extraPUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_3 } })

      // A, B, provide 10000, 5000 PUSD to SP
      await stabilityPool.provideToSP(dec(10000, 18), frontEnd_1, { from: alice })
      await stabilityPool.provideToSP(dec(5000, 18), frontEnd_1, { from: bob })

      //price drops
      await priceFeed.setPrice(dec(105, 18))

      // Liquidate defaulter 1. Empties the Pool
      await troveManager.liquidate(defaulter_1)
      assert.isFalse(await sortedTroves.contains(defaulter_1))

      const PUSDinSP = (await stabilityPool.getTotalPUSDDeposits()).toString()
      assert.equal(PUSDinSP, '0')

      // Check Stability deposits have been fully cancelled with debt, and are now all zero
      const alice_Deposit = (await stabilityPool.getCompoundedPUSDDeposit(alice)).toString()
      const bob_Deposit = (await stabilityPool.getCompoundedPUSDDeposit(bob)).toString()

      assert.equal(alice_Deposit, '0')
      assert.equal(bob_Deposit, '0')

      // Get ETH gain for A and B
      // if a user's deposit in the SP is 0, then getDepositorGains returns two length 0 arrays
      const alice_ETHGain_1 = ((await stabilityPool.getDepositorGains(alice))[1].length).toString()
      const bob_ETHGain_1 = ((await stabilityPool.getDepositorGains(bob))[1].length).toString()

      // Whale deposits 10000 PUSD to Stability Pool
      await stabilityPool.provideToSP(dec(1, 24), frontEnd_1, { from: whale })

      // Liquidation 2
      await troveManager.liquidate(defaulter_2)
      assert.isFalse(await sortedTroves.contains(defaulter_2))

      // Check Alice and Bob have not received ETH gain from liquidation 2 while their deposit was 0
      const alice_ETHGain_2 = ((await stabilityPool.getDepositorGains(alice))[1].length).toString()
      const bob_ETHGain_2 = ((await stabilityPool.getDepositorGains(bob))[1].length).toString()

      assert.equal(alice_ETHGain_1, alice_ETHGain_2)
      assert.equal(bob_ETHGain_1, bob_ETHGain_2)

      // Liquidation 3
      await troveManager.liquidate(defaulter_3)
      assert.isFalse(await sortedTroves.contains(defaulter_3))

      // Check Alice and Bob have not received ETH gain from liquidation 3 while their deposit was 0
      const alice_ETHGain_3 = ((await stabilityPool.getDepositorGains(alice))[1].length).toString()
      const bob_ETHGain_3 = ((await stabilityPool.getDepositorGains(bob))[1].length).toString()

      assert.equal(alice_ETHGain_1, alice_ETHGain_3)
      assert.equal(bob_ETHGain_1, bob_ETHGain_3)
    })

    // --- PREON functionality ---
    it("withdrawFromSP(): triggers PREON reward event - increases the sum G", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(1, 24)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // A and B provide to SP
      await stabilityPool.provideToSP(dec(10000, 18), frontEnd_1, { from: A })
      await stabilityPool.provideToSP(dec(10000, 18), ZERO_ADDRESS, { from: B })

      const G_Before = await stabilityPool.epochToScaleToG(0, 0)

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // A withdraws from SP
      await stabilityPool.withdrawFromSP(dec(5000, 18), { from: A })

      const G_1 = await stabilityPool.epochToScaleToG(0, 0)

      // Expect G has increased from the PREON reward event triggered
      assert.isTrue(G_1.gt(G_Before))

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // A withdraws from SP
      await stabilityPool.withdrawFromSP(dec(5000, 18), { from: B })

      const G_2 = await stabilityPool.epochToScaleToG(0, 0)

      // Expect G has increased from the PREON reward event triggered
      assert.isTrue(G_2.gt(G_1))
    })

    it("withdrawFromSP(), partial withdrawal: doesn't change the front end tag", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // whale transfer to troves D and E
      await pusdToken.transfer(D, dec(100, 18), { from: whale })
      await pusdToken.transfer(E, dec(200, 18), { from: whale })

      // A, B, C open troves
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // A, B, C, D, E provide to SP
      await stabilityPool.provideToSP(dec(10, 18), frontEnd_1, { from: A })
      await stabilityPool.provideToSP(dec(20, 18), frontEnd_2, { from: B })
      await stabilityPool.provideToSP(dec(30, 18), ZERO_ADDRESS, { from: C })
      await stabilityPool.provideToSP(dec(40, 18), frontEnd_1, { from: D })
      await stabilityPool.provideToSP(dec(50, 18), ZERO_ADDRESS, { from: E })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // A, B, C, D, E withdraw, from different front ends
      await stabilityPool.withdrawFromSP(dec(5, 18), { from: A })
      await stabilityPool.withdrawFromSP(dec(10, 18), { from: B })
      await stabilityPool.withdrawFromSP(dec(15, 18), { from: C })
      await stabilityPool.withdrawFromSP(dec(20, 18), { from: D })
      await stabilityPool.withdrawFromSP(dec(25, 18), { from: E })

      const frontEndTag_A = (await stabilityPool.deposits(A))[1]
      const frontEndTag_B = (await stabilityPool.deposits(B))[1]
      const frontEndTag_C = (await stabilityPool.deposits(C))[1]
      const frontEndTag_D = (await stabilityPool.deposits(D))[1]
      const frontEndTag_E = (await stabilityPool.deposits(E))[1]

      // Check deposits are still tagged with their original front end
      assert.equal(frontEndTag_A, frontEnd_1)
      assert.equal(frontEndTag_B, frontEnd_2)
      assert.equal(frontEndTag_C, ZERO_ADDRESS)
      assert.equal(frontEndTag_D, frontEnd_1)
      assert.equal(frontEndTag_E, ZERO_ADDRESS)
    })

    it("withdrawFromSP(), partial withdrawal: depositor receives PREON rewards", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // A, B, C, provide to SP
      await stabilityPool.provideToSP(dec(10, 18), frontEnd_1, { from: A })
      await stabilityPool.provideToSP(dec(20, 18), frontEnd_2, { from: B })
      await stabilityPool.provideToSP(dec(30, 18), ZERO_ADDRESS, { from: C })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // Get A, B, C PREON balance before
      const A_PREONBalance_Before = await preonToken.balanceOf(A)
      const B_PREONBalance_Before = await preonToken.balanceOf(B)
      const C_PREONBalance_Before = await preonToken.balanceOf(C)

      // A, B, C withdraw
      await stabilityPool.withdrawFromSP(dec(1, 18), { from: A })
      await stabilityPool.withdrawFromSP(dec(2, 18), { from: B })
      await stabilityPool.withdrawFromSP(dec(3, 18), { from: C })

      // Get PREON balance after
      const A_PREONBalance_After = await preonToken.balanceOf(A)
      const B_PREONBalance_After = await preonToken.balanceOf(B)
      const C_PREONBalance_After = await preonToken.balanceOf(C)

      // Check PREON Balance of A, B, C has increased
      assert.isTrue(A_PREONBalance_After.gt(A_PREONBalance_Before))
      assert.isTrue(B_PREONBalance_After.gt(B_PREONBalance_Before))
      assert.isTrue(C_PREONBalance_After.gt(C_PREONBalance_Before))
    })

    it("withdrawFromSP(), partial withdrawal: tagged front end receives PREON rewards", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // A, B, C, provide to SP
      await stabilityPool.provideToSP(dec(10, 18), frontEnd_1, { from: A })
      await stabilityPool.provideToSP(dec(20, 18), frontEnd_2, { from: B })
      await stabilityPool.provideToSP(dec(30, 18), frontEnd_3, { from: C })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // Get front ends' PREON balance before
      const F1_PREONBalance_Before = await preonToken.balanceOf(frontEnd_1)
      const F2_PREONBalance_Before = await preonToken.balanceOf(frontEnd_2)
      const F3_PREONBalance_Before = await preonToken.balanceOf(frontEnd_3)

      // A, B, C withdraw
      await stabilityPool.withdrawFromSP(dec(1, 18), { from: A })
      await stabilityPool.withdrawFromSP(dec(2, 18), { from: B })
      await stabilityPool.withdrawFromSP(dec(3, 18), { from: C })

      // Get front ends' PREON balance after
      const F1_PREONBalance_After = await preonToken.balanceOf(A)
      const F2_PREONBalance_After = await preonToken.balanceOf(B)
      const F3_PREONBalance_After = await preonToken.balanceOf(C)

      // Check PREON Balance of front ends has increased
      assert.isTrue(F1_PREONBalance_After.gt(F1_PREONBalance_Before))
      assert.isTrue(F2_PREONBalance_After.gt(F2_PREONBalance_Before))
      assert.isTrue(F3_PREONBalance_After.gt(F3_PREONBalance_Before))
    })

    it("withdrawFromSP(), partial withdrawal: tagged front end's stake decreases", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C, D, E, F open troves 
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })
      await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })
      await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: F } })

      // A, B, C, D, E, F provide to SP
      await stabilityPool.provideToSP(dec(10, 18), frontEnd_1, { from: A })
      await stabilityPool.provideToSP(dec(20, 18), frontEnd_2, { from: B })
      await stabilityPool.provideToSP(dec(30, 18), frontEnd_3, { from: C })
      await stabilityPool.provideToSP(dec(10, 18), frontEnd_1, { from: D })
      await stabilityPool.provideToSP(dec(20, 18), frontEnd_2, { from: E })
      await stabilityPool.provideToSP(dec(30, 18), frontEnd_3, { from: F })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // Get front ends' stake before
      const F1_Stake_Before = await stabilityPool.frontEndStakes(frontEnd_1)
      const F2_Stake_Before = await stabilityPool.frontEndStakes(frontEnd_2)
      const F3_Stake_Before = await stabilityPool.frontEndStakes(frontEnd_3)

      // A, B, C withdraw 
      await stabilityPool.withdrawFromSP(dec(1, 18), { from: A })
      await stabilityPool.withdrawFromSP(dec(2, 18), { from: B })
      await stabilityPool.withdrawFromSP(dec(3, 18), { from: C })

      // Get front ends' stakes after
      const F1_Stake_After = await stabilityPool.frontEndStakes(frontEnd_1)
      const F2_Stake_After = await stabilityPool.frontEndStakes(frontEnd_2)
      const F3_Stake_After = await stabilityPool.frontEndStakes(frontEnd_3)

      // Check front ends' stakes have decreased
      assert.isTrue(F1_Stake_After.lt(F1_Stake_Before))
      assert.isTrue(F2_Stake_After.lt(F2_Stake_Before))
      assert.isTrue(F3_Stake_After.lt(F3_Stake_Before))
    })

    it("withdrawFromSP(), full withdrawal: rem`oves deposit's front end tag", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // Whale transfers to A, B 
      await pusdToken.transfer(A, dec(10000, 18), { from: whale })
      await pusdToken.transfer(B, dec(20000, 18), { from: whale })

      //C, D open troves
      await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ extraPUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

      // A, B, C, D make their initial deposits
      await stabilityPool.provideToSP(dec(10000, 18), frontEnd_1, { from: A })
      await stabilityPool.provideToSP(dec(20000, 18), ZERO_ADDRESS, { from: B })
      await stabilityPool.provideToSP(dec(30000, 18), frontEnd_2, { from: C })
      await stabilityPool.provideToSP(dec(40000, 18), ZERO_ADDRESS, { from: D })

      // Check deposits are tagged with correct front end 
      const A_tagBefore = await getFrontEndTag(stabilityPool, A)
      const B_tagBefore = await getFrontEndTag(stabilityPool, B)
      const C_tagBefore = await getFrontEndTag(stabilityPool, C)
      const D_tagBefore = await getFrontEndTag(stabilityPool, D)

      assert.equal(A_tagBefore, frontEnd_1)
      assert.equal(B_tagBefore, ZERO_ADDRESS)
      assert.equal(C_tagBefore, frontEnd_2)
      assert.equal(D_tagBefore, ZERO_ADDRESS)

      // All depositors make full withdrawal
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: A })
      await stabilityPool.withdrawFromSP(dec(20000, 18), { from: B })
      await stabilityPool.withdrawFromSP(dec(30000, 18), { from: C })
      await stabilityPool.withdrawFromSP(dec(40000, 18), { from: D })

      // Check all deposits now have no front end tag
      const A_tagAfter = await getFrontEndTag(stabilityPool, A)
      const B_tagAfter = await getFrontEndTag(stabilityPool, B)
      const C_tagAfter = await getFrontEndTag(stabilityPool, C)
      const D_tagAfter = await getFrontEndTag(stabilityPool, D)

      assert.equal(A_tagAfter, ZERO_ADDRESS)
      assert.equal(B_tagAfter, ZERO_ADDRESS)
      assert.equal(C_tagAfter, ZERO_ADDRESS)
      assert.equal(D_tagAfter, ZERO_ADDRESS)
    })

    it("withdrawFromSP(), full withdrawal: zero's depositor's snapshots", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(1000000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      await openTrove({  ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      //  SETUP: Execute a series of operations to make G, S > 0 and P < 1  

      // E opens trove and makes a deposit
      await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: E } })
      await stabilityPool.provideToSP(dec(10000, 18), frontEnd_3, { from: E })

      // Fast-forward time and make a second deposit, to trigger PREON reward and make G > 0
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)
      await stabilityPool.provideToSP(dec(10000, 18), frontEnd_3, { from: E })

      // perform a liquidation to make 0 < P < 1, and S > 0
      await priceFeed.setPrice(dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))

      await troveManager.liquidate(defaulter_1)

      const currentEpoch = await stabilityPool.currentEpoch()
      const currentScale = await stabilityPool.currentScale()

      const S_Before = await stabilityPool.epochToScaleToSum(contracts.weth.address, currentEpoch, currentScale)
      const P_Before = await stabilityPool.P()
      const G_Before = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

      // Confirm 0 < P < 1
      assert.isTrue(P_Before.gt(toBN('0')) && P_Before.lt(toBN(dec(1, 18))))
      // Confirm S, G are both > 0
      assert.isTrue(S_Before.gt(toBN('0')))
      assert.isTrue(G_Before.gt(toBN('0')))

      // --- TEST ---

      // Whale transfers to A, B
      await pusdToken.transfer(A, dec(10000, 18), { from: whale })
      await pusdToken.transfer(B, dec(20000, 18), { from: whale })

      await priceFeed.setPrice(dec(200, 18))

      // C, D open troves
      await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: C } })
      await openTrove({ extraPUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: D } })

      // A, B, C, D make their initial deposits
      await stabilityPool.provideToSP(dec(10000, 18), frontEnd_1, { from: A })
      await stabilityPool.provideToSP(dec(20000, 18), ZERO_ADDRESS, { from: B })
      await stabilityPool.provideToSP(dec(30000, 18), frontEnd_2, { from: C })
      await stabilityPool.provideToSP(dec(40000, 18), ZERO_ADDRESS, { from: D })

      // Check deposits snapshots are non-zero

      for (depositor of [A, B, C, D]) {
        const snapshot = await stabilityPool.depositSnapshots(depositor)

        const ZERO = toBN('0')
        // Check S,P, G snapshots are non-zero
        assert.equal((await stabilityPool.getDepositSnapshotS(depositor, contracts.weth.address)).toString(),  S_Before)  // S 
        assert.isTrue(snapshot.P.eq(P_Before))  // P 
        assert.isTrue(snapshot.G.gt(ZERO))  // GL increases a bit between each depositor op, so just check it is non-zero
        assert.equal(snapshot.scale, '0')  // scale
        assert.equal(snapshot.epoch, '0')  // epoch
      }

      // All depositors make full withdrawal
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: A })
      await stabilityPool.withdrawFromSP(dec(20000, 18), { from: B })
      await stabilityPool.withdrawFromSP(dec(30000, 18), { from: C })
      await stabilityPool.withdrawFromSP(dec(40000, 18), { from: D })

      // Check all depositors' snapshots have been zero'd
      for (depositor of [A, B, C, D]) {
        const snapshot = await stabilityPool.depositSnapshots(depositor)

        // Check S, P, G snapshots are now zero
        assert.equal((await stabilityPool.getDepositSnapshotS(depositor, contracts.weth.address)).toString(), '0')  // S 
        assert.equal(snapshot.P.toString(), '0')  // P 
        assert.equal(snapshot.G.toString(), '0')  // G
        assert.equal(snapshot.scale, '0')  // scale
        assert.equal(snapshot.epoch, '0')  // epoch
      }
    })

    it("withdrawFromSP(), reverts when initial deposit value is 0", async () => {
      await openTrove({ extraPUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A opens trove and join the Stability Pool
      await openTrove({ extraPUSDAmount: toBN(dec(10100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await stabilityPool.provideToSP(dec(10000, 18), frontEnd_1, { from: A })

      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      //  SETUP: Execute a series of operations to trigger PREON and ETH rewards for depositor A

      // Fast-forward time and make a second deposit, to trigger PREON reward and make G > 0
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)
      await stabilityPool.provideToSP(dec(100, 18), frontEnd_1, { from: A })

      // perform a liquidation to make 0 < P < 1, and S > 0
      await priceFeed.setPrice(dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))

      await troveManager.liquidate(defaulter_1)
      assert.isFalse(await sortedTroves.contains(defaulter_1))

      await priceFeed.setPrice(dec(200, 18))

      // A successfully withraws deposit and all gains
      await stabilityPool.withdrawFromSP(dec(10100, 18), { from: A })

      // Confirm A's recorded deposit is 0
      const A_deposit = (await stabilityPool.deposits(A))[0]  // get initialValue property on deposit struct
      assert.equal(A_deposit, '0')

      // --- TEST ---
      const expectedRevertMessage = "StabilityPool: User must have a non-zero deposit"

      // Further withdrawal attempt from A
      const withdrawalPromise_A = stabilityPool.withdrawFromSP(dec(10000, 18), { from: A })
      await th.assertRevert(withdrawalPromise_A, expectedRevertMessage)

      // Withdrawal attempt of a non-existent deposit, from C
      const withdrawalPromise_C = stabilityPool.withdrawFromSP(dec(10000, 18), { from: C })
      await th.assertRevert(withdrawalPromise_C, expectedRevertMessage)
    })

    it("registerFrontEnd(): registers the front end and chosen kickback rate", async () => {
      const unregisteredFrontEnds = [A, B, C, D, E]

      for (const frontEnd of unregisteredFrontEnds) {
        assert.isFalse((await stabilityPool.frontEnds(frontEnd))[1])  // check inactive
        assert.equal((await stabilityPool.frontEnds(frontEnd))[0], '0') // check no chosen kickback rate
      }

      await stabilityPool.registerFrontEnd(dec(1, 18), { from: A })
      await stabilityPool.registerFrontEnd('897789897897897', { from: B })
      await stabilityPool.registerFrontEnd('99990098', { from: C })
      await stabilityPool.registerFrontEnd('37', { from: D })
      await stabilityPool.registerFrontEnd('0', { from: E })

      // Check front ends are registered as active, and have correct kickback rates
      assert.isTrue((await stabilityPool.frontEnds(A))[1])
      assert.equal((await stabilityPool.frontEnds(A))[0], dec(1, 18))

      assert.isTrue((await stabilityPool.frontEnds(B))[1])
      assert.equal((await stabilityPool.frontEnds(B))[0], '897789897897897')

      assert.isTrue((await stabilityPool.frontEnds(C))[1])
      assert.equal((await stabilityPool.frontEnds(C))[0], '99990098')

      assert.isTrue((await stabilityPool.frontEnds(D))[1])
      assert.equal((await stabilityPool.frontEnds(D))[0], '37')

      assert.isTrue((await stabilityPool.frontEnds(E))[1])
      assert.equal((await stabilityPool.frontEnds(E))[0], '0')
    })

    it("registerFrontEnd(): reverts if the front end is already registered", async () => {

      await stabilityPool.registerFrontEnd(dec(1, 18), { from: A })
      await stabilityPool.registerFrontEnd('897789897897897', { from: B })
      await stabilityPool.registerFrontEnd('99990098', { from: C })

      const _2ndAttempt_A = stabilityPool.registerFrontEnd(dec(1, 18), { from: A })
      const _2ndAttempt_B = stabilityPool.registerFrontEnd('897789897897897', { from: B })
      const _2ndAttempt_C = stabilityPool.registerFrontEnd('99990098', { from: C })

      await th.assertRevert(_2ndAttempt_A, "StabilityPool: must not already be a registered front end")
      await th.assertRevert(_2ndAttempt_B, "StabilityPool: must not already be a registered front end")
      await th.assertRevert(_2ndAttempt_C, "StabilityPool: must not already be a registered front end")
    })

    it("registerFrontEnd(): reverts if the kickback rate >1", async () => {

      const invalidKickbackTx_A = stabilityPool.registerFrontEnd(dec(1, 19), { from: A })
      const invalidKickbackTx_B = stabilityPool.registerFrontEnd('1000000000000000001', { from: A })
      const invalidKickbackTx_C = stabilityPool.registerFrontEnd(dec(23423, 45), { from: A })
      const invalidKickbackTx_D = stabilityPool.registerFrontEnd(maxBytes32, { from: A })

      await th.assertRevert(invalidKickbackTx_A, "StabilityPool: Kickback rate must be in range [0,1]")
      await th.assertRevert(invalidKickbackTx_B, "StabilityPool: Kickback rate must be in range [0,1]")
      await th.assertRevert(invalidKickbackTx_C, "StabilityPool: Kickback rate must be in range [0,1]")
      await th.assertRevert(invalidKickbackTx_D, "StabilityPool: Kickback rate must be in range [0,1]")
    })

    it("registerFrontEnd(): reverts if address has a non-zero deposit already", async () => {
      // C, D, E open troves 
      await openTrove({ extraPUSDAmount: toBN(dec(10, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ extraPUSDAmount: toBN(dec(10, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })
      await openTrove({ extraPUSDAmount: toBN(dec(10, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })
      
      // C, E provides to SP
      await stabilityPool.provideToSP(dec(10, 18), frontEnd_1, { from: C })
      await stabilityPool.provideToSP(dec(10, 18), ZERO_ADDRESS, { from: E })

      const txPromise_C = stabilityPool.registerFrontEnd(dec(1, 18), { from: C })
      const txPromise_E = stabilityPool.registerFrontEnd(dec(1, 18), { from: E })
      await th.assertRevert(txPromise_C, "StabilityPool: User must have no deposit")
      await th.assertRevert(txPromise_E, "StabilityPool: User must have no deposit")

      // D, with no deposit, successfully registers a front end
      const txD = await stabilityPool.registerFrontEnd(dec(1, 18), { from: D })
      assert.isTrue(txD.receipt.status)
    })
    
  })
})

contract('Reset chain state', async accounts => { })

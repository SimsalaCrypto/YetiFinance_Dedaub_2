const Decimal = require("decimal.js");
const deploymentHelper = require("../utils/deploymentHelpers.js")
const { BNConverter } = require("../utils/BNConverter.js")
const testHelpers = require("../utils/testHelpers.js")

const SPREONTester = artifacts.require('sPREONToken')
const TroveManagerTester = artifacts.require("TroveManagerTester")
const NonPayable = artifacts.require("./NonPayable.sol")

const th = testHelpers.TestHelper
const timeValues = testHelpers.TimeValues
const dec = th.dec
const assertRevert = th.assertRevert

const toBN = th.toBN
const ZERO = th.toBN('0')

/* NOTE: These tests do not test for specific ETH and PUSD gain values. They only test that the
 * gains are non-zero, occur when they should, and are in correct proportion to the user's stake. 
 *
 * Specific ETH/PUSD gain values will depend on the final fee schedule used, and the final choices for
 * parameters BETA and MINUTE_DECAY_FACTOR in the TroveManager, which are still TBD based on economic
 * modelling.
 * 
 */ 

contract('SPREON revenue share tests', async accounts => {

  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)
  
  const [owner, A, B, C, D, E, F, G, whale] = accounts;

  let priceFeed
  let pusdToken
  let sortedTroves
  let troveManager
  let activePool
  let stabilityPool
  let defaultPool
  let borrowerOperations
  let sPREON
  let preonToken

  let contracts

  const openTrove = async (params) => th.openTrove(contracts, params)

  beforeEach(async () => {
    contracts = await deploymentHelper.deployLiquityCore()
    contracts.troveManager = await TroveManagerTester.new()
    contracts = await deploymentHelper.deployPUSDTokenTester(contracts)
    const PREONContracts = await deploymentHelper.deployPREONTesterContractsHardhat(bountyAddress, lpRewardsAddress, multisig)
    
    await deploymentHelper.connectPREONContracts(PREONContracts)
    await deploymentHelper.connectCoreContracts(contracts, PREONContracts)
    await deploymentHelper.connectPREONContractsToCore(PREONContracts, contracts)

    nonPayable = await NonPayable.new() 
    priceFeed = contracts.priceFeedTestnet
    pusdToken = contracts.pusdToken
    sortedTroves = contracts.sortedTroves
    troveManager = contracts.troveManager
    activePool = contracts.activePool
    stabilityPool = contracts.stabilityPool
    defaultPool = contracts.defaultPool
    borrowerOperations = contracts.borrowerOperations
    hintHelpers = contracts.hintHelpers

    preonToken = PREONContracts.preonToken
    sPREON = PREONContracts.sPREON
  })

  it('stake(): reverts if amount is zero', async () => {
    // FF time one year so owner can transfer PREON
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers PREON to staker A
    await preonToken.transfer(A, dec(100, 18), {from: multisig})

    // console.log(`A preon bal: ${await preonToken.balanceOf(A)}`)

    // A makes stake
    await preonToken.approve(sPREON.address, dec(100, 18), {from: A})
    await assertRevert(sPREON.mint(0, {from: A}), "SPREON: Amount must be non-zero")
  })

  it("ETH fee per PREON staked increases when a redemption fee is triggered and totalStakes > 0", async () => {
    await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraPUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

    // FF time one year so owner can transfer PREON
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers PREON to staker A
    await preonToken.transfer(A, dec(100, 18), {from: multisig})

    // console.log(`A preon bal: ${await preonToken.balanceOf(A)}`)

    // A makes stake
    await preonToken.approve(sPREON.address, dec(100, 18), {from: A})
    await sPREON.mint(dec(100, 18), {from: A})

    // Check ETH fee per unit staked is zero
    const F_ETH_Before = await sPREON.F_ETH()
    assert.equal(F_ETH_Before, '0')

    const B_BalBeforeREdemption = await pusdToken.balanceOf(B)
    // B redeems
    const redemptionTx = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
    
    const B_BalAfterRedemption = await pusdToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // check ETH fee emitted in event is non-zero
    const emittedETHFee = toBN((await th.getEmittedRedemptionValues(redemptionTx))[3])
    assert.isTrue(emittedETHFee.gt(toBN('0')))

    // Check ETH fee per unit staked has increased by correct amount
    const F_ETH_After = await sPREON.F_ETH()

    // Expect fee per unit staked = fee/100, since there is 100 PUSD totalStaked
    const expected_F_ETH_After = emittedETHFee.div(toBN('100')) 

    assert.isTrue(expected_F_ETH_After.eq(F_ETH_After))
  })

  it("ETH fee per PREON staked doesn't change when a redemption fee is triggered and totalStakes == 0", async () => {
    await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraPUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraPUSDAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    // FF time one year so owner can transfer PREON
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers PREON to staker A
    await preonToken.transfer(A, dec(100, 18), {from: multisig})

    // Check ETH fee per unit staked is zero
    const F_ETH_Before = await sPREON.F_ETH()
    assert.equal(F_ETH_Before, '0')

    const B_BalBeforeREdemption = await pusdToken.balanceOf(B)
    // B redeems
    const redemptionTx = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
    
    const B_BalAfterRedemption = await pusdToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // check ETH fee emitted in event is non-zero
    const emittedETHFee = toBN((await th.getEmittedRedemptionValues(redemptionTx))[3])
    assert.isTrue(emittedETHFee.gt(toBN('0')))

    // Check ETH fee per unit staked has not increased 
    const F_ETH_After = await sPREON.F_ETH()
    assert.equal(F_ETH_After, '0')
  })

  it("PUSD fee per PREON staked increases when a redemption fee is triggered and totalStakes > 0", async () => {
    await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraPUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraPUSDAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    // FF time one year so owner can transfer PREON
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers PREON to staker A
    await preonToken.transfer(A, dec(100, 18), {from: multisig})

    // A makes stake
    await preonToken.approve(sPREON.address, dec(100, 18), {from: A})
    await sPREON.mint(dec(100, 18), {from: A})

    // Check PUSD fee per unit staked is zero
    const F_PUSD_Before = await sPREON.F_ETH()
    assert.equal(F_PUSD_Before, '0')

    const B_BalBeforeREdemption = await pusdToken.balanceOf(B)
    // B redeems
    const redemptionTx = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
    
    const B_BalAfterRedemption = await pusdToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // Check base rate is now non-zero
    const baseRate = await troveManager.baseRate()
    assert.isTrue(baseRate.gt(toBN('0')))

    // D draws debt
    const tx = await borrowerOperations.withdrawPUSD(th._100pct, dec(27, 18), D, D, {from: D})
    
    // Check PUSD fee value in event is non-zero
    const emittedPUSDFee = toBN(th.getPUSDFeeFromPUSDBorrowingEvent(tx))
    assert.isTrue(emittedPUSDFee.gt(toBN('0')))
    
    // Check PUSD fee per unit staked has increased by correct amount
    const F_PUSD_After = await sPREON.F_PUSD()

    // Expect fee per unit staked = fee/100, since there is 100 PUSD totalStaked
    const expected_F_PUSD_After = emittedPUSDFee.div(toBN('100'))

    assert.isTrue(expected_F_PUSD_After.eq(F_PUSD_After))
  })

  it("PUSD fee per PREON staked doesn't change when a redemption fee is triggered and totalStakes == 0", async () => {
    await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraPUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraPUSDAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    // FF time one year so owner can transfer PREON
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers PREON to staker A
    await preonToken.transfer(A, dec(100, 18), {from: multisig})

    // Check PUSD fee per unit staked is zero
    const F_PUSD_Before = await sPREON.F_ETH()
    assert.equal(F_PUSD_Before, '0')

    const B_BalBeforeREdemption = await pusdToken.balanceOf(B)
    // B redeems
    const redemptionTx = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
    
    const B_BalAfterRedemption = await pusdToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // Check base rate is now non-zero
    const baseRate = await troveManager.baseRate()
    assert.isTrue(baseRate.gt(toBN('0')))

    // D draws debt
    const tx = await borrowerOperations.withdrawPUSD(th._100pct, dec(27, 18), D, D, {from: D})
    
    // Check PUSD fee value in event is non-zero
    const emittedPUSDFee = toBN(th.getPUSDFeeFromPUSDBorrowingEvent(tx))
    assert.isTrue(emittedPUSDFee.gt(toBN('0')))
    
    // Check PUSD fee per unit staked did not increase, is still zero
    const F_PUSD_After = await sPREON.F_PUSD()
    assert.equal(F_PUSD_After, '0')
  })

  it("PREON Staking: A single staker earns all ETH and PREON fees that occur", async () => {
    await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraPUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraPUSDAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    // FF time one year so owner can transfer PREON
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers PREON to staker A
    await preonToken.transfer(A, dec(100, 18), {from: multisig})

    // A makes stake
    await preonToken.approve(sPREON.address, dec(100, 18), {from: A})
    await sPREON.mint(dec(100, 18), {from: A})

    const B_BalBeforeREdemption = await pusdToken.balanceOf(B)
    // B redeems
    const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
    
    const B_BalAfterRedemption = await pusdToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // check ETH fee 1 emitted in event is non-zero
    const emittedETHFee_1 = toBN((await th.getEmittedRedemptionValues(redemptionTx_1))[3])
    assert.isTrue(emittedETHFee_1.gt(toBN('0')))

    const C_BalBeforeREdemption = await pusdToken.balanceOf(C)
    // C redeems
    const redemptionTx_2 = await th.redeemCollateralAndGetTxObject(C, contracts, dec(100, 18))
    
    const C_BalAfterRedemption = await pusdToken.balanceOf(C)
    assert.isTrue(C_BalAfterRedemption.lt(C_BalBeforeREdemption))
 
     // check ETH fee 2 emitted in event is non-zero
     const emittedETHFee_2 = toBN((await th.getEmittedRedemptionValues(redemptionTx_2))[3])
     assert.isTrue(emittedETHFee_2.gt(toBN('0')))

    // D draws debt
    const borrowingTx_1 = await borrowerOperations.withdrawPUSD(th._100pct, dec(104, 18), D, D, {from: D})
    
    // Check PUSD fee value in event is non-zero
    const emittedPUSDFee_1 = toBN(th.getPUSDFeeFromPUSDBorrowingEvent(borrowingTx_1))
    assert.isTrue(emittedPUSDFee_1.gt(toBN('0')))

    // B draws debt
    const borrowingTx_2 = await borrowerOperations.withdrawPUSD(th._100pct, dec(17, 18), B, B, {from: B})
    
    // Check PUSD fee value in event is non-zero
    const emittedPUSDFee_2 = toBN(th.getPUSDFeeFromPUSDBorrowingEvent(borrowingTx_2))
    assert.isTrue(emittedPUSDFee_2.gt(toBN('0')))

    const expectedTotalETHGain = emittedETHFee_1.add(emittedETHFee_2)
    const expectedTotalPUSDGain = emittedPUSDFee_1.add(emittedPUSDFee_2)

    const A_ETHBalance_Before = toBN(await web3.eth.getBalance(A))
    const A_PUSDBalance_Before = toBN(await pusdToken.balanceOf(A))

    // A un-stakes
    await sPREON.unstake(dec(100, 18), {from: A, gasPrice: 0})

    const A_ETHBalance_After = toBN(await web3.eth.getBalance(A))
    const A_PUSDBalance_After = toBN(await pusdToken.balanceOf(A))


    const A_ETHGain = A_ETHBalance_After.sub(A_ETHBalance_Before)
    const A_PUSDGain = A_PUSDBalance_After.sub(A_PUSDBalance_Before)

    assert.isAtMost(th.getDifference(expectedTotalETHGain, A_ETHGain), 1000)
    assert.isAtMost(th.getDifference(expectedTotalPUSDGain, A_PUSDGain), 1000)
  })

  it("stake(): Top-up sends out all accumulated ETH and PUSD gains to the staker", async () => {
    await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraPUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraPUSDAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    // FF time one year so owner can transfer PREON
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers PREON to staker A
    await preonToken.transfer(A, dec(100, 18), {from: multisig})

    // A makes stake
    await preonToken.approve(sPREON.address, dec(100, 18), {from: A})
    await sPREON.mint(dec(50, 18), {from: A})

    const B_BalBeforeREdemption = await pusdToken.balanceOf(B)
    // B redeems
    const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
    
    const B_BalAfterRedemption = await pusdToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // check ETH fee 1 emitted in event is non-zero
    const emittedETHFee_1 = toBN((await th.getEmittedRedemptionValues(redemptionTx_1))[3])
    assert.isTrue(emittedETHFee_1.gt(toBN('0')))

    const C_BalBeforeREdemption = await pusdToken.balanceOf(C)
    // C redeems
    const redemptionTx_2 = await th.redeemCollateralAndGetTxObject(C, contracts, dec(100, 18))
    
    const C_BalAfterRedemption = await pusdToken.balanceOf(C)
    assert.isTrue(C_BalAfterRedemption.lt(C_BalBeforeREdemption))
 
     // check ETH fee 2 emitted in event is non-zero
     const emittedETHFee_2 = toBN((await th.getEmittedRedemptionValues(redemptionTx_2))[3])
     assert.isTrue(emittedETHFee_2.gt(toBN('0')))

    // D draws debt
    const borrowingTx_1 = await borrowerOperations.withdrawPUSD(th._100pct, dec(104, 18), D, D, {from: D})
    
    // Check PUSD fee value in event is non-zero
    const emittedPUSDFee_1 = toBN(th.getPUSDFeeFromPUSDBorrowingEvent(borrowingTx_1))
    assert.isTrue(emittedPUSDFee_1.gt(toBN('0')))

    // B draws debt
    const borrowingTx_2 = await borrowerOperations.withdrawPUSD(th._100pct, dec(17, 18), B, B, {from: B})
    
    // Check PUSD fee value in event is non-zero
    const emittedPUSDFee_2 = toBN(th.getPUSDFeeFromPUSDBorrowingEvent(borrowingTx_2))
    assert.isTrue(emittedPUSDFee_2.gt(toBN('0')))

    const expectedTotalETHGain = emittedETHFee_1.add(emittedETHFee_2)
    const expectedTotalPUSDGain = emittedPUSDFee_1.add(emittedPUSDFee_2)

    const A_ETHBalance_Before = toBN(await web3.eth.getBalance(A))
    const A_PUSDBalance_Before = toBN(await pusdToken.balanceOf(A))

    // A tops up
    await sPREON.mint(dec(50, 18), {from: A, gasPrice: 0})

    const A_ETHBalance_After = toBN(await web3.eth.getBalance(A))
    const A_PUSDBalance_After = toBN(await pusdToken.balanceOf(A))

    const A_ETHGain = A_ETHBalance_After.sub(A_ETHBalance_Before)
    const A_PUSDGain = A_PUSDBalance_After.sub(A_PUSDBalance_Before)

    assert.isAtMost(th.getDifference(expectedTotalETHGain, A_ETHGain), 1000)
    assert.isAtMost(th.getDifference(expectedTotalPUSDGain, A_PUSDGain), 1000)
  })

  it("getPendingETHGain(): Returns the staker's correct pending ETH gain", async () => { 
    await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraPUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraPUSDAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    // FF time one year so owner can transfer PREON
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers PREON to staker A
    await preonToken.transfer(A, dec(100, 18), {from: multisig})

    // A makes stake
    await preonToken.approve(sPREON.address, dec(100, 18), {from: A})
    await sPREON.mint(dec(50, 18), {from: A})

    const B_BalBeforeREdemption = await pusdToken.balanceOf(B)
    // B redeems
    const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
    
    const B_BalAfterRedemption = await pusdToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // check ETH fee 1 emitted in event is non-zero
    const emittedETHFee_1 = toBN((await th.getEmittedRedemptionValues(redemptionTx_1))[3])
    assert.isTrue(emittedETHFee_1.gt(toBN('0')))

    const C_BalBeforeREdemption = await pusdToken.balanceOf(C)
    // C redeems
    const redemptionTx_2 = await th.redeemCollateralAndGetTxObject(C, contracts, dec(100, 18))
    
    const C_BalAfterRedemption = await pusdToken.balanceOf(C)
    assert.isTrue(C_BalAfterRedemption.lt(C_BalBeforeREdemption))
 
     // check ETH fee 2 emitted in event is non-zero
     const emittedETHFee_2 = toBN((await th.getEmittedRedemptionValues(redemptionTx_2))[3])
     assert.isTrue(emittedETHFee_2.gt(toBN('0')))

    const expectedTotalETHGain = emittedETHFee_1.add(emittedETHFee_2)

    const A_ETHGain = await sPREON.getPendingETHGain(A)

    assert.isAtMost(th.getDifference(expectedTotalETHGain, A_ETHGain), 1000)
  })

  it("getPendingPUSDGain(): Returns the staker's correct pending PUSD gain", async () => {
    await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraPUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraPUSDAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    // FF time one year so owner can transfer PREON
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers PREON to staker A
    await preonToken.transfer(A, dec(100, 18), {from: multisig})

    // A makes stake
    await preonToken.approve(sPREON.address, dec(100, 18), {from: A})
    await sPREON.mint(dec(50, 18), {from: A})

    const B_BalBeforeREdemption = await pusdToken.balanceOf(B)
    // B redeems
    const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
    
    const B_BalAfterRedemption = await pusdToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // check ETH fee 1 emitted in event is non-zero
    const emittedETHFee_1 = toBN((await th.getEmittedRedemptionValues(redemptionTx_1))[3])
    assert.isTrue(emittedETHFee_1.gt(toBN('0')))

    const C_BalBeforeREdemption = await pusdToken.balanceOf(C)
    // C redeems
    const redemptionTx_2 = await th.redeemCollateralAndGetTxObject(C, contracts, dec(100, 18))
    
    const C_BalAfterRedemption = await pusdToken.balanceOf(C)
    assert.isTrue(C_BalAfterRedemption.lt(C_BalBeforeREdemption))
 
     // check ETH fee 2 emitted in event is non-zero
     const emittedETHFee_2 = toBN((await th.getEmittedRedemptionValues(redemptionTx_2))[3])
     assert.isTrue(emittedETHFee_2.gt(toBN('0')))

    // D draws debt
    const borrowingTx_1 = await borrowerOperations.withdrawPUSD(th._100pct, dec(104, 18), D, D, {from: D})
    
    // Check PUSD fee value in event is non-zero
    const emittedPUSDFee_1 = toBN(th.getPUSDFeeFromPUSDBorrowingEvent(borrowingTx_1))
    assert.isTrue(emittedPUSDFee_1.gt(toBN('0')))

    // B draws debt
    const borrowingTx_2 = await borrowerOperations.withdrawPUSD(th._100pct, dec(17, 18), B, B, {from: B})
    
    // Check PUSD fee value in event is non-zero
    const emittedPUSDFee_2 = toBN(th.getPUSDFeeFromPUSDBorrowingEvent(borrowingTx_2))
    assert.isTrue(emittedPUSDFee_2.gt(toBN('0')))

    const expectedTotalPUSDGain = emittedPUSDFee_1.add(emittedPUSDFee_2)
    const A_PUSDGain = await sPREON.getPendingPUSDGain(A)

    assert.isAtMost(th.getDifference(expectedTotalPUSDGain, A_PUSDGain), 1000)
  })

  // - multi depositors, several rewards
  it("PREON Staking: Multiple stakers earn the correct share of all ETH and PREON fees, based on their stake size", async () => {
    await openTrove({ extraPUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraPUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraPUSDAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })
    await openTrove({ extraPUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })
    await openTrove({ extraPUSDAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: F } })
    await openTrove({ extraPUSDAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: G } })

    // FF time one year so owner can transfer PREON
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers PREON to staker A, B, C
    await preonToken.transfer(A, dec(100, 18), {from: multisig})
    await preonToken.transfer(B, dec(200, 18), {from: multisig})
    await preonToken.transfer(C, dec(300, 18), {from: multisig})

    // A, B, C make stake
    await preonToken.approve(sPREON.address, dec(100, 18), {from: A})
    await preonToken.approve(sPREON.address, dec(200, 18), {from: B})
    await preonToken.approve(sPREON.address, dec(300, 18), {from: C})
    await sPREON.mint(dec(100, 18), {from: A})
    await sPREON.mint(dec(200, 18), {from: B})
    await sPREON.mint(dec(300, 18), {from: C})

    // Confirm staking contract holds 600 PREON
    // console.log(`preon staking PREON bal: ${await preonToken.balanceOf(sPREON.address)}`)
    assert.equal(await preonToken.balanceOf(sPREON.address), dec(600, 18))
    assert.equal(await sPREON.totalPREONStaked(), dec(600, 18))

    // F redeems
    const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(F, contracts, dec(45, 18))
    const emittedETHFee_1 = toBN((await th.getEmittedRedemptionValues(redemptionTx_1))[3])
    assert.isTrue(emittedETHFee_1.gt(toBN('0')))

     // G redeems
     const redemptionTx_2 = await th.redeemCollateralAndGetTxObject(G, contracts, dec(197, 18))
     const emittedETHFee_2 = toBN((await th.getEmittedRedemptionValues(redemptionTx_2))[3])
     assert.isTrue(emittedETHFee_2.gt(toBN('0')))

    // F draws debt
    const borrowingTx_1 = await borrowerOperations.withdrawPUSD(th._100pct, dec(104, 18), F, F, {from: F})
    const emittedPUSDFee_1 = toBN(th.getPUSDFeeFromPUSDBorrowingEvent(borrowingTx_1))
    assert.isTrue(emittedPUSDFee_1.gt(toBN('0')))

    // G draws debt
    const borrowingTx_2 = await borrowerOperations.withdrawPUSD(th._100pct, dec(17, 18), G, G, {from: G})
    const emittedPUSDFee_2 = toBN(th.getPUSDFeeFromPUSDBorrowingEvent(borrowingTx_2))
    assert.isTrue(emittedPUSDFee_2.gt(toBN('0')))

    // D obtains PREON from owner and makes a stake
    await preonToken.transfer(D, dec(50, 18), {from: multisig})
    await preonToken.approve(sPREON.address, dec(50, 18), {from: D})
    await sPREON.mint(dec(50, 18), {from: D})

    // Confirm staking contract holds 650 PREON
    assert.equal(await preonToken.balanceOf(sPREON.address), dec(650, 18))
    assert.equal(await sPREON.totalPREONStaked(), dec(650, 18))

     // G redeems
     const redemptionTx_3 = await th.redeemCollateralAndGetTxObject(C, contracts, dec(197, 18))
     const emittedETHFee_3 = toBN((await th.getEmittedRedemptionValues(redemptionTx_3))[3])
     assert.isTrue(emittedETHFee_3.gt(toBN('0')))

     // G draws debt
    const borrowingTx_3 = await borrowerOperations.withdrawPUSD(th._100pct, dec(17, 18), G, G, {from: G})
    const emittedPUSDFee_3 = toBN(th.getPUSDFeeFromPUSDBorrowingEvent(borrowingTx_3))
    assert.isTrue(emittedPUSDFee_3.gt(toBN('0')))
     
    /*  
    Expected rewards:

    A_ETH: (100* ETHFee_1)/600 + (100* ETHFee_2)/600 + (100*ETH_Fee_3)/650
    B_ETH: (200* ETHFee_1)/600 + (200* ETHFee_2)/600 + (200*ETH_Fee_3)/650
    C_ETH: (300* ETHFee_1)/600 + (300* ETHFee_2)/600 + (300*ETH_Fee_3)/650
    D_ETH:                                             (100*ETH_Fee_3)/650

    A_PUSD: (100*PUSDFee_1 )/600 + (100* PUSDFee_2)/600 + (100*PUSDFee_3)/650
    B_PUSD: (200* PUSDFee_1)/600 + (200* PUSDFee_2)/600 + (200*PUSDFee_3)/650
    C_PUSD: (300* PUSDFee_1)/600 + (300* PUSDFee_2)/600 + (300*PUSDFee_3)/650
    D_PUSD:                                               (100*PUSDFee_3)/650
    */

    // Expected ETH gains
    const expectedETHGain_A = toBN('100').mul(emittedETHFee_1).div( toBN('600'))
                            .add(toBN('100').mul(emittedETHFee_2).div( toBN('600')))
                            .add(toBN('100').mul(emittedETHFee_3).div( toBN('650')))

    const expectedETHGain_B = toBN('200').mul(emittedETHFee_1).div( toBN('600'))
                            .add(toBN('200').mul(emittedETHFee_2).div( toBN('600')))
                            .add(toBN('200').mul(emittedETHFee_3).div( toBN('650')))

    const expectedETHGain_C = toBN('300').mul(emittedETHFee_1).div( toBN('600'))
                            .add(toBN('300').mul(emittedETHFee_2).div( toBN('600')))
                            .add(toBN('300').mul(emittedETHFee_3).div( toBN('650')))

    const expectedETHGain_D = toBN('50').mul(emittedETHFee_3).div( toBN('650'))

    // Expected PUSD gains:
    const expectedPUSDGain_A = toBN('100').mul(emittedPUSDFee_1).div( toBN('600'))
                            .add(toBN('100').mul(emittedPUSDFee_2).div( toBN('600')))
                            .add(toBN('100').mul(emittedPUSDFee_3).div( toBN('650')))

    const expectedPUSDGain_B = toBN('200').mul(emittedPUSDFee_1).div( toBN('600'))
                            .add(toBN('200').mul(emittedPUSDFee_2).div( toBN('600')))
                            .add(toBN('200').mul(emittedPUSDFee_3).div( toBN('650')))

    const expectedPUSDGain_C = toBN('300').mul(emittedPUSDFee_1).div( toBN('600'))
                            .add(toBN('300').mul(emittedPUSDFee_2).div( toBN('600')))
                            .add(toBN('300').mul(emittedPUSDFee_3).div( toBN('650')))
    
    const expectedPUSDGain_D = toBN('50').mul(emittedPUSDFee_3).div( toBN('650'))


    const A_ETHBalance_Before = toBN(await web3.eth.getBalance(A))
    const A_PUSDBalance_Before = toBN(await pusdToken.balanceOf(A))
    const B_ETHBalance_Before = toBN(await web3.eth.getBalance(B))
    const B_PUSDBalance_Before = toBN(await pusdToken.balanceOf(B))
    const C_ETHBalance_Before = toBN(await web3.eth.getBalance(C))
    const C_PUSDBalance_Before = toBN(await pusdToken.balanceOf(C))
    const D_ETHBalance_Before = toBN(await web3.eth.getBalance(D))
    const D_PUSDBalance_Before = toBN(await pusdToken.balanceOf(D))

    // A-D un-stake
    const unstake_A = await sPREON.unstake(dec(100, 18), {from: A, gasPrice: 0})
    const unstake_B = await sPREON.unstake(dec(200, 18), {from: B, gasPrice: 0})
    const unstake_C = await sPREON.unstake(dec(400, 18), {from: C, gasPrice: 0})
    const unstake_D = await sPREON.unstake(dec(50, 18), {from: D, gasPrice: 0})

    // Confirm all depositors could withdraw

    //Confirm pool Size is now 0
    assert.equal((await preonToken.balanceOf(sPREON.address)), '0')
    assert.equal((await sPREON.totalPREONStaked()), '0')

    // Get A-D ETH and PUSD balances
    const A_ETHBalance_After = toBN(await web3.eth.getBalance(A))
    const A_PUSDBalance_After = toBN(await pusdToken.balanceOf(A))
    const B_ETHBalance_After = toBN(await web3.eth.getBalance(B))
    const B_PUSDBalance_After = toBN(await pusdToken.balanceOf(B))
    const C_ETHBalance_After = toBN(await web3.eth.getBalance(C))
    const C_PUSDBalance_After = toBN(await pusdToken.balanceOf(C))
    const D_ETHBalance_After = toBN(await web3.eth.getBalance(D))
    const D_PUSDBalance_After = toBN(await pusdToken.balanceOf(D))

    // Get ETH and PUSD gains
    const A_ETHGain = A_ETHBalance_After.sub(A_ETHBalance_Before)
    const A_PUSDGain = A_PUSDBalance_After.sub(A_PUSDBalance_Before)
    const B_ETHGain = B_ETHBalance_After.sub(B_ETHBalance_Before)
    const B_PUSDGain = B_PUSDBalance_After.sub(B_PUSDBalance_Before)
    const C_ETHGain = C_ETHBalance_After.sub(C_ETHBalance_Before)
    const C_PUSDGain = C_PUSDBalance_After.sub(C_PUSDBalance_Before)
    const D_ETHGain = D_ETHBalance_After.sub(D_ETHBalance_Before)
    const D_PUSDGain = D_PUSDBalance_After.sub(D_PUSDBalance_Before)

    // Check gains match expected amounts
    assert.isAtMost(th.getDifference(expectedETHGain_A, A_ETHGain), 1000)
    assert.isAtMost(th.getDifference(expectedPUSDGain_A, A_PUSDGain), 1000)
    assert.isAtMost(th.getDifference(expectedETHGain_B, B_ETHGain), 1000)
    assert.isAtMost(th.getDifference(expectedPUSDGain_B, B_PUSDGain), 1000)
    assert.isAtMost(th.getDifference(expectedETHGain_C, C_ETHGain), 1000)
    assert.isAtMost(th.getDifference(expectedPUSDGain_C, C_PUSDGain), 1000)
    assert.isAtMost(th.getDifference(expectedETHGain_D, D_ETHGain), 1000)
    assert.isAtMost(th.getDifference(expectedPUSDGain_D, D_PUSDGain), 1000)
  })
 
  it("unstake(): reverts if caller has ETH gains and can't receive ETH",  async () => {
    await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })
    await openTrove({ extraPUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraPUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraPUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraPUSDAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers PREON to staker A and the non-payable proxy
    await preonToken.transfer(A, dec(100, 18), {from: multisig})
    await preonToken.transfer(nonPayable.address, dec(100, 18), {from: multisig})

    //  A makes stake
    const A_stakeTx = await sPREON.mint(dec(100, 18), {from: A})
    assert.isTrue(A_stakeTx.receipt.status)

    //  A tells proxy to make a stake
    const proxystakeTxData = await th.getTransactionData('stake(uint256)', ['0x56bc75e2d63100000'])  // proxy stakes 100 PREON
    await nonPayable.forward(sPREON.address, proxystakeTxData, {from: A})


    // B makes a redemption, creating ETH gain for proxy
    const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(B, contracts, dec(45, 18))
    
    const proxy_ETHGain = await sPREON.getPendingETHGain(nonPayable.address)
    assert.isTrue(proxy_ETHGain.gt(toBN('0')))

    // Expect this tx to revert: stake() tries to send nonPayable proxy's accumulated ETH gain (albeit 0),
    //  A tells proxy to unstake
    const proxyUnStakeTxData = await th.getTransactionData('unstake(uint256)', ['0x56bc75e2d63100000'])  // proxy stakes 100 PREON
    const proxyUnstakeTxPromise = nonPayable.forward(sPREON.address, proxyUnStakeTxData, {from: A})
   
    // but nonPayable proxy can not accept ETH - therefore stake() reverts.
    await assertRevert(proxyUnstakeTxPromise)
  })

  it("receive(): reverts when it receives ETH from an address that is not the Active Pool",  async () => { 
    const ethSendTxPromise1 = web3.eth.sendTransaction({to: sPREON.address, from: A, value: dec(1, 'ether')})
    const ethSendTxPromise2 = web3.eth.sendTransaction({to: sPREON.address, from: owner, value: dec(1, 'ether')})

    await assertRevert(ethSendTxPromise1)
    await assertRevert(ethSendTxPromise2)
  })

  it("unstake(): reverts if user has no stake",  async () => {  
    const unstakeTxPromise1 = sPREON.unstake(1, {from: A})
    const unstakeTxPromise2 = sPREON.unstake(1, {from: owner})

    await assertRevert(unstakeTxPromise1)
    await assertRevert(unstakeTxPromise2)
  })

})

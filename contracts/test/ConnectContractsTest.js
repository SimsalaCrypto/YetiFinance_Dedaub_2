const deploymentHelper = require("../utils/deploymentHelpers.js")

contract('Deployment script - Sets correct contract addresses dependencies after deployment', async accounts => {
  const [owner] = accounts;

  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)
  
  let priceFeed
  let pusdToken
  let sortedTroves
  let troveManager
  let activePool
  let stabilityPool
  let defaultPool
  let functionCaller
  let borrowerOperations
  let sPREON
  let preonToken
  let communityIssuance
  let lockupContractFactory

  before(async () => {
    const coreContracts = await deploymentHelper.deployLiquityCore()
    const PREONContracts = await deploymentHelper.deployPREONContracts(bountyAddress, lpRewardsAddress, multisig)

    priceFeed = coreContracts.priceFeedTestnet
    pusdToken = coreContracts.pusdToken
    sortedTroves = coreContracts.sortedTroves
    troveManager = coreContracts.troveManager
    activePool = coreContracts.activePool
    stabilityPool = coreContracts.stabilityPool
    defaultPool = coreContracts.defaultPool
    functionCaller = coreContracts.functionCaller
    borrowerOperations = coreContracts.borrowerOperations

    sPREON = PREONContracts.sPREON
    preonToken = PREONContracts.preonToken
    communityIssuance = PREONContracts.communityIssuance
    lockupContractFactory = PREONContracts.lockupContractFactory

    await deploymentHelper.connectPREONContracts(PREONContracts)
    await deploymentHelper.connectCoreContracts(coreContracts, PREONContracts)
    await deploymentHelper.connectPREONContractsToCore(PREONContracts, coreContracts)
  })

  // @KingPreon: priceFeed no longer set in troveManager
  // it('Sets the correct PriceFeed address in TroveManager', async () => {
  //   const priceFeedAddress = priceFeed.address
  //
  //   const recordedPriceFeedAddress = await troveManager.priceFeed()
  //
  //   assert.equal(priceFeedAddress, recordedPriceFeedAddress)
  // })

  it('Sets the correct PUSDToken address in TroveManager', async () => {
    const pusdTokenAddress = pusdToken.address

    const recordedClvTokenAddress = await troveManager.pusdToken()

    assert.equal(pusdTokenAddress, recordedClvTokenAddress)
  })

  it('Sets the correct SortedTroves address in TroveManager', async () => {
    const sortedTrovesAddress = sortedTroves.address

    const recordedSortedTrovesAddress = await troveManager.sortedTroves()

    assert.equal(sortedTrovesAddress, recordedSortedTrovesAddress)
  })

  it('Sets the correct BorrowerOperations address in TroveManager', async () => {
    const borrowerOperationsAddress = borrowerOperations.address

    const recordedBorrowerOperationsAddress = await troveManager.borrowerOperationsAddress()

    assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
  })

  // ActivePool in TroveM
  it('Sets the correct ActivePool address in TroveManager', async () => {
    const activePoolAddress = activePool.address

    const recordedActivePoolAddresss = await troveManager.activePool()

    assert.equal(activePoolAddress, recordedActivePoolAddresss)
  })

  // DefaultPool in TroveM
  it('Sets the correct DefaultPool address in TroveManager', async () => {
    const defaultPoolAddress = defaultPool.address

    const recordedDefaultPoolAddresss = await troveManager.defaultPool()

    assert.equal(defaultPoolAddress, recordedDefaultPoolAddresss)
  })

  // StabilityPool in TroveM
  it('Sets the correct StabilityPool address in TroveManager', async () => {
    const stabilityPoolAddress = stabilityPool.address

    const recordedStabilityPoolAddresss = await troveManager.stabilityPool()

    assert.equal(stabilityPoolAddress, recordedStabilityPoolAddresss)
  })

  // PREON Staking in TroveM
  it('Sets the correct SPREON address in TroveManager', async () => {
    const sPREONAddress = sPREON.address

    const recordedSPREONAddress = await troveManager.sPREON()
    assert.equal(sPREONAddress, recordedSPREONAddress)
  })

  // Active Pool

  it('Sets the correct StabilityPool address in ActivePool', async () => {
    const stabilityPoolAddress = stabilityPool.address

    const recordedStabilityPoolAddress = await activePool.stabilityPoolAddress()

    assert.equal(stabilityPoolAddress, recordedStabilityPoolAddress)
  })

  it('Sets the correct DefaultPool address in ActivePool', async () => {
    const defaultPoolAddress = defaultPool.address

    const recordedDefaultPoolAddress = await activePool.defaultPoolAddress()

    assert.equal(defaultPoolAddress, recordedDefaultPoolAddress)
  })

  it('Sets the correct BorrowerOperations address in ActivePool', async () => {
    const borrowerOperationsAddress = borrowerOperations.address

    const recordedBorrowerOperationsAddress = await activePool.borrowerOperationsAddress()

    assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
  })

  it('Sets the correct TroveManager address in ActivePool', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await activePool.troveManagerAddress()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  // Stability Pool

  it('Sets the correct ActivePool address in StabilityPool', async () => {
    const activePoolAddress = activePool.address

    const recordedActivePoolAddress = await stabilityPool.activePool()
    assert.equal(activePoolAddress, recordedActivePoolAddress)
  })

  it('Sets the correct BorrowerOperations address in StabilityPool', async () => {
    const borrowerOperationsAddress = borrowerOperations.address

    const recordedBorrowerOperationsAddress = await stabilityPool.borrowerOperations()

    assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
  })

  it('Sets the correct PUSDToken address in StabilityPool', async () => {
    const pusdTokenAddress = pusdToken.address

    const recordedClvTokenAddress = await stabilityPool.pusdToken()

    assert.equal(pusdTokenAddress, recordedClvTokenAddress)
  })

  it('Sets the correct TroveManager address in StabilityPool', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await stabilityPool.troveManager()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  // Default Pool

  it('Sets the correct TroveManager address in DefaultPool', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await defaultPool.troveManagerAddress()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  it('Sets the correct ActivePool address in DefaultPool', async () => {
    const activePoolAddress = activePool.address

    const recordedActivePoolAddress = await defaultPool.activePoolAddress()
    assert.equal(activePoolAddress, recordedActivePoolAddress)
  })

  it('Sets the correct TroveManager address in SortedTroves', async () => {
    const borrowerOperationsAddress = borrowerOperations.address

    const recordedBorrowerOperationsAddress = await sortedTroves.borrowerOperationsAddress()
    assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
  })

  it('Sets the correct BorrowerOperations address in SortedTroves', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await sortedTroves.troveManager()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  //--- BorrowerOperations ---

  // TroveManager in BO
  it('Sets the correct TroveManager address in BorrowerOperations', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await borrowerOperations.troveManager()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  // @KingPreon: Price Feed no longer set in Borrower Operations
  // it('Sets the correct PriceFeed address in BorrowerOperations', async () => {
  //   const priceFeedAddress = priceFeed.address
  //
  //   const recordedPriceFeedAddress = await borrowerOperations.priceFeed()
  //   assert.equal(priceFeedAddress, recordedPriceFeedAddress)
  // })

  // setSortedTroves in BO
  it('Sets the correct SortedTroves address in BorrowerOperations', async () => {
    const sortedTrovesAddress = sortedTroves.address

    const recordedSortedTrovesAddress = await borrowerOperations.sortedTroves()
    assert.equal(sortedTrovesAddress, recordedSortedTrovesAddress)
  })

  // setActivePool in BO
  it('Sets the correct ActivePool address in BorrowerOperations', async () => {
    const activePoolAddress = activePool.address

    const recordedActivePoolAddress = await borrowerOperations.activePool()
    assert.equal(activePoolAddress, recordedActivePoolAddress)
  })

  // setDefaultPool in BO
  it('Sets the correct DefaultPool address in BorrowerOperations', async () => {
    const defaultPoolAddress = defaultPool.address

    const recordedDefaultPoolAddress = await borrowerOperations.defaultPool()
    assert.equal(defaultPoolAddress, recordedDefaultPoolAddress)
  })

  // PREON Staking in BO
  it('Sets the correct SPREON address in BorrowerOperations', async () => {
    const sPREONAddress = sPREON.address

    const recordedSPREONAddress = await borrowerOperations.sPREONAddress()
    assert.equal(sPREONAddress, recordedSPREONAddress)
  })


  // --- PREON Staking ---

  // Sets PREONToken in SPREON
  it('Sets the correct PREONToken address in SPREON', async () => {
    const preonTokenAddress = preonToken.address

    const recordedPREONTokenAddress = await sPREON.preonToken()
    assert.equal(preonTokenAddress, recordedPREONTokenAddress)
  })

  // Sets PUSDToken in SPREON
  it('Sets the correct PUSD Token address in SPREON', async () => {
    const pusdTokenAddress = pusdToken.address

    const recordedPUSDTokenAddress = await sPREON.pusdToken()
    assert.equal(pusdTokenAddress, recordedPUSDTokenAddress)
  })


  // ---  PREONToken ---

  // Sets CI in PREONToken
  it('Sets the correct CommunityIssuance address in PREONToken', async () => {
    const communityIssuanceAddress = communityIssuance.address

    const recordedcommunityIssuanceAddress = await preonToken.communityIssuanceAddress()
    assert.equal(communityIssuanceAddress, recordedcommunityIssuanceAddress)
  })

  // Sets SPREON in PREONToken
  it('Sets the correct SPREON address in PREONToken', async () => {
    const sPREONAddress = sPREON.address

    const recordedSPREONAddress =  await preonToken.sPREONAddress()
    assert.equal(sPREONAddress, recordedSPREONAddress)
  })

  // Sets LCF in PREONToken
  it('Sets the correct LockupContractFactory address in PREONToken', async () => {
    const LCFAddress = lockupContractFactory.address

    const recordedLCFAddress =  await preonToken.lockupContractFactory()
    assert.equal(LCFAddress, recordedLCFAddress)
  })

  // --- LCF  ---

  // Sets PREONToken in LockupContractFactory
  it('Sets the correct PREONToken address in LockupContractFactory', async () => {
    const preonTokenAddress = preonToken.address

    const recordedPREONTokenAddress = await lockupContractFactory.preonTokenAddress()
    assert.equal(preonTokenAddress, recordedPREONTokenAddress)
  })

  // --- CI ---

  // Sets PREONToken in CommunityIssuance
  it('Sets the correct PREONToken address in CommunityIssuance', async () => {
    const preonTokenAddress = preonToken.address

    const recordedPREONTokenAddress = await communityIssuance.preonToken()
    assert.equal(preonTokenAddress, recordedPREONTokenAddress)
  })

  it('Sets the correct StabilityPool address in CommunityIssuance', async () => {
    const stabilityPoolAddress = stabilityPool.address

    const recordedStabilityPoolAddress = await communityIssuance.stabilityPoolAddress()
    assert.equal(stabilityPoolAddress, recordedStabilityPoolAddress)
  })
})

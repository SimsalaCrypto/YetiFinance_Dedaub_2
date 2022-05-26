const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")
const CommunityIssuance = artifacts.require("./CommunityIssuance.sol")


const th = testHelpers.TestHelper
const timeValues = testHelpers.TimeValues
const assertRevert = th.assertRevert
const toBN = th.toBN
const dec = th.dec

contract('Deploying the PREON contracts: LCF, CI, SPREON, and PREONToken ', async accounts => {
  const [liquityAG, A, B] = accounts;
  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

  let PREONContracts

  const oneMillion = toBN(1000000)
  const digits = toBN(1e18)
  const thirtyTwo = toBN(32)
  const expectedCISupplyCap = thirtyTwo.mul(oneMillion).mul(digits)

  beforeEach(async () => {
    // Deploy all contracts from the first account
    PREONContracts = await deploymentHelper.deployPREONContracts(bountyAddress, lpRewardsAddress, multisig)
    await deploymentHelper.connectPREONContracts(PREONContracts)

    sPREON = PREONContracts.sPREON
    preonToken = PREONContracts.preonToken
    communityIssuance = PREONContracts.communityIssuance
    lockupContractFactory = PREONContracts.lockupContractFactory

    //PREON Staking and CommunityIssuance have not yet had their setters called, so are not yet
    // connected to the rest of the system
  })


  describe('CommunityIssuance deployment', async accounts => {
    it("Stores the deployer's address", async () => {
      const storedDeployerAddress = await communityIssuance.owner()

      assert.equal(liquityAG, storedDeployerAddress)
    })
  })

  describe('SPREON deployment', async accounts => {
    it("Stores the deployer's address", async () => {
      const storedDeployerAddress = await sPREON.owner()

      assert.equal(liquityAG, storedDeployerAddress)
    })
  })

  describe('PREONToken deployment', async accounts => {
    it("Stores the multisig's address", async () => {
      const storedMultisigAddress = await preonToken.multisigAddress()

      assert.equal(multisig, storedMultisigAddress)
    })

    it("Stores the CommunityIssuance address", async () => {
      const storedCIAddress = await preonToken.communityIssuanceAddress()

      assert.equal(communityIssuance.address, storedCIAddress)
    })

    it("Stores the LockupContractFactory address", async () => {
      const storedLCFAddress = await preonToken.lockupContractFactory()

      assert.equal(lockupContractFactory.address, storedLCFAddress)
    })

    it("Mints the correct PREON amount to the multisig's address: (64.66 million)", async () => {
      const multisigPREONEntitlement = await preonToken.balanceOf(multisig)

     const twentyThreeSixes = "6".repeat(23)
      const expectedMultisigEntitlement = "64".concat(twentyThreeSixes).concat("7")
      assert.equal(multisigPREONEntitlement, expectedMultisigEntitlement)
    })

    it("Mints the correct PREON amount to the CommunityIssuance contract address: 32 million", async () => {
      const communityPREONEntitlement = await preonToken.balanceOf(communityIssuance.address)
      // 32 million as 18-digit decimal
      const _32Million = dec(32, 24)

      assert.equal(communityPREONEntitlement, _32Million)
    })

    it("Mints the correct PREON amount to the bountyAddress EOA: 2 million", async () => {
      const bountyAddressBal = await preonToken.balanceOf(bountyAddress)
      // 2 million as 18-digit decimal
      const _2Million = dec(2, 24)

      assert.equal(bountyAddressBal, _2Million)
    })

    it("Mints the correct PREON amount to the lpRewardsAddress EOA: 1.33 million", async () => {
      const lpRewardsAddressBal = await preonToken.balanceOf(lpRewardsAddress)
      // 1.3 million as 18-digit decimal
      const _1pt33Million = "1".concat("3".repeat(24))

      assert.equal(lpRewardsAddressBal, _1pt33Million)
    })
  })

  describe('Community Issuance deployment', async accounts => {
    it("Stores the deployer's address", async () => {

      const storedDeployerAddress = await communityIssuance.owner()

      assert.equal(storedDeployerAddress, liquityAG)
    })

    it("Has a supply cap of 32 million", async () => {
      const supplyCap = await communityIssuance.PREONSupplyCap()

      assert.isTrue(expectedCISupplyCap.eq(supplyCap))
    })

    it("Liquity AG can set addresses if CI's PREON balance is equal or greater than 32 million ", async () => {
      const PREONBalance = await preonToken.balanceOf(communityIssuance.address)
      assert.isTrue(PREONBalance.eq(expectedCISupplyCap))

      // Deploy core contracts, just to get the Stability Pool address
      const coreContracts = await deploymentHelper.deployLiquityCore()

      const tx = await communityIssuance.setAddresses(
        preonToken.address,
        coreContracts.stabilityPool.address,
        { from: liquityAG }
      );
      assert.isTrue(tx.receipt.status)
    })

    it("Liquity AG can't set addresses if CI's PREON balance is < 32 million ", async () => {
      const newCI = await CommunityIssuance.new()

      const PREONBalance = await preonToken.balanceOf(newCI.address)
      assert.equal(PREONBalance, '0')

      // Deploy core contracts, just to get the Stability Pool address
      const coreContracts = await deploymentHelper.deployLiquityCore()

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)
      await preonToken.transfer(newCI.address, '31999999999999999999999999', {from: multisig}) // 1e-18 less than CI expects (32 million)

      try {
        const tx = await newCI.setAddresses(
          preonToken.address,
          coreContracts.stabilityPool.address,
          { from: liquityAG }
        );
      
        // Check it gives the expected error message for a failed Solidity 'assert'
      } catch (err) {
        assert.include(err.message, "invalid opcode")
      }
    })
  })

  describe('Connecting PREONToken to LCF, CI and SPREON', async accounts => {
    it('sets the correct PREONToken address in SPREON', async () => {
      // Deploy core contracts and set the PREONToken address in the CI and SPREON
      const coreContracts = await deploymentHelper.deployLiquityCore()
      await deploymentHelper.connectPREONContractsToCore(PREONContracts, coreContracts)

      const preonTokenAddress = preonToken.address

      const recordedPREONTokenAddress = await sPREON.preonToken()
      assert.equal(preonTokenAddress, recordedPREONTokenAddress)
    })

    it('sets the correct PREONToken address in LockupContractFactory', async () => {
      const preonTokenAddress = preonToken.address

      const recordedPREONTokenAddress = await lockupContractFactory.preonTokenAddress()
      assert.equal(preonTokenAddress, recordedPREONTokenAddress)
    })

    it('sets the correct PREONToken address in CommunityIssuance', async () => {
      // Deploy core contracts and set the PREONToken address in the CI and SPREON
      const coreContracts = await deploymentHelper.deployLiquityCore()
      await deploymentHelper.connectPREONContractsToCore(PREONContracts, coreContracts)

      const preonTokenAddress = preonToken.address

      const recordedPREONTokenAddress = await communityIssuance.preonToken()
      assert.equal(preonTokenAddress, recordedPREONTokenAddress)
    })
  })
})

const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")

const th = testHelpers.TestHelper
const timeValues = testHelpers.TimeValues
const { dec, toBN, assertRevert } = th

contract('After the initial lockup period has passed', async accounts => {
  const [
    liquityAG,
    teamMember_1,
    teamMember_2,
    teamMember_3,
    investor_1,
    investor_2,
    investor_3,
    A, B, C, D, E, F, G, H, I, J, K] = accounts;

  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

  const SECONDS_IN_ONE_DAY = timeValues.SECONDS_IN_ONE_DAY
  const SECONDS_IN_ONE_MONTH = timeValues.SECONDS_IN_ONE_MONTH
  const SECONDS_IN_ONE_YEAR = timeValues.SECONDS_IN_ONE_YEAR
  const maxBytes32 = th.maxBytes32

  let PREONContracts
  let coreContracts

  // LCs for team members on vesting schedules
  let LC_T1
  let LC_T2
  let LC_T3

  // LCs for investors
  let LC_I1
  let LC_I2
  let LC_I3

  // 1e24 = 1 million tokens with 18 decimal digits
  const teamMemberInitialEntitlement_1 = dec(1, 24)
  const teamMemberInitialEntitlement_2 = dec(2, 24)
  const teamMemberInitialEntitlement_3 = dec(3, 24)

  const investorInitialEntitlement_1 = dec(4, 24)
  const investorInitialEntitlement_2 = dec(5, 24)
  const investorInitialEntitlement_3 = dec(6, 24)

  const teamMemberMonthlyVesting_1 = dec(1, 23)
  const teamMemberMonthlyVesting_2 = dec(2, 23)
  const teamMemberMonthlyVesting_3 = dec(3, 23)

  const PREONEntitlement_A = dec(1, 24)
  const PREONEntitlement_B = dec(2, 24)
  const PREONEntitlement_C = dec(3, 24)
  const PREONEntitlement_D = dec(4, 24)
  const PREONEntitlement_E = dec(5, 24)

  let oneYearFromSystemDeployment
  let twoYearsFromSystemDeployment
  let justOverOneYearFromSystemDeployment
  let _18monthsFromSystemDeployment

  beforeEach(async () => {
    // Deploy all contracts from the first account
    PREONContracts = await deploymentHelper.deployPREONTesterContractsHardhat(bountyAddress, lpRewardsAddress, multisig)
    coreContracts = await deploymentHelper.deployLiquityCore()

    sPREON = PREONContracts.sPREON
    preonToken = PREONContracts.preonToken
    communityIssuance = PREONContracts.communityIssuance
    lockupContractFactory = PREONContracts.lockupContractFactory

    await deploymentHelper.connectPREONContracts(PREONContracts)
    await deploymentHelper.connectCoreContracts(coreContracts, PREONContracts)
    await deploymentHelper.connectPREONContractsToCore(PREONContracts, coreContracts)

    oneYearFromSystemDeployment = await th.getTimeFromSystemDeployment(preonToken, web3, timeValues.SECONDS_IN_ONE_YEAR)
    justOverOneYearFromSystemDeployment = oneYearFromSystemDeployment.add(toBN('1'))

    const secondsInTwoYears = toBN(timeValues.SECONDS_IN_ONE_YEAR).mul(toBN('2'))
    const secondsIn18Months = toBN(timeValues.SECONDS_IN_ONE_MONTH).mul(toBN('18'))
    twoYearsFromSystemDeployment = await th.getTimeFromSystemDeployment(preonToken, web3, secondsInTwoYears)
    _18monthsFromSystemDeployment = await th.getTimeFromSystemDeployment(preonToken, web3, secondsIn18Months)

    // Deploy 3 LCs for team members on vesting schedules
    const deployedLCtx_T1 = await lockupContractFactory.deployLockupContract(teamMember_1, oneYearFromSystemDeployment, { from: liquityAG })
    const deployedLCtx_T2 = await lockupContractFactory.deployLockupContract(teamMember_2, oneYearFromSystemDeployment, { from: liquityAG })
    const deployedLCtx_T3 = await lockupContractFactory.deployLockupContract(teamMember_3, oneYearFromSystemDeployment, { from: liquityAG })

    const deployedLCtx_I1 = await lockupContractFactory.deployLockupContract(investor_1, oneYearFromSystemDeployment, { from: liquityAG })
    const deployedLCtx_I2 = await lockupContractFactory.deployLockupContract(investor_2, oneYearFromSystemDeployment, { from: liquityAG })
    const deployedLCtx_I3 = await lockupContractFactory.deployLockupContract(investor_3, oneYearFromSystemDeployment, { from: liquityAG })

    // LCs for team members on vesting schedules
    LC_T1 = await th.getLCFromDeploymentTx(deployedLCtx_T1)
    LC_T2 = await th.getLCFromDeploymentTx(deployedLCtx_T2)
    LC_T3 = await th.getLCFromDeploymentTx(deployedLCtx_T3)

    // LCs for investors
    LC_I1 = await th.getLCFromDeploymentTx(deployedLCtx_I1)
    LC_I2 = await th.getLCFromDeploymentTx(deployedLCtx_I2)
    LC_I3 = await th.getLCFromDeploymentTx(deployedLCtx_I3)

    // Multisig transfers initial PREON entitlements to LCs
    await preonToken.transfer(LC_T1.address, teamMemberInitialEntitlement_1, { from: multisig })
    await preonToken.transfer(LC_T2.address, teamMemberInitialEntitlement_2, { from: multisig })
    await preonToken.transfer(LC_T3.address, teamMemberInitialEntitlement_3, { from: multisig })

    await preonToken.transfer(LC_I1.address, investorInitialEntitlement_1, { from: multisig })
    await preonToken.transfer(LC_I2.address, investorInitialEntitlement_2, { from: multisig })
    await preonToken.transfer(LC_I3.address, investorInitialEntitlement_3, { from: multisig })

    const systemDeploymentTime = await preonToken.getDeploymentStartTime()

    // Every thirty days, mutlsig transfers vesting amounts to team members
    for (i = 0; i < 12; i++) {
      await th.fastForwardTime(SECONDS_IN_ONE_MONTH, web3.currentProvider)

      await preonToken.transfer(LC_T1.address, teamMemberMonthlyVesting_1, { from: multisig })
      await preonToken.transfer(LC_T2.address, teamMemberMonthlyVesting_2, { from: multisig })
      await preonToken.transfer(LC_T3.address, teamMemberMonthlyVesting_3, { from: multisig })
    }

    // After Since only 360 days have passed, fast forward 5 more days, until LCs unlock
    await th.fastForwardTime((SECONDS_IN_ONE_DAY * 5), web3.currentProvider)

    const endTime = toBN(await th.getLatestBlockTimestamp(web3))

    const timePassed = endTime.sub(systemDeploymentTime)
    // Confirm that just over one year has passed -  not more than 1000 seconds 
    assert.isTrue(timePassed.sub(toBN(SECONDS_IN_ONE_YEAR)).lt(toBN('1000')))
    assert.isTrue(timePassed.sub(toBN(SECONDS_IN_ONE_YEAR)).gt(toBN('0')))
  })

  describe('Deploying new LCs', async accounts => {
    it("PREON Deployer can deploy new LCs", async () => {
      // PREON deployer deploys LCs
      const LCDeploymentTx_A = await lockupContractFactory.deployLockupContract(A, justOverOneYearFromSystemDeployment, { from: liquityAG })
      const LCDeploymentTx_B = await lockupContractFactory.deployLockupContract(B, oneYearFromSystemDeployment, { from: liquityAG })
      const LCDeploymentTx_C = await lockupContractFactory.deployLockupContract(C, '9595995999999900000023423234', { from: liquityAG })

      assert.isTrue(LCDeploymentTx_A.receipt.status)
      assert.isTrue(LCDeploymentTx_B.receipt.status)
      assert.isTrue(LCDeploymentTx_C.receipt.status)
    })

    it("Anyone can deploy new LCs", async () => {
      // Various EOAs deploy LCs
      const LCDeploymentTx_1 = await lockupContractFactory.deployLockupContract(A, justOverOneYearFromSystemDeployment, { from: teamMember_1 })
      const LCDeploymentTx_2 = await lockupContractFactory.deployLockupContract(C, oneYearFromSystemDeployment, { from: investor_2 })
      const LCDeploymentTx_3 = await lockupContractFactory.deployLockupContract(liquityAG, '9595995999999900000023423234', { from: A })

      assert.isTrue(LCDeploymentTx_1.receipt.status)
      assert.isTrue(LCDeploymentTx_2.receipt.status)
      assert.isTrue(LCDeploymentTx_3.receipt.status)
    })

    it("Anyone can deploy new LCs with unlockTime in the past", async () => {
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider )
      // Various EOAs deploy LCs
      const LCDeploymentTx_1 = await lockupContractFactory.deployLockupContract(A, justOverOneYearFromSystemDeployment, { from: teamMember_1 })
      const LCDeploymentTx_2 = await lockupContractFactory.deployLockupContract(B, oneYearFromSystemDeployment, { from: E })
      const LCDeploymentTx_3 = await lockupContractFactory.deployLockupContract(C, _18monthsFromSystemDeployment, { from: multisig })
      
      const LC_1 = await th.getLCFromDeploymentTx(LCDeploymentTx_1)
      const LC_2 = await th.getLCFromDeploymentTx(LCDeploymentTx_2)
      const LC_3 = await th.getLCFromDeploymentTx(LCDeploymentTx_3)

      // Check deployments succeeded
      assert.isTrue(LCDeploymentTx_1.receipt.status)
      assert.isTrue(LCDeploymentTx_2.receipt.status)
      assert.isTrue(LCDeploymentTx_3.receipt.status)

      // Check LCs have unlockTimes in the past
      unlockTime_1 = await LC_1.unlockTime()
      unlockTime_2 = await LC_2.unlockTime()
      unlockTime_3 = await LC_3.unlockTime()

      const currentTime = toBN(await th.getLatestBlockTimestamp(web3))
      assert.isTrue(unlockTime_1.lt(currentTime))
      assert.isTrue(unlockTime_2.lt(currentTime))
      assert.isTrue(unlockTime_3.lt(currentTime))
    })

    it("Anyone can deploy new LCs with unlockTime in the future", async () => {
      // Various EOAs deploy LCs
      const LCDeploymentTx_1 = await lockupContractFactory.deployLockupContract(A, twoYearsFromSystemDeployment, { from: teamMember_1 })
      const LCDeploymentTx_2 = await lockupContractFactory.deployLockupContract(B, _18monthsFromSystemDeployment, { from: E })
    
      const LC_1 = await th.getLCFromDeploymentTx(LCDeploymentTx_1)
      const LC_2 = await th.getLCFromDeploymentTx(LCDeploymentTx_2)

      // Check deployments succeeded
      assert.isTrue(LCDeploymentTx_1.receipt.status)
      assert.isTrue(LCDeploymentTx_2.receipt.status)

      // Check LCs have unlockTimes in the future
      unlockTime_1 = await LC_1.unlockTime()
      unlockTime_2 = await LC_2.unlockTime()

      const currentTime = toBN(await th.getLatestBlockTimestamp(web3))
      assert.isTrue(unlockTime_1.gt(currentTime))
      assert.isTrue(unlockTime_2.gt(currentTime))
    })
  })

  describe('Beneficiary withdrawal from initial LC', async accounts => {
    it("A beneficiary can withdraw their full entitlement from their LC", async () => {

      // Check PREON balances of investors' LCs are equal to their initial entitlements
      assert.equal(await preonToken.balanceOf(LC_I1.address), investorInitialEntitlement_1)
      assert.equal(await preonToken.balanceOf(LC_I2.address), investorInitialEntitlement_2)
      assert.equal(await preonToken.balanceOf(LC_I3.address), investorInitialEntitlement_3)

      // Check PREON balances of investors are 0
      assert.equal(await preonToken.balanceOf(investor_1), '0')
      assert.equal(await preonToken.balanceOf(investor_2), '0')
      assert.equal(await preonToken.balanceOf(investor_3), '0')

      // All investors withdraw from their respective LCs
      await LC_I1.withdrawPREON({ from: investor_1 })
      await LC_I2.withdrawPREON({ from: investor_2 })
      await LC_I3.withdrawPREON({ from: investor_3 })

      // Check PREON balances of investors now equal their entitlements
      assert.equal(await preonToken.balanceOf(investor_1), investorInitialEntitlement_1)
      assert.equal(await preonToken.balanceOf(investor_2), investorInitialEntitlement_2)
      assert.equal(await preonToken.balanceOf(investor_3), investorInitialEntitlement_3)

      // Check PREON balances of investors' LCs are now 0
      assert.equal(await preonToken.balanceOf(LC_I1.address), '0')
      assert.equal(await preonToken.balanceOf(LC_I2.address), '0')
      assert.equal(await preonToken.balanceOf(LC_I3.address), '0')
    })

    it("A beneficiary on a vesting schedule can withdraw their total vested amount from their LC", async () => {
      // Get PREON balances of LCs for beneficiaries (team members) on vesting schedules
      const PREONBalanceOfLC_T1_Before = await preonToken.balanceOf(LC_T1.address)
      const PREONBalanceOfLC_T2_Before = await preonToken.balanceOf(LC_T2.address)
      const PREONBalanceOfLC_T3_Before = await preonToken.balanceOf(LC_T3.address)

      // Check PREON balances of vesting beneficiaries' LCs are greater than their initial entitlements
      assert.isTrue(PREONBalanceOfLC_T1_Before.gt(th.toBN(teamMemberInitialEntitlement_1)))
      assert.isTrue(PREONBalanceOfLC_T2_Before.gt(th.toBN(teamMemberInitialEntitlement_2)))
      assert.isTrue(PREONBalanceOfLC_T3_Before.gt(th.toBN(teamMemberInitialEntitlement_3)))

      // Check PREON balances of beneficiaries are 0
      assert.equal(await preonToken.balanceOf(teamMember_1), '0')
      assert.equal(await preonToken.balanceOf(teamMember_2), '0')
      assert.equal(await preonToken.balanceOf(teamMember_3), '0')

      // All beneficiaries withdraw from their respective LCs
      await LC_T1.withdrawPREON({ from: teamMember_1 })
      await LC_T2.withdrawPREON({ from: teamMember_2 })
      await LC_T3.withdrawPREON({ from: teamMember_3 })

      // Check beneficiaries' PREON balances now equal their accumulated vested entitlements
      assert.isTrue((await preonToken.balanceOf(teamMember_1)).eq(PREONBalanceOfLC_T1_Before))
      assert.isTrue((await preonToken.balanceOf(teamMember_2)).eq(PREONBalanceOfLC_T2_Before))
      assert.isTrue((await preonToken.balanceOf(teamMember_3)).eq(PREONBalanceOfLC_T3_Before))

      // Check PREON balances of beneficiaries' LCs are now 0
      assert.equal(await preonToken.balanceOf(LC_T1.address), '0')
      assert.equal(await preonToken.balanceOf(LC_T2.address), '0')
      assert.equal(await preonToken.balanceOf(LC_T3.address), '0')
    })

    it("Beneficiaries can withraw full PREON balance of LC if it has increased since lockup period ended", async () => {
      // Check PREON balances of investors' LCs are equal to their initial entitlements
      assert.equal(await preonToken.balanceOf(LC_I1.address), investorInitialEntitlement_1)
      assert.equal(await preonToken.balanceOf(LC_I2.address), investorInitialEntitlement_2)
      assert.equal(await preonToken.balanceOf(LC_I3.address), investorInitialEntitlement_3)

      // Check PREON balances of investors are 0
      assert.equal(await preonToken.balanceOf(investor_1), '0')
      assert.equal(await preonToken.balanceOf(investor_2), '0')
      assert.equal(await preonToken.balanceOf(investor_3), '0')

      // PREON multisig sends extra PREON to investor LCs
      await preonToken.transfer(LC_I1.address, dec(1, 24), { from: multisig })
      await preonToken.transfer(LC_I2.address, dec(1, 24), { from: multisig })
      await preonToken.transfer(LC_I3.address, dec(1, 24), { from: multisig })

      // 1 month passes
      await th.fastForwardTime(SECONDS_IN_ONE_MONTH, web3.currentProvider)

      // PREON multisig again sends extra PREON to investor LCs
      await preonToken.transfer(LC_I1.address, dec(1, 24), { from: multisig })
      await preonToken.transfer(LC_I2.address, dec(1, 24), { from: multisig })
      await preonToken.transfer(LC_I3.address, dec(1, 24), { from: multisig })

      // Get PREON balances of LCs for investors
      const PREONBalanceOfLC_I1_Before = await preonToken.balanceOf(LC_I1.address)
      const PREONBalanceOfLC_I2_Before = await preonToken.balanceOf(LC_I2.address)
      const PREONBalanceOfLC_I3_Before = await preonToken.balanceOf(LC_I3.address)

      // Check PREON balances of investors' LCs are greater than their initial entitlements
      assert.isTrue(PREONBalanceOfLC_I1_Before.gt(th.toBN(investorInitialEntitlement_1)))
      assert.isTrue(PREONBalanceOfLC_I2_Before.gt(th.toBN(investorInitialEntitlement_2)))
      assert.isTrue(PREONBalanceOfLC_I3_Before.gt(th.toBN(investorInitialEntitlement_3)))

      // All investors withdraw from their respective LCs
      await LC_I1.withdrawPREON({ from: investor_1 })
      await LC_I2.withdrawPREON({ from: investor_2 })
      await LC_I3.withdrawPREON({ from: investor_3 })

      // Check PREON balances of investors now equal their LC balances prior to withdrawal
      assert.isTrue((await preonToken.balanceOf(investor_1)).eq(PREONBalanceOfLC_I1_Before))
      assert.isTrue((await preonToken.balanceOf(investor_2)).eq(PREONBalanceOfLC_I2_Before))
      assert.isTrue((await preonToken.balanceOf(investor_3)).eq(PREONBalanceOfLC_I3_Before))

      // Check PREON balances of investors' LCs are now 0
      assert.equal(await preonToken.balanceOf(LC_I1.address), '0')
      assert.equal(await preonToken.balanceOf(LC_I2.address), '0')
      assert.equal(await preonToken.balanceOf(LC_I3.address), '0')
    })
  })

  describe('Withdrawal attempts from LCs by non-beneficiaries', async accounts => {
    it("PREON Multisig can't withdraw from a LC they deployed through the Factory", async () => {
      try {
        const withdrawalAttempt = await LC_T1.withdrawPREON({ from: multisig })
        assert.isFalse(withdrawalAttempt.receipt.status)
      } catch (error) {
        assert.include(error.message, "LockupContract: caller is not the beneficiary")
      }
    })

    it("PREON Multisig can't withdraw from a LC that someone else deployed", async () => {
      // Account D deploys a new LC via the Factory
      const deployedLCtx_B = await lockupContractFactory.deployLockupContract(B, oneYearFromSystemDeployment, { from: D })
      const LC_B = await th.getLCFromDeploymentTx(deployedLCtx_B)

      //PREON multisig fund the newly deployed LCs
      await preonToken.transfer(LC_B.address, dec(2, 18), { from: multisig })

      // PREON multisig attempts withdrawal from LC
      try {
        const withdrawalAttempt_B = await LC_B.withdrawPREON({ from: multisig })
        assert.isFalse(withdrawalAttempt_B.receipt.status)
      } catch (error) {
        assert.include(error.message, "LockupContract: caller is not the beneficiary")
      }
    })

    it("Non-beneficiaries cannot withdraw from a LC", async () => {
      const variousEOAs = [
        teamMember_1,
        teamMember_3,
        liquityAG,
        investor_1,
        investor_2,
        investor_3,
        A,
        B,
        C,
        D,
        E]

      // Several EOAs attempt to withdraw from the LC that has teamMember_2 as beneficiary
      for (account of variousEOAs) {
        try {
          const withdrawalAttempt = await LC_T2.withdrawPREON({ from: account })
          assert.isFalse(withdrawalAttempt.receipt.status)
        } catch (error) {
          assert.include(error.message, "LockupContract: caller is not the beneficiary")
        }
      }
    })
  })

  describe('Transferring PREON', async accounts => {
    it("PREON multisig can transfer PREON to LCs they deployed", async () => {
      const initialPREONBalanceOfLC_T1 = await preonToken.balanceOf(LC_T1.address)
      const initialPREONBalanceOfLC_T2 = await preonToken.balanceOf(LC_T2.address)
      const initialPREONBalanceOfLC_T3 = await preonToken.balanceOf(LC_T3.address)

      // One month passes
      await th.fastForwardTime(SECONDS_IN_ONE_MONTH, web3.currentProvider)

      // PREON multisig transfers vesting amount
      await preonToken.transfer(LC_T1.address, dec(1, 24), { from: multisig })
      await preonToken.transfer(LC_T2.address, dec(1, 24), { from: multisig })
      await preonToken.transfer(LC_T3.address, dec(1, 24), { from: multisig })

      // Get new LC PREON balances
      const PREONBalanceOfLC_T1_1 = await preonToken.balanceOf(LC_T1.address)
      const PREONBalanceOfLC_T2_1 = await preonToken.balanceOf(LC_T2.address)
      const PREONBalanceOfLC_T3_1 = await preonToken.balanceOf(LC_T3.address)

      // // Check team member LC balances have increased 
      assert.isTrue(PREONBalanceOfLC_T1_1.eq(th.toBN(initialPREONBalanceOfLC_T1).add(th.toBN(dec(1, 24)))))
      assert.isTrue(PREONBalanceOfLC_T2_1.eq(th.toBN(initialPREONBalanceOfLC_T2).add(th.toBN(dec(1, 24)))))
      assert.isTrue(PREONBalanceOfLC_T3_1.eq(th.toBN(initialPREONBalanceOfLC_T3).add(th.toBN(dec(1, 24)))))

      // Another month passes
      await th.fastForwardTime(SECONDS_IN_ONE_MONTH, web3.currentProvider)

      // PREON multisig transfers vesting amount
      await preonToken.transfer(LC_T1.address, dec(1, 24), { from: multisig })
      await preonToken.transfer(LC_T2.address, dec(1, 24), { from: multisig })
      await preonToken.transfer(LC_T3.address, dec(1, 24), { from: multisig })

      // Get new LC PREON balances
      const PREONBalanceOfLC_T1_2 = await preonToken.balanceOf(LC_T1.address)
      const PREONBalanceOfLC_T2_2 = await preonToken.balanceOf(LC_T2.address)
      const PREONBalanceOfLC_T3_2 = await preonToken.balanceOf(LC_T3.address)

      // Check team member LC balances have increased again
      assert.isTrue(PREONBalanceOfLC_T1_2.eq(PREONBalanceOfLC_T1_1.add(th.toBN(dec(1, 24)))))
      assert.isTrue(PREONBalanceOfLC_T2_2.eq(PREONBalanceOfLC_T2_1.add(th.toBN(dec(1, 24)))))
      assert.isTrue(PREONBalanceOfLC_T3_2.eq(PREONBalanceOfLC_T3_1.add(th.toBN(dec(1, 24)))))
    })

    it("PREON multisig can transfer tokens to LCs deployed by anyone", async () => {
      // A, B, C each deploy a lockup contract ith themself as beneficiary
      const deployedLCtx_A = await lockupContractFactory.deployLockupContract(A, oneYearFromSystemDeployment, { from: A })
      const deployedLCtx_B = await lockupContractFactory.deployLockupContract(B, justOverOneYearFromSystemDeployment, { from: B })
      const deployedLCtx_C = await lockupContractFactory.deployLockupContract(C, twoYearsFromSystemDeployment, { from: C })

      const LC_A = await th.getLCFromDeploymentTx(deployedLCtx_A)
      const LC_B = await th.getLCFromDeploymentTx(deployedLCtx_B)
      const LC_C = await th.getLCFromDeploymentTx(deployedLCtx_C)

      // Check balances of LCs are 0
      assert.equal(await preonToken.balanceOf(LC_A.address), '0')
      assert.equal(await preonToken.balanceOf(LC_B.address), '0')
      assert.equal(await preonToken.balanceOf(LC_C.address), '0')

      // One month passes
      await th.fastForwardTime(SECONDS_IN_ONE_MONTH, web3.currentProvider)

      // PREON multisig transfers PREON to LCs deployed by other accounts
      await preonToken.transfer(LC_A.address, dec(1, 24), { from: multisig })
      await preonToken.transfer(LC_B.address, dec(2, 24), { from: multisig })
      await preonToken.transfer(LC_C.address, dec(3, 24), { from: multisig })

      // Check balances of LCs have increased
      assert.equal(await preonToken.balanceOf(LC_A.address), dec(1, 24))
      assert.equal(await preonToken.balanceOf(LC_B.address), dec(2, 24))
      assert.equal(await preonToken.balanceOf(LC_C.address), dec(3, 24))
    })

    it("PREON multisig can transfer PREON directly to any externally owned account", async () => {
      // Check PREON balances of EOAs
      assert.equal(await preonToken.balanceOf(A), '0')
      assert.equal(await preonToken.balanceOf(B), '0')
      assert.equal(await preonToken.balanceOf(C), '0')

      // PREON multisig transfers PREON to EOAs
      const txA = await preonToken.transfer(A, dec(1, 24), { from: multisig })
      const txB = await preonToken.transfer(B, dec(2, 24), { from: multisig })
      const txC = await preonToken.transfer(C, dec(3, 24), { from: multisig })

      // Check new balances have increased by correct amount
      assert.equal(await preonToken.balanceOf(A), dec(1, 24))
      assert.equal(await preonToken.balanceOf(B), dec(2, 24))
      assert.equal(await preonToken.balanceOf(C), dec(3, 24))
    })

    it("Anyone can transfer PREON to LCs deployed by anyone", async () => {
      // Start D, E, F with some PREON
      await preonToken.transfer(D, dec(1, 24), { from: multisig })
      await preonToken.transfer(E, dec(2, 24), { from: multisig })
      await preonToken.transfer(F, dec(3, 24), { from: multisig })

      // H, I, J deploy lockup contracts with A, B, C as beneficiaries, respectively
      const deployedLCtx_A = await lockupContractFactory.deployLockupContract(A, oneYearFromSystemDeployment, { from: H })
      const deployedLCtx_B = await lockupContractFactory.deployLockupContract(B, justOverOneYearFromSystemDeployment, { from: I })
      const deployedLCtx_C = await lockupContractFactory.deployLockupContract(C, twoYearsFromSystemDeployment, { from: J })

      // Grab contract addresses from deployment tx events
      const LCAddress_A = await th.getLCAddressFromDeploymentTx(deployedLCtx_A)
      const LCAddress_B = await th.getLCAddressFromDeploymentTx(deployedLCtx_B)
      const LCAddress_C = await th.getLCAddressFromDeploymentTx(deployedLCtx_C)

      // Check balances of LCs are 0
      assert.equal(await preonToken.balanceOf(LCAddress_A), '0')
      assert.equal(await preonToken.balanceOf(LCAddress_B), '0')
      assert.equal(await preonToken.balanceOf(LCAddress_C), '0')

      // D, E, F transfer PREON to LCs
      await preonToken.transfer(LCAddress_A, dec(1, 24), { from: D })
      await preonToken.transfer(LCAddress_B, dec(2, 24), { from: E })
      await preonToken.transfer(LCAddress_C, dec(3, 24), { from: F })

      // Check balances of LCs has increased
      assert.equal(await preonToken.balanceOf(LCAddress_A), dec(1, 24))
      assert.equal(await preonToken.balanceOf(LCAddress_B), dec(2, 24))
      assert.equal(await preonToken.balanceOf(LCAddress_C), dec(3, 24))
    })


    it("Anyone can transfer to an EOA", async () => {
      // Start D, E, liquityAG with some PREON
      await preonToken.unprotectedMint(D, dec(1, 24))
      await preonToken.unprotectedMint(E, dec(2, 24))
      await preonToken.unprotectedMint(liquityAG, dec(3, 24))
      await preonToken.unprotectedMint(multisig, dec(4, 24))

      // PREON holders transfer to other EOAs
      const PREONtransferTx_1 = await preonToken.transfer(A, dec(1, 18), { from: D })
      const PREONtransferTx_2 = await preonToken.transfer(liquityAG, dec(1, 18), { from: E })
      const PREONtransferTx_3 = await preonToken.transfer(F, dec(1, 18), { from: liquityAG })
      const PREONtransferTx_4 = await preonToken.transfer(G, dec(1, 18), { from: multisig })

      assert.isTrue(PREONtransferTx_1.receipt.status)
      assert.isTrue(PREONtransferTx_2.receipt.status)
      assert.isTrue(PREONtransferTx_3.receipt.status)
      assert.isTrue(PREONtransferTx_4.receipt.status)
    })

    it("Anyone can approve any EOA to spend their PREON", async () => {
      // EOAs approve EOAs to spend PREON
      const PREONapproveTx_1 = await preonToken.approve(A, dec(1, 18), { from: multisig })
      const PREONapproveTx_2 = await preonToken.approve(B, dec(1, 18), { from: G })
      const PREONapproveTx_3 = await preonToken.approve(liquityAG, dec(1, 18), { from: F })
      await assert.isTrue(PREONapproveTx_1.receipt.status)
      await assert.isTrue(PREONapproveTx_2.receipt.status)
      await assert.isTrue(PREONapproveTx_3.receipt.status)
    })

    it("Anyone can increaseAllowance for any EOA or Liquity contract", async () => {
      // Anyone can increaseAllowance of EOAs to spend PREON
      const PREONIncreaseAllowanceTx_1 = await preonToken.increaseAllowance(A, dec(1, 18), { from: multisig })
      const PREONIncreaseAllowanceTx_2 = await preonToken.increaseAllowance(B, dec(1, 18), { from: G })
      const PREONIncreaseAllowanceTx_3 = await preonToken.increaseAllowance(multisig, dec(1, 18), { from: F })
      await assert.isTrue(PREONIncreaseAllowanceTx_1.receipt.status)
      await assert.isTrue(PREONIncreaseAllowanceTx_2.receipt.status)
      await assert.isTrue(PREONIncreaseAllowanceTx_3.receipt.status)

      // Increase allowance of Liquity contracts from F
      for (const contract of Object.keys(coreContracts)) {
        const PREONIncreaseAllowanceTx = await preonToken.increaseAllowance(coreContracts[contract].address, dec(1, 18), { from: F })
        await assert.isTrue(PREONIncreaseAllowanceTx.receipt.status)
      }

      // Increase allowance of Liquity contracts from multisig
      for (const contract of Object.keys(coreContracts)) {
        const PREONIncreaseAllowanceTx = await preonToken.increaseAllowance(coreContracts[contract].address, dec(1, 18), { from: multisig })
        await assert.isTrue(PREONIncreaseAllowanceTx.receipt.status)
      }

      // Increase allowance of PREON contracts from F
      for (const contract of Object.keys(PREONContracts)) {
        const PREONIncreaseAllowanceTx = await preonToken.increaseAllowance(PREONContracts[contract].address, dec(1, 18), { from: F })
        await assert.isTrue(PREONIncreaseAllowanceTx.receipt.status)
      }

      // Increase allowance of LQT contracts from multisig
      for (const contract of Object.keys(PREONContracts)) {
        const PREONIncreaseAllowanceTx = await preonToken.increaseAllowance(PREONContracts[contract].address, dec(1, 18), { from: multisig })
        await assert.isTrue(PREONIncreaseAllowanceTx.receipt.status)
      }
    })

    it("Anyone can decreaseAllowance for any EOA or Liquity contract", async () => {
      //First, increase allowance of A, B LiqAG and core contracts
      const PREONapproveTx_1 = await preonToken.approve(A, dec(1, 18), { from: multisig })
      const PREONapproveTx_2 = await preonToken.approve(B, dec(1, 18), { from: G })
      const PREONapproveTx_3 = await preonToken.approve(multisig, dec(1, 18), { from: F })
      await assert.isTrue(PREONapproveTx_1.receipt.status)
      await assert.isTrue(PREONapproveTx_2.receipt.status)
      await assert.isTrue(PREONapproveTx_3.receipt.status)

      // --- SETUP ---

      // IncreaseAllowance of core contracts, from F
      for (const contract of Object.keys(coreContracts)) {
        const PREONtransferTx = await preonToken.increaseAllowance(coreContracts[contract].address, dec(1, 18), { from: F })
        await assert.isTrue(PREONtransferTx.receipt.status)
      }

      // IncreaseAllowance of core contracts, from multisig
      for (const contract of Object.keys(coreContracts)) {
        const PREONtransferTx = await preonToken.increaseAllowance(coreContracts[contract].address, dec(1, 18), { from: multisig })
        await assert.isTrue(PREONtransferTx.receipt.status)
      }

      // Increase allowance of PREON contracts from F
      for (const contract of Object.keys(PREONContracts)) {
        const PREONIncreaseAllowanceTx = await preonToken.increaseAllowance(PREONContracts[contract].address, dec(1, 18), { from: F })
        await assert.isTrue(PREONIncreaseAllowanceTx.receipt.status)
      }

      // Increase allowance of LQTT contracts from multisig 
      for (const contract of Object.keys(PREONContracts)) {
        const PREONIncreaseAllowanceTx = await preonToken.increaseAllowance(PREONContracts[contract].address, dec(1, 18), { from: multisig })
        await assert.isTrue(PREONIncreaseAllowanceTx.receipt.status)
      }

      // --- TEST ---

      // Decrease allowance of A, B, multisig
      const PREONDecreaseAllowanceTx_1 = await preonToken.decreaseAllowance(A, dec(1, 18), { from: multisig })
      const PREONDecreaseAllowanceTx_2 = await preonToken.decreaseAllowance(B, dec(1, 18), { from: G })
      const PREONDecreaseAllowanceTx_3 = await preonToken.decreaseAllowance(multisig, dec(1, 18), { from: F })
      await assert.isTrue(PREONDecreaseAllowanceTx_1.receipt.status)
      await assert.isTrue(PREONDecreaseAllowanceTx_2.receipt.status)
      await assert.isTrue(PREONDecreaseAllowanceTx_3.receipt.status)

      // Decrease allowance of core contracts, from F
      for (const contract of Object.keys(coreContracts)) {
        const PREONDecreaseAllowanceTx = await preonToken.decreaseAllowance(coreContracts[contract].address, dec(1, 18), { from: F })
        await assert.isTrue(PREONDecreaseAllowanceTx.receipt.status)
      }

      // Decrease allowance of core contracts from multisig
      for (const contract of Object.keys(coreContracts)) {
        const PREONDecreaseAllowanceTx = await preonToken.decreaseAllowance(coreContracts[contract].address, dec(1, 18), { from: multisig })
        await assert.isTrue(PREONDecreaseAllowanceTx.receipt.status)
      }

      // Decrease allowance of PREON contracts from F
      for (const contract of Object.keys(PREONContracts)) {
        const PREONIncreaseAllowanceTx = await preonToken.decreaseAllowance(PREONContracts[contract].address, dec(1, 18), { from: F })
        await assert.isTrue(PREONIncreaseAllowanceTx.receipt.status)
      }

      // Decrease allowance of PREON contracts from multisig
      for (const contract of Object.keys(PREONContracts)) {
        const PREONIncreaseAllowanceTx = await preonToken.decreaseAllowance(PREONContracts[contract].address, dec(1, 18), { from: multisig })
        await assert.isTrue(PREONIncreaseAllowanceTx.receipt.status)
      }
    })

    it("Anyone can be the sender in a transferFrom() call", async () => {
      // Fund B, C
      await preonToken.unprotectedMint(B, dec(1, 18))
      await preonToken.unprotectedMint(C, dec(1, 18))

      // LiqAG, B, C approve F, G, multisig respectively
      await preonToken.approve(F, dec(1, 18), { from: multisig })
      await preonToken.approve(G, dec(1, 18), { from: B })
      await preonToken.approve(multisig, dec(1, 18), { from: C })

      // Approved addresses transfer from the address they're approved for
      const PREONtransferFromTx_1 = await preonToken.transferFrom(multisig, F, dec(1, 18), { from: F })
      const PREONtransferFromTx_2 = await preonToken.transferFrom(B, multisig, dec(1, 18), { from: G })
      const PREONtransferFromTx_3 = await preonToken.transferFrom(C, A, dec(1, 18), { from: multisig })
      await assert.isTrue(PREONtransferFromTx_1.receipt.status)
      await assert.isTrue(PREONtransferFromTx_2.receipt.status)
      await assert.isTrue(PREONtransferFromTx_3.receipt.status)
    })

    it("Anyone can stake their PREON in the staking contract", async () => {
      // Fund F
      await preonToken.unprotectedMint(F, dec(1, 18))

      const SPREONTx_1 = await sPREON.mint(dec(1, 18), { from: F })
      const SPREONTx_2 = await sPREON.mint(dec(1, 18), { from: multisig })
      await assert.isTrue(SPREONTx_1.receipt.status)
      await assert.isTrue(SPREONTx_2.receipt.status)
    })
  })

  describe('Withdrawal Attempts on new LCs before unlockTime has passed', async accounts => {
    it("PREON Deployer can't withdraw from a funded LC they deployed for another beneficiary through the Factory, before the unlockTime", async () => {
      const deployedLCtx_B = await lockupContractFactory.deployLockupContract(B, _18monthsFromSystemDeployment, { from: D })
      const LC_B = await th.getLCFromDeploymentTx(deployedLCtx_B)

      // Check currentTime < unlockTime
      const currentTime = toBN(await th.getLatestBlockTimestamp(web3))
      const unlockTime = await LC_B.unlockTime()
      assert.isTrue(currentTime.lt(unlockTime))

      // PREON multisig attempts withdrawal from LC they deployed through the Factory
      try {
        const withdrawalAttempt = await LC_B.withdrawPREON({ from: multisig })
        assert.isFalse(withdrawalAttempt.receipt.status)
      } catch (error) {
        assert.include(error.message, "LockupContract: caller is not the beneficiary")
      }
    })

    it("PREON Deployer can't withdraw from a funded LC that someone else deployed, before the unlockTime", async () => {
      // Account D deploys a new LC via the Factory
      const deployedLCtx_B = await lockupContractFactory.deployLockupContract(B, _18monthsFromSystemDeployment, { from: D })
      const LC_B = await th.getLCFromDeploymentTx(deployedLCtx_B)

      //PREON multisig fund the newly deployed LCs
      await preonToken.transfer(LC_B.address, dec(2, 18), { from: multisig })

      // Check currentTime < unlockTime
      const currentTime = toBN(await th.getLatestBlockTimestamp(web3))
      const unlockTime = await LC_B.unlockTime()
      assert.isTrue(currentTime.lt(unlockTime))

      // PREON multisig attempts withdrawal from LCs
      try {
        const withdrawalAttempt_B = await LC_B.withdrawPREON({ from: multisig })
        assert.isFalse(withdrawalAttempt_B.receipt.status)
      } catch (error) {
        assert.include(error.message, "LockupContract: caller is not the beneficiary")
      }
    })

    it("Beneficiary can't withdraw from their funded LC, before the unlockTime", async () => {
      // Account D deploys a new LC via the Factory
      const deployedLCtx_B = await lockupContractFactory.deployLockupContract(B, _18monthsFromSystemDeployment, { from: D })
      const LC_B = await th.getLCFromDeploymentTx(deployedLCtx_B)

      // PREON multisig funds contracts
      await preonToken.transfer(LC_B.address, dec(2, 18), { from: multisig })

      // Check currentTime < unlockTime
      const currentTime = toBN(await th.getLatestBlockTimestamp(web3))
      const unlockTime = await LC_B.unlockTime()
      assert.isTrue(currentTime.lt(unlockTime))

      try {
        const beneficiary = await LC_B.beneficiary()
        const withdrawalAttempt = await LC_B.withdrawPREON({ from: beneficiary })
        assert.isFalse(withdrawalAttempt.receipt.status)
      } catch (error) {
        assert.include(error.message, "LockupContract: The lockup duration must have passed")
      }
    })

    it("No one can withdraw from a beneficiary's funded LC, before the unlockTime", async () => {
      // Account D deploys a new LC via the Factory
      const deployedLCtx_B = await lockupContractFactory.deployLockupContract(B, _18monthsFromSystemDeployment, { from: D })
      const LC_B = await th.getLCFromDeploymentTx(deployedLCtx_B)

      // PREON multisig funds contracts
      await preonToken.transfer(LC_B.address, dec(2, 18), { from: multisig })

      // Check currentTime < unlockTime
      const currentTime = toBN(await th.getLatestBlockTimestamp(web3))
      const unlockTime = await LC_B.unlockTime()
      assert.isTrue(currentTime.lt(unlockTime))

      const variousEOAs = [teamMember_2, multisig, investor_1, A, C, D, E]

      // Several EOAs attempt to withdraw from LC deployed by D
      for (account of variousEOAs) {
        try {
          const withdrawalAttempt = await LC_B.withdrawPREON({ from: account })
          assert.isFalse(withdrawalAttempt.receipt.status)
        } catch (error) {
          assert.include(error.message, "LockupContract: caller is not the beneficiary")
        }
      }
    })
  })

  describe('Withdrawals from new LCs after unlockTime has passed', async accounts => {
    it("PREON Deployer can't withdraw from a funded LC they deployed for another beneficiary through the Factory, after the unlockTime", async () => {
      const deployedLCtx_B = await lockupContractFactory.deployLockupContract(B, _18monthsFromSystemDeployment, { from: D })
      const LC_B = await th.getLCFromDeploymentTx(deployedLCtx_B)

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

      // Check currentTime > unlockTime
      const currentTime = toBN(await th.getLatestBlockTimestamp(web3))
      const unlockTime = await LC_B.unlockTime()
      assert.isTrue(currentTime.gt(unlockTime))

      // PREON multisig attempts withdrawal from LC they deployed through the Factory
      try {
        const withdrawalAttempt = await LC_B.withdrawPREON({ from: multisig })
        assert.isFalse(withdrawalAttempt.receipt.status)
      } catch (error) {
        assert.include(error.message, "LockupContract: caller is not the beneficiary")
      }
    })

    it("PREON multisig can't withdraw from a funded LC when they are not the beneficiary, after the unlockTime", async () => {
      // Account D deploys a new LC via the Factory
      const deployedLCtx_B = await lockupContractFactory.deployLockupContract(B, _18monthsFromSystemDeployment, { from: D })
      const LC_B = await th.getLCFromDeploymentTx(deployedLCtx_B)

      //PREON multisig fund the newly deployed LC
      await preonToken.transfer(LC_B.address, dec(2, 18), { from: multisig })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

      // Check currentTime > unlockTime
      const currentTime = toBN(await th.getLatestBlockTimestamp(web3))
      const unlockTime = await LC_B.unlockTime()
      assert.isTrue(currentTime.gt(unlockTime))

      // PREON multisig attempts withdrawal from LCs
      try {
        const withdrawalAttempt_B = await LC_B.withdrawPREON({ from: multisig })
        assert.isFalse(withdrawalAttempt_B.receipt.status)
      } catch (error) {
        assert.include(error.message, "LockupContract: caller is not the beneficiary")
      }
    })

    it("Beneficiary can withdraw from their funded LC, after the unlockTime", async () => {
      // Account D deploys a new LC via the Factory
      const deployedLCtx_B = await lockupContractFactory.deployLockupContract(B, _18monthsFromSystemDeployment, { from: D })
      const LC_B = await th.getLCFromDeploymentTx(deployedLCtx_B)

      // PREON multisig funds contract
      await preonToken.transfer(LC_B.address, dec(2, 18), { from: multisig })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

      // Check currentTime > unlockTime
      const currentTime = toBN(await th.getLatestBlockTimestamp(web3))
      const unlockTime = await LC_B.unlockTime()
      assert.isTrue(currentTime.gt(unlockTime))

      const beneficiary = await LC_B.beneficiary()
      assert.equal(beneficiary, B)

      // Get B's balance before
      const B_balanceBefore = await preonToken.balanceOf(B)
      assert.equal(B_balanceBefore, '0')
      
      const withdrawalAttempt = await LC_B.withdrawPREON({ from: B })
      assert.isTrue(withdrawalAttempt.receipt.status)

       // Get B's balance after
       const B_balanceAfter = await preonToken.balanceOf(B)
       assert.equal(B_balanceAfter, dec(2, 18))
    })

    it("Non-beneficiaries can't withdraw from a beneficiary's funded LC, after the unlockTime", async () => {
      // Account D deploys a new LC via the Factory
      const deployedLCtx_B = await lockupContractFactory.deployLockupContract(B, _18monthsFromSystemDeployment, { from: D })
      const LC_B = await th.getLCFromDeploymentTx(deployedLCtx_B)

      // PREON multisig funds contracts
      await preonToken.transfer(LC_B.address, dec(2, 18), { from: multisig })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

      // Check currentTime > unlockTime
      const currentTime = toBN(await th.getLatestBlockTimestamp(web3))
      const unlockTime = await LC_B.unlockTime()
      assert.isTrue(currentTime.gt(unlockTime))

      const variousEOAs = [teamMember_2, liquityAG, investor_1, A, C, D, E]

      // Several EOAs attempt to withdraw from LC deployed by D
      for (account of variousEOAs) {
        try {
          const withdrawalAttempt = await LC_B.withdrawPREON({ from: account })
          assert.isFalse(withdrawalAttempt.receipt.status)
        } catch (error) {
          assert.include(error.message, "LockupContract: caller is not the beneficiary")
        }
      }
    })
  })
})

const { artifacts, ethers } = require("hardhat")
const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const PUSDTokenTester = artifacts.require("./PUSDTokenTester.sol")
const PreonTokenTester = artifacts.require("./PREONTokenTester.sol")



const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN
const getDifference = th.getDifference
const assertRevert = th.assertRevert
const mv = testHelpers.MoneyValues

const PUSDToken = artifacts.require("PUSDToken")
const PreonToken = artifacts.require("PREONToken")
const sPREONToken = artifacts.require("./sPREONToken.sol")
const sPREONTokenTester = artifacts.require("./sPREONTokenTester.sol")

contract('TroveManager - Redistribution reward calculations', async accounts => {

  const [
    owner,
    alice, bob, carol, dennis, erin, freddy, greta, harry, ida,
    A, B, C, D, E,
    whale, defaulter_1, defaulter_2, defaulter_3, defaulter_4] = accounts;

    const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)


  let pusdToken
  let preonToken
  let sPreonToken

  let contracts

  beforeEach(async () => {
    contracts = await deploymentHelper.deployLiquityCore()
    contracts.pusdToken = await PUSDTokenTester.new(
      contracts.troveManager.address,
      contracts.troveManagerLiquidations.address,
      contracts.troveManagerRedemptions.address,
      contracts.stabilityPool.address,
      contracts.borrowerOperations.address
    )
    const PREONContracts = await deploymentHelper.deployPREONTesterContractsHardhat()

    await deploymentHelper.connectPREONContracts(PREONContracts)
    await deploymentHelper.connectCoreContracts(contracts, PREONContracts)
    await deploymentHelper.connectPREONContractsToCore(PREONContracts, contracts)

    pusdToken = contracts.pusdToken
    preonToken = PREONContracts.preonToken
    sPreonToken = PREONContracts.sPREON;
    // console.log(sPreonToken.methods);
    console.log("Preon Token address", preonToken.address);
  })

  it("mint sPREON token", async () => {
    await preonToken.unprotectedMint(alice, toBN(dec(200, 17)))

    await preonToken.approve(sPreonToken.address, toBN(dec(200, 17)), {from: alice})
    console.log("63: preon token address:", preonToken.address);
    await sPreonToken.mint(toBN(dec(120, 17)), {from: alice})

    // Check balance
    assert.equal(toBN(dec(120, 17)).toString(), (await sPreonToken.balanceOf(alice)).toString())
    assert.equal(toBN(dec(80, 17)).toString(), (await preonToken.balanceOf(alice)).toString())
  })

  it("mint sPREON token muti accounts", async () => {
    await preonToken.unprotectedMint(alice, toBN(dec(200, 17)))
    await preonToken.unprotectedMint(bob, toBN(dec(1000, 17)))
    await preonToken.unprotectedMint(carol, toBN(dec(1000, 17)))

    await preonToken.approve(sPreonToken.address, toBN(dec(200, 17)), {from: alice})
    await preonToken.approve(sPreonToken.address, toBN(dec(1000, 17)), {from: bob})
    await preonToken.approve(sPreonToken.address, toBN(dec(1000, 17)), {from: carol})

    await sPreonToken.mint(toBN(dec(100, 17)), {from: alice})
    await sPreonToken.mint(toBN(dec(100, 17)), {from: bob})

    await sPreonToken.mint(toBN(dec(100, 17)), {from: carol})
    await sPreonToken.mint(toBN(dec(100, 17)), {from: carol})
    // Check balance
    assert.equal(toBN(dec(100, 17)).toString(), (await sPreonToken.balanceOf(alice)).toString())
    assert.equal(toBN(dec(100, 17)).toString(), (await preonToken.balanceOf(alice)).toString())

    assert.equal(toBN(dec(100, 17)).toString(), (await sPreonToken.balanceOf(bob)).toString())

    assert.equal(toBN(dec(200, 17)).toString(), (await sPreonToken.balanceOf(carol)).toString())

  })
  it("burn sPREON token muti accounts", async () => {
    await preonToken.unprotectedMint(alice, toBN(dec(200, 17)))
    await preonToken.unprotectedMint(bob, toBN(dec(1000, 17)))
    await preonToken.unprotectedMint(carol, toBN(dec(1000, 17)))

    await preonToken.approve(sPreonToken.address, toBN(dec(200, 17)), {from: alice})
    await preonToken.approve(sPreonToken.address, toBN(dec(1000, 17)), {from: bob})
    await preonToken.approve(sPreonToken.address, toBN(dec(1000, 17)), {from: carol})

    await sPreonToken.mint(toBN(dec(100, 17)), {from: alice})
    await sPreonToken.mint(toBN(dec(100, 17)), {from: bob})

    await sPreonToken.mint(toBN(dec(100, 17)), {from: carol})
    await sPreonToken.mint(toBN(dec(100, 17)), {from: carol})
    // Fastforward time 69 hours
    await ethers.provider.send('evm_increaseTime', [252000]); 
    await ethers.provider.send('evm_mine');

    await sPreonToken.burn(alice, toBN(dec(100, 17)), {from: alice})
    assert.equal(toBN(dec(0, 17)).toString(), (await sPreonToken.balanceOf(alice)).toString())
    assert.equal(toBN(dec(200, 17)).toString(), (await preonToken.balanceOf(alice)).toString())

    assert.equal(toBN(dec(100, 17)).toString(), (await sPreonToken.balanceOf(bob)).toString())

    assert.equal(toBN(dec(200, 17)).toString(), (await sPreonToken.balanceOf(carol)).toString())

  })
  it("sPREON lockup testing", async () => {
    await preonToken.unprotectedMint(alice, toBN(dec(200, 17)))
    await preonToken.unprotectedMint(bob, toBN(dec(1000, 17)))
    await preonToken.unprotectedMint(carol, toBN(dec(1000, 17)))

    await preonToken.approve(sPreonToken.address, toBN(dec(200, 17)), {from: alice})
    await preonToken.approve(sPreonToken.address, toBN(dec(1000, 17)), {from: bob})
    await preonToken.approve(sPreonToken.address, toBN(dec(1000, 17)), {from: carol})

    await sPreonToken.mint(toBN(dec(100, 17)), {from: alice})
    await sPreonToken.mint(toBN(dec(100, 17)), {from: bob})

    await sPreonToken.mint(toBN(dec(100, 17)), {from: carol})
    await sPreonToken.mint(toBN(dec(100, 17)), {from: carol})
    

    assertRevert(sPreonToken.burn(alice, toBN(dec(100, 17)), {from: alice}))
    

  })
})
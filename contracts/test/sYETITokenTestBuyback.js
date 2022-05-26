const { artifacts, ethers, assert } = require("hardhat")
const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const PUSDTokenTester = artifacts.require("./PUSDTokenTester.sol")
const PreonTokenTester = artifacts.require("./PREONTokenTester.sol")
let joeRouter
let joeZap

const routerABI = [{ "inputs": [{ "internalType": "address", "name": "_factory", "type": "address" }, { "internalType": "address", "name": "_WAVAX", "type": "address" }], "stateMutability": "nonpayable", "type": "constructor" }, { "inputs": [], "name": "WAVAX", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "tokenA", "type": "address" }, { "internalType": "address", "name": "tokenB", "type": "address" }, { "internalType": "uint256", "name": "amountADesired", "type": "uint256" }, { "internalType": "uint256", "name": "amountBDesired", "type": "uint256" }, { "internalType": "uint256", "name": "amountAMin", "type": "uint256" }, { "internalType": "uint256", "name": "amountBMin", "type": "uint256" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "addLiquidity", "outputs": [{ "internalType": "uint256", "name": "amountA", "type": "uint256" }, { "internalType": "uint256", "name": "amountB", "type": "uint256" }, { "internalType": "uint256", "name": "liquidity", "type": "uint256" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "token", "type": "address" }, { "internalType": "uint256", "name": "amountTokenDesired", "type": "uint256" }, { "internalType": "uint256", "name": "amountTokenMin", "type": "uint256" }, { "internalType": "uint256", "name": "amountAVAXMin", "type": "uint256" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "addLiquidityAVAX", "outputs": [{ "internalType": "uint256", "name": "amountToken", "type": "uint256" }, { "internalType": "uint256", "name": "amountAVAX", "type": "uint256" }, { "internalType": "uint256", "name": "liquidity", "type": "uint256" }], "stateMutability": "payable", "type": "function" }, { "inputs": [], "name": "factory", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountOut", "type": "uint256" }, { "internalType": "uint256", "name": "reserveIn", "type": "uint256" }, { "internalType": "uint256", "name": "reserveOut", "type": "uint256" }], "name": "getAmountIn", "outputs": [{ "internalType": "uint256", "name": "amountIn", "type": "uint256" }], "stateMutability": "pure", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountIn", "type": "uint256" }, { "internalType": "uint256", "name": "reserveIn", "type": "uint256" }, { "internalType": "uint256", "name": "reserveOut", "type": "uint256" }], "name": "getAmountOut", "outputs": [{ "internalType": "uint256", "name": "amountOut", "type": "uint256" }], "stateMutability": "pure", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountOut", "type": "uint256" }, { "internalType": "address[]", "name": "path", "type": "address[]" }], "name": "getAmountsIn", "outputs": [{ "internalType": "uint256[]", "name": "amounts", "type": "uint256[]" }], "stateMutability": "view", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountIn", "type": "uint256" }, { "internalType": "address[]", "name": "path", "type": "address[]" }], "name": "getAmountsOut", "outputs": [{ "internalType": "uint256[]", "name": "amounts", "type": "uint256[]" }], "stateMutability": "view", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountA", "type": "uint256" }, { "internalType": "uint256", "name": "reserveA", "type": "uint256" }, { "internalType": "uint256", "name": "reserveB", "type": "uint256" }], "name": "quote", "outputs": [{ "internalType": "uint256", "name": "amountB", "type": "uint256" }], "stateMutability": "pure", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "tokenA", "type": "address" }, { "internalType": "address", "name": "tokenB", "type": "address" }, { "internalType": "uint256", "name": "liquidity", "type": "uint256" }, { "internalType": "uint256", "name": "amountAMin", "type": "uint256" }, { "internalType": "uint256", "name": "amountBMin", "type": "uint256" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "removeLiquidity", "outputs": [{ "internalType": "uint256", "name": "amountA", "type": "uint256" }, { "internalType": "uint256", "name": "amountB", "type": "uint256" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "token", "type": "address" }, { "internalType": "uint256", "name": "liquidity", "type": "uint256" }, { "internalType": "uint256", "name": "amountTokenMin", "type": "uint256" }, { "internalType": "uint256", "name": "amountAVAXMin", "type": "uint256" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "removeLiquidityAVAX", "outputs": [{ "internalType": "uint256", "name": "amountToken", "type": "uint256" }, { "internalType": "uint256", "name": "amountAVAX", "type": "uint256" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "token", "type": "address" }, { "internalType": "uint256", "name": "liquidity", "type": "uint256" }, { "internalType": "uint256", "name": "amountTokenMin", "type": "uint256" }, { "internalType": "uint256", "name": "amountAVAXMin", "type": "uint256" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "removeLiquidityAVAXSupportingFeeOnTransferTokens", "outputs": [{ "internalType": "uint256", "name": "amountAVAX", "type": "uint256" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "token", "type": "address" }, { "internalType": "uint256", "name": "liquidity", "type": "uint256" }, { "internalType": "uint256", "name": "amountTokenMin", "type": "uint256" }, { "internalType": "uint256", "name": "amountAVAXMin", "type": "uint256" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }, { "internalType": "bool", "name": "approveMax", "type": "bool" }, { "internalType": "uint8", "name": "v", "type": "uint8" }, { "internalType": "bytes32", "name": "r", "type": "bytes32" }, { "internalType": "bytes32", "name": "s", "type": "bytes32" }], "name": "removeLiquidityAVAXWithPermit", "outputs": [{ "internalType": "uint256", "name": "amountToken", "type": "uint256" }, { "internalType": "uint256", "name": "amountAVAX", "type": "uint256" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "token", "type": "address" }, { "internalType": "uint256", "name": "liquidity", "type": "uint256" }, { "internalType": "uint256", "name": "amountTokenMin", "type": "uint256" }, { "internalType": "uint256", "name": "amountAVAXMin", "type": "uint256" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }, { "internalType": "bool", "name": "approveMax", "type": "bool" }, { "internalType": "uint8", "name": "v", "type": "uint8" }, { "internalType": "bytes32", "name": "r", "type": "bytes32" }, { "internalType": "bytes32", "name": "s", "type": "bytes32" }], "name": "removeLiquidityAVAXWithPermitSupportingFeeOnTransferTokens", "outputs": [{ "internalType": "uint256", "name": "amountAVAX", "type": "uint256" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "tokenA", "type": "address" }, { "internalType": "address", "name": "tokenB", "type": "address" }, { "internalType": "uint256", "name": "liquidity", "type": "uint256" }, { "internalType": "uint256", "name": "amountAMin", "type": "uint256" }, { "internalType": "uint256", "name": "amountBMin", "type": "uint256" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }, { "internalType": "bool", "name": "approveMax", "type": "bool" }, { "internalType": "uint8", "name": "v", "type": "uint8" }, { "internalType": "bytes32", "name": "r", "type": "bytes32" }, { "internalType": "bytes32", "name": "s", "type": "bytes32" }], "name": "removeLiquidityWithPermit", "outputs": [{ "internalType": "uint256", "name": "amountA", "type": "uint256" }, { "internalType": "uint256", "name": "amountB", "type": "uint256" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountOut", "type": "uint256" }, { "internalType": "address[]", "name": "path", "type": "address[]" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "swapAVAXForExactTokens", "outputs": [{ "internalType": "uint256[]", "name": "amounts", "type": "uint256[]" }], "stateMutability": "payable", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountOutMin", "type": "uint256" }, { "internalType": "address[]", "name": "path", "type": "address[]" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "swapExactAVAXForTokens", "outputs": [{ "internalType": "uint256[]", "name": "amounts", "type": "uint256[]" }], "stateMutability": "payable", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountOutMin", "type": "uint256" }, { "internalType": "address[]", "name": "path", "type": "address[]" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "swapExactAVAXForTokensSupportingFeeOnTransferTokens", "outputs": [], "stateMutability": "payable", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountIn", "type": "uint256" }, { "internalType": "uint256", "name": "amountOutMin", "type": "uint256" }, { "internalType": "address[]", "name": "path", "type": "address[]" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "swapExactTokensForAVAX", "outputs": [{ "internalType": "uint256[]", "name": "amounts", "type": "uint256[]" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountIn", "type": "uint256" }, { "internalType": "uint256", "name": "amountOutMin", "type": "uint256" }, { "internalType": "address[]", "name": "path", "type": "address[]" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "swapExactTokensForAVAXSupportingFeeOnTransferTokens", "outputs": [], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountIn", "type": "uint256" }, { "internalType": "uint256", "name": "amountOutMin", "type": "uint256" }, { "internalType": "address[]", "name": "path", "type": "address[]" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "swapExactTokensForTokens", "outputs": [{ "internalType": "uint256[]", "name": "amounts", "type": "uint256[]" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountIn", "type": "uint256" }, { "internalType": "uint256", "name": "amountOutMin", "type": "uint256" }, { "internalType": "address[]", "name": "path", "type": "address[]" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "swapExactTokensForTokensSupportingFeeOnTransferTokens", "outputs": [], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountOut", "type": "uint256" }, { "internalType": "uint256", "name": "amountInMax", "type": "uint256" }, { "internalType": "address[]", "name": "path", "type": "address[]" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "swapTokensForExactAVAX", "outputs": [{ "internalType": "uint256[]", "name": "amounts", "type": "uint256[]" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountOut", "type": "uint256" }, { "internalType": "uint256", "name": "amountInMax", "type": "uint256" }, { "internalType": "address[]", "name": "path", "type": "address[]" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "swapTokensForExactTokens", "outputs": [{ "internalType": "uint256[]", "name": "amounts", "type": "uint256[]" }], "stateMutability": "nonpayable", "type": "function" }, { "stateMutability": "payable", "type": "receive" }];
const zapABI = [{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousOwner","type":"address"},{"indexed":true,"internalType":"address","name":"newOwner","type":"address"}],"name":"OwnershipTransferred","type":"event"},{"inputs":[],"name":"DAI","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"JOE","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"USDT","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"WAVAX","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"_joe","type":"address"},{"internalType":"address","name":"_router","type":"address"}],"name":"initialize","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"_address","type":"address"}],"name":"isLP","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"owner","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"i","type":"uint256"}],"name":"removeToken","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"renounceOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"_address","type":"address"}],"name":"routePair","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"token","type":"address"}],"name":"setNotLP","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"asset","type":"address"},{"internalType":"address","name":"route","type":"address"}],"name":"setRoutePairAddress","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"sweep","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"","type":"uint256"}],"name":"tokens","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"newOwner","type":"address"}],"name":"transferOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"token","type":"address"}],"name":"withdraw","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"_to","type":"address"}],"name":"zapIn","outputs":[],"stateMutability":"payable","type":"function"},{"inputs":[{"internalType":"address","name":"_from","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"address","name":"_to","type":"address"}],"name":"zapInToken","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"_from","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"zapOut","outputs":[],"stateMutability":"nonpayable","type":"function"},{"stateMutability":"payable","type":"receive"}]


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

console.log("")
console.log("All tests will fail if mainnet not forked in hardhat.config.js")
console.log("Also may need to change hardhat.config.js file in the hardhat section under networks to enable forking ")
console.log("")

contract('sPREON Token Buyback Teset', async accounts => {

  const [
    owner,
    alice, bob, carol, dennis, erin, freddy, greta, harry, ida,
    A, B, C, D, E,
    whale, defaulter_1, defaulter_2, defaulter_3, defaulter_4] = accounts;

  const [bountyAddress, lpRewardsAddress, multisig] = [defaulter_1, defaulter_2, defaulter_3]


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
    const PREONContracts = await deploymentHelper.deployPREONTesterContractsHardhat(bountyAddress, lpRewardsAddress, multisig)

    joeRouter = new ethers.Contract("0x60aE616a2155Ee3d9A68541Ba4544862310933d4", abi = routerABI, signer = await hre.ethers.getSigner(harry));
    joeZap = new ethers.Contract("0x2C7B8e971c704371772eDaf16e0dB381A8D02027", abi = zapABI, signer = await hre.ethers.getSigner(harry));

    await deploymentHelper.connectPREONContracts(PREONContracts)
    await deploymentHelper.connectCoreContracts(contracts, PREONContracts)
    await deploymentHelper.connectPREONContractsToCore(PREONContracts, contracts)


    pusdToken = contracts.pusdToken
    sPreonToken = PREONContracts.sPREON
    preonToken = PREONContracts.preonToken

    await preonToken.unprotectedMint(harry, dec(100000, 18))
    await pusdToken.unprotectedMint(harry, dec(1000000, 18));
    console.log("pre preon, pusd", (await preonToken.balanceOf(harry)).toString(), (await pusdToken.balanceOf(harry)).toString())
    await pusdToken.approve(joeRouter.address, dec(1000000, 18), { from: harry })
    await preonToken.approve(joeRouter.address, dec(1000000, 18), { from: harry })
    await joeRouter.addLiquidity(pusdToken.address, preonToken.address, dec(100000, 18), dec(10000, 18), 0, 0, harry, 1737113033, { from: harry })

    console.log("post preon/pusd", (await preonToken.balanceOf(harry)).toString(), (await pusdToken.balanceOf(harry)).toString())
  })

  it("buyBack(): Reverts if buyback window not met", async () => {
    await sPreonToken.setTransferRatio(dec(1, 16));
    await preonToken.unprotectedMint(alice, toBN(dec(200, 17)))

    // Alice should get 120 sPREON Tokens at ratio of 1. 
    await preonToken.approve(sPreonToken.address, toBN(dec(200, 17)), { from: alice })
    await sPreonToken.mint(toBN(dec(120, 17)), { from: alice })

    // Check balance
    assert.equal(toBN(dec(120, 17)).toString(), (await sPreonToken.balanceOf(alice)).toString())
    assert.equal(toBN(dec(80, 17)).toString(), (await preonToken.balanceOf(alice)).toString())
    let pusdToken = contracts.pusdToken

    const amountToBuyback = toBN(dec(100, 18))
    await pusdToken.unprotectedMint(sPreonToken.address, amountToBuyback)

    let initialPUSD = await pusdToken.balanceOf(sPreonToken.address)
    let initialPREON = await preonToken.balanceOf(sPreonToken.address)
    console.log("pre balances pusd/preon", initialPUSD.toString(), initialPREON.toString())
    
    await sPreonToken.buyBack(joeRouter.address, amountToBuyback, dec(9, 18), [pusdToken.address, preonToken.address])

    // Increase time not equal to 69 hours
    await ethers.provider.send('evm_increaseTime', [22000]);
    await ethers.provider.send('evm_mine');
    await pusdToken.unprotectedMint(sPreonToken.address, amountToBuyback)
    await th.assertRevert(
      sPreonToken.buyBack(joeRouter.address, amountToBuyback, dec(9, 18), [pusdToken.address, preonToken.address]),
      "Buyback time less than 69 hours"
    )
  })

  it("rebase(): Reverts if rebase window not met", async () => {
    await sPreonToken.setTransferRatio(dec(1, 16))
    await preonToken.unprotectedMint(alice, toBN(dec(200, 17)))

    // Alice should get 120 sPREON Tokens at ratio of 1. 
    await preonToken.approve(sPreonToken.address, toBN(dec(200, 17)), { from: alice })
    await sPreonToken.mint(toBN(dec(120, 17)), { from: alice })

    // Check balance
    assert.equal(toBN(dec(120, 17)).toString(), (await sPreonToken.balanceOf(alice)).toString())
    assert.equal(toBN(dec(80, 17)).toString(), (await preonToken.balanceOf(alice)).toString())
    let pusdToken = contracts.pusdToken

    const amountToBuyback = toBN(dec(100, 18))
    await pusdToken.unprotectedMint(sPreonToken.address, amountToBuyback)

    let initialPUSD = await pusdToken.balanceOf(sPreonToken.address)
    let initialPREON = await preonToken.balanceOf(sPreonToken.address)
    console.log("pre balances pusd/preon", initialPUSD.toString(), initialPREON.toString())
    
    await sPreonToken.buyBack(joeRouter.address, amountToBuyback, dec(9, 18), [pusdToken.address, preonToken.address])
    await sPreonToken.rebase()
    // Increase time not equal to 8 hours
    await ethers.provider.send('evm_increaseTime', [2200]);
    await ethers.provider.send('evm_mine');
    await th.assertRevert(
      sPreonToken.rebase(),      
      "Buyback time less than 8 hours"
    )
  })

  it("simple sPREON token buyback", async () => {
    await preonToken.unprotectedMint(alice, toBN(dec(200, 17)))

    await preonToken.approve(sPreonToken.address, toBN(dec(200, 17)), { from: alice })
    await sPreonToken.mint(toBN(dec(120, 17)), { from: alice })

    // Check balance
    assert.equal(toBN(dec(120, 17)).toString(), (await sPreonToken.balanceOf(alice)).toString())
    assert.equal(toBN(dec(80, 17)).toString(), (await preonToken.balanceOf(alice)).toString())
    let pusdToken = contracts.pusdToken
    await pusdToken.unprotectedMint(sPreonToken.address, dec(100, 18))


    let initialPUSD = await pusdToken.balanceOf(sPreonToken.address)
    let initialPREON = await preonToken.balanceOf(sPreonToken.address)
    console.log("pre balances pusd/preon", initialPUSD.toString(), initialPREON.toString())
    await sPreonToken.buyBack(joeRouter.address, dec(100, 18), dec(9, 18), [pusdToken.address, preonToken.address])
    let finalPUSD = await pusdToken.balanceOf(sPreonToken.address)
    let finalPREON = await preonToken.balanceOf(sPreonToken.address)
    console.log("Final balances pusd/preon", finalPUSD.toString(), finalPREON.toString())
    assert.equal(initialPUSD - finalPUSD, dec(100, 18))
    assert(finalPREON - initialPREON >= dec(9, 18))
  })

  it("sPREON token buyback no stakers", async () => {

    let pusdToken = contracts.pusdToken
    await pusdToken.unprotectedMint(sPreonToken.address, dec(100, 18))


    let initialPUSD = await pusdToken.balanceOf(sPreonToken.address)
    let initialPREON = await preonToken.balanceOf(sPreonToken.address)
    console.log("pre balances pusd/preon", initialPUSD.toString(), initialPREON.toString())
    await sPreonToken.buyBack(joeRouter.address, dec(100, 18), dec(9, 18), [pusdToken.address, preonToken.address])
    let finalPUSD = await pusdToken.balanceOf(sPreonToken.address)
    let finalPREON = await preonToken.balanceOf(sPreonToken.address)
    console.log("Final balances pusd/preon", finalPUSD.toString(), finalPREON.toString())
    assert.equal(initialPUSD - finalPUSD, dec(100, 18))
    assert(finalPREON - initialPREON >= dec(9, 18))
  })

  it("simple sPREON token buyback N burn, with 100% transfer ratio. ", async () => {
    await sPreonToken.setTransferRatio(dec(1, 18))
    await preonToken.unprotectedMint(alice, toBN(dec(200, 17)))

    // Alice should get 120 sPREON Tokens at ratio of 1. 
    await preonToken.approve(sPreonToken.address, toBN(dec(200, 17)), { from: alice })
    await sPreonToken.mint(toBN(dec(120, 17)), { from: alice })
    console.log("Value before ", (await sPreonToken.balanceOf(alice)).toString())

    // Check balance
    assert.equal(toBN(dec(120, 17)).toString(), (await sPreonToken.balanceOf(alice)).toString())
    assert.equal(toBN(dec(80, 17)).toString(), (await preonToken.balanceOf(alice)).toString())
    let pusdToken = contracts.pusdToken

    const amountToBuyback = toBN(dec(100, 18))
    await pusdToken.unprotectedMint(sPreonToken.address, amountToBuyback)


    let initialPUSD = await pusdToken.balanceOf(sPreonToken.address)
    let initialPREON = await preonToken.balanceOf(sPreonToken.address)
    console.log("pre balances pusd/preon", initialPUSD.toString(), initialPREON.toString())
    
    await sPreonToken.buyBack(joeRouter.address, amountToBuyback, dec(9, 18), [pusdToken.address, preonToken.address])

    const lastBuyBackPrice = await sPreonToken.lastBuybackPrice();
    console.log("Last buyback price", lastBuyBackPrice.toString())
    const valueAddedThroughBuyback = amountToBuyback.div(lastBuyBackPrice)

    let finalPUSD = await pusdToken.balanceOf(sPreonToken.address)
    let finalPREON = await preonToken.balanceOf(sPreonToken.address)
    console.log("Final balances pusd/preon", finalPUSD.toString(), finalPREON.toString())
    assert.equal(initialPUSD - finalPUSD, dec(100, 18))
    assert(finalPREON - initialPREON >= dec(9, 18))
    // Fastforward time 69 hours
    await ethers.provider.send('evm_increaseTime', [252000]);
    await ethers.provider.send('evm_mine');
    let alicePrePREON = await preonToken.balanceOf(alice)
    await sPreonToken.rebase()
    await sPreonToken.burn(alice, toBN(dec(120, 17)), { from: alice })
    assert.equal(await preonToken.balanceOf(alice) - alicePrePREON, finalPREON.toString())
  })

  it("sPREON token buyback N burn, with 1% transfer ratio. ", async () => {
    await sPreonToken.setTransferRatio(dec(1, 16))
    await preonToken.unprotectedMint(alice, toBN(dec(200, 17)))

    // Alice should get 120 sPREON Tokens at ratio of 1. 
    await preonToken.approve(sPreonToken.address, toBN(dec(200, 17)), { from: alice })
    await sPreonToken.mint(toBN(dec(120, 17)), { from: alice })

    // Check balance
    assert.equal(toBN(dec(120, 17)).toString(), (await sPreonToken.balanceOf(alice)).toString())
    assert.equal(toBN(dec(80, 17)).toString(), (await preonToken.balanceOf(alice)).toString())
    let pusdToken = contracts.pusdToken

    const amountToBuyback = toBN(dec(100, 18))
    await pusdToken.unprotectedMint(sPreonToken.address, amountToBuyback)


    let initialPUSD = await pusdToken.balanceOf(sPreonToken.address)
    let initialPREON = await preonToken.balanceOf(sPreonToken.address)
    console.log("pre balances pusd/preon", initialPUSD.toString(), initialPREON.toString())
    
    await sPreonToken.buyBack(joeRouter.address, amountToBuyback, dec(9, 18), [pusdToken.address, preonToken.address])

    const lastBuyBackPrice = await sPreonToken.lastBuybackPrice();
    const valueAddedThroughBuyback = amountToBuyback.mul(toBN(dec(1, 18))).div(lastBuyBackPrice)

    let finalPUSD = await pusdToken.balanceOf(sPreonToken.address)
    let finalPREON = await preonToken.balanceOf(sPreonToken.address)
    assert.equal(initialPUSD - finalPUSD, dec(100, 18))
    assert(finalPREON - initialPREON >= dec(9, 18))
    // Fastforward time 69 hours
    await ethers.provider.send('evm_increaseTime', [252000]);
    await ethers.provider.send('evm_mine');
    let alicePrePREON = await preonToken.balanceOf(alice)
    await sPreonToken.rebase()
    await sPreonToken.burn(alice, toBN(dec(120, 17)), { from: alice })
    await th.assertIsApproximatelyEqual(
      await preonToken.balanceOf(alice) - alicePrePREON, 
      toBN(dec(120, 17)).add(valueAddedThroughBuyback.div(toBN(dec(100, 0)))).toString(), 
      10000
    )
  })

  it("Same buyback test as above, check to see if PUSD + PREON value taken into account", async () => {
    await sPreonToken.setTransferRatio(dec(1, 16))
    await preonToken.unprotectedMint(alice, toBN(dec(200, 17)))

    // Alice should get 120 sPREON Tokens at ratio of 1. 
    await preonToken.approve(sPreonToken.address, toBN(dec(200, 17)), { from: alice })
    await sPreonToken.mint(toBN(dec(120, 17)), { from: alice })

    // Check balance
    assert.equal(toBN(dec(120, 17)).toString(), (await sPreonToken.balanceOf(alice)).toString())
    assert.equal(toBN(dec(80, 17)).toString(), (await preonToken.balanceOf(alice)).toString())
    let pusdToken = contracts.pusdToken

    const amountToBuyback = toBN(dec(50, 18))
    await pusdToken.unprotectedMint(sPreonToken.address, amountToBuyback)


    let initialPUSD = await pusdToken.balanceOf(sPreonToken.address)
    let initialPREON = await preonToken.balanceOf(sPreonToken.address)
    console.log("pre balances pusd/preon", initialPUSD.toString(), initialPREON.toString())
    
    await sPreonToken.buyBack(joeRouter.address, amountToBuyback, dec(4, 18), [pusdToken.address, preonToken.address])

    const lastBuyBackPrice = await sPreonToken.lastBuybackPrice();
    // as if 100 (final value) is added
    const valueAddedThroughBuyback = amountToBuyback.mul(toBN(dec(2, 18))).div(lastBuyBackPrice)

    let finalPUSD = await pusdToken.balanceOf(sPreonToken.address)
    let finalPREON = await preonToken.balanceOf(sPreonToken.address)
    assert.equal(initialPUSD - finalPUSD, dec(50, 18))
    assert(finalPREON - initialPREON >= dec(4, 18))
    // Fastforward time 69 hours
    await ethers.provider.send('evm_increaseTime', [252000]);
    await ethers.provider.send('evm_mine');
    let alicePrePREON = await preonToken.balanceOf(alice)
    await pusdToken.unprotectedMint(sPreonToken.address, amountToBuyback)
    await sPreonToken.rebase()
    await sPreonToken.burn(alice, toBN(dec(120, 17)), { from: alice })
    await th.assertIsApproximatelyEqual(
      await preonToken.balanceOf(alice) - alicePrePREON, 
      toBN(dec(120, 17)).add(valueAddedThroughBuyback.div(toBN(dec(100, 0)))).toString(), 
      10000
    )
  })

  it("sPREON token buyback N burn, with 1% transfer ratio. Multiple rebases, with ratio change in between.", async () => {
    await sPreonToken.setTransferRatio(dec(1, 16))
    await preonToken.unprotectedMint(alice, toBN(dec(200, 17)))

    // Alice should get 120 sPREON Tokens at ratio of 1. 
    await preonToken.approve(sPreonToken.address, toBN(dec(200, 17)), { from: alice })
    await sPreonToken.mint(toBN(dec(120, 17)), { from: alice })

    // Check balance
    assert.equal(toBN(dec(120, 17)).toString(), (await sPreonToken.balanceOf(alice)).toString())
    assert.equal(toBN(dec(80, 17)).toString(), (await preonToken.balanceOf(alice)).toString())
    let pusdToken = contracts.pusdToken

    const amountToBuyback = toBN(dec(100, 18))
    await pusdToken.unprotectedMint(sPreonToken.address, amountToBuyback)


    let initialPUSD = await pusdToken.balanceOf(sPreonToken.address)
    let initialPREON = await preonToken.balanceOf(sPreonToken.address)
    console.log("pre balances pusd/preon", initialPUSD.toString(), initialPREON.toString())
    
    await sPreonToken.buyBack(joeRouter.address, amountToBuyback, dec(9, 18), [pusdToken.address, preonToken.address])

    const lastBuyBackPrice = await sPreonToken.lastBuybackPrice();
    const valueAddedThroughBuyback = amountToBuyback.mul(toBN(dec(1, 18))).div(lastBuyBackPrice)

    let finalPUSD = await pusdToken.balanceOf(sPreonToken.address)
    let finalPREON = await preonToken.balanceOf(sPreonToken.address)
    assert.equal(initialPUSD - finalPUSD, dec(100, 18))
    assert(finalPREON - initialPREON >= dec(9, 18))
    // Fastforward time 69 hours
    await ethers.provider.send('evm_increaseTime', [252000]);
    await ethers.provider.send('evm_mine');
    let alicePrePREON = await preonToken.balanceOf(alice)
    await sPreonToken.rebase()

    await ethers.provider.send('evm_increaseTime', [252000]);
    await ethers.provider.send('evm_mine');
    await sPreonToken.rebase()

    await sPreonToken.setTransferRatio(dec(2, 16))

    await ethers.provider.send('evm_increaseTime', [252000]);
    await ethers.provider.send('evm_mine');
    await sPreonToken.rebase()
    await sPreonToken.burn(alice, toBN(dec(120, 17)), { from: alice })

    const onePercent = valueAddedThroughBuyback.div(toBN(dec(100, 0)))
    const valueAddedThroughBuyback2 = (valueAddedThroughBuyback.mul(toBN(dec(99, 0))).div(toBN(dec(100, 0))))
    const oneOnePercent = valueAddedThroughBuyback2.div(toBN(dec(100, 0)))
    const valueAddedThroughBuyback3 = (valueAddedThroughBuyback2.mul(toBN(dec(99, 0))).div(toBN(dec(100, 0))))
    const oneOneTwoPercent = valueAddedThroughBuyback3.div(toBN(dec(50, 0)))

    await th.assertIsApproximatelyEqual(
      await preonToken.balanceOf(alice) - alicePrePREON, 
      toBN(dec(120, 17)).add(onePercent.add(oneOnePercent).add(oneOneTwoPercent)).toString(), 
      10000
    )
  })

  it("sPREON token buyback N burn, with 1% transfer ratio. Alice gets reward 1 and 2, Bob gets reward 2.", async () => {
    await sPreonToken.setTransferRatio(dec(1, 16))
    await preonToken.unprotectedMint(alice, toBN(dec(200, 17)))

    // Alice should get 120 sPREON Tokens at ratio of 1. 
    await preonToken.approve(sPreonToken.address, toBN(dec(200, 17)), { from: alice })
    await sPreonToken.mint(toBN(dec(120, 17)), { from: alice })

    // Check balance
    assert.equal(toBN(dec(120, 17)).toString(), (await sPreonToken.balanceOf(alice)).toString())
    assert.equal(toBN(dec(80, 17)).toString(), (await preonToken.balanceOf(alice)).toString())
    let pusdToken = contracts.pusdToken

    const amountToBuyback = toBN(dec(100, 18))
    await pusdToken.unprotectedMint(sPreonToken.address, amountToBuyback)


    let initialPUSD = await pusdToken.balanceOf(sPreonToken.address)
    let initialPREON = await preonToken.balanceOf(sPreonToken.address)
    console.log("pre balances pusd/preon", initialPUSD.toString(), initialPREON.toString())
    
    await sPreonToken.buyBack(joeRouter.address, amountToBuyback, dec(9, 18), [pusdToken.address, preonToken.address])

    const lastBuyBackPrice = await sPreonToken.lastBuybackPrice();
    const valueAddedThroughBuyback = amountToBuyback.mul(toBN(dec(1, 18))).div(lastBuyBackPrice)

    let finalPUSD = await pusdToken.balanceOf(sPreonToken.address)
    let finalPREON = await preonToken.balanceOf(sPreonToken.address)
    assert.equal(initialPUSD - finalPUSD, dec(100, 18))
    assert(finalPREON - initialPREON >= dec(9, 18))
    // Fastforward time 69 hours
    await ethers.provider.send('evm_increaseTime', [252000]);
    await ethers.provider.send('evm_mine');
    let alicePrePREON = await preonToken.balanceOf(alice)
    await sPreonToken.rebase()

    // Bob should get rebase 2
    await preonToken.unprotectedMint(bob, toBN(dec(200, 17)))
    await preonToken.approve(sPreonToken.address, toBN(dec(200, 17)), { from: bob })
    await sPreonToken.mint(toBN(dec(120, 17)), { from: bob })

    await ethers.provider.send('evm_increaseTime', [252000]);
    await ethers.provider.send('evm_mine');
    const bobPrePREON = await preonToken.balanceOf(bob)
    await sPreonToken.rebase()

    const alicesPREONBalance = await sPreonToken.balanceOf(alice)
    const bobsPREONBalance = await sPreonToken.balanceOf(bob) // did not mint 120 bc alice rebase increased ratio

    await sPreonToken.burn(alice, alicesPREONBalance, { from: alice })
    await sPreonToken.burn(bob, bobsPREONBalance, { from: bob })

    const onePercent = valueAddedThroughBuyback.div(toBN(dec(100, 0)))
    const valueAddedThroughBuyback2 = (valueAddedThroughBuyback.mul(toBN(dec(99, 0))).div(toBN(dec(100, 0))))//.add(toBN(dec(120, 17)))
    // 1 % / 2 = .5% for each alice and bob. But this is probably not right because alice has more stake now? // TODO 
    const denom = alicesPREONBalance.add(bobsPREONBalance)
    
    const oneOnePercent = valueAddedThroughBuyback2.div(toBN(dec(100, 0)))
    const aliceSecondOnePercent = oneOnePercent.mul(alicesPREONBalance).div(denom)
    const bobSecondOnePercent = oneOnePercent.mul(bobsPREONBalance).div(denom)
    const aliceFinalPREONDiff = await preonToken.balanceOf(alice) - alicePrePREON
    const bobFinalPREONDiff = await preonToken.balanceOf(bob) - bobPrePREON

    await th.assertIsApproximatelyEqual(
      aliceFinalPREONDiff, 
      toBN(dec(120, 17)).add(onePercent.add(aliceSecondOnePercent)).toString(), 
      10000
    )

    await th.assertIsApproximatelyEqual(
      bobFinalPREONDiff, 
      toBN(dec(120, 17)).add(bobSecondOnePercent).toString(), 
      10000
    )

    // re-minting resets ratio level to 1, aka 120 in = 120 out
    await preonToken.approve(sPreonToken.address, toBN(dec(200, 17)), { from: bob })
    await sPreonToken.mint(toBN(dec(120, 17)), { from: bob })
    const bobsPREONBalanceAfter = await sPreonToken.balanceOf(bob)
    assert.equal(bobsPREONBalanceAfter.toString(), toBN(dec(120, 17)).toString())

  })

})
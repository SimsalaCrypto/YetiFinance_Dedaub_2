const SortedTroves = artifacts.require("./SortedTroves.sol")
const TroveManager = artifacts.require("./TroveManager.sol")
const TroveManagerLiquidations = artifacts.require("./TroveManagerLiquidations.sol")
const TroveManagerRedemptions = artifacts.require("./TroveManagerRedemptions.sol")
const PriceFeedTestnet = artifacts.require("./PriceFeedTestnet.sol")
// const PriceFeedTestnetAVAX = artifacts.require("./PriceFeedTestnet.sol")
// const PriceFeedTestnetETH = artifacts.require("./PriceFeedTestnet.sol")

const PUSDToken = artifacts.require("./PUSDToken.sol")
const ActivePool = artifacts.require("./ActivePool.sol");
const DefaultPool = artifacts.require("./DefaultPool.sol");
const StabilityPool = artifacts.require("./StabilityPool.sol")
const GasPool = artifacts.require("./GasPool.sol")
const CollSurplusPool = artifacts.require("./CollSurplusPool.sol")
const FunctionCaller = artifacts.require("./TestContracts/FunctionCaller.sol")
const BorrowerOperations = artifacts.require("./BorrowerOperations.sol")
const HintHelpers = artifacts.require("./HintHelpers.sol")
const Whitelist = artifacts.require("./Whitelist.sol")

const TeamAllocation = artifacts.require("./TeamAllocation.sol")

// const ERC20TokenETH = artifacts.require("./TestContracts/TestAssets/ERC20Token.sol")
// const ERC20TokenAVAX = artifacts.require("./TestContracts/TestAssets/ERC20Token.sol")
// const ERC20TokenBTC = artifacts.require("./TestContracts/TestAssets/ERC20Token.sol")

const ERC20Token = artifacts.require("./TestContracts/TestAssets/ERC20Token.sol")
// const WJLP = artifacts.require("./WJLP.sol")

const LinearPriceCurve = artifacts.require("./PriceCurves/ThreePieceWiseLinearPriceCurve.sol");
const ERC20Router = artifacts.require("./Routers/ERC20Router.sol")

const SPREON = artifacts.require("./sPREONToken.sol")
const SPREONTester = artifacts.require("./sPREONTokenTester.sol")
const PREONToken = artifacts.require("./PREONToken.sol"); // @Simsala: changed to Preon token
const LockupContractFactory = artifacts.require("./LockupContractFactory.sol")
const CommunityIssuance = artifacts.require("./CommunityIssuance.sol")
const PreonFinanceTreasury = artifacts.require("./PreonFinanceTreasury.sol")

const Unipool =  artifacts.require("./Unipool.sol")

const WJLP = artifacts.require("./AssetWrappers/WJLP.sol");
const WBQI = artifacts.require("./AssetWrappers/WBQI.sol");
const WAAVE = artifacts.require("./AssetWrappers/WAAVE.sol");
const WCRV = artifacts.require("./AssetWrappers/WCRV.sol");

const PREONTokenTester = artifacts.require("./PREONTokenTester.sol")
const CommunityIssuanceTester = artifacts.require("./CommunityIssuanceTester.sol")
const StabilityPoolTester = artifacts.require("./StabilityPoolTester.sol")
const ActivePoolTester = artifacts.require("./ActivePoolTester.sol")
const DefaultPoolTester = artifacts.require("./DefaultPoolTester.sol")
const LiquityMathTester = artifacts.require("./LiquityMathTester.sol")
const BorrowerOperationsTester = artifacts.require("./BorrowerOperationsTester.sol")
const TroveManagerTester = artifacts.require("./TroveManagerTester.sol")
const PUSDTokenTester = artifacts.require("./PUSDTokenTester.sol")

// Proxy scripts
const BorrowerOperationsScript = artifacts.require('BorrowerOperationsScript')
const BorrowerWrappersScript = artifacts.require('BorrowerWrappersScript')
const TroveManagerScript = artifacts.require('TroveManagerScript')
const StabilityPoolScript = artifacts.require('StabilityPoolScript')
const TokenScript = artifacts.require('TokenScript')
const SPREONScript = artifacts.require('SPREONScript')

// const { artifacts } = require('hardhat')
const { contractSizer } = require('../hardhat.config.js')
const {
  buildUserProxies,
  BorrowerOperationsProxy,
  BorrowerWrappersProxy,
  TroveManagerProxy,
  StabilityPoolProxy,
  SortedTrovesProxy,
  TokenProxy,
  SPREONProxy
} = require('../utils/proxyHelpers.js')

/* "Liquity core" consists of all contracts in the core Liquity system.

PREON contracts consist of only those contracts related to the PREON Token:

-the PREON token
-the Lockup factory and lockup contracts
-the sPREON contract
-the CommunityIssuance contract 
*/

const ZERO_ADDRESS = '0x' + '0'.repeat(40)
const maxBytes32 = '0x' + 'f'.repeat(64)

class DeploymentHelper {

  static async deployAssetWrappers() {
    const wJLP_WETH_WAVAX = await WJLP.new(
          "wJLP_WETH_WAVAX",
          "Wrapped JLP WETH WAVAX",
          18,
          "0xfe15c2695f1f920da45c30aae47d11de51007af9", // WETH-WAVAX JLP Address
          "0x6e84a6216ea6dacc71ee8e6b0a5b7322eebc0fdd", // JOE
          // "0x2C7B8e971c704371772eDaf16e0dB381A8D02027", // Zap
          "0xd6a4F121CA35509aF06A0Be99093d08462f53052", // MasterChef
          26 // pid
        )
    const wBQI_WAVAX = await WBQI.new(
          "wBQI_AVAX",
          "Wrapped qiAVAX",
          18,
          "0x5C0401e81Bc07Ca70fAD469b451682c0d747Ef1c", //qiAVAX
          "0x8729438EB15e2C8B576fCc6AeCdA6A148776C0F5", //QI
          '0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4'//Comptroller
        )
    const wAAVE_WAVAX = await WAAVE.new(
          "wAAVE_aWAVAX",
          "Wrapped aWAVAX",
          18,
          "0xDFE521292EcE2A4f44242efBcD66Bc594CA9714B",
        )
    const wCRV_3crv = await WCRV.new(
          "wCRV_3crv",
          "Wrapped 3crv",
          18,
          "0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664", //USDC.e is the swapoutput
          "0x7f90122BF0700F9E7e1F688fe926940E8839F353", //3CRV pool
          "0x1337BedC9D22ecbe766dF105c9623922A27963EC", //3CRV token
          // reward tokens and corresponding routing to get from token -> usdc.e
          [{"token":"0x47536F17F4fF30e64A96a7555826b8f9e66ec468", "swapPath":["0x47536F17F4fF30e64A96a7555826b8f9e66ec468","0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", "0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664"], "minAmt":"100000000000000000"}, 
          {"token":"0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", "swapPath":["0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", "0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664"], "minAmt":"100000000000000000"}],
          "0x5B5CFE992AdAC0C9D48E05854B2d91C73a003858", //CRV gauge address
          "0x60aE616a2155Ee3d9A68541Ba4544862310933d4", //Joerouter
          3, //3 coins in 3crv
          1, //USDC is index 1
        )
    const WRAPPERS={
      wJLP_WETH_WAVAX,
      wBQI_WAVAX,
      wAAVE_WAVAX,
      wCRV_3crv
    }
    return WRAPPERS
  }

  // static async deployAssetWrappersHardhat() {
  //   const wJLP_WETH_WAVAX = await WJLP.new(
  //     "wJLP_WETH_WAVAX",
  //     "Wrapped JLP WETH WAVAX",
  //     18,
  //     "0xfe15c2695f1f920da45c30aae47d11de51007af9", // WETH-WAVAX JLP Address
  //     "0x6e84a6216ea6dacc71ee8e6b0a5b7322eebc0fdd", // JOE
  //     // "0x2C7B8e971c704371772eDaf16e0dB381A8D02027", // Zap
  //     "0xd6a4F121CA35509aF06A0Be99093d08462f53052", // MasterChef
  //     26 // pid
  //   )
  //   return wJLP_WETH_WAVAX
    
  // }

  static async deployLiquityCore() {
    const cmdLineArgs = process.argv
    const frameworkPath = cmdLineArgs[1]

    if (frameworkPath.includes("hardhat")) {
      return this.deployLiquityCoreHardhat()
    } else if (frameworkPath.includes("truffle")) {
      return this.deployLiquityCoreTruffle()
    }
  }

  static async deployPREONContracts(bountyAddress, lpRewardsAddress, multisigAddress) {
    const cmdLineArgs = process.argv
    const frameworkPath = cmdLineArgs[1]
    // console.log(`Framework used:  ${frameworkPath}`)

    if (frameworkPath.includes("hardhat")) {
      return this.deployPREONContractsHardhat(
        bountyAddress,
        lpRewardsAddress,
        multisigAddress
      )
    } else if (frameworkPath.includes("truffle")) {
      return this.deployPREONContractsTruffle(bountyAddress, lpRewardsAddress, multisigAddress)
    }
  }

  static async deployPREONRightNow(sPREONAddress) {
    const preonFinanceTreasury = await PreonFinanceTreasury.new()
    const teamAllocation = await TeamAllocation.new();
    const preonToken = await PREONToken.new(
      sPREONAddress,
      preonFinanceTreasury.address,
      teamAllocation.address
    );

    return {
      preonFinanceTreasury,
      teamAllocation,
      preonToken
    }
  }

  static async deployLiquityCoreHardhat() {
    //const priceFeedTestnet = await PriceFeedTestnet.new()
    const sortedTroves = await SortedTroves.new()
    const troveManager = await TroveManager.new()
    const troveManagerLiquidations = await TroveManagerLiquidations.new()
    const troveManagerRedemptions = await TroveManagerRedemptions.new()
    const activePool = await ActivePool.new()
    const stabilityPool = await StabilityPool.new()
    const gasPool = await GasPool.new()
    const defaultPool = await DefaultPool.new()
    const collSurplusPool = await CollSurplusPool.new()
    const functionCaller = await FunctionCaller.new()
    const borrowerOperations = await BorrowerOperations.new()
    const hintHelpers = await HintHelpers.new()
    const pusdToken = await PUSDToken.new(
      troveManager.address,
      troveManagerLiquidations.address,
      troveManagerRedemptions.address,
      stabilityPool.address,
      borrowerOperations.address
    )
    const whitelist = await Whitelist.new()
    // const wJLP = await WJLP.new();

    
    const weth = await ERC20Token.new("WETH", "Wrapped Ether", 18)
    // ERC20TokenETH.setAsDeployed(weth);

    const wavax = await ERC20Token.new("WAVAX", "Wrapped AVAX", 18)
    // ERC20TokenAVAX.setAsDeployed(wavax);

    const wbtc = await ERC20Token.new("WBTC", "Wrapped Bitcoin", 18);
    // ERC20TokenBTC.setAsDeployed(wbtc);

    const dec8 = await ERC20Token.new("DEC8", "Token With 8DEC", 8);

    const JLP = await ERC20Token.new("JLP", "JLP", 18)

    const wJLP = await WJLP.new(
      "wJLP_WETH_WAVAX",
      "Wrapped JLP WETH WAVAX",
      18,
      "0xFE15c2695F1F920da45C30AAE47d11dE51007AF9", // WETH-WAVAX JLP Address
      "0x6e84a6216ea6dacc71ee8e6b0a5b7322eebc0fdd", // JOE
      "0xd6a4F121CA35509aF06A0Be99093d08462f53052", // MasterChef
      26 // pid
    )

    const priceFeedDEC8 = await PriceFeedTestnet.new();

    const priceFeedAVAX = await PriceFeedTestnet.new();
    // PriceFeedTestnetAVAX.setAsDeployed(priceFeedAVAX);

    const priceFeedETH = await PriceFeedTestnet.new();

    const priceFeedJLP = await PriceFeedTestnet.new();

    // PriceFeedTestnetETH.setAsDeployed(priceFeedETH);

    const PriceCurveDEC8 = await LinearPriceCurve.new();

    const PriceCurveAVAX = await LinearPriceCurve.new();
    // PriceCurveLiquidAVAX.setAsDeployed(PriceCurveAVAX);

    const PriceCurveETH = await LinearPriceCurve.new();

    const PriceCurveJLP = await LinearPriceCurve.new();

    // PriceCurveLiquidETH.setAsDeployed(PriceCurveETH);
    WJLP.setAsDeployed(wJLP)
    Whitelist.setAsDeployed(whitelist)
    PUSDToken.setAsDeployed(pusdToken)
    DefaultPool.setAsDeployed(defaultPool)
    // PriceFeedTestnet.setAsDeployed(priceFeedTestnet)
    SortedTroves.setAsDeployed(sortedTroves)
    TroveManager.setAsDeployed(troveManager)
    TroveManagerLiquidations.setAsDeployed(troveManagerLiquidations)
    TroveManagerRedemptions.setAsDeployed(troveManagerRedemptions)
    ActivePool.setAsDeployed(activePool)
    StabilityPool.setAsDeployed(stabilityPool)
    GasPool.setAsDeployed(gasPool)
    CollSurplusPool.setAsDeployed(collSurplusPool)
    FunctionCaller.setAsDeployed(functionCaller)
    BorrowerOperations.setAsDeployed(borrowerOperations)
    HintHelpers.setAsDeployed(hintHelpers)

    const coreContracts = {
      priceFeedAVAX,
      priceFeedETH,
      priceFeedDEC8,
      priceFeedJLP,
      pusdToken,
      sortedTroves,
      troveManager,
      activePool,
      stabilityPool,
      gasPool,
      defaultPool,
      collSurplusPool,
      functionCaller,
      borrowerOperations,
      hintHelpers, 
      whitelist, 
      weth,
      wavax,
      wbtc,
      dec8,
      JLP,
      PriceCurveAVAX,
      PriceCurveETH,
      PriceCurveDEC8,
      PriceCurveJLP,
      troveManagerLiquidations, 
      troveManagerRedemptions, 
      wJLP
    }
    return coreContracts
  }

  static async deployTesterContractsHardhat() {
    const testerContracts = {}

    // Contract without testers (yet)
    testerContracts.priceFeedTestnet = await PriceFeedTestnet.new()
    testerContracts.sortedTroves = await SortedTroves.new()
    testerContracts.whitelist = await Whitelist.new()
    // Actual tester contracts
    testerContracts.communityIssuance = await CommunityIssuanceTester.new()
    testerContracts.activePool = await ActivePoolTester.new()
    testerContracts.defaultPool = await DefaultPoolTester.new()
    testerContracts.stabilityPool = await StabilityPoolTester.new()
    testerContracts.gasPool = await GasPool.new()
    testerContracts.collSurplusPool = await CollSurplusPool.new()
    testerContracts.math = await LiquityMathTester.new()
    testerContracts.borrowerOperations = await BorrowerOperationsTester.new()
    testerContracts.troveManager = await TroveManagerTester.new()
    testerContracts.functionCaller = await FunctionCaller.new()
    testerContracts.hintHelpers = await HintHelpers.new()
    testerContracts.troveManagerLiquidations = await TroveManagerLiquidations.new()
    testerContracts.troveManagerRedemptions = await TroveManagerRedemptions.new()
    testerContracts.pusdToken =  await PUSDTokenTester.new(
      testerContracts.troveManager.address,
      testerContracts.troveManagerLiquidations.address,
      testerContracts.troveManagerRedemptions.address,
      testerContracts.stabilityPool.address,
      testerContracts.borrowerOperations.address
    )
    testerContracts.whitelist = await Whitelist.new()

    testerContracts.weth = await ERC20Token.new("WETH", "Wrapped Ether", 18)

    testerContracts.wavax = await ERC20Token.new("WAVAX", "Wrapped AVAX", 18)

    testerContracts.wbtc = await ERC20Token.new("WBTC", "Wrapped Bitcoin", 18);
    // ERC20TokenBTC.setAsDeployed(wbtc);

    testerContracts.priceFeedAVAX = await PriceFeedTestnet.new();
    // PriceFeedTestnetAVAX.setAsDeployed(priceFeedAVAX);

    testerContracts.priceFeedETH = await PriceFeedTestnet.new();
    // PriceFeedTestnetETH.setAsDeployed(priceFeedETH);

    testerContracts.PriceCurveAVAX = await LinearPriceCurve.new();
    // PriceCurveLiquidAVAX.setAsDeployed(PriceCurveAVAX);

    testerContracts.PriceCurveETH = await LinearPriceCurve.new();

    testerContracts.priceCurveJLP = await LinearPriceCurve.new();

    return testerContracts
  }

  static async deployPREONContractsHardhat() {
    const sPREON = await SPREON.new()
    const lockupContractFactory = await LockupContractFactory.new()
    const communityIssuance = await CommunityIssuance.new()
    const preonFinanceTreasury =  await PreonFinanceTreasury.new();
    
    SPREON.setAsDeployed(sPREON)
    LockupContractFactory.setAsDeployed(lockupContractFactory)
    CommunityIssuance.setAsDeployed(communityIssuance)
    PreonFinanceTreasury.setAsDeployed(preonFinanceTreasury)

    // Deploy PREON Token, passing Community Issuance and Factory addresses to the constructor
    const preonToken = await PREONToken.new(
      sPREON.address,
      communityIssuance.address,
      communityIssuance.address
    )

    PREONToken.setAsDeployed(preonToken)

    const PREONContracts = {
      sPREON,
      lockupContractFactory,
      communityIssuance,
      preonToken,
      preonFinanceTreasury
    }
    return PREONContracts
  }

  static async deployPREONTesterContractsHardhat() {
    const sPREON = await SPREONTester.new()
    const lockupContractFactory = await LockupContractFactory.new()
    const communityIssuance = await CommunityIssuanceTester.new()
    const preonFinanceTreasury =  await PreonFinanceTreasury.new();

    SPREONTester.setAsDeployed(sPREON)
    LockupContractFactory.setAsDeployed(lockupContractFactory)
    CommunityIssuanceTester.setAsDeployed(communityIssuance)
    PreonFinanceTreasury.setAsDeployed(preonFinanceTreasury)

    // Deploy PREON Token, passing Community Issuance and Factory addresses to the constructor
    const preonToken = await PREONTokenTester.new(
      sPREON.address,
      preonFinanceTreasury.address,
      communityIssuance.address
    )
    PREONTokenTester.setAsDeployed(preonToken)

    const PREONContracts = {
      sPREON,
      lockupContractFactory,
      communityIssuance,
      preonToken,
      preonFinanceTreasury
    }
    return PREONContracts
  }

  static async deployLiquityCoreTruffle() {
    const priceFeedTestnet = await PriceFeedTestnet.new()
    const sortedTroves = await SortedTroves.new()
    const troveManager = await TroveManager.new()
    const activePool = await ActivePool.new()
    const stabilityPool = await StabilityPool.new()
    const gasPool = await GasPool.new()
    const defaultPool = await DefaultPool.new()
    const collSurplusPool = await CollSurplusPool.new()
    const functionCaller = await FunctionCaller.new()
    const borrowerOperations = await BorrowerOperations.new()
    const hintHelpers = await HintHelpers.new()
    const pusdToken = await PUSDToken.new(
      troveManager.address,
      stabilityPool.address,
      borrowerOperations.address
    )
    const coreContracts = {
      priceFeedTestnet,
      pusdToken,
      sortedTroves,
      troveManager,
      activePool,
      stabilityPool,
      gasPool,
      defaultPool,
      collSurplusPool,
      functionCaller,
      borrowerOperations,
      hintHelpers
    }
    return coreContracts
  }

  static async deployPREONContractsTruffle(bountyAddress, lpRewardsAddress, multisigAddress, preonTokenAddress, pusdTokenAddress) {
    const sPREON = await sPREON.new(preonTokenAddress, pusdTokenAddress)
    const lockupContractFactory = await LockupContractFactory.new()
    const communityIssuance = await CommunityIssuance.new()

    /* Deploy PREON Token, passing Community Issuance,  sPREON, and Factory addresses
    to the constructor  */
    const preonToken = await PREONToken.new(
      sPREON.address,
      communityIssuance.address,
      communityIssuance.address
    )

    const PREONContracts = {
      sPREON,
      lockupContractFactory,
      communityIssuance,
      preonToken
    }
    return PREONContracts
  }

  static async deployPUSDToken(contracts) {
    contracts.pusdToken = await PUSDToken.new(
        contracts.troveManager.address,
        contracts.troveManagerLiquidations.address,
        contracts.troveManagerRedemptions.address,
        contracts.stabilityPool.address,
        contracts.borrowerOperations.address
    )
    return contracts
  }

  static async deployPUSDTokenTester(contracts) {
    contracts.pusdToken = await PUSDTokenTester.new(
      contracts.troveManager.address,
      contracts.troveManagerLiquidations.address,
      contracts.troveManagerRedemptions.address,
      contracts.stabilityPool.address,
      contracts.borrowerOperations.address
    )
    return contracts
  }

  static async deployProxyScripts(contracts, PREONContracts, owner, users) {
    const proxies = await buildUserProxies(users)

    const borrowerWrappersScript = await BorrowerWrappersScript.new(
      contracts.borrowerOperations.address,
      contracts.troveManager.address,
      PREONContracts.sPREON.address
    )
    contracts.borrowerWrappers = new BorrowerWrappersProxy(owner, proxies, borrowerWrappersScript.address)

    const borrowerOperationsScript = await BorrowerOperationsScript.new(contracts.borrowerOperations.address)
    contracts.borrowerOperations = new BorrowerOperationsProxy(owner, proxies, borrowerOperationsScript.address, contracts.borrowerOperations)

    const troveManagerScript = await TroveManagerScript.new(contracts.troveManager.address)
    contracts.troveManager = new TroveManagerProxy(owner, proxies, troveManagerScript.address, contracts.troveManager)

    const stabilityPoolScript = await StabilityPoolScript.new(contracts.stabilityPool.address)
    contracts.stabilityPool = new StabilityPoolProxy(owner, proxies, stabilityPoolScript.address, contracts.stabilityPool)

    contracts.sortedTroves = new SortedTrovesProxy(owner, proxies, contracts.sortedTroves)

    const pusdTokenScript = await TokenScript.new(contracts.pusdToken.address)
    contracts.pusdToken = new TokenProxy(owner, proxies, pusdTokenScript.address, contracts.pusdToken)

    const preonTokenScript = await TokenScript.new(PREONContracts.preonToken.address)
    PREONContracts.preonToken = new TokenProxy(owner, proxies, preonTokenScript.address, PREONContracts.preonToken)

    const sPREONScript = await SPREONScript.new(PREONContracts.sPREON.address)
    PREONContracts.sPREON = new SPREONProxy(owner, proxies, sPREONScript.address, PREONContracts.sPREON)
  }

  // Connect contracts to their dependencies
  static async connectCoreContracts(contracts, PREONContracts) {
    // set TroveManager addr in SortedTroves
    await contracts.sortedTroves.setParams(
      maxBytes32,
      contracts.troveManager.address,
      contracts.borrowerOperations.address, 
      contracts.troveManagerRedemptions.address
    )

    // set contract addresses in the FunctionCaller 
    await contracts.functionCaller.setTroveManagerAddress(contracts.troveManager.address)
    await contracts.functionCaller.setSortedTrovesAddress(contracts.sortedTroves.address)

    // set contracts in the Trove Manager
    await contracts.troveManager.setAddresses(
      contracts.borrowerOperations.address,
      contracts.activePool.address,
      contracts.defaultPool.address,
      contracts.stabilityPool.address,
      contracts.gasPool.address,
      contracts.collSurplusPool.address,
      contracts.pusdToken.address,
      contracts.sortedTroves.address,
      PREONContracts.preonToken.address,
      PREONContracts.sPREON.address,
      contracts.whitelist.address,
      contracts.troveManagerRedemptions.address,
      contracts.troveManagerLiquidations.address,
    )

    await contracts.troveManagerRedemptions.setAddresses(
      contracts.borrowerOperations.address,
      contracts.activePool.address,
      contracts.defaultPool.address,
      contracts.stabilityPool.address,
      contracts.gasPool.address,
      contracts.collSurplusPool.address,
      contracts.pusdToken.address,
      contracts.sortedTroves.address,
      PREONContracts.preonToken.address,
      PREONContracts.sPREON.address,
      contracts.whitelist.address,
      contracts.troveManager.address
    )

    await contracts.troveManagerLiquidations.setAddresses(
      contracts.borrowerOperations.address,
      contracts.activePool.address,
      contracts.defaultPool.address,
      contracts.stabilityPool.address,
      contracts.gasPool.address,
      contracts.collSurplusPool.address,
      contracts.pusdToken.address,
      contracts.sortedTroves.address,
      PREONContracts.preonToken.address,
      PREONContracts.sPREON.address,
      contracts.whitelist.address,
      contracts.troveManager.address,
      PREONContracts.preonFinanceTreasury.address
    )

    // set contracts in BorrowerOperations 
    await contracts.borrowerOperations.setAddresses(
      contracts.troveManager.address,
      contracts.activePool.address,
      contracts.defaultPool.address,
      contracts.stabilityPool.address,
      contracts.gasPool.address,
      contracts.collSurplusPool.address,
      contracts.sortedTroves.address,
      contracts.pusdToken.address,
      PREONContracts.sPREON.address,
      contracts.whitelist.address
    )

    // set contracts in the Pools
    await contracts.stabilityPool.setAddresses(
      contracts.borrowerOperations.address,
      contracts.troveManager.address,
      contracts.activePool.address,
      contracts.pusdToken.address,
      contracts.sortedTroves.address,
      PREONContracts.communityIssuance.address,
      contracts.whitelist.address,
      contracts.troveManagerLiquidations.address
    )

    await contracts.activePool.setAddresses(
      contracts.borrowerOperations.address,
      contracts.troveManager.address,
      contracts.stabilityPool.address,
      contracts.defaultPool.address, 
      contracts.whitelist.address,
      contracts.troveManagerLiquidations.address,
      contracts.troveManagerRedemptions.address,
      contracts.collSurplusPool.address
    )

    await contracts.defaultPool.setAddresses(
      contracts.troveManager.address,
      contracts.activePool.address,
      contracts.whitelist.address,
      PREONContracts.preonFinanceTreasury.address,
    )

    await contracts.collSurplusPool.setAddresses(
      contracts.borrowerOperations.address,
      contracts.troveManager.address,
      contracts.troveManagerRedemptions.address,
      contracts.activePool.address,
      contracts.whitelist.address,
    )

    // set contracts in HintHelpers
    await contracts.hintHelpers.setAddresses(
      contracts.sortedTroves.address,
      contracts.troveManager.address,
      contracts.whitelist.address
    )

    // set contracts in Whitelist
    await contracts.whitelist.setAddresses(
      contracts.activePool.address,
      contracts.defaultPool.address,
      contracts.stabilityPool.address,
      contracts.collSurplusPool.address,
      contracts.borrowerOperations.address,
    )

    await contracts.wJLP.setAddresses(
      contracts.activePool.address,
      contracts.troveManagerLiquidations.address,
      contracts.troveManagerRedemptions.address,
      contracts.defaultPool.address,
      contracts.stabilityPool.address,
      PREONContracts.preonFinanceTreasury.address,
      contracts.borrowerOperations.address,
      contracts.collSurplusPool.address
    )

    await contracts.PriceCurveAVAX.setAddresses(contracts.whitelist.address)
    await contracts.PriceCurveAVAX.adjustParams("AVAX", "0", "0", "0", "0", "0", "0", "0",);
    await contracts.PriceCurveETH.setAddresses(contracts.whitelist.address)
    await contracts.PriceCurveETH.adjustParams("ETH", "0", "0", "0", "0", "0", "0", "0");
    await contracts.PriceCurveJLP.setAddresses(contracts.whitelist.address)
    await contracts.PriceCurveJLP.adjustParams("JLP", "0", "0", "0", "0", "0", "0", "0");

    const newERC20Router = await ERC20Router.new("tester", contracts.activePool.address, ZERO_ADDRESS, contracts.pusdToken.address)

    await contracts.whitelist.addCollateral(contracts.weth.address, "1000000000000000000", contracts.priceFeedETH.address, 18, contracts.PriceCurveETH.address, false, newERC20Router.address);
    await contracts.whitelist.addCollateral(contracts.wavax.address, "1000000000000000000", contracts.priceFeedAVAX.address, 18, contracts.PriceCurveAVAX.address, false, newERC20Router.address);
    await contracts.whitelist.addCollateral(contracts.wJLP.address, "1000000000000000000", contracts.priceFeedJLP.address, 18, contracts.PriceCurveJLP.address, true, newERC20Router.address);
    // for (let i = 0; i < 147; i++) {
    //   let params = {
    //     name: "Token " + String(i),
    //     symbol: "Token" + String(i),
    //     decimals: 18,
    //     ratio: "1050000000000000000"
    //   }
    //
    //   await this.deployExtraCollateral(contracts, params)
    // }
    // @RoboPreon: added 150 collaterals in the system.
    // Can run everything all tests and see if any gas issues pop up
  }


  // Deploys a new whitelist collateral. 
  // Creates a corresponding price feed, price curve, adjusts the params, and adds it to the whitelist.
  // Call this function after the normal connect core contracts.  
  static async deployExtraCollateral(contracts, params) {

    const {
      name,
      symbol,
      decimals,
      ratio,
    } = params

    const newToken = await ERC20Token.new(symbol, name, decimals);

    const newPriceFeed = await PriceFeedTestnet.new();

    const newPriceCurve = await LinearPriceCurve.new();
    await newPriceCurve.setAddresses(contracts.whitelist.address)
    await newPriceCurve.adjustParams(name, "0", "0", "0", "0", "0", "0", "0");

    const newERC20Router = await ERC20Router.new("tester", contracts.activePool.address, ZERO_ADDRESS, contracts.pusdToken.address)

    await contracts.whitelist.addCollateral(newToken.address, ratio, newPriceFeed.address, decimals, newPriceCurve.address, false, newERC20Router.address);

    return {
      token: newToken,
      priceFeed: newPriceFeed,
      priceCurve: newPriceCurve
    }
  }

  static async deployNewRouter(contracts, params) {
    const {
      name, 
      joeRouter, 
      whitelistCollateral
    } = params

    const newERC20Router = await ERC20Router.new(name, contracts.activePool.address, joeRouter.address, contracts.pusdToken.address)

    await contracts.whitelist.setDefaultRouter(whitelistCollateral.address, newERC20Router.address)

    return {
      router: newERC20Router
    }
  }

  static async connectPREONContracts(PREONContracts) {
    // Set PREONToken address in LCF
    await PREONContracts.lockupContractFactory.setPREONTokenAddress(PREONContracts.preonToken.address)
  }

  static async connectPREONContractsToCore(PREONContracts, coreContracts) {
    await PREONContracts.sPREON.setAddresses(
      PREONContracts.preonToken.address,
      coreContracts.pusdToken.address,
    )
  
    await PREONContracts.communityIssuance.setAddresses(
      PREONContracts.preonToken.address,
      coreContracts.stabilityPool.address
    )
  }

  static async connectUnipool(uniPool, PREONContracts, uniswapPairAddr, duration) {
    await uniPool.setParams(PREONContracts.preonToken.address, uniswapPairAddr, duration)
  }
}
module.exports = DeploymentHelper

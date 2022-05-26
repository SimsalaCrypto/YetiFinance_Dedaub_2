const { UniswapV2Factory } = require("./ABIs/UniswapV2Factory.js")
const { UniswapV2Pair } = require("./ABIs/UniswapV2Pair.js")
const { UniswapV2Router02 } = require("./ABIs/UniswapV2Router02.js")
const { ChainlinkAggregatorV3Interface } = require("./ABIs/ChainlinkAggregatorV3Interface.js")
const { TestHelper: th, TimeValues: timeVals } = require("../utils/testHelpers.js")
const { dec } = th
const MainnetDeploymentHelper = require("../utils/mainnetDeploymentHelpers.js")
const toBigNum = ethers.BigNumber.from

async function mainnetDeploy(configParams) {
  const date = new Date()
  console.log(date.toUTCString())
  const deployerWallet = (await ethers.getSigners())[0]
  // const account2Wallet = (await ethers.getSigners())[1]
  const basefee = await ethers.provider.getGasPrice();
  const gasPrice = toBigNum(basefee).add(toBigNum('20000000000')) // add tip
  configParams.GAS_PRICE = gasPrice;
  console.log(`BWB gasPrice is ${configParams.GAS_PRICE}`)

  const mdh = new MainnetDeploymentHelper(configParams, deployerWallet)
  
  const deploymentState = mdh.loadPreviousDeployment()
  console.log(`deployer address: ${deployerWallet.address}`)
  assert.equal(deployerWallet.address, configParams.liquityAddrs.DEPLOYER)
  // assert.equal(account2Wallet.address, configParams.beneficiaries.ACCOUNT_2)
  let deployerETHBalance = await ethers.provider.getBalance(deployerWallet.address)
  console.log(`deployerETHBalance before: ${deployerETHBalance}`)

  // Get UniswapV2Factory instance at its deployed address
  const uniswapV2Factory = new ethers.Contract(
    configParams.externalAddrs.UNISWAP_V2_FACTORY,
    UniswapV2Factory.abi,
    deployerWallet
  )

  console.log(`Uniswp addr: ${uniswapV2Factory.address}`)
  // const uniAllPairsLength = await uniswapV2Factory.allPairsLength()
  // console.log(`Uniswap Factory number of pairs: ${uniAllPairsLength}`)

  deployerETHBalance = await ethers.provider.getBalance(deployerWallet.address)
  console.log(`deployer's ETH balance before deployments: ${deployerETHBalance}`)

  // Deploy core logic contracts
  const liquityCore = await mdh.deployLiquityCoreMainnet(configParams.externalAddrs.TELLOR_MASTER, deploymentState)
  console.log("Deployed liquity core mainnet");
  await mdh.logContractObjects(liquityCore)



  // Check Uniswap Pair PUSD-ETH pair before pair creation
  let PUSDWETHPairAddr = await uniswapV2Factory.getPair(liquityCore.pusdToken.address, configParams.externalAddrs.WETH_ERC20)
  let WETHPUSDPairAddr = await uniswapV2Factory.getPair(configParams.externalAddrs.WETH_ERC20, liquityCore.pusdToken.address)
  assert.equal(PUSDWETHPairAddr, WETHPUSDPairAddr)

  if (PUSDWETHPairAddr == th.ZERO_ADDRESS) {
    // Deploy Unipool for PUSD-WETH
    const pairTx = await mdh.sendAndWaitForTransaction(uniswapV2Factory.createPair(
      configParams.externalAddrs.WETH_ERC20,
      liquityCore.pusdToken.address,
      { gasPrice }
    ))

    // Check Uniswap Pair PUSD-WETH pair after pair creation (forwards and backwards should have same address)
    PUSDWETHPairAddr = await uniswapV2Factory.getPair(liquityCore.pusdToken.address, configParams.externalAddrs.WETH_ERC20)
    assert.notEqual(PUSDWETHPairAddr, th.ZERO_ADDRESS)
    WETHPUSDPairAddr = await uniswapV2Factory.getPair(configParams.externalAddrs.WETH_ERC20, liquityCore.pusdToken.address)
    console.log(`PUSD-WETH pair contract address after Uniswap pair creation: ${PUSDWETHPairAddr}`)
    assert.equal(WETHPUSDPairAddr, PUSDWETHPairAddr)
  }

  deploymentState['uniToken'] = {address: PUSDWETHPairAddr};
  // Deploy Unipool
  const unipool = await mdh.deployUnipoolMainnet(deploymentState);

  
  // Deploy PREON Contracts
  const PREONContracts = await mdh.deployPREONContractsMainnet(
    configParams.liquityAddrs.GENERAL_SAFE, // bounty address
    unipool.address,  // lp rewards address
    configParams.liquityAddrs.PREON_SAFE, // multisig PREON endowment address
    deploymentState,
  );
  console.log("Deployed PREON Contracts");

  // Connect all core contracts up
  await mdh.connectCoreContractsMainnet(liquityCore, PREONContracts, configParams.externalAddrs.CHAINLINK_ETHUSD_PROXY)
  console.log("Connected Core Contracts");
  await mdh.connectPREONContractsMainnet(PREONContracts)
  console.log("Connected PREON Contracts");
  await mdh.connectPREONContractsToCoreMainnet(PREONContracts, liquityCore)
  console.log("Connected Preon Contracts to Core");

  // @KingPreon: commented out below for now because it is not part of the core system
 //  // Deploy a read-only multi-trove getter
 //  const multiTroveGetter = await mdh.deployMultiTroveGetterMainnet(liquityCore, deploymentState)
 //
 //  // Connect Unipool to PREONToken and the PUSD-WETH pair address, with a 6 week duration
 //  const LPRewardsDuration = timeVals.SECONDS_IN_SIX_WEEKS
 //  await mdh.connectUnipoolMainnet(unipool, PREONContracts, PUSDWETHPairAddr, LPRewardsDuration)
 //
 //
 //  // deploy pool2
 //  const pool2Factories = {
 //    'tj': new ethers.Contract(
 //    configParams.externalAddrs.TJ_FACTORY,
 //    UniswapV2Factory.abi,
 //    deployerWallet
 //    ),
 //    'png': new ethers.Contract(
 //    configParams.externalAddrs.UNISWAP_V2_FACTORY,
 //    UniswapV2Factory.abi,
 //    deployerWallet
 //    )
 //  };
 //
 //
 //  for (const [dex, factory] of Object.entries(pool2Factories)) {
 //    let PREONWETHPairAddr = await factory.getPair(PREONContracts.preonToken.address, configParams.externalAddrs.WETH_ERC20)
 //    let WETHPREONPairAddr = await factory.getPair(configParams.externalAddrs.WETH_ERC20, PREONContracts.preonToken.address)
 //    assert.equal(PREONWETHPairAddr, WETHPREONPairAddr)
 //    const pool2Name = `${dex}Token`;
 //    if (PREONWETHPairAddr == th.ZERO_ADDRESS) {
 //      // Deploy Unipool for PREON-WETH
 //      const pairTx = await mdh.sendAndWaitForTransaction(factory.createPair(
 //        configParams.externalAddrs.WETH_ERC20,
 //        PREONContracts.preonToken.address,
 //        { gasPrice }
 //      ))
 //
 //      // Check Uniswap Pair PUSD-WETH pair after pair creation (forwards and backwards should have same address)
 //      PREONWETHPairAddr = await factory.getPair(PREONContracts.preonToken.address, configParams.externalAddrs.WETH_ERC20)
 //      assert.notEqual(PREONWETHPairAddr, th.ZERO_ADDRESS)
 //      WETHPREONPairAddr = await factory.getPair(configParams.externalAddrs.WETH_ERC20, PREONContracts.preonToken.address)
 //      console.log(`${dex} PREON-WETH pair contract address after Uniswap pair creation: ${PREONWETHPairAddr}`)
 //      assert.equal(WETHPREONPairAddr, PREONWETHPairAddr)
 //      deploymentState[pool2Name] = {address: PREONWETHPairAddr, txHash: pairTx.transactionHash};
 //    } else if (!deploymentState[pool2Name]) {
 //      // Check Uniswap Pair PUSD-WETH pair after pair creation (forwards and backwards should have same address)
 //      PREONWETHPairAddr = await factory.getPair(PREONContracts.preonToken.address, configParams.externalAddrs.WETH_ERC20)
 //      assert.notEqual(PREONWETHPairAddr, th.ZERO_ADDRESS)
 //      console.log(`${dex} PREON-WETH pair contract address after Uniswap pair creation: ${PREONWETHPairAddr}`)
 //      deploymentState[pool2Name] = {address: PREONWETHPairAddr};
 //    }
 //
 //    // create rewards unipools
 //    const pool2Unipool = await mdh.deployPool2UnipoolMainnet(deploymentState, dex);
 //    console.log(`${dex} pool2Unipool address: ${pool2Unipool.address}`)
 //    // duration is 4 weeks
 //    await mdh.connectUnipoolMainnet(pool2Unipool, PREONContracts, PREONWETHPairAddr, timeVals.SECONDS_IN_ONE_MONTH);
 //    console.log(`Successfully connected${pool2Name}`);
 //  }
 //
 //  // Log PREON and Unipool addresses
 //  await mdh.logContractObjects(PREONContracts)
 //  console.log(`Unipool address: ${unipool.address}`)
 //
 //  const deployTx = await ethers.provider.getTransaction(deploymentState['preonToken'].txHash)
 //  const startBlock = deployTx.blockNumber;
 //
 //  let deploymentStartTime = await PREONContracts.preonToken.getDeploymentStartTime()
 //  //let deploymentStartTime = (await ethers.provider.getBlock(latestBlock)).timestamp
 //  deploymentState.metadata = deploymentState.metadata || {};
 //  deploymentState.metadata.startBlock = startBlock;
 //  deploymentState.metadata.deploymentDate = parseInt(deploymentStartTime.toString() + '000');
 //  deploymentState.metadata.network = {name: mdh.hre.network.name, chainId: mdh.hre.network.config.chainId};
 //
 //  console.log(`deployment start time: ${deploymentStartTime}`)
 //  const oneYearFromDeployment = (Number(deploymentStartTime) + timeVals.SECONDS_IN_ONE_YEAR).toString()
 //  console.log(`time oneYearFromDeployment: ${oneYearFromDeployment}`)
 //
 //  // Deploy LockupContracts - one for each beneficiary
 //  const lockupContracts = {}
 //
 //  for (const [investor, investorObj] of Object.entries(configParams.beneficiaries)) {
 //    investorAddr = investorObj.address
 //    const lockupContractEthersFactory = await ethers.getContractFactory("LockupContract", deployerWallet)
 //    if (deploymentState[investor] && deploymentState[investor].address) {
 //      console.log(`Using previously deployed ${investor} lockup contract at address ${deploymentState[investor].address}`)
 //      lockupContracts[investor] = new ethers.Contract(
 //        deploymentState[investor].address,
 //        lockupContractEthersFactory.interface,
 //        deployerWallet
 //      )
 //    } else {
 //      console.log(`Deploying lockup for ${investor}`)
 //      let unlockTime = investorObj.unlockTime ? investorObj.unlockTime : oneYearFromDeployment;
 //      const txReceipt = await mdh.sendAndWaitForTransaction(PREONContracts.lockupContractFactory.deployLockupContract(investorAddr, unlockTime, { gasPrice }))
 //
 //      const address = await txReceipt.logs[0].address // The deployment event emitted from the LC itself is is the first of two events, so this is its address
 //      lockupContracts[investor] = new ethers.Contract(
 //        address,
 //        lockupContractEthersFactory.interface,
 //        deployerWallet
 //      )
 //
 //      deploymentState[investor] = {
 //        address: address,
 //        txHash: txReceipt.transactionHash
 //      }
 //
 //      mdh.saveDeployment(deploymentState)
 //    }
 //
 //    const preonTokenAddr = PREONContracts.preonToken.address
 //    // verify
 //    if (configParams.ETHERSCAN_BASE_URL) {
 //      console.log("@KingPreon: Removed Call to mdf.verifyContract in mainnetDeployment")
 //      // await mdh.verifyContract(investor, deploymentState, [preonTokenAddr, investorAddr, oneYearFromDeployment])
 //    }
 //  }
 //  mdh.saveDeployment(deploymentState)
 //  // // --- TESTS AND CHECKS  ---
 //
 //  // Deployer repay PUSD
 //  // console.log(`deployer trove debt before repaying: ${await liquityCore.troveManager.getTroveDebt(deployerWallet.address)}`)
 // // await mdh.sendAndWaitForTransaction(liquityCore.borrowerOperations.repayPUSD(dec(800, 18), th.ZERO_ADDRESS, th.ZERO_ADDRESS, {gasPrice, gasLimit: 1000000}))
 //  // console.log(`deployer trove debt after repaying: ${await liquityCore.troveManager.getTroveDebt(deployerWallet.address)}`)
 //
 //  // Deployer add coll
 //  // console.log(`deployer trove coll before adding coll: ${await liquityCore.troveManager.getTroveColl(deployerWallet.address)}`)
 //  // await mdh.sendAndWaitForTransaction(liquityCore.borrowerOperations.addColl(th.ZERO_ADDRESS, th.ZERO_ADDRESS, {value: dec(2, 'ether'), gasPrice, gasLimit: 1000000}))
 //  // console.log(`deployer trove coll after addingColl: ${await liquityCore.troveManager.getTroveColl(deployerWallet.address)}`)
 //
 //  // Check chainlink proxy price ---
 //
 //  const chainlinkProxy = new ethers.Contract(
 //    configParams.externalAddrs.CHAINLINK_ETHUSD_PROXY,
 //    ChainlinkAggregatorV3Interface,
 //    deployerWallet
 //  )
 //
 //  // Get latest price
 //  let chainlinkPrice = await chainlinkProxy.latestAnswer()
 //  console.log(`current Chainlink price: ${chainlinkPrice}`)
 //
 //  // Check Tellor price directly (through our TellorCaller)
 //  // let tellorPriceResponse = await liquityCore.tellorCaller.getTellorCurrentValue(1) // id == 1: the ETH-USD request ID
 //  // console.log(`current Tellor price: ${tellorPriceResponse[1]}`)
 //  // console.log(`current Tellor timestamp: ${tellorPriceResponse[2]}`)
 //
 //  // // --- Lockup Contracts ---
 //  console.log("LOCKUP CONTRACT CHECKS")
 //  // Check lockup contracts exist for each beneficiary with correct unlock time
 //  for (investor of Object.keys(lockupContracts)) {
 //    const lockupContract = lockupContracts[investor]
 //    // check LC references correct PREONToken
 //    const storedPREONTokenAddr = await lockupContract.preonToken()
 //    assert.equal(PREONContracts.preonToken.address, storedPREONTokenAddr)
 //    // Check contract has stored correct beneficary
 //    const onChainBeneficiary = await lockupContract.beneficiary()
 //    assert.equal(configParams.beneficiaries[investor].address.toLowerCase(), onChainBeneficiary.toLowerCase())
 //    // Check correct unlock time (1 yr from deployment)
 //    const unlockTime = await lockupContract.unlockTime()
 //    assert(toBigNum(unlockTime).gte(oneYearFromDeployment))
 //
 //    console.log(
 //      `lockupContract addr: ${lockupContract.address},
 //            stored PREONToken addr: ${storedPREONTokenAddr}
 //            beneficiary: ${investor},
 //            beneficiary addr: ${configParams.beneficiaries[investor].address},
 //            on-chain beneficiary addr: ${onChainBeneficiary},
 //            unlockTime: ${unlockTime}
 //            `
 //    )
 //  }

  // // --- Check correct addresses set in PREONToken
  // console.log("STORED ADDRESSES IN PREON TOKEN")
  // const storedMultisigAddress = await PREONContracts.preonToken.multisigAddress()
  // assert.equal(configParams.liquityAddrs.PREON_SAFE.toLowerCase(), storedMultisigAddress.toLowerCase())
  // console.log(`multi-sig address stored in PREONToken : ${th.squeezeAddr(storedMultisigAddress)}`)
  // console.log(`PREON Safe address: ${th.squeezeAddr(configParams.liquityAddrs.PREON_SAFE)}`)

  // // --- PREON allowances of different addresses ---
  // console.log("INITIAL PREON BALANCES")
  // // Unipool
  // const unipoolPREONBal = await PREONContracts.preonToken.balanceOf(unipool.address)
  // // assert.equal(unipoolPREONBal.toString(), '1333333333333333333333333')
  // th.logBN('Unipool PREON balance       ', unipoolPREONBal)

  // // PREON Safe
  // const preonSafeBal = await PREONContracts.preonToken.balanceOf(configParams.liquityAddrs.PREON_SAFE)
  // assert.equal(preonSafeBal.toString(), '64666666666666666666666667')
  // th.logBN('PREON Safe balance     ', preonSafeBal)

  // // Bounties/hackathons (General Safe)
  // const generalSafeBal = await PREONContracts.preonToken.balanceOf(configParams.liquityAddrs.GENERAL_SAFE)
  // assert.equal(generalSafeBal.toString(), '2000000000000000000000000')
  // th.logBN('General Safe balance       ', generalSafeBal)

  // // CommunityIssuance contract
  // const communityIssuanceBal = await PREONContracts.preonToken.balanceOf(PREONContracts.communityIssuance.address)
  // // assert.equal(communityIssuanceBal.toString(), '32000000000000000000000000')
  // th.logBN('Community Issuance balance', communityIssuanceBal)

  // // --- PriceFeed ---
  // console.log("PRICEFEED CHECKS")
  // // Check Pricefeed's status and last good price
  // const lastGoodPrice = await liquityCore.priceFeed.lastGoodPrice()
  // const priceFeedInitialStatus = await liquityCore.priceFeed.status()
  // th.logBN('PriceFeed first stored price', lastGoodPrice)
  // console.log(`PriceFeed initial status: ${priceFeedInitialStatus}`)

  // // Check PriceFeed's & TellorCaller's stored addresses
  // const priceFeedCLAddress = await liquityCore.priceFeed.priceAggregator()
  // const priceFeedTellorCallerAddress = await liquityCore.priceFeed.tellorCaller()
  // assert.equal(priceFeedCLAddress, configParams.externalAddrs.CHAINLINK_ETHUSD_PROXY)
  // assert.equal(priceFeedTellorCallerAddress, liquityCore.tellorCaller.address)

  // // Check Tellor address
  // const tellorCallerTellorMasterAddress = await liquityCore.tellorCaller.tellor()
  // assert.equal(tellorCallerTellorMasterAddress, configParams.externalAddrs.TELLOR_MASTER)

  // // --- Unipool ---

  // // Check Unipool's PUSD-ETH Uniswap Pair address
  // const unipoolUniswapPairAddr = await unipool.uniToken()
  // console.log(`Unipool's stored PUSD-ETH Uniswap Pair address: ${unipoolUniswapPairAddr}`)

  // console.log("SYSTEM GLOBAL VARS CHECKS")
  // // --- Sorted Troves ---

  // // Check max size
  // const sortedTrovesMaxSize = (await liquityCore.sortedTroves.data())[2]
  // assert.equal(sortedTrovesMaxSize, '115792089237316195423570985008687907853269984665640564039457584007913129639935')

  // // --- TroveManager ---

  // const liqReserve = await liquityCore.troveManager.PUSD_GAS_COMPENSATION()
  // const minNetDebt = await liquityCore.troveManager.MIN_NET_DEBT()

  // th.logBN('system liquidation reserve', liqReserve)
  // th.logBN('system min net debt      ', minNetDebt)

  // // --- Make first PUSD-ETH liquidity provision ---

  // // Open trove if not yet opened
  // const troveStatus = await liquityCore.troveManager.getTroveStatus(deployerWallet.address)
  // if (troveStatus.toString() != '1') {
  //   let _3kPUSDWithdrawal = th.dec(3000, 18) // 3000 PUSD
  //   let _3ETHcoll = th.dec(3, 'ether') // 3 ETH
  //   console.log('Opening trove...')
  //   await mdh.sendAndWaitForTransaction(
  //     liquityCore.borrowerOperations.openTrove(
  //       th._100pct,
  //       _3kPUSDWithdrawal,
  //       th.ZERO_ADDRESS,
  //       th.ZERO_ADDRESS,
  //       { value: _3ETHcoll, gasPrice }
  //     )
  //   )
  // } else {
  //   console.log('Deployer already has an active trove')
  // }

  // // Check deployer now has an open trove
  // console.log(`deployer is in sorted list after making trove: ${await liquityCore.sortedTroves.contains(deployerWallet.address)}`)

  // const deployerTrove = await liquityCore.troveManager.Troves(deployerWallet.address)
  // th.logBN('deployer debt', deployerTrove[0])
  // th.logBN('deployer coll', deployerTrove[1])
  // th.logBN('deployer stake', deployerTrove[2])
  // console.log(`deployer's trove status: ${deployerTrove[3]}`)

  // // Check deployer has PUSD
  // let deployerPUSDBal = await liquityCore.pusdToken.balanceOf(deployerWallet.address)
  // th.logBN("deployer's PUSD balance", deployerPUSDBal)

  // // Check Uniswap pool has PUSD and WETH tokens
  const PUSDETHPair = await new ethers.Contract(
    PUSDWETHPairAddr,
    UniswapV2Pair.abi,
    deployerWallet
  )

  // const token0Addr = await PUSDETHPair.token0()
  // const token1Addr = await PUSDETHPair.token1()
  // console.log(`PUSD-ETH Pair token 0: ${th.squeezeAddr(token0Addr)},
  //       PUSDToken contract addr: ${th.squeezeAddr(liquityCore.pusdToken.address)}`)
  // console.log(`PUSD-ETH Pair token 1: ${th.squeezeAddr(token1Addr)},
  //       WETH ERC20 contract addr: ${th.squeezeAddr(configParams.externalAddrs.WETH_ERC20)}`)

  // // Check initial PUSD-ETH pair reserves before provision
  // let reserves = await PUSDETHPair.getReserves()
  // th.logBN("PUSD-ETH Pair's PUSD reserves before provision", reserves[0])
  // th.logBN("PUSD-ETH Pair's ETH reserves before provision", reserves[1])

  // // Get the UniswapV2Router contract
  // const uniswapV2Router02 = new ethers.Contract(
  //   configParams.externalAddrs.UNISWAP_V2_ROUTER02,
  //   UniswapV2Router02.abi,
  //   deployerWallet
  // )

  // // --- Provide liquidity to PUSD-ETH pair if not yet done so ---
  // let deployerLPTokenBal = await PUSDETHPair.balanceOf(deployerWallet.address)
  // if (deployerLPTokenBal.toString() == '0') {
  //   console.log('Providing liquidity to Uniswap...')
  //   // Give router an allowance for PUSD
  //   await liquityCore.pusdToken.increaseAllowance(uniswapV2Router02.address, dec(10000, 18))

  //   // Check Router's spending allowance
  //   const routerPUSDAllowanceFromDeployer = await liquityCore.pusdToken.allowance(deployerWallet.address, uniswapV2Router02.address)
  //   th.logBN("router's spending allowance for deployer's PUSD", routerPUSDAllowanceFromDeployer)

  //   // Get amounts for liquidity provision
  //   const LP_ETH = dec(1, 'ether')

  //   // Convert 8-digit CL price to 18 and multiply by ETH amount
  //   const PUSDAmount = toBigNum(chainlinkPrice)
  //     .mul(toBigNum(dec(1, 10)))
  //     .mul(toBigNum(LP_ETH))
  //     .div(toBigNum(dec(1, 18)))

  //   const minPUSDAmount = PUSDAmount.sub(toBigNum(dec(100, 18)))

  //   latestBlock = await ethers.provider.getBlockNumber()
  //   now = (await ethers.provider.getBlock(latestBlock)).timestamp
  //   let tenMinsFromNow = now + (60 * 60 * 10)

  //   // Provide liquidity to PUSD-ETH pair
  //   await mdh.sendAndWaitForTransaction(
  //     uniswapV2Router02.addLiquidityETH(
  //       liquityCore.pusdToken.address, // address of PUSD token
  //       PUSDAmount, // PUSD provision
  //       minPUSDAmount, // minimum PUSD provision
  //       LP_ETH, // minimum ETH provision
  //       deployerWallet.address, // address to send LP tokens to
  //       tenMinsFromNow, // deadline for this tx
  //       {
  //         value: dec(1, 'ether'),
  //         gasPrice,
  //         gasLimit: 5000000 // For some reason, ethers can't estimate gas for this tx
  //       }
  //     )
  //   )
  // } else {
  //   console.log('Liquidity already provided to Uniswap')
  // }
  // // Check PUSD-ETH reserves after liquidity provision:
  // reserves = await PUSDETHPair.getReserves()
  // th.logBN("PUSD-ETH Pair's PUSD reserves after provision", reserves[0])
  // th.logBN("PUSD-ETH Pair's ETH reserves after provision", reserves[1])



  // // ---  Check LP staking  ---
  // console.log("CHECK LP STAKING EARNS PREON")

  // // Check deployer's LP tokens
  // deployerLPTokenBal = await PUSDETHPair.balanceOf(deployerWallet.address)
  // th.logBN("deployer's LP token balance", deployerLPTokenBal)

  // // Stake LP tokens in Unipool
  // console.log(`PUSDETHPair addr: ${PUSDETHPair.address}`)
  // console.log(`Pair addr stored in Unipool: ${await unipool.uniToken()}`)

  // earnedPREON = await unipool.earned(deployerWallet.address)
  // th.logBN("deployer's farmed PREON before staking LP tokens", earnedPREON)

  // const deployerUnipoolStake = await unipool.balanceOf(deployerWallet.address)
  // if (deployerUnipoolStake.toString() == '0') {
  //   console.log('Staking to Unipool...')
  //   // Deployer approves Unipool
  //   await mdh.sendAndWaitForTransaction(
  //     PUSDETHPair.approve(unipool.address, deployerLPTokenBal, { gasPrice })
  //   )

  //   await mdh.sendAndWaitForTransaction(unipool.stake(1, { gasPrice }))
  // } else {
  //   console.log('Already staked in Unipool')
  // }

  // console.log("wait 90 seconds before checking earnings... ")
  // await configParams.waitFunction()

  // earnedPREON = await unipool.earned(deployerWallet.address)
  // th.logBN("deployer's farmed PREON from Unipool after waiting ~1.5mins", earnedPREON)

  // let deployerPREONBal = await PREONContracts.preonToken.balanceOf(deployerWallet.address)
  // th.logBN("deployer PREON Balance Before SP deposit", deployerPREONBal)



  // // --- Make SP deposit and earn PREON ---
  // console.log("CHECK DEPLOYER MAKING DEPOSIT AND EARNING PREON")

  // let SPDeposit = await liquityCore.stabilityPool.getCompoundedPUSDDeposit(deployerWallet.address)
  // th.logBN("deployer SP deposit before making deposit", SPDeposit)

  // // Provide to SP
  // await mdh.sendAndWaitForTransaction(liquityCore.stabilityPool.provideToSP(dec(15, 18), th.ZERO_ADDRESS, { gasPrice, gasLimit: 400000 }))

  // // Get SP deposit 
  // SPDeposit = await liquityCore.stabilityPool.getCompoundedPUSDDeposit(deployerWallet.address)
  // th.logBN("deployer SP deposit after depositing 15 PUSD", SPDeposit)

  // console.log("wait 90 seconds before withdrawing...")
  // // wait 90 seconds
  // await configParams.waitFunction()

  // // Withdraw from SP
  // // await mdh.sendAndWaitForTransaction(liquityCore.stabilityPool.withdrawFromSP(dec(1000, 18), { gasPrice, gasLimit: 400000 }))

  // // SPDeposit = await liquityCore.stabilityPool.getCompoundedPUSDDeposit(deployerWallet.address)
  // // th.logBN("deployer SP deposit after full withdrawal", SPDeposit)

  // // deployerPREONBal = await PREONContracts.preonToken.balanceOf(deployerWallet.address)
  // // th.logBN("deployer PREON Balance after SP deposit withdrawal", deployerPREONBal)



  // // ---  Attempt withdrawal from LC  ---
  // console.log("CHECK BENEFICIARY ATTEMPTING WITHDRAWAL FROM LC")

  // // connect Acct2 wallet to the LC they are beneficiary of
  // let account2LockupContract = await lockupContracts["ACCOUNT_2"].connect(account2Wallet)

  // // Deployer funds LC with 10 PREON
  // // await mdh.sendAndWaitForTransaction(PREONContracts.preonToken.transfer(account2LockupContract.address, dec(10, 18), { gasPrice }))

  // // account2 PREON bal
  // let account2bal = await PREONContracts.preonToken.balanceOf(account2Wallet.address)
  // th.logBN("account2 PREON bal before withdrawal attempt", account2bal)

  // // Check LC PREON bal 
  // let account2LockupContractBal = await PREONContracts.preonToken.balanceOf(account2LockupContract.address)
  // th.logBN("account2's LC PREON bal before withdrawal attempt", account2LockupContractBal)

  // // Acct2 attempts withdrawal from  LC
  // await mdh.sendAndWaitForTransaction(account2LockupContract.withdrawPREON({ gasPrice, gasLimit: 1000000 }))

  // // Acct PREON bal
  // account2bal = await PREONContracts.preonToken.balanceOf(account2Wallet.address)
  // th.logBN("account2's PREON bal after LC withdrawal attempt", account2bal)

  // // Check LC bal 
  // account2LockupContractBal = await PREONContracts.preonToken.balanceOf(account2LockupContract.address)
  // th.logBN("account2's LC PREON bal LC withdrawal attempt", account2LockupContractBal)

  // // --- Stake PREON ---
  // console.log("CHECK DEPLOYER STAKING PREON")

  // // Log deployer PREON bal and stake before staking
  // deployerPREONBal = await PREONContracts.preonToken.balanceOf(deployerWallet.address)
  // th.logBN("deployer PREON bal before staking", deployerPREONBal)
  // let deployerPREONStake = await PREONContracts.sPREON.mints(deployerWallet.address)
  // th.logBN("deployer stake before staking", deployerPREONStake)

  // // stake 13 PREON
  // await mdh.sendAndWaitForTransaction(PREONContracts.sPREON.mint(dec(13, 18), { gasPrice, gasLimit: 1000000 }))

  // // Log deployer PREON bal and stake after staking
  // deployerPREONBal = await PREONContracts.preonToken.balanceOf(deployerWallet.address)
  // th.logBN("deployer PREON bal after staking", deployerPREONBal)
  // deployerPREONStake = await PREONContracts.sPREON.mints(deployerWallet.address)
  // th.logBN("deployer stake after staking", deployerPREONStake)

  // // Log deployer rev share immediately after staking
  // let deployerPUSDRevShare = await PREONContracts.sPREON.getPendingPUSDGain(deployerWallet.address)
  // th.logBN("deployer pending PUSD revenue share", deployerPUSDRevShare)



  // // --- 2nd Account opens trove ---
  // const trove2Status = await liquityCore.troveManager.getTroveStatus(account2Wallet.address)
  // if (trove2Status.toString() != '1') {
  //   console.log("Acct 2 opens a trove ...")
  //   let _2kPUSDWithdrawal = th.dec(2000, 18) // 2000 PUSD
  //   let _1pt5_ETHcoll = th.dec(15, 17) // 1.5 ETH
  //   const borrowerOpsEthersFactory = await ethers.getContractFactory("BorrowerOperations", account2Wallet)
  //   const borrowerOpsAcct2 = await new ethers.Contract(liquityCore.borrowerOperations.address, borrowerOpsEthersFactory.interface, account2Wallet)

  //   await mdh.sendAndWaitForTransaction(borrowerOpsAcct2.openTrove(th._100pct, _2kPUSDWithdrawal, th.ZERO_ADDRESS, th.ZERO_ADDRESS, { value: _1pt5_ETHcoll, gasPrice, gasLimit: 1000000 }))
  // } else {
  //   console.log('Acct 2 already has an active trove')
  // }

  // const acct2Trove = await liquityCore.troveManager.Troves(account2Wallet.address)
  // th.logBN('acct2 debt', acct2Trove[0])
  // th.logBN('acct2 coll', acct2Trove[1])
  // th.logBN('acct2 stake', acct2Trove[2])
  // console.log(`acct2 trove status: ${acct2Trove[3]}`)

  // // Log deployer's pending PUSD gain - check fees went to staker (deloyer)
  // deployerPUSDRevShare = await PREONContracts.sPREON.getPendingPUSDGain(deployerWallet.address)
  // th.logBN("deployer pending PUSD revenue share from staking, after acct 2 opened trove", deployerPUSDRevShare)

  // //  --- deployer withdraws staking gains ---
  // console.log("CHECK DEPLOYER WITHDRAWING STAKING GAINS")

  // // check deployer's PUSD balance before withdrawing staking gains
  // deployerPUSDBal = await liquityCore.pusdToken.balanceOf(deployerWallet.address)
  // th.logBN('deployer PUSD bal before withdrawing staking gains', deployerPUSDBal)

  // // Deployer withdraws staking gains
  // await mdh.sendAndWaitForTransaction(PREONContracts.sPREON.unstake(0, { gasPrice, gasLimit: 1000000 }))

  // // check deployer's PUSD balance after withdrawing staking gains
  // deployerPUSDBal = await liquityCore.pusdToken.balanceOf(deployerWallet.address)
  // th.logBN('deployer PUSD bal after withdrawing staking gains', deployerPUSDBal)


  // // --- System stats  ---
  //
  // // Uniswap PUSD-ETH pool size
  // reserves = await PUSDETHPair.getReserves()
  // th.logBN("PUSD-ETH Pair's current PUSD reserves", reserves[0])
  // th.logBN("PUSD-ETH Pair's current ETH reserves", reserves[1])
  //
  // // Number of troves
  // const numTroves = await liquityCore.troveManager.getTroveOwnersCount()
  // console.log(`number of troves: ${numTroves} `)
  //
  // // Sorted list size
  // const listSize = await liquityCore.sortedTroves.getSize()
  // console.log(`Trove list size: ${listSize} `)
  //
  // // Total system debt and coll
  // const entireSystemDebt = await liquityCore.troveManager.getEntireSystemDebt()
  // const entireSystemColl = await liquityCore.troveManager.getEntireSystemColl()
  // th.logBN("Entire system debt", entireSystemDebt)
  // th.logBN("Entire system coll", entireSystemColl)
  //
  // // TCR
  // const TCR = await liquityCore.troveManager.getTCR(chainlinkPrice)
  // console.log(`TCR: ${TCR}`)
  //
  // // current borrowing rate
  // const baseRate = await liquityCore.troveManager.baseRate()
  // const currentBorrowingRate = await liquityCore.troveManager.getBorrowingRateWithDecay()
  // th.logBN("Base rate", baseRate)
  // th.logBN("Current borrowing rate", currentBorrowingRate)
  //
  // // total SP deposits
  // const totalSPDeposits = await liquityCore.stabilityPool.getTotalPUSDDeposits()
  // th.logBN("Total PUSD SP deposits", totalSPDeposits)
  //
  // // total PREON Staked in SPREON
  // const totalPREONStaked = await PREONContracts.sPREON.totalPREONStaked()
  // th.logBN("Total PREON staked", totalPREONStaked)
  //
  // // total LP tokens staked in Unipool
  // const totalLPTokensStaked = await unipool.totalSupply()
  // th.logBN("Total LP (PUSD-ETH) tokens staked in unipool", totalLPTokensStaked)
  //
  // // --- State variables ---
  //
  // // TroveManager
  // console.log("TroveManager state variables:")
  // const totalStakes = await liquityCore.troveManager.totalStakes()
  // const totalStakesSnapshot = await liquityCore.troveManager.totalStakesSnapshot()
  // const totalCollateralSnapshot = await liquityCore.troveManager.totalCollateralSnapshot()
  // th.logBN("Total trove stakes", totalStakes)
  // th.logBN("Snapshot of total trove stakes before last liq. ", totalStakesSnapshot)
  // th.logBN("Snapshot of total trove collateral before last liq. ", totalCollateralSnapshot)
  //
  // const L_ETH = await liquityCore.troveManager.L_ETH()
  // const L_PUSDDebt = await liquityCore.troveManager.L_PUSDDebt()
  // th.logBN("L_ETH", L_ETH)
  // th.logBN("L_PUSDDebt", L_PUSDDebt)
  //
  // // StabilityPool
  // console.log("StabilityPool state variables:")
  // const P = await liquityCore.stabilityPool.P()
  // const currentScale = await liquityCore.stabilityPool.currentScale()
  // const currentEpoch = await liquityCore.stabilityPool.currentEpoch()
  // // TODO: Supply an address here: epochToScaleToSum(address, epoch, scale)
  // const S = await liquityCore.stabilityPool.epochToScaleToSum(currentEpoch, currentScale)
  // const G = await liquityCore.stabilityPool.epochToScaleToG(currentEpoch, currentScale)
  // th.logBN("Product P", P)
  // th.logBN("Current epoch", currentEpoch)
  // th.logBN("Current scale", currentScale)
  // th.logBN("Sum S, at current epoch and scale", S)
  // th.logBN("Sum G, at current epoch and scale", G)
  //
  // // SPREON
  // console.log("SPREON state variables:")
  // const F_PUSD = await PREONContracts.sPREON.F_PUSD()
  // const F_ETH = await PREONContracts.sPREON.F_ETH()
  // th.logBN("F_PUSD", F_PUSD)
  // th.logBN("F_ETH", F_ETH)
  //
  //
  // // CommunityIssuance
  // console.log("CommunityIssuance state variables:")
  // const totalPREONIssued = await PREONContracts.communityIssuance.totalPREONIssued()
  // th.logBN("Total PREON issued to depositors / front ends", totalPREONIssued)
  //
  //
  // // TODO: Uniswap *PREON-ETH* pool size (check it's deployed?)















  // ************************
  // --- NOT FOR APRIL 5: Deploy a PREONToken2 with General Safe as beneficiary to test minting PREON showing up in Gnosis App  ---

  // // General Safe PREON bal before:
  // const realGeneralSafeAddr = "0xF06016D822943C42e3Cb7FC3a6A3B1889C1045f8"

  //   const PREONToken2EthersFactory = await ethers.getContractFactory("PREONToken2", deployerWallet)
  //   const preonToken2 = await PREONToken2EthersFactory.deploy( 
  //     "0xF41E0DD45d411102ed74c047BdA544396cB71E27",  // CI param: LC1 
  //     "0x9694a04263593AC6b895Fc01Df5929E1FC7495fA", // PREON Staking param: LC2
  //     "0x98f95E112da23c7b753D8AE39515A585be6Fb5Ef", // LCF param: LC3
  //     realGeneralSafeAddr,  // bounty/hackathon param: REAL general safe addr
  //     "0x98f95E112da23c7b753D8AE39515A585be6Fb5Ef", // LP rewards param: LC3
  //     deployerWallet.address, // multisig param: deployer wallet
  //     {gasPrice, gasLimit: 10000000}
  //   )

  //   console.log(`preon2 address: ${preonToken2.address}`)

  //   let generalSafePREONBal = await preonToken2.balanceOf(realGeneralSafeAddr)
  //   console.log(`generalSafePREONBal: ${generalSafePREONBal}`)



  // ************************
  // --- NOT FOR APRIL 5: Test short-term lockup contract PREON withdrawal on mainnet ---

  // now = (await ethers.provider.getBlock(latestBlock)).timestamp

  // const LCShortTermEthersFactory = await ethers.getContractFactory("LockupContractShortTerm", deployerWallet)

  // new deployment
  // const LCshortTerm = await LCShortTermEthersFactory.deploy(
  //   PREONContracts.preonToken.address,
  //   deployerWallet.address,
  //   now, 
  //   {gasPrice, gasLimit: 1000000}
  // )

  // LCshortTerm.deployTransaction.wait()

  // existing deployment
  // const deployedShortTermLC = await new ethers.Contract(
  //   "0xbA8c3C09e9f55dA98c5cF0C28d15Acb927792dC7", 
  //   LCShortTermEthersFactory.interface,
  //   deployerWallet
  // )

  // new deployment
  // console.log(`Short term LC Address:  ${LCshortTerm.address}`)
  // console.log(`recorded beneficiary in short term LC:  ${await LCshortTerm.beneficiary()}`)
  // console.log(`recorded short term LC name:  ${await LCshortTerm.NAME()}`)

  // existing deployment
  //   console.log(`Short term LC Address:  ${deployedShortTermLC.address}`)
  //   console.log(`recorded beneficiary in short term LC:  ${await deployedShortTermLC.beneficiary()}`)
  //   console.log(`recorded short term LC name:  ${await deployedShortTermLC.NAME()}`)
  //   console.log(`recorded short term LC name:  ${await deployedShortTermLC.unlockTime()}`)
  //   now = (await ethers.provider.getBlock(latestBlock)).timestamp
  //   console.log(`time now: ${now}`)

  //   // check deployer PREON bal
  //   let deployerPREONBal = await PREONContracts.preonToken.balanceOf(deployerWallet.address)
  //   console.log(`deployerPREONBal before he withdraws: ${deployerPREONBal}`)

  //   // check LC PREON bal
  //   let LC_PREONBal = await PREONContracts.preonToken.balanceOf(deployedShortTermLC.address)
  //   console.log(`LC PREON bal before withdrawal: ${LC_PREONBal}`)

  // // withdraw from LC
  // const withdrawFromShortTermTx = await deployedShortTermLC.withdrawPREON( {gasPrice, gasLimit: 1000000})
  // withdrawFromShortTermTx.wait()

  // // check deployer bal after LC withdrawal
  // deployerPREONBal = await PREONContracts.preonToken.balanceOf(deployerWallet.address)
  // console.log(`deployerPREONBal after he withdraws: ${deployerPREONBal}`)

  //   // check LC PREON bal
  //   LC_PREONBal = await PREONContracts.preonToken.balanceOf(deployedShortTermLC.address)
  //   console.log(`LC PREON bal after withdrawal: ${LC_PREONBal}`)
}

module.exports = {
  mainnetDeploy
}

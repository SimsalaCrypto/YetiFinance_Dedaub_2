// Testing PREON token ERC2612 functionality works as well as TeamAllocation.sol and FirstTreasury.sol

const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")

const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN

contract('PreonDeploymentTest', async accounts => {
  const [x, RoboPreon, Talent, LilPreon, sPREON ] = accounts;

  let PREON;
  let Treasury;
  let TeamAlloc;
  let multisig

  const testCorpus = ({ withProxy = false }) => {
    beforeEach(async () => {
      const contracts = await deploymentHelper.deployPREONRightNow(sPREON);
      PREON = contracts.preonToken;
      Treasury = contracts.preonFinanceTreasury;
      TeamAlloc = contracts.teamAllocation;

      let TreasuryTeamWallet = await Treasury.getTeamWallet();
      let TeamAllocTeamWallet = await TeamAlloc.getTeamWallet();

      assert.equal(TreasuryTeamWallet.toString(), TeamAllocTeamWallet.toString())

      multisig = TreasuryTeamWallet;
      await contracts.teamAllocation.setPreonAddress(PREON.address, {from: multisig});
    })

    it("Check all init balances are correct", async () => {
      let bal = await PREON.balanceOf(RoboPreon);
      assert.equal(bal.toString(), "0");

      bal = await PREON.balanceOf(Talent);
      assert.equal(bal.toString(), "0");

      bal = await PREON.balanceOf(LilPreon);
      assert.equal(bal.toString(), "0");

      bal = await PREON.balanceOf(Treasury.address)
      console.log("Treasury", bal.toString())
      assert.equal(bal.toString(), toBN(dec(365, 24)).toString());

      bal = await PREON.balanceOf(TeamAlloc.address)
      console.log("Team", bal.toString())
      assert.equal(bal.toString(), toBN(dec(135, 24)).toString());
    })

    it("sendAllocatedTokens() Works correctly", async () => {
      await TeamAlloc.sendAllocatedPREON();

      let team = [
        ("0x5Ed80B5C5e8A34D5E60572C022483Dc234Aea5Bb"), // RoboPreon
        ("0x02B11CdD34Ca73358c162C6B50f8eCe40a63F67F"), // 0xTalent
        ("0x95F58372A6e4b1B6D571e638E4f0aaFb4B0D895d"), // Lil Preon
        ("0xE4147a2B5bAc2D1B9FA23a1C0D477700Af590280"), // Festive Preon
        ("0x7Cd7D566ad0AD1903dfE680e4a1696814734eC28"), // Aces Preon
        ("0x7eFCCB1dE156b0ee337fD22567ae60c660dc265E"), // Preon Player One
        ("0xFB2B6fe35470CE08721cdfC84a61A6aa814262E7")  // Yung Preon
      ];

      const _94_5_thousand = 94500;

      let allocations = [
        toBN(dec(_94_5_thousand * 320, 18)),
        toBN(dec(_94_5_thousand * 265, 18)),
        toBN(dec(_94_5_thousand * 220, 18)),
        toBN(dec(_94_5_thousand * 80, 18)),
        toBN(dec(_94_5_thousand * 70, 18)),
        toBN(dec(_94_5_thousand * 30, 18)),
        toBN(dec(_94_5_thousand * 15, 18))
      ];

      for (let i = 0; i < 7; i++) {
        console.log(team[i].toString());
        console.log(allocations[i].toString());
        let bal = await PREON.balanceOf(team[i]);
        assert.equal(bal.toString(), allocations[i].toString());
      }
    })

    it("Update Team checks Work", async () => {
      await TeamAlloc.updateTeamAddress(multisig, {from: multisig});

      await th.assertRevert(TeamAlloc.updateTeamAddress(multisig, {from: RoboPreon}));

      await TeamAlloc.updateTeamAddress(RoboPreon, {from: multisig});
      await th.assertRevert(TeamAlloc.updateTeamAddress(multisig, {from: multisig}));
      await TeamAlloc.updateTeamAddress(RoboPreon, {from: RoboPreon});
      await th.assertRevert(TeamAlloc.updateTeamAddress(multisig, {from: multisig}));
    })

    it("Send Unallocated Checks Work", async () => {
      await th.assertRevert(TeamAlloc.sendUnallocatedPREON(multisig, "200", {from: multisig}));
    })

    it("Treasury Transfer sendToken() works and errors properly", async () => {
      th.assertRevert(Treasury.sendToken(PREON.address, RoboPreon, dec(300, 20).toString(), {from: RoboPreon}));
      await Treasury.sendToken(PREON.address, RoboPreon, dec(300, 20).toString(), {from: multisig});
      let bal = await PREON.balanceOf(RoboPreon);
      assert.equal(bal.toString(), dec(300, 20).toString());
    })



  }

  describe('Without proxy', async () => {
    testCorpus({ withProxy: false })
  })

})
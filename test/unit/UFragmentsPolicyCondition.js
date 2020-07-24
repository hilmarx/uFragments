const { expect } = require("chai");

const UFragmentsPolicy = artifacts.require("UFragmentsPolicy.sol");
const MockUFragments = artifacts.require("MockUFragments.sol");
const MockOracle = artifacts.require("MockOracle.sol");
const UFragmentsPolicyCondition = artifacts.require(
  "UFragmentsPolicyCondition.sol"
);

const encodeCall = require("zos-lib/lib/helpers/encodeCall").default;
const BigNumber = web3.BigNumber;
const _require = require("app-root-path").require;
const BlockchainCaller = _require("/util/blockchain_caller");
const chain = new BlockchainCaller(web3);

require("chai").use(require("chai-bignumber")(BigNumber)).should();

let uFragmentsPolicy,
  mockUFragments,
  mockMarketOracle,
  mockCpiOracle,
  condition,
  conditionResult;
let r, prevEpoch, prevTime;
let deployer, user, orchestrator;

const MAX_RATE = new BigNumber("1").mul(10 ** 6 * 10 ** 18);
const MAX_SUPPLY = new BigNumber(2).pow(255).minus(1).div(MAX_RATE);
const BASE_CPI = new BigNumber(100e18);
const INITIAL_CPI = new BigNumber(251.712e18);
const INITIAL_CPI_25P_MORE = INITIAL_CPI.mul(1.25).dividedToIntegerBy(1);
const INITIAL_CPI_25P_LESS = INITIAL_CPI.mul(0.77).dividedToIntegerBy(1);
const INITIAL_RATE = INITIAL_CPI.mul(1e18).dividedToIntegerBy(BASE_CPI);
const INITIAL_RATE_30P_MORE = INITIAL_RATE.mul(1.3).dividedToIntegerBy(1);
const INITIAL_RATE_30P_LESS = INITIAL_RATE.mul(0.7).dividedToIntegerBy(1);
const INITIAL_RATE_5P_MORE = INITIAL_RATE.mul(1.05).dividedToIntegerBy(1);
const INITIAL_RATE_5P_LESS = INITIAL_RATE.mul(0.95).dividedToIntegerBy(1);
const INITIAL_RATE_60P_MORE = INITIAL_RATE.mul(1.6).dividedToIntegerBy(1);
const INITIAL_RATE_2X = INITIAL_RATE.mul(2);

async function setupContracts() {
  await chain.waitForSomeTime(86400);
  const accounts = await chain.getUserAccounts();
  deployer = accounts[0];
  user = accounts[1];
  orchestrator = accounts[2];
  mockUFragments = await MockUFragments.new();
  mockMarketOracle = await MockOracle.new("MarketOracle");
  mockCpiOracle = await MockOracle.new("CpiOracle");
  uFragmentsPolicy = await UFragmentsPolicy.new();
  // CONDITION
  condition = await UFragmentsPolicyCondition.new(
    mockUFragments.address,
    uFragmentsPolicy.address,
    mockCpiOracle.address,
    mockMarketOracle.address
  );

  await uFragmentsPolicy.sendTransaction({
    data: encodeCall(
      "initialize",
      ["address", "address", "uint256"],
      [deployer, mockUFragments.address, BASE_CPI.toString()]
    ),
    from: deployer,
  });
  await uFragmentsPolicy.setMarketOracle(mockMarketOracle.address);
  await uFragmentsPolicy.setCpiOracle(mockCpiOracle.address);
  await uFragmentsPolicy.setOrchestrator(orchestrator);
}

async function setupContractsWithOpenRebaseWindow() {
  await setupContracts();
  await uFragmentsPolicy.setRebaseTimingParameters(60, 0, 60);
}

async function mockExternalData(
  rate,
  cpi,
  uFragSupply,
  rateValidity = true,
  cpiValidity = true
) {
  await mockMarketOracle.storeData(rate);
  await mockMarketOracle.storeValidity(rateValidity);
  await mockCpiOracle.storeData(cpi);
  await mockCpiOracle.storeValidity(cpiValidity);
  await mockUFragments.storeSupply(uFragSupply);
}

contract("UFragmentsPolicy:Rebase", async function (accounts) {
  before("setup UFragmentsPolicy contract", setupContractsWithOpenRebaseWindow);

  describe("when minRebaseTimeIntervalSec has NOT passed since the previous rebase", function () {
    before(async function () {
      await mockExternalData(INITIAL_RATE_30P_MORE, INITIAL_CPI, 1010);
      await chain.waitForSomeTime(60);
      await uFragmentsPolicy.rebase({ from: orchestrator });
    });

    it("should fail", async function () {
      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal(
        "Not enough time elapsed since last rebase"
      );
    });
  });
});

contract("UFragmentsPolicy:Rebase", async function (accounts) {
  before("setup UFragmentsPolicy contract", setupContractsWithOpenRebaseWindow);

  describe("when rate is within deviationThreshold", function () {
    before(async function () {
      await uFragmentsPolicy.setRebaseTimingParameters(60, 0, 60);
    });

    it("should return 0", async function () {
      await mockExternalData(INITIAL_RATE.minus(1), INITIAL_CPI, 1000);
      conditionResult = await condition.isRebaseCallable();

      // Last timestamp was more than 60 seconds ago
      expect(conditionResult).to.be.equal("Rebase with supply delta 0");

      await chain.waitForSomeTime(60);

      r = await uFragmentsPolicy.rebase({ from: orchestrator });
      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal(
        "Not enough time elapsed since last rebase"
      );

      await chain.waitForSomeTime(60);

      await mockExternalData(INITIAL_RATE.plus(1), INITIAL_CPI, 1000);
      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal("Rebase with supply delta 0");
      r = await uFragmentsPolicy.rebase({ from: orchestrator });
      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal(
        "Not enough time elapsed since last rebase"
      );

      await chain.waitForSomeTime(60);

      await mockExternalData(INITIAL_RATE_5P_MORE.minus(2), INITIAL_CPI, 1000);
      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal("Rebase with supply delta 0");
      r = await uFragmentsPolicy.rebase({ from: orchestrator });
      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal(
        "Not enough time elapsed since last rebase"
      );

      await chain.waitForSomeTime(60);

      await mockExternalData(INITIAL_RATE_5P_LESS.plus(2), INITIAL_CPI, 1000);
      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal("Rebase with supply delta 0");
      r = await uFragmentsPolicy.rebase({ from: orchestrator });
      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal(
        "Not enough time elapsed since last rebase"
      );

      await chain.waitForSomeTime(60);
    });
  });
});

contract("UFragmentsPolicy:Rebase", async function (accounts) {
  before("setup UFragmentsPolicy contract", setupContractsWithOpenRebaseWindow);

  describe("when rate is more than MAX_RATE", function () {
    it("should return same supply delta as delta for MAX_RATE", async function () {
      // Any exchangeRate >= (MAX_RATE=100x) would result in the same supply increase
      await mockExternalData(MAX_RATE, INITIAL_CPI, 1000);
      await chain.waitForSomeTime(60);

      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal("OK");
      r = await uFragmentsPolicy.rebase({ from: orchestrator });
      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal(
        "Not enough time elapsed since last rebase"
      );
      const supplyChange = r.logs[0].args.requestedSupplyAdjustment;

      await chain.waitForSomeTime(60);

      conditionResult = await condition.isRebaseCallable();

      // OK Because the first mockExternalData change was so big that we will rebase after each time forwarding
      expect(conditionResult).to.be.equal("OK");

      await mockExternalData(MAX_RATE.add(1e17), INITIAL_CPI, 1000);

      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal("OK");
      r = await uFragmentsPolicy.rebase({ from: orchestrator });

      await chain.waitForSomeTime(60);
      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal("OK");

      await mockExternalData(MAX_RATE.mul(2), INITIAL_CPI, 1000);
      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal("OK");
      r = await uFragmentsPolicy.rebase({ from: orchestrator });
    });
  });
});

contract("UFragmentsPolicy:Rebase", async function (accounts) {
  before("setup UFragmentsPolicy contract", setupContractsWithOpenRebaseWindow);

  describe("when uFragments grows beyond MAX_SUPPLY", function () {
    before(async function () {
      await mockExternalData(INITIAL_RATE_2X, INITIAL_CPI, MAX_SUPPLY.minus(1));
      await chain.waitForSomeTime(60);
    });

    it("should apply SupplyAdjustment {MAX_SUPPLY - totalSupply}", async function () {
      // Supply is MAX_SUPPLY-1, exchangeRate is 2x; resulting in a new supply more than MAX_SUPPLY
      // However, supply is ONLY increased by 1 to MAX_SUPPLY
      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal("OK");
      r = await uFragmentsPolicy.rebase({ from: orchestrator });
    });
  });
});

contract("UFragmentsPolicy:Rebase", async function (accounts) {
  before("setup UFragmentsPolicy contract", setupContractsWithOpenRebaseWindow);

  describe("when uFragments supply equals MAX_SUPPLY and rebase attempts to grow", function () {
    before(async function () {
      await mockExternalData(INITIAL_RATE_2X, INITIAL_CPI, MAX_SUPPLY);
      await chain.waitForSomeTime(60);
    });

    it("should not grow", async function () {
      conditionResult = await condition.isRebaseCallable();
      // Because token supply was set to MAX_SUPPLY we dont have Supply after rebase is higher than MAX_SUPPLY
      expect(conditionResult).to.be.equal("Rebase with supply delta 0");
      r = await uFragmentsPolicy.rebase({ from: orchestrator });
    });
  });
});

contract("UFragmentsPolicy:Rebase", async function (accounts) {
  before("setup UFragmentsPolicy contract", setupContractsWithOpenRebaseWindow);

  describe("when the market oracle returns invalid data", function () {
    it("should fail", async function () {
      await mockExternalData(INITIAL_RATE_30P_MORE, INITIAL_CPI, 1000, false);
      await chain.waitForSomeTime(60);
      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal(
        "Market aggregated value failed to compute"
      );
    });
  });

  describe("when the market oracle returns valid data", function () {
    it("should NOT fail", async function () {
      await mockExternalData(INITIAL_RATE_30P_MORE, INITIAL_CPI, 1000, true);
      await chain.waitForSomeTime(60);
      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal("OK");
    });
  });
});

contract("UFragmentsPolicy:Rebase", async function (accounts) {
  before("setup UFragmentsPolicy contract", setupContractsWithOpenRebaseWindow);

  describe("when the cpi oracle returns invalid data", function () {
    it("should fail", async function () {
      await mockExternalData(
        INITIAL_RATE_30P_MORE,
        INITIAL_CPI,
        1000,
        true,
        false
      );
      await chain.waitForSomeTime(60);
      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal(
        "Cpi aggregated value failed to compute"
      );
    });
  });

  describe("when the cpi oracle returns valid data", function () {
    it("should NOT fail", async function () {
      await mockExternalData(
        INITIAL_RATE_30P_MORE,
        INITIAL_CPI,
        1000,
        true,
        true
      );
      await chain.waitForSomeTime(60);
      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal("OK");
    });
  });
});

contract("UFragmentsPolicy:Rebase", async function (accounts) {
  before("setup UFragmentsPolicy contract", setupContractsWithOpenRebaseWindow);

  describe("positive rate and no change CPI", function () {
    before(async function () {
      await mockExternalData(INITIAL_RATE_30P_MORE, INITIAL_CPI, 1000);
      await uFragmentsPolicy.setRebaseTimingParameters(60, 0, 60);

      // let lastRebaseTimestampSec = await uFragmentsPolicy.lastRebaseTimestampSec();
      // let minRebaseTimeIntervalSec = await uFragmentsPolicy.minRebaseTimeIntervalSec();

      // let currentTIme = await chain.currentTime();
      // console.log(`lastRebaseTimestampSec: ${lastRebaseTimestampSec}`);
      // console.log(`minRebaseTimeIntervalSec: ${minRebaseTimeIntervalSec}`);
      // console.log(`currentTIme: ${currentTIme}`);

      // conditionResult = await condition.isRebaseCallable();
      // console.log(conditionResult);

      await chain.waitForSomeTime(60);

      await uFragmentsPolicy.rebase({ from: orchestrator });
      await chain.waitForSomeTime(59);

      // Even though we skip only 59 secnds, due to earlier tx's incrementing time this is sufficient
      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal("OK");

      prevEpoch = await uFragmentsPolicy.epoch.call();
      prevTime = await uFragmentsPolicy.lastRebaseTimestampSec.call();
      await mockExternalData(INITIAL_RATE_60P_MORE, INITIAL_CPI, 1010);
      r = await uFragmentsPolicy.rebase({ from: orchestrator });
    });

    it("should increment epoch", async function () {
      const epoch = await uFragmentsPolicy.epoch.call();
      expect(prevEpoch.plus(1).eq(epoch));
    });

    it("should update lastRebaseTimestamp", async function () {
      const time = await uFragmentsPolicy.lastRebaseTimestampSec.call();
      expect(time.minus(prevTime).eq(60)).to.be.true;
    });

    it("should emit Rebase with positive requestedSupplyAdjustment", async function () {
      const log = r.logs[0];
      expect(log.event).to.eq("LogRebase");
      expect(log.args.epoch.eq(prevEpoch.plus(1))).to.be.true;
      log.args.exchangeRate.should.be.bignumber.eq(INITIAL_RATE_60P_MORE);
      log.args.cpi.should.be.bignumber.eq(INITIAL_CPI);
      log.args.requestedSupplyAdjustment.should.be.bignumber.eq(20);
    });

    it("should call getData from the market oracle", async function () {
      const fnCalled = mockMarketOracle
        .FunctionCalled()
        .formatter(r.receipt.logs[2]);
      expect(fnCalled.args.instanceName).to.eq("MarketOracle");
      expect(fnCalled.args.functionName).to.eq("getData");
      expect(fnCalled.args.caller).to.eq(uFragmentsPolicy.address);
    });

    it("should call getData from the cpi oracle", async function () {
      const fnCalled = mockCpiOracle
        .FunctionCalled()
        .formatter(r.receipt.logs[0]);
      expect(fnCalled.args.instanceName).to.eq("CpiOracle");
      expect(fnCalled.args.functionName).to.eq("getData");
      expect(fnCalled.args.caller).to.eq(uFragmentsPolicy.address);
    });

    it("should call uFrag Rebase", async function () {
      prevEpoch = await uFragmentsPolicy.epoch.call();
      const fnCalled = mockUFragments
        .FunctionCalled()
        .formatter(r.receipt.logs[4]);
      expect(fnCalled.args.instanceName).to.eq("UFragments");
      expect(fnCalled.args.functionName).to.eq("rebase");
      expect(fnCalled.args.caller).to.eq(uFragmentsPolicy.address);
      const fnArgs = mockUFragments
        .FunctionArguments()
        .formatter(r.receipt.logs[5]);
      const parsedFnArgs = Object.keys(fnArgs.args).reduce((m, k) => {
        return fnArgs.args[k].map((d) => d.toNumber()).concat(m);
      }, []);
      expect(parsedFnArgs).to.include.members([prevEpoch.toNumber(), 20]);
    });
  });
});

contract("UFragmentsPolicy:Rebase", async function (accounts) {
  before("setup UFragmentsPolicy contract", setupContractsWithOpenRebaseWindow);

  describe("negative rate", function () {
    before(async function () {
      await mockExternalData(INITIAL_RATE_30P_LESS, INITIAL_CPI, 1000);
      await chain.waitForSomeTime(60);
      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal("OK");
      r = await uFragmentsPolicy.rebase({ from: orchestrator });
    });

    it("should emit Rebase with negative requestedSupplyAdjustment", async function () {
      const log = r.logs[0];
      expect(log.event).to.eq("LogRebase");
      log.args.requestedSupplyAdjustment.should.be.bignumber.eq(-10);
    });
  });
});

contract("UFragmentsPolicy:Rebase", async function (accounts) {
  before("setup UFragmentsPolicy contract", setupContractsWithOpenRebaseWindow);

  describe("when cpi increases", function () {
    before(async function () {
      await mockExternalData(INITIAL_RATE, INITIAL_CPI_25P_MORE, 1000);
      await chain.waitForSomeTime(60);
      await uFragmentsPolicy.setDeviationThreshold(0);
      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal("OK");
      r = await uFragmentsPolicy.rebase({ from: orchestrator });
    });

    it("should emit Rebase with negative requestedSupplyAdjustment", async function () {
      const log = r.logs[0];
      expect(log.event).to.eq("LogRebase");
      log.args.requestedSupplyAdjustment.should.be.bignumber.eq(-6);
    });
  });
});

contract("UFragmentsPolicy:Rebase", async function (accounts) {
  before("setup UFragmentsPolicy contract", setupContractsWithOpenRebaseWindow);

  describe("when cpi decreases", function () {
    before(async function () {
      await mockExternalData(INITIAL_RATE, INITIAL_CPI_25P_LESS, 1000);
      await chain.waitForSomeTime(60);
      await uFragmentsPolicy.setDeviationThreshold(0);
      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal("OK");
      r = await uFragmentsPolicy.rebase({ from: orchestrator });
    });

    it("should emit Rebase with positive requestedSupplyAdjustment", async function () {
      const log = r.logs[0];
      expect(log.event).to.eq("LogRebase");
      log.args.requestedSupplyAdjustment.should.be.bignumber.eq(9);
    });
  });
});

contract("UFragmentsPolicy:Rebase", async function (accounts) {
  before("setup UFragmentsPolicy contract", setupContractsWithOpenRebaseWindow);

  describe("rate=TARGET_RATE", function () {
    before(async function () {
      await mockExternalData(INITIAL_RATE, INITIAL_CPI, 1000);
      await uFragmentsPolicy.setDeviationThreshold(0);
      await chain.waitForSomeTime(60);
      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal("Rebase with supply delta 0");
      r = await uFragmentsPolicy.rebase({ from: orchestrator });
    });

    it("should emit Rebase with 0 requestedSupplyAdjustment", async function () {
      const log = r.logs[0];
      expect(log.event).to.eq("LogRebase");
      log.args.requestedSupplyAdjustment.should.be.bignumber.eq(0);
    });
  });
});

contract("UFragmentsPolicy:Rebase", async function (accounts) {
  let rbTime,
    rbWindow,
    minRebaseTimeIntervalSec,
    now,
    prevRebaseTime,
    nextRebaseWindowOpenTime,
    timeToWait,
    lastRebaseTimestamp;

  beforeEach("setup UFragmentsPolicy contract", async function () {
    await setupContracts();
    await uFragmentsPolicy.setRebaseTimingParameters(86400, 72000, 900);
    rbTime = await uFragmentsPolicy.rebaseWindowOffsetSec.call();
    rbWindow = await uFragmentsPolicy.rebaseWindowLengthSec.call();
    minRebaseTimeIntervalSec = await uFragmentsPolicy.minRebaseTimeIntervalSec.call();
    now = new BigNumber(await chain.currentTime());
    prevRebaseTime = now.minus(now.mod(minRebaseTimeIntervalSec)).plus(rbTime);
    nextRebaseWindowOpenTime = prevRebaseTime.plus(minRebaseTimeIntervalSec);
  });

  describe("when its 5s after the rebase window closes", function () {
    it("should fail", async function () {
      timeToWait = nextRebaseWindowOpenTime.minus(now).plus(rbWindow).plus(5);
      await chain.waitForSomeTime(timeToWait.toNumber());
      await mockExternalData(INITIAL_RATE, INITIAL_CPI, 1000);

      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal("Not in Rebase Window");

      expect(await uFragmentsPolicy.inRebaseWindow.call()).to.be.false;
      expect(
        await chain.isEthException(
          uFragmentsPolicy.rebase({ from: orchestrator })
        )
      ).to.be.true;
    });
  });

  describe("when its 5s before the rebase window opens", function () {
    it("should fail", async function () {
      timeToWait = nextRebaseWindowOpenTime.minus(now).minus(5);
      await chain.waitForSomeTime(timeToWait.toNumber());
      await mockExternalData(INITIAL_RATE, INITIAL_CPI, 1000);
      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal("Not in Rebase Window");
      expect(await uFragmentsPolicy.inRebaseWindow.call()).to.be.false;
      expect(
        await chain.isEthException(
          uFragmentsPolicy.rebase({ from: orchestrator })
        )
      ).to.be.true;
    });
  });

  describe("when its 5s after the rebase window opens", function () {
    it("should NOT fail", async function () {
      timeToWait = nextRebaseWindowOpenTime.minus(now).plus(5);
      await chain.waitForSomeTime(timeToWait.toNumber());
      await mockExternalData(INITIAL_RATE, INITIAL_CPI_25P_MORE, 1000);

      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal("OK");

      expect(await uFragmentsPolicy.inRebaseWindow.call()).to.be.true;
      expect(
        await chain.isEthException(
          uFragmentsPolicy.rebase({ from: orchestrator })
        )
      ).to.be.false;
      lastRebaseTimestamp = await uFragmentsPolicy.lastRebaseTimestampSec.call();
      expect(lastRebaseTimestamp.eq(nextRebaseWindowOpenTime)).to.be.true;
    });
  });

  describe("when its 5s before the rebase window closes", function () {
    it("should NOT fail", async function () {
      timeToWait = nextRebaseWindowOpenTime.minus(now).plus(rbWindow).minus(5);
      await chain.waitForSomeTime(timeToWait.toNumber());
      await mockExternalData(INITIAL_RATE, INITIAL_CPI_25P_MORE, 1000);

      conditionResult = await condition.isRebaseCallable();
      expect(conditionResult).to.be.equal("OK");

      expect(await uFragmentsPolicy.inRebaseWindow.call()).to.be.true;
      expect(
        await chain.isEthException(
          uFragmentsPolicy.rebase({ from: orchestrator })
        )
      ).to.be.false;
      lastRebaseTimestamp = await uFragmentsPolicy.lastRebaseTimestampSec.call();
      expect(lastRebaseTimestamp.eq(nextRebaseWindowOpenTime)).to.be.true;
    });
  });
});

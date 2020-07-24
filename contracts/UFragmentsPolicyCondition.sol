pragma solidity 0.4.24;

import "./UFragmentsPolicy.sol";

/// @dev Condition Contract to be used as a condition that checks whether a rebase can occur
contract UFragmentsPolicyCondition  {

    using SafeMath for uint256;
    using SafeMathInt for int256;
    using UInt256Lib for uint256;

    UFragments public uFragments;
    UFragmentsPolicy public uFragmentsPolicy;
    IOracle public cpiOracle;
    IOracle public marketOracle;

    // Gelato Consts
    string public constant OK = "OK";

    // UFragmentsPolicy Consts
    uint256 public constant DECIMALS = 18;
    uint256 public constant MAX_SUPPLY = ~(uint256(1) << 255) / MAX_RATE;
    uint256 public constant MAX_RATE = 10**6 * 10**DECIMALS;

    /// @dev TO DO: upddate to actual baseCPI value
    // 100e18
    uint256 public constant BASE_CPI = 100*10**18;

    // UFragments Conts
    uint256 public constant MAX_SUPPLY_UFRAG = ~uint128(0);  // (2^128) - 1

    constructor(address _uFragments, address _uFragmentsPolicy, address _cpiOracle, address _marketOracle)
        public
    {
        uFragments = UFragments(_uFragments);
        uFragmentsPolicy = UFragmentsPolicy(_uFragmentsPolicy);
        cpiOracle = IOracle(_cpiOracle);
        marketOracle = IOracle(_marketOracle);
    }

    /// @notice GelatoCore calls this to verify securely the specified Condition securely
    /// @dev We can leave out the data passed by Gelato Core for now, we don't need it for
    /// the first version
    function ok(uint256, bytes, uint256)
        external
        view
        returns(string memory)
    {
        return isRebaseCallable();
    }

    /// @notice Function which checks IF a rebase can be called. This will return "OK" before the rebase actually happens
    function isRebaseCallable()
        public
        view
        returns (string memory)
    {
        if(!uFragmentsPolicy.inRebaseWindow()) return "Not in Rebase Window";
        if(!(uFragmentsPolicy.lastRebaseTimestampSec().add(uFragmentsPolicy.minRebaseTimeIntervalSec()) < now))
            return "Not enough time elapsed since last rebase";

        // Fetch CPI Oracle
        uint256 cpi;
        bool cpiValid;
        (cpi, cpiValid) = cpiOracle.getData();
        if(!cpiValid) return "Cpi aggregated value failed to compute";

        // Fetch Market Oracle
        uint256 exchangeRate;
        bool rateValid;
        (exchangeRate, rateValid) = marketOracle.getData();
        if(!rateValid) return "Market aggregated value failed to compute";

        if (exchangeRate > MAX_RATE) {
            exchangeRate = MAX_RATE;
        }

        // To DO set real baseCpi level
        uint256 targetRate = cpi.mul(10 ** DECIMALS).div(BASE_CPI);

        // we fetch total supply here to avoid duplicate state reads
        uint256 totalSupply = uFragments.totalSupply();

        int256 supplyDelta = computeSupplyDelta(exchangeRate, targetRate, totalSupply);

        // Apply the Dampening factor.
        supplyDelta = supplyDelta.div(uFragmentsPolicy.rebaseLag().toInt256Safe());

        if (supplyDelta > 0 && uFragments.totalSupply().add(uint256(supplyDelta)) > MAX_SUPPLY) {
            supplyDelta = (MAX_SUPPLY.sub(uFragments.totalSupply())).toInt256Safe();
        }

        if (supplyDelta == 0) return "Rebase with supply delta 0";

        uint256 supplyAfterRebase = getSupplyAfterRebase(supplyDelta);
        if(!(supplyAfterRebase <= MAX_SUPPLY)) return "Supply after rebase is higher than MAX_SUPPLY";

        // If all these checks pass, a rebase is likely to happen soon
        return OK;
    }

    // Checks what the supply after rebase will be
    function getSupplyAfterRebase(int256 _supplyDelta)
        private
        view
        returns (uint256)
    {
        uint256 totalSupply = uFragments.totalSupply();
        if (_supplyDelta == 0) {
            return totalSupply;
        }

        if (_supplyDelta < 0) {
            totalSupply = totalSupply.sub(uint256(_supplyDelta.abs()));
        } else {
            totalSupply = totalSupply.add(uint256(_supplyDelta));
        }

        if (totalSupply > MAX_SUPPLY_UFRAG) {
            totalSupply = MAX_SUPPLY_UFRAG;
        }
        return totalSupply;
    }

    // Copied internal functions from UFragmentsPolicy
    function computeSupplyDelta(uint256 rate, uint256 targetRate, uint _totalSupply)
        private
        view
        returns (int256)
    {
        if (withinDeviationThreshold(rate, targetRate)) {
            return 0;
        }

        // supplyDelta = totalSupply * (rate - targetRate) / targetRate
        int256 targetRateSigned = targetRate.toInt256Safe();
        return _totalSupply.toInt256Safe()
            .mul(rate.toInt256Safe().sub(targetRateSigned))
            .div(targetRateSigned);
    }

    function withinDeviationThreshold(uint256 rate, uint256 targetRate)
        private
        view
        returns (bool)
    {
        uint256 absoluteDeviationThreshold = targetRate.mul(uFragmentsPolicy.deviationThreshold())
            .div(10 ** DECIMALS);

        return (rate >= targetRate && rate.sub(targetRate) < absoluteDeviationThreshold)
            || (rate < targetRate && targetRate.sub(rate) < absoluteDeviationThreshold);
    }


}
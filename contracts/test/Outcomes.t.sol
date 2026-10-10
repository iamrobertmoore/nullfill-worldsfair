// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {Nullfill} from "../src/Nullfill.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev The baseline: the escrow most people would write first. The funder deposits against any
///      deadline, the funder releases to the beneficiary, and after the deadline the funder takes
///      the money back. No reference, no recovery address, no floor on the deadline, and it trusts
///      the amount it was asked for. Nothing here is a strawman bug; every line is the ordinary way.
contract NaiveEscrow {
    using SafeERC20 for IERC20;

    struct Order { address funder; address beneficiary; IERC20 token; uint256 amount; uint64 deadline; bool open; }
    Order[] public orders;

    function open(address beneficiary, IERC20 token, uint256 amount, uint64 deadline) external returns (uint256 id) {
        token.safeTransferFrom(msg.sender, address(this), amount);
        orders.push(Order(msg.sender, beneficiary, token, amount, deadline, true));
        return orders.length - 1;
    }

    function release(uint256 id) external {
        Order storage o = orders[id];
        require(o.open && msg.sender == o.funder, "not allowed");
        o.open = false;
        o.token.safeTransfer(o.beneficiary, o.amount);
    }

    function refund(uint256 id) external {
        Order storage o = orders[id];
        require(o.open && msg.sender == o.funder && block.timestamp >= o.deadline, "not allowed");
        o.open = false;
        o.token.safeTransfer(o.funder, o.amount);
    }

    function count() external view returns (uint256) { return orders.length; }
}

/// @dev A six-decimal dollar. Screening is modelled the only way a contract can see it: an address
///      that is blocked never sends a transaction, so the tests simply never act as it.
contract Usd is ERC20 {
    constructor() ERC20("Dollar", "USD") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract ShortUsd is Usd {
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            super._update(from, address(0xdead), value / 100);
            super._update(from, to, value - value / 100);
        } else {
            super._update(from, to, value);
        }
    }
}

/// @title Five settlement outcomes, the same scenario run against the naive escrow and against Nullfill.
/// @notice An outcome is correct when, at the end, every dollar is where the trade says it should be,
///         and nothing depends on a blocked party sending a transaction. The baseline is computed here,
///         not observed in the wild. Run with `forge test --match-path test/Outcomes.t.sol -vv`.
contract OutcomesTest is Test {
    uint256 constant AMOUNT = 1_000e6;
    address desk = makeAddr("desk");
    address recovery = makeAddr("desk-recovery");
    address counterparty = makeAddr("counterparty");
    address stranger = makeAddr("stranger");

    function _fresh(Usd usd) internal returns (NaiveEscrow naive, Nullfill nf) {
        naive = new NaiveEscrow();
        nf = new Nullfill();
        usd.mint(desk, 10 * AMOUNT);
        vm.startPrank(desk);
        usd.approve(address(naive), type(uint256).max);
        usd.approve(address(nf), type(uint256).max);
        vm.stopPrank();
    }

    // 1. Nothing goes wrong: the desk releases the cash.
    function _happy() internal returns (bool naiveOk, bool nfOk) {
        Usd usd = new Usd();
        (NaiveEscrow naive, Nullfill nf) = _fresh(usd);
        vm.startPrank(desk);
        uint256 id = naive.open(counterparty, usd, AMOUNT, uint64(block.timestamp + 1 days));
        naive.release(id);
        nf.open("happy", counterparty, usd, AMOUNT, uint64(block.timestamp + 1 days), recovery);
        nf.settle("happy");
        vm.stopPrank();
        naiveOk = usd.balanceOf(counterparty) >= AMOUNT;
        nfOk = usd.balanceOf(counterparty) == 2 * AMOUNT;
    }

    // 2. The trade fails and the desk is screened before the deadline. It can no longer send anything.
    //    Correct: the money still goes home, without the desk transacting.
    function _deskScreened() internal returns (bool naiveOk, bool nfOk) {
        Usd usd = new Usd();
        (NaiveEscrow naive, Nullfill nf) = _fresh(usd);
        vm.startPrank(desk);
        uint256 id = naive.open(counterparty, usd, AMOUNT, uint64(block.timestamp + 1 days));
        nf.open("screened", counterparty, usd, AMOUNT, uint64(block.timestamp + 1 days), recovery);
        vm.stopPrank();
        vm.warp(block.timestamp + 2 days);
        // The desk is blocked from here on. Only someone else can act.
        vm.prank(stranger);
        try naive.refund(id) {} catch {}
        vm.prank(stranger);
        try nf.unwind("screened") {} catch {}
        naiveOk = usd.balanceOf(desk) + usd.balanceOf(recovery) >= 10 * AMOUNT; // never: the funds are stuck
        nfOk = usd.balanceOf(recovery) == AMOUNT;
    }

    // 3. The counterparty delivered, but its delivery was screened at the door and only arrives by
    //    force inclusion 20 hours later. The desk set a one hour deadline and, seeing nothing, refunded.
    //    Correct: the counterparty is paid for what it delivered.
    function _lateArrival() internal returns (bool naiveOk, bool nfOk) {
        Usd usd = new Usd();
        (NaiveEscrow naive, Nullfill nf) = _fresh(usd);
        uint256 t0 = block.timestamp;
        vm.startPrank(desk);
        uint256 id = naive.open(counterparty, usd, AMOUNT, uint64(t0 + 1 hours));
        // Nullfill will not take a deadline inside the window, so the desk gets the earliest it allows.
        try nf.open("late", counterparty, usd, AMOUNT, uint64(t0 + 1 hours), recovery) {} catch {
            nf.open("late", counterparty, usd, AMOUNT, uint64(t0 + nf.FORCE_INCLUSION_WINDOW()), recovery);
        }
        vm.warp(t0 + 1 hours);
        try naive.refund(id) {} catch {}
        try nf.unwind("late") {} catch {} // refused: the window is still open
        // Hour 20: the delivery lands. The desk now knows the trade happened and pays.
        vm.warp(t0 + 20 hours);
        bool naivePaid = true;
        try naive.release(id) {} catch { naivePaid = false; } // already refunded: the counterparty is not paid
        bool nfPaid = true;
        try nf.settle("late") {} catch { nfPaid = false; }
        vm.stopPrank();
        naiveOk = naivePaid;
        nfOk = nfPaid && usd.balanceOf(counterparty) == AMOUNT;
    }

    // 4. The desk's open seemed to vanish, so it sent it again, and both arrived.
    //    Correct: one escrow, one deposit.
    function _retry() internal returns (bool naiveOk, bool nfOk) {
        Usd usd = new Usd();
        (NaiveEscrow naive, Nullfill nf) = _fresh(usd);
        vm.startPrank(desk);
        uint64 dl = uint64(block.timestamp + 1 days);
        naive.open(counterparty, usd, AMOUNT, dl);
        naive.open(counterparty, usd, AMOUNT, dl);
        nf.open("retry", counterparty, usd, AMOUNT, dl, recovery);
        try nf.open("retry", counterparty, usd, AMOUNT, dl, recovery) {} catch {}
        vm.stopPrank();
        naiveOk = usd.balanceOf(address(naive)) == AMOUNT;
        nfOk = usd.balanceOf(address(nf)) == AMOUNT;
    }

    // 5. The asset delivers one percent less than asked. Two desks escrow, both trades fail.
    //    Correct: nobody's refund is paid out of someone else's deposit.
    function _shortAsset() internal returns (bool naiveOk, bool nfOk) {
        ShortUsd usd = new ShortUsd();
        (NaiveEscrow naive, Nullfill nf) = _fresh(usd);
        uint64 dl = uint64(block.timestamp + 1 days);
        vm.startPrank(desk);
        uint256 a = naive.open(counterparty, usd, AMOUNT, dl);
        uint256 b = naive.open(counterparty, usd, AMOUNT, dl);
        bool nfOpened = true;
        try nf.open("short", counterparty, usd, AMOUNT, dl, recovery) {} catch { nfOpened = false; }
        vm.warp(dl);
        naive.refund(a);
        bool secondPaid = true;
        try naive.refund(b) {} catch { secondPaid = false; }
        vm.stopPrank();
        naiveOk = secondPaid; // the first refund spent part of the second deposit, so the second fails
        nfOk = !nfOpened && usd.balanceOf(address(nf)) == 0;
    }

    function test_Outcomes_NullfillFiveOfFive_NaiveOneOfFive() public {
        string[5] memory names = ["nothing goes wrong", "desk screened, trade fails", "delivery lands late, inside 24h", "the open is retried", "asset delivers short"];
        bool[5] memory n;
        bool[5] memory f;
        (n[0], f[0]) = _happy();
        (n[1], f[1]) = _deskScreened();
        (n[2], f[2]) = _lateArrival();
        (n[3], f[3]) = _retry();
        (n[4], f[4]) = _shortAsset();
        uint256 nCount; uint256 fCount;
        for (uint256 i; i < 5; i++) {
            console.log(string.concat(names[i], ": naive ", n[i] ? "correct" : "WRONG", ", Nullfill ", f[i] ? "correct" : "WRONG"));
            if (n[i]) nCount++;
            if (f[i]) fCount++;
        }
        console.log("correct outcomes: naive", nCount, "of 5, Nullfill", fCount);
        assertEq(fCount, 5, "Nullfill gets every outcome right");
        assertEq(nCount, 1, "the naive escrow gets only the happy path right");
    }
}

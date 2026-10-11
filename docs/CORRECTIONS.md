# Corrections

Claims this repository published and then changed. Kept because a correction is more useful than a silent edit, and because the list is the honest measure of how much of the rest survived checking.

**9 October 2026.** The exact-deposit guard held back on 28 September now ships, in a new deployment at `0xb834…1FC9`, with its bytecode checked against this source. The first deployment is left as it was.

**29 September 2026.** This README said a failure receipt cannot tell you why it failed. For the filter's own refusals on mainnet, it can: the chain lists them at `0x74`, and the classifier now reads that list. The limit is rewritten above as what is still true, that a refusal at the sequencer's door leaves no record at all.

**28 September 2026.** This README said the local reproduction was "written up in the repository history". It was not. No commit and no file mentioned it. The writeup now exists at [`docs/reproduction.md`](docs/reproduction.md), and the sentence points at it. The claim was true about the work and false about the record.

**28 September 2026.** The test count above said 29. It was 29 when written and 44 by the time anyone read it, because a second test file was added. A count is only meaningful with a date attached, and it had none.

**28 September 2026.** The deposit path accepts an amount without checking what arrived, so a fee on transfer token would leave one order able to spend another order's balance. Found while writing the USDG tests. I wrote the fix, a balance delta check, and then took it back out of this repository, because shipping it meant redeploying the contract in the last week of the buildathon and the repository would otherwise no longer match its own deployment. The limit is now stated under "What this will not claim", pinned by a test, and the fix ships with the next deployment.

**28 September 2026.** An earlier version of this README said the route to testnet USDG was undocumented. It is documented: Paxos runs a testnet faucet that covers Robinhood Chain, 100 USDG per wallet per day. The two live orders above were funded from it.


"""Count the transactions Robinhood Chain's compliance filter has refused, from the chain's own registry.

ArbOS keeps the registry at the precompile 0x74. Every registration emits one log whose topics[1] is the
filtered transaction's hash. This reads every such log on mainnet and counts distinct hashes.

    python3 tools/count-filtered.py
"""
import json, urllib.request, collections, datetime

RPC = "https://rpc.mainnet.chain.robinhood.com"
REGISTRY = "0x0000000000000000000000000000000000000074"


def rpc(method, params):
    req = urllib.request.Request(RPC, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                                 headers={"content-type": "application/json", "user-agent": "curl/8.5.0"})
    r = json.load(urllib.request.urlopen(req, timeout=120))
    if "error" in r:
        raise RuntimeError(r["error"])
    return r["result"]


head = int(rpc("eth_blockNumber", []), 16)
logs, start, step = [], 0, 5_000_000  # the public RPC caps a query at 10 million blocks
while start <= head:
    end = min(start + step - 1, head)
    logs += rpc("eth_getLogs", [{"address": REGISTRY, "fromBlock": hex(start), "toBlock": hex(end)}])
    start = end + 1

hashes = {l["topics"][1] for l in logs}
blocks = sorted(int(l["blockNumber"], 16) for l in logs)
when = lambda b: datetime.datetime.fromtimestamp(int(rpc("eth_getBlockByNumber", [hex(b), False])["timestamp"], 16), datetime.timezone.utc)
print(f"read at block {head:,}: {len(logs):,} registrations, {len(hashes):,} distinct transactions")
if blocks:
    print(f"first {when(blocks[0]):%d %b %Y %H:%M} UTC, last {when(blocks[-1]):%d %b %Y %H:%M} UTC")

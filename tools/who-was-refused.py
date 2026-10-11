"""Read back the transactions behind Robinhood Chain's filtered-transactions registry and count who sent them.

    python3 tools/who-was-refused.py

Reads every registration log at the ArbOS precompile 0x74 on mainnet (as count-filtered.py does), fetches each
transaction with eth_getTransactionByHash, and prints distinct senders, the busiest sender's share, and the most
repeated identical token transfer. Addresses are not printed: the point is the pattern, not the parties.
"""
import json, urllib.request, collections, time

RPC = "https://rpc.mainnet.chain.robinhood.com"
H = {"content-type": "application/json", "user-agent": "curl/8.5.0"}


def post(body):
    for attempt in range(6):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(RPC, data=json.dumps(body).encode(), headers=H), timeout=60))
        except Exception:
            time.sleep(3 * (attempt + 1))
    raise SystemExit("RPC kept failing")


head = int(post({"jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": []})["result"], 16)
logs, start = [], 0
while start <= head:
    end = min(start + 5_000_000 - 1, head)
    logs += post({"jsonrpc": "2.0", "id": 1, "method": "eth_getLogs", "params": [{"address": "0x0000000000000000000000000000000000000074", "fromBlock": hex(start), "toBlock": hex(end)}]})["result"]
    start = end + 1
hashes = sorted({l["topics"][1] for l in logs})
txs = []
for i in range(0, len(hashes), 20):
    for r in post([{"jsonrpc": "2.0", "id": j, "method": "eth_getTransactionByHash", "params": [h]} for j, h in enumerate(hashes[i:i + 20])]):
        if r.get("result"):
            txs.append(r["result"])
    time.sleep(0.6)
senders = collections.Counter(t["from"] for t in txs)
transfers = collections.Counter((t["from"], (t.get("to") or "").lower(), t["input"][:138]) for t in txs if t.get("input", "").startswith("0xa9059cbb"))
top = transfers.most_common(1)[0] if transfers else None
print(f"{len(hashes):,} refused transactions in the registry; {len(txs):,} read back")
print(f"{len(senders)} distinct senders; the busiest sent {senders.most_common(1)[0][1]:,}")
if top:
    print(f"most repeated identical token transfer: sent {top[1]} times")

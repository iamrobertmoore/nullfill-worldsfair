// The judges' page. Two things a judge can do against the live contract, with no wallet of their own:
// unwind an expired escrow as a stranger (a real transaction), and run five attacks as calls.
import {
  JsonRpcProvider, Wallet, Contract, Interface, id, formatUnits, getAddress,
} from 'https://cdn.jsdelivr.net/npm/ethers@6.13.4/dist/ethers.min.js';

const RPC = 'https://rpc.testnet.chain.robinhood.com';
const CHAIN_ID = 46630;
const EXPLORER = 'https://explorer.testnet.chain.robinhood.com';
export const NULLFILL = '0x0503e528155c236f100efbf5A4A4A368C1fAFF99';
const USDG = '0x7E955252E15c84f5768B83c41a71F9eba181802F';
const BENEFICIARY = '0xaAe247DC771532320050416d0e83BBe7220057D9';

// A throwaway testnet gas wallet, published on purpose. See the footer of the page.
const STRANGER_KEY = '0xe1be047200f8db33f80eead82c42a641e2e92a12590f88e2d42ceda73b966a7e';

// Escrows set aside for judges on v1.2, opened 11 October 2026 with deadlines on 12 October:
// three of 2 USDG (25 to 27), then twenty-four of 1 USDG (01 to 24).
const SEEDED = [25, 26, 27, ...Array.from({ length: 24 }, (_, i) => i + 1)]
  .map((n) => id(`nullfill-v12-judges-${String(n).padStart(2, '0')}`));
const LONG = id('nullfill-v12-judges-long'); // open until December, so "too early" is always testable
const CLOSED = id('nullfill-v12-judges-closed'); // opened and settled at once, so "already closed" is always testable

const ABI = [
  'function describe(bytes32) view returns (uint8 status, address funder, address beneficiary, address unwindTo, address token, uint256 amount, uint64 deadline, bool unwindable)',
  'function open(bytes32 ref, address beneficiary, address token, uint256 amount, uint64 deadline, address unwindTo)',
  'function settle(bytes32 ref)',
  'function unwind(bytes32 ref)',
  'function FORCE_INCLUSION_WINDOW() view returns (uint64)',
  'error RefAlreadyUsed(bytes32 ref)',
  'error UnknownRef(bytes32 ref)',
  'error NotOpen(bytes32 ref, uint8 status)',
  'error DeadlineTooSoon(uint64 earliest)',
  'error NotYetUnwindable(bytes32 ref, uint64 deadline)',
  'error NotAParty(bytes32 ref, address caller)',
  'error TransferNotExact(uint256 expected, uint256 received)',
];
const ERC20 = ['function balanceOf(address) view returns (uint256)'];
const STATUS = ['None', 'Open', 'Settled', 'Unwound'];

const provider = new JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
const nullfill = new Contract(NULLFILL, ABI, provider);
const usdg = new Contract(USDG, ERC20, provider);
const iface = new Interface(ABI);
const stranger = new Wallet(STRANGER_KEY, provider);

const $ = (sel) => document.querySelector(sel);
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const tx = (h, label) => `<a class="mono" href="${EXPLORER}/tx/${h}" target="_blank" rel="noopener">${label ?? short(h)}</a>`;
const addr = (a) => `<a class="mono" href="${EXPLORER}/address/${a}" target="_blank" rel="noopener">${short(a)}</a>`;
const usd = (v) => `${Number(formatUnits(v, 6)).toFixed(2)} USDG`;
const when = (t) => new Date(t * 1000).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function describe(ref) {
  const d = await nullfill.describe(ref);
  return { ref, status: STATUS[Number(d.status)], funder: d.funder, unwindTo: d.unwindTo, amount: d.amount, deadline: Number(d.deadline), unwindable: d.unwindable };
}

// ------------------------------------------------------------------ 01 be the stranger

let seeded = [];

async function loadSeeded() {
  seeded = await Promise.all(SEEDED.map(describe));
  const ready = seeded.filter((o) => o.unwindable);
  const waiting = seeded.filter((o) => o.status === 'Open' && !o.unwindable);
  const done = seeded.filter((o) => o.status === 'Unwound');
  $('#seed-counts').textContent =
    `${seeded.length} escrows set aside for judges · ${ready.length} ready to unwind · ${waiting.length} not yet expired · ${done.length} already sent home by visitors`;
  return { ready, waiting, done };
}

async function renderStranger() {
  const card = $('#stranger-card');
  let state;
  try { state = await loadSeeded(); } catch (e) {
    card.innerHTML = `<p class="bad">Couldn't reach the chain (${e.shortMessage ?? e.message}). The recorded run in section 03 is on chain regardless.</p>`;
    return;
  }
  const gas = await provider.getBalance(stranger.address);
  const target = state.ready[0];

  if (!target) {
    const next = state.waiting.sort((a, b) => a.deadline - b.deadline)[0];
    card.innerHTML = next
      ? `<p>None of the judges' escrows has expired yet. The first one becomes unwindable on <b>${when(next.deadline)}</b>, and until then the contract refuses (try it in section 02).</p>`
      : `<p>Every escrow set aside for judges has already been unwound by visitors. The recorded run in section 03 shows the same thing on chain.</p>`;
    return;
  }

  const before = await usdg.balanceOf(target.unwindTo);
  const lowGas = gas < 2_000_000_000_000n; // 0.000002 ETH, comfortably more than one unwind
  card.innerHTML = `
    <div class="j-escrow">
      <dl>
        <div><dt>Escrow</dt><dd class="mono">${short(target.ref)}</dd></div>
        <div><dt>Holds</dt><dd>${usd(target.amount)}</dd></div>
        <div><dt>Deadline passed</dt><dd>${when(target.deadline)}</dd></div>
        <div><dt>Recovery address</dt><dd>${addr(target.unwindTo)} · holds <b id="rec-bal">${usd(before)}</b></dd></div>
        <div><dt>You, the stranger</dt><dd>${addr(stranger.address)} · never a party to this escrow</dd></div>
      </dl>
      <div class="j-status"><span class="j-pill open" id="pill">Open</span></div>
    </div>
    ${lowGas
      ? `<p class="warn">The stranger wallet is out of gas, probably because someone emptied it. Section 03 shows the same unwind on chain.</p>`
      : `<button type="button" class="btn primary" id="unwind">Unwind it <span aria-hidden="true">→</span></button>`}
    <div class="j-log mono" id="log" aria-live="polite"></div>`;
  $('#unwind')?.addEventListener('click', () => unwind(target, before));
}

async function unwind(target, before) {
  const btn = $('#unwind');
  const log = $('#log');
  btn.disabled = true;
  const line = (s) => { log.insertAdjacentHTML('beforeend', `<div>${s}</div>`); };
  try {
    line('Signing unwind() as the stranger…');
    const sent = await nullfill.connect(stranger).unwind(target.ref);
    line(`Sent ${tx(sent.hash)}. Waiting for the block…`);
    const rcpt = await sent.wait();
    line(`Included in block ${rcpt.blockNumber}.`);
    const after = await describe(target.ref);
    const bal = await usdg.balanceOf(target.unwindTo);
    $('#pill').textContent = after.status;
    $('#pill').className = `j-pill ${after.status.toLowerCase()}`;
    $('#rec-bal').textContent = usd(bal);
    line(`Status read back from the contract: <b>${after.status}</b>.`);
    line(`Recovery address: ${usd(before)} → <b>${usd(bal)}</b>. Your wallet paid the gas and received nothing.`);
    line('The person who opened it never had to send a transaction. That is the point.');
    loadSeeded();
  } catch (e) {
    const why = decode(e);
    line(`<span class="bad">Refused: ${why ?? e.shortMessage ?? e.message}</span>`);
    if (why?.startsWith('NotOpen')) line('Someone else got there first. Reload for the next one.');
    btn.disabled = false;
  }
}

// ------------------------------------------------------------------ 02 try to break it

function decode(e) {
  const data = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
  if (!data || typeof data !== 'string') return null;
  try { const p = iface.parseError(data); return p ? `${p.name}` : null; } catch { return null; }
}

async function expectRevert(callData, expected) {
  try {
    await provider.call({ to: NULLFILL, from: stranger.address, data: callData });
    return { held: false, got: 'the call succeeded' };
  } catch (e) {
    const got = decode(e) ?? (e.shortMessage ?? 'reverted without a reason');
    return { held: got === expected, got };
  }
}

function attacks(now, closedRef) {
  const fresh = id(`judge-probe-${now}-${Math.random()}`);
  const list = [
    {
      title: 'Open an escrow whose deadline sits inside the 24 hour window',
      why: 'A transaction screened now could still arrive by force inclusion inside that window, and land on top of a refund.',
      data: iface.encodeFunctionData('open', [fresh, BENEFICIARY, USDG, 1_000_000n, BigInt(now + 3600), BENEFICIARY]),
      expected: 'DeadlineTooSoon',
    },
    {
      title: 'Unwind an escrow before its deadline',
      why: 'Early refunds are how a late but genuine payment ends up paying twice.',
      data: iface.encodeFunctionData('unwind', [LONG]),
      expected: 'NotYetUnwindable',
    },
    {
      title: "Settle someone else's escrow as a stranger",
      why: 'Only the two parties can release funds to the beneficiary. A stranger can only send money home.',
      data: iface.encodeFunctionData('settle', [LONG]),
      expected: 'NotAParty',
    },
    {
      title: 'Retry an open with a reference that is already used',
      why: 'A retried transaction must never open a second escrow, or a desk pays twice.',
      data: iface.encodeFunctionData('open', [LONG, BENEFICIARY, USDG, 1_000_000n, BigInt(now + 2 * 86400), BENEFICIARY]),
      expected: 'RefAlreadyUsed',
    },
  ];
  if (closedRef) {
    list.push({
      title: 'Unwind an escrow that has already been sent home',
      why: 'Every state change is one way. A closed escrow cannot pay out again.',
      data: iface.encodeFunctionData('unwind', [closedRef]),
      expected: 'NotOpen',
    });
  }
  return list;
}

async function runAttacks() {
  const btn = $('#run-attacks');
  btn.disabled = true;
  const now = (await provider.getBlock('latest')).timestamp;
  const closed = seeded.find((o) => o.status === 'Unwound' || o.status === 'Settled')?.ref ?? CLOSED;
  const list = attacks(now, closed);
  const ol = $('#attack-list');
  ol.innerHTML = list.map((a, i) => `<li id="atk-${i}"><div class="j-atk-title">${a.title}</div><div class="muted">${a.why}</div><div class="j-atk-result mono">running…</div></li>`).join('');
  let held = 0;
  for (const [i, a] of list.entries()) {
    const r = await expectRevert(a.data, a.expected);
    if (r.held) held += 1;
    const el = $(`#atk-${i} .j-atk-result`);
    el.innerHTML = r.held ? `<span class="good">Refused · ${r.got}</span>` : `<span class="bad">Not refused as expected · ${r.got}</span>`;
    $(`#atk-${i}`).classList.add(r.held ? 'held' : 'broke');
  }
  $('#attack-score').textContent = `${held} of ${list.length}`;
  $('#attack-score-label').textContent = held === list.length ? 'refused, each with the exact error the contract defines' : 'refused';
  if (list.length < 5) $('#attack-score-label').textContent += ' (the fifth unlocks once a judges’ escrow has been unwound)';
  btn.disabled = false;
  btn.innerHTML = 'Run them again <span aria-hidden="true">→</span>';
}

// ------------------------------------------------------------------ boot

async function boot() {
  const link = $('#contract-link');
  link.href = `${EXPLORER}/address/${NULLFILL}`;
  link.textContent = short(getAddress(NULLFILL));
  try {
    const n = await provider.getBlockNumber();
    $('#block').textContent = n.toLocaleString();
    $('#net-dot').classList.add('online');
  } catch { $('#net-dot').classList.add('offline'); }
  await renderStranger();
  $('#run-attacks').addEventListener('click', runAttacks);
}

boot();

// Renders docs/draft-board.html from `mock-draft.mjs --json`.
//
// The JSON carries two different things per pick: the player the representative
// run took, and the consensus over all 50 runs. Neither alone makes a good
// board. The run is a legal draft but sometimes hands a manager a 2% name; the
// per-pick consensus names the likeliest player but is a set of marginals, so
// reading it straight down the board hands the same player to two managers.
//
// This reconciles them. Each cell keeps the position the run gave it, then
// every (pick, player) pairing across the fifty drafts competes for cells
// strongest first, so a player lands on the pick where he actually went most
// often rather than on whichever pick reached for him earliest. Legal by
// construction — nobody is drafted twice, nobody ends up with three
// quarterbacks — and every cell names the likeliest player still sitting there.
import { readdir, readFile, writeFile } from 'node:fs/promises';

const OUT = new URL('../docs/draft-board.html', import.meta.url);
// K and DEF are drafted as generic slots rather than named players, so they are
// the one thing that legitimately repeats down the board.
const GENERIC = new Set(['K', 'DEF']);
// Under a fifth of the drafts is a plausible name rather than a projection; at
// that point the position is the firmer signal and the cell says so.
const WEAK_BELOW = 20;
const SUFFIXES = new Set(['Jr.', 'Sr.', 'II', 'III', 'IV', 'V']);
const PARTICLES = new Set(['St.', 'Van', 'Von', 'De', 'Del', 'La', 'Le', 'Da']);

const NAMES = {
  jerv: 'Jerv',
  zichen225: 'Zi',
  djho57: 'dho',
  alexngo1994: 'alex',
  VietMagic312: 'Johnny',
  drapheus: 'Keith',
  alvo123: 'Alvin',
  YOU: 'YOU',
  CheeksSlapper: 'Elton',
  aprounh: 'Prounh',
  trizillah: 'Tri',
  clvnluu: 'Calvin',
};

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": '#x27' }[c]};`);

// "Marvin Harrison Jr." -> "Harrison", "Amon-Ra St. Brown" -> "St. Brown".
const short = (name) => {
  const parts = String(name).split(/\s+/);
  while (parts.length > 1 && SUFFIXES.has(parts.at(-1))) parts.pop();
  const last = parts.at(-1);
  return parts.length > 2 && PARTICLES.has(parts.at(-2)) ? `${parts.at(-2)} ${last}` : last;
};

// A cell is 96px wide, so it shows a surname — until two of them are the same.
// Chase Brown, A.J. Brown and Amon-Ra St. Brown all go in this draft, and three
// cells reading "Brown" is worse than no name at all.
const labeller = (names) => {
  const groups = new Map();
  for (const name of names) {
    const key = short(name);
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key).add(name);
  }

  const labels = new Map();
  for (const [surname, group] of groups) {
    // Surname alone, then an initial, then the whole first name — stopping at
    // the first form that tells the two of them apart. Jordan and Jeremiyah
    // Love share an initial, so they need the long version; Chase and A.J.
    // Brown do not.
    const forms = [() => surname, (n) => `${n[0]}. ${surname}`, (n) => `${n.split(/\s+/)[0]} ${surname}`];
    const form =
      forms.find((f) => new Set([...group].map((n) => f(n))).size === group.size) ?? ((n) => n);
    for (const name of group) labels.set(name, form(name));
  }
  return (name) => labels.get(name) ?? short(name);
};

export function reconcile(picks, pool = []) {
  // Each cell keeps the position the run gave it and only competes for a better
  // name within that position. That is what holds the rosters together: the run
  // is a legal draft, so borrowing its positional skeleton means nobody ends up
  // with three quarterbacks and nobody's shape drifts. Counting positions per
  // manager instead does not work — a manager will spend his five back slots on
  // whichever picks he is most confident about and then have none left for the
  // pick where a back was the obvious call.
  const options = new Map();
  for (const p of picks) {
    const seen = new Set();
    options.set(
      p.overall,
      [{ name: p.name, position: p.position, pct: p.pct, fromRun: true }, ...(p.alts ?? [])]
        .filter((c) => c.position === p.position)
        .filter((c) => (seen.has(c.name) ? false : seen.add(c.name)))
        .sort((a, b) => b.pct - a.pct || Number(b.fromRun ?? false) - Number(a.fromRun ?? false)),
    );
  }

  const claimed = new Set();
  const taken = new Map();

  const assign = (p, chosen) => {
    taken.set(p.overall, chosen);
    if (!GENERIC.has(chosen.position)) claimed.add(chosen.name);
  };

  const byOverall = new Map(picks.map((p) => [p.overall, p]));
  for (const p of picks) if (GENERIC.has(p.position)) assign(p, { ...p, fromRun: true });

  // Every (pick, player) pairing the fifty drafts produced, strongest first. A
  // player belongs to the pick where he went most often, not to whichever pick
  // happens to come first: Breece Hall is 14% at pick 27 and 26% at pick 32, so
  // he is pick 32's man and 27 moves on to its next name.
  const pairs = [];
  for (const [overall, cands] of options) {
    if (GENERIC.has(byOverall.get(overall).position)) continue;
    for (const c of cands) pairs.push({ overall, c });
  }
  pairs.sort(
    (a, b) =>
      b.c.pct - a.c.pct || Number(b.c.fromRun ?? false) - Number(a.c.fromRun ?? false) || a.overall - b.overall,
  );

  for (const { overall, c } of pairs) {
    if (taken.has(overall) || claimed.has(c.name)) continue;
    assign(byOverall.get(overall), c);
  }

  // Greedy strands a handful of picks: every name that ever went there is spoken
  // for by a pick that wanted them more. Shuffling the board to free one up
  // would mean demoting a cell that is well established, so those picks fall
  // back to the board itself — the best player left at that position by ADP,
  // which is what a manager staring at a picked-over board would do anyway.
  const gaps = [];
  for (const p of picks) {
    if (taken.has(p.overall)) continue;
    const best = pool.find((c) => c.position === p.position && !claimed.has(c.name));
    if (!best) {
      gaps.push(p.overall);
      continue;
    }
    assign(p, { ...best, pct: 0, fallback: true });
  }

  const board = picks
    .map((p) => {
      const chosen = taken.get(p.overall);
      return {
        overall: p.overall,
        round: p.round,
        slot: p.slot,
        who: p.who,
        name: chosen?.name ?? null,
        position: chosen?.position ?? p.position,
        pct: chosen?.pct ?? 0,
        fallback: chosen?.fallback === true,
        positionPct: p.positionPct,
        modalPosition: p.positions?.[0]?.position ?? p.position,
        // Everything the pick could have been, minus whoever ended up on it.
        alts: options
          .get(p.overall)
          .filter((c) => c.name !== chosen?.name)
          .slice(0, 3),
      };
    })
    .sort((a, b) => a.overall - b.overall);

  return { board, gaps };
}

const cell = (p, mySlot, first, last, label) => {
  const mine = p.slot === mySlot;
  const weak = p.pct < WEAK_BELOW && !GENERIC.has(p.position);
  const classes = ['cell', `p-${p.position}`, first && 'flow-in', last && 'flow-out', mine && 'mine', weak && 'weak']
    .filter(Boolean)
    .join(' ');
  const alts = p.alts.map((a) => `${short(a.name)} ${a.pct}%`).join(' · ');
  const title =
    `#${p.overall} — ` +
    (p.name === null
      ? `nothing left at ${p.position}`
      : p.fallback
        ? `${p.name} — best ${p.position} left on the board`
        : `${p.name}, ${p.pct}%`) +
    (weak && p.name && !p.fallback ? ` · ${p.modalPosition} in ${p.positionPct}% of drafts` : '') +
    (alts ? `   also: ${alts}` : '');
  const shown = GENERIC.has(p.position) ? p.position : p.name ? label(p.name) : '—';
  return (
    `<td class="${classes}" title="${esc(title)}">` +
    `<span class="ov">${p.overall}</span>` +
    `<span class="pos">${p.position}</span>` +
    `<span class="nm">${esc(shown)}</span>` +
    (weak ? `<span class="hint">${p.fallback ? 'best left' : `${p.positionPct}% ${p.modalPosition}`}</span>` : '') +
    `<span class="conf" style="--w:${p.pct}%"></span>` +
    `<span class="pct">${GENERIC.has(p.position) || p.fallback ? '' : p.pct}</span>` +
    `</td>`
  );
};

const card = (p) => {
  const alts = p.alts.map((a) => `${esc(a.name)} ${a.pct}%`);
  const weak = p.pct < WEAK_BELOW && !GENERIC.has(p.position);
  if (p.fallback) alts.unshift(`best ${p.position} left on the board`);
  else if (weak) alts.unshift(`${p.modalPosition} in ${p.positionPct}% of drafts`);
  return (
    `<li class="shortlist-item">` +
    `<div class="sl-head"><span class="sl-pick">${p.round}.${String(p.slot).padStart(2, '0')}</span>` +
    `<span class="sl-ov">pick ${p.overall}</span></div>` +
    `<div class="sl-main"><span class="chip p-${p.position}">${p.position}</span>` +
    `<b>${esc(GENERIC.has(p.position) ? { K: 'Kicker', DEF: 'Defense' }[p.position] : p.name)}</b>` +
    `<span class="sl-pct">${GENERIC.has(p.position) || p.fallback ? '' : `${p.pct}%`}</span></div>` +
    `<div class="sl-alt">${GENERIC.has(p.position) ? 'last two rounds' : alts.join(' · ')}</div>` +
    `</li>`
  );
};

export function render({ teams, rounds, mySlot, sims }, board) {
  const mine = board.filter((p) => p.slot === mySlot);
  const label = labeller(board.filter((p) => p.name && !GENERIC.has(p.position)).map((p) => p.name));
  const bySlot = new Map(board.map((p) => [`${p.round}:${p.slot}`, p]));

  const head = Array.from({ length: teams }, (_, i) => {
    const slot = i + 1;
    const who = board.find((p) => p.slot === slot)?.who ?? '';
    return `<th class="mgr${slot === mySlot ? ' mine' : ''}" scope="col"><span>${esc(NAMES[who] ?? who)}</span></th>`;
  }).join('');

  const rows = Array.from({ length: rounds }, (_, i) => {
    const round = i + 1;
    const forward = round % 2 === 1;
    const cells = Array.from({ length: teams }, (_, j) => {
      const slot = j + 1;
      const p = bySlot.get(`${round}:${slot}`);
      if (!p) return '<td class="cell empty"></td>';
      // The snake enters a round on one side and leaves on the other.
      return cell(p, mySlot, slot === (forward ? 1 : teams), slot === (forward ? teams : 1), label);
    }).join('');
    return (
      `<tr class="${forward ? 'fwd' : 'rev'}">` +
      `<th class="rd" scope="row"><b>${round}</b><i>${forward ? '→' : '←'}</i></th>${cells}</tr>`
    );
  }).join('');

  return `${STYLE}
<div class="wrap">
  <header class="masthead">
    <div>
      <h1>The Board<br><em>Slot ${mySlot}</em></h1>
      <p class="sub">Every pick is the likeliest player still on the board at that moment across
      ${sims} simulated drafts &mdash; so no one is drafted twice and no manager ends up with a
      roster he would never build. The figure on each pick is how often that player went there.</p>
    </div>
    <div class="facts">
      <div class="fact"><b>${sims}</b><span>drafts run</span></div>
      <div class="fact"><b>${mySlot}</b><span>your slot</span></div>
      <div class="fact"><b>${mine.filter((p) => !GENERIC.has(p.position)).length}</b><span>your picks</span></div>
      <div class="fact"><b>Sep 8</b><span>draft night</span></div>
    </div>
  </header>

  <section>
    <h2>Your shortlist</h2>
    <ul class="shortlist">${mine.map(card).join('')}</ul>
  </section>

  <section>
    <h2>Full board &middot; ${rounds} rounds, snake</h2>
    <div class="boardwrap">
      <table>
        <thead><tr><th class="rd" scope="col">R</th>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="legend" style="margin-top:12px">
      <span class="key"><span class="chip p-RB">RB</span> running back</span>
      <span class="key"><span class="chip p-WR">WR</span> receiver</span>
      <span class="key"><span class="chip p-TE">TE</span> tight end</span>
      <span class="key"><span class="chip p-QB">QB</span> quarterback</span>
      <span class="key"><span class="chip p-K">K</span> kicker</span>
      <span class="key"><span class="chip p-DEF">DEF</span> defense</span>
      <span class="key">the bar under a pick is how often that player went there</span>
    </p>
  </section>

  <p class="note"><b>How to read a faded name.</b> Below ${WEAK_BELOW}% the pick carries a second
  figure &mdash; how often that <em>position</em> went at that pick, which is the part ${sims} drafts
  agree on. The name under it is the likeliest player who would still be sitting there, given
  everything taken above him. Your last two picks are the kicker and the defense.</p>

  <p class="note"><b>Your board, not the market&rsquo;s.</b> Backs go McCaffrey, Cook, Barkley,
  Jeanty, Chase Brown, Hampton, Henry, Walker, Achane. Receivers go Olave, McConkey, DeVonta Smith,
  DJ Moore, Waddle, McMillan. Josh Jacobs is off your board, and the only tight ends on it are
  Kittle and Likely. Dallas, New York and Washington are out too &mdash; except Likely, because you
  asked for him by name &mdash; and the Eagles stay.</p>

  <p class="note"><b>What the model knows.</b> Each manager&rsquo;s positional schedule (when his
  second and third back arrive), how far ahead of market he opens at each position, how often he
  stacks a quarterback with his own receiver, the round he habitually takes a kicker, and two
  hand-entered facts &mdash; Johnny will not draft McCaffrey, and alex has Taylor over him. It does
  not know injuries, camp news, or anything after today&rsquo;s ADP pull.</p>
</div>
`;
}

const STYLE = `<title>12 Guys 1 Cup Draft Board</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@500;600;700&family=Archivo:wght@400;500;600&family=IBM+Plex+Mono:wght@400;600&display=swap">
<style>
:root{
  --bg:#e9ecef; --surface:#fbfcfd; --raised:#f3f5f8; --line:#d2d8df; --line-soft:#e3e8ee;
  --ink:#11151b; --ink-2:#3d4652; --muted:#5f6975;
  --qb:#c9185a; --rb:#00887a; --wr:#2f7fd6; --te:#a96a10; --k:#8a3fd0; --def:#8f5442;
  --dead:#94a0ad; --on-pos:#fff; --snake:#98a3b1; --snake-wash:rgba(15,94,168,.10);
  --mine:#0f5ea8; --mine-wash:#dbeaf9;
  --shadow:0 1px 2px rgba(16,22,30,.07),0 8px 24px -12px rgba(16,22,30,.18);
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --bg:#0f1218; --surface:#171b22; --raised:#1e232b; --line:#2a313b; --line-soft:#222834;
    --ink:#e7ebf1; --ink-2:#b3bcc8; --muted:#8a95a2;
    --qb:#fc2b6d; --rb:#00ceb8; --wr:#58a7ff; --te:#ffae58; --k:#bd66ff; --def:#bf755d;
    --dead:#5b6673; --on-pos:#0f1218; --snake:#6b7683; --snake-wash:rgba(111,179,245,.12);
    --mine:#6fb3f5; --mine-wash:#15304c;
    --shadow:0 1px 2px rgba(0,0,0,.5),0 10px 30px -14px rgba(0,0,0,.8);
  }
}
:root[data-theme="dark"]{
  --bg:#0f1218; --surface:#171b22; --raised:#1e232b; --line:#2a313b; --line-soft:#222834;
  --ink:#e7ebf1; --ink-2:#b3bcc8; --muted:#8a95a2;
  --qb:#fc2b6d; --rb:#00ceb8; --wr:#58a7ff; --te:#ffae58; --k:#bd66ff; --def:#bf755d;
  --dead:#5b6673; --on-pos:#0f1218; --snake:#6b7683; --snake-wash:rgba(111,179,245,.12);
  --mine:#6fb3f5; --mine-wash:#15304c;
  --shadow:0 1px 2px rgba(0,0,0,.5),0 10px 30px -14px rgba(0,0,0,.8);
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font-family:Archivo,system-ui,-apple-system,"Segoe UI",sans-serif;
  font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
.wrap{max-width:1560px;margin:0 auto;padding:clamp(20px,4vw,44px) clamp(14px,3vw,32px) 72px;
  display:flex;flex-direction:column;gap:34px}

.masthead{display:flex;flex-wrap:wrap;align-items:flex-end;gap:18px 32px;
  padding-bottom:20px;border-bottom:2px solid var(--ink)}
h1{font-family:"Saira Condensed",Archivo,sans-serif;font-weight:700;
  font-size:clamp(34px,6vw,58px);line-height:.94;letter-spacing:.005em;margin:0;
  text-transform:uppercase;text-wrap:balance}
h1 em{font-style:normal;color:var(--mine)}
.sub{color:var(--muted);max-width:62ch;margin:0}
.facts{display:flex;gap:26px;flex-wrap:wrap;margin-left:auto}
.fact{display:flex;flex-direction:column;gap:2px}
.fact b{font-family:"Saira Condensed",sans-serif;font-size:26px;line-height:1;
  font-variant-numeric:tabular-nums}
.fact span{font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted)}

h2{font-family:"Saira Condensed",Archivo,sans-serif;text-transform:uppercase;
  letter-spacing:.06em;font-size:15px;font-weight:600;color:var(--ink-2);margin:0 0 12px}

.shortlist{list-style:none;margin:0;padding:0;display:grid;gap:10px;
  grid-template-columns:repeat(auto-fill,minmax(212px,1fr))}
.shortlist-item{background:var(--surface);border:1px solid var(--line);border-radius:3px;
  padding:11px 13px 12px;display:flex;flex-direction:column;gap:7px;box-shadow:var(--shadow)}
.sl-head{display:flex;justify-content:space-between;align-items:baseline;
  font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11px;color:var(--muted);
  font-variant-numeric:tabular-nums}
.sl-pick{color:var(--mine);font-weight:600}
.sl-main{display:flex;align-items:center;gap:8px}
.sl-main b{font-size:15px;font-weight:600;line-height:1.25}
.sl-pct{margin-left:auto;font-family:"IBM Plex Mono",monospace;font-size:12px;
  color:var(--ink-2);font-variant-numeric:tabular-nums}
.sl-alt{font-size:11.5px;color:var(--muted);line-height:1.4;border-top:1px solid var(--line-soft);
  padding-top:6px}
.chip{font-family:"IBM Plex Mono",monospace;font-size:10px;font-weight:600;letter-spacing:.05em;
  padding:2px 5px;border-radius:2px;color:var(--on-pos)}

.p-RB .chip,.chip.p-RB{background:var(--rb)}
.p-WR .chip,.chip.p-WR{background:var(--wr)}
.p-TE .chip,.chip.p-TE{background:var(--te)}
.p-QB .chip,.chip.p-QB{background:var(--qb)}
.p-K .chip,.chip.p-K{background:var(--k)}
.p-DEF .chip,.chip.p-DEF{background:var(--def)}

.boardwrap{overflow-x:auto;background:var(--surface);border:1px solid var(--line);
  border-radius:4px;box-shadow:var(--shadow)}
table{border-collapse:separate;border-spacing:0;width:100%;min-width:1180px}
th,td{text-align:left}
thead th{position:sticky;top:0;z-index:3;background:var(--raised);
  border-bottom:1.5px solid var(--line);padding:9px 8px;
  font-family:"Saira Condensed",sans-serif;text-transform:uppercase;letter-spacing:.05em;
  font-size:13px;font-weight:600;color:var(--ink-2);white-space:nowrap}
thead th.mine{color:var(--mine)}
thead th.mine span{border-bottom:2px solid var(--mine);padding-bottom:2px}
th.rd{position:sticky;left:0;z-index:2;background:var(--raised);width:40px;
  border-right:1.5px solid var(--line);border-bottom:1px solid var(--line-soft);
  font-family:"IBM Plex Mono",monospace;font-size:11px;color:var(--muted);
  text-align:center;font-weight:600;font-variant-numeric:tabular-nums;padding:0 4px}
th.rd b{display:block;font-size:12px;color:var(--ink-2)}
th.rd i{display:block;font-style:normal;font-size:12px;line-height:1;color:var(--snake)}
/* The snake: each round enters on one side and leaves on the other, and the
   direction flips every round. The rails mark where the order turns. */
.cell.flow-in{box-shadow:inset 3px 0 0 var(--snake)}
tr.rev .cell.flow-in{box-shadow:inset -3px 0 0 var(--snake)}
.cell.flow-out{background-image:linear-gradient(to right,transparent 70%,var(--snake-wash))}
tr.rev .cell.flow-out{background-image:linear-gradient(to left,transparent 70%,var(--snake-wash))}
.cell.mine.flow-in,.cell.mine.flow-out{box-shadow:inset 2px 0 0 var(--mine)}
thead th:first-child{left:0;z-index:4}

.cell{position:relative;padding:7px 8px 11px;border-bottom:1px solid var(--line-soft);
  border-right:1px solid var(--line-soft);vertical-align:top;min-width:96px}
.cell .ov{position:absolute;top:5px;right:6px;font-family:"IBM Plex Mono",monospace;
  font-size:9.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.cell .pos{display:inline-block;font-family:"IBM Plex Mono",monospace;font-size:9.5px;
  font-weight:600;letter-spacing:.05em;padding:1px 4px;border-radius:2px;color:var(--on-pos);
  background:var(--dead)}
.cell .nm{display:block;margin-top:3px;font-size:13px;font-weight:500;line-height:1.2;
  color:var(--ink);padding-right:14px}
.cell .pct{position:absolute;left:8px;bottom:2px;font-family:"IBM Plex Mono",monospace;
  font-size:9px;color:var(--muted);font-variant-numeric:tabular-nums}
.cell .conf{position:absolute;left:0;bottom:0;height:2px;width:var(--w);background:var(--dead);
  opacity:.85}
.cell.p-RB .pos,.cell.p-RB .conf{background:var(--rb)}
.cell.p-WR .pos,.cell.p-WR .conf{background:var(--wr)}
.cell.p-TE .pos,.cell.p-TE .conf{background:var(--te)}
.cell.p-QB .pos,.cell.p-QB .conf{background:var(--qb)}
.cell.p-K .pos,.cell.p-K .conf{background:var(--k)}
.cell.p-DEF .pos,.cell.p-DEF .conf{background:var(--def)}
.cell.empty{background:var(--raised)}
/* A name under a fifth is plausible rather than projected: the chip keeps its
   colour, the name gives up its weight. */
.cell.weak .nm{color:var(--ink-2);font-weight:400}
.cell .hint{display:block;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:9px;
  color:var(--muted);letter-spacing:.02em;margin-top:1px}
.cell.weak .conf{opacity:.35}
.cell.mine{background:var(--mine-wash);box-shadow:inset 2px 0 0 var(--mine)}
.cell.mine .nm{font-weight:600}
tbody tr:hover .cell{background-color:color-mix(in srgb,var(--raised) 55%,transparent)}
tbody tr:hover .cell.mine{background-color:var(--mine-wash)}
.cell:hover{outline:2px solid var(--mine);outline-offset:-2px}

.legend{display:flex;flex-wrap:wrap;gap:8px 20px;align-items:center;font-size:12.5px;
  color:var(--muted)}
.legend .key{display:inline-flex;align-items:center;gap:6px}
.note{color:var(--muted);font-size:13.5px;max-width:78ch;margin:0}
.note b{color:var(--ink-2);font-weight:600}
@media (max-width:640px){.facts{margin-left:0}}
</style>
`;

// The market, for picks the simulations left nothing usable at.
async function adpPool() {
  const dir = new URL('../data/raw/adp/', import.meta.url);
  const season = (await readdir(dir)).filter((f) => /^\d{4}\.json$/.test(f)).sort().at(-1);
  if (!season) return [];
  const rows = JSON.parse(await readFile(new URL(season, dir), 'utf8'));
  return Object.values(rows)
    .filter((p) => p.adp < 250 && !GENERIC.has(p.position))
    .sort((a, b) => a.adp - b.adp);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const source = process.argv[2];
  const raw = source ? await readFile(source, 'utf8') : await new Response(process.stdin).text();
  const data = JSON.parse(raw);
  const { board, gaps } = reconcile(data.picks, await adpPool());
  await writeFile(OUT, render(data, board));

  const names = board.filter((p) => !GENERIC.has(p.position)).map((p) => p.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  console.log(`${board.length} picks written to docs/draft-board.html`);
  console.log(dupes.length ? `duplicates: ${[...new Set(dupes)].join(', ')}` : 'no duplicates');
  if (gaps.length) console.log(`no candidate left at picks: ${gaps.join(', ')}`);
}

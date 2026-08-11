# UI/UX Modernization — 12 Guys 1 Cup

**Date:** 2026-08-11
**Status:** Approved design

## Goal

Modernize the look and feel of the league history site in the "playful cards"
direction: personality-forward, gradient accents, rounded surfaces, avatars, and
emoji honors — while keeping every page's information intact and the data
pipeline untouched.

Chosen in brainstorming (visual companion mockups):

- **Visual direction:** playful cards (option C) over broadcast-sports and
  refined-minimal alternatives.
- **Front door:** unchanged — `/` keeps redirecting to the newest season. The
  season page is home; the year pills are the primary navigation axis.

## Approach

Token refresh plus extraction of the few repeated markup fragments. Existing
page markup and class names are preserved wherever possible so the restyle lands
mostly in CSS. Brackets, draft board, and the head-to-head matrix keep their
current structure — new skin, not new layout.

`src/styles/global.css` (1362 lines, doing everything) is split into an entry
file that imports three focused stylesheets. `Base.astro`'s single import stays
unchanged.

```
src/styles/global.css      # entry: @import tokens, base, components
src/styles/tokens.css      # palette, radii, shadows, spacing, type scale
src/styles/base.css        # reset, typography, nav, season strip, layout
src/styles/components.css  # cards, honors, tables, brackets, chips, badges
```

## Visual system

**Palette.** Deep indigo base (`#0e1023`) with a radial violet wash. Signature
accent is a violet→cyan gradient (`#a78bfa` → `#22d3ee`). Gold (`#fbbf24`) is
reserved for champions and 1st-place rank badges, rose (`#fda4af`) for the shit
bowl and last place, green (`#34d399`) for wins.

**Surfaces.** Translucent white panels (4–6% over the indigo base) with hairline
`rgba(255,255,255,.09)` borders and 12–16px radii, replacing today's flat grey
cards.

**Type.** Existing Inter/system stack. Display weights raised to 800–900 for
headings, honors, and numbers. `font-variant-numeric: tabular-nums` on all stat
columns so figures align.

**Signature elements.**

- Gradient hero card for the headline honor (champion) with member avatar.
- Honor chips — 🏆 champion, 🥈 runner-up, 🥉 third, 📈 most PF, 💩 shit bowl —
  rendered identically wherever honors appear.
- Rank badges: rounded squares, gold gradient for 1st, neutral otherwise.
- Sleeper avatars beside member names. Avatar hashes already exist in
  `data/computed/members.json`; only the season and member pages use them today.

**Motion.** Subtle hover lift on interactive cards only, ≤150ms, wrapped in
`@media (prefers-reduced-motion: reduce)` to disable.

## UX changes

**Mobile table treatment.** The wide tables — all-time standings, records,
season final standings — collapse into rounded card rows under 640px instead of
scrolling horizontally. Each row becomes a card: member (with avatar) on the
first line, stats as labelled pairs beneath.

**Scanability.** `MemberLink` gains an optional avatar. It is enabled in
headline spots and card rows, and left off inside dense matrix cells (h2h) where
it would crowd the grid.

**Navigation.** Season pills stay the primary axis. The nav bar tightens and the
active-page state becomes unmistakable (gradient underline plus accent text).

**Consistency.** The honors row renders from one component, so season pages,
member pages, and the ELO page all present honors identically.

## Components

| Component | Responsibility |
|---|---|
| `src/components/Honors.astro` | Renders an honors row from a season summary (champion, runner-up, third, PF champ, last place) as chips |
| `src/components/StatTile.astro` | Label + big value + optional sub-caption tile, used for records and league stats |
| `src/components/MemberLink.astro` | Existing; extended with optional `avatar` and `size` props |

## Scope

All ten pages receive the new skin: season, standings (all-time), h2h, records,
trades, punishments, rules, member, power/ELO, and the index redirect page.

Out of scope: any change to `scripts/`, `data/`, stat definitions, or the
information architecture. No new pages. No content rewrites.

## Verification

- `npm test` — the 39 existing data tests must stay green (they should be
  entirely unaffected; a failure means the change strayed out of scope).
- `npm run build` — all 31 pages build.
- Visual check in the preview browser at desktop (1280px) and mobile (375px) for
  the season page, all-time standings, records, and a member page, confirming no
  horizontal page scroll at 375px.

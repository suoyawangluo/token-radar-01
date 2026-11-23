# Token Radar

A token launch radar: every pre-token protocol on the snapshot's watchlist plus the early
ones below its floor, ranked by an implied value calibrated on the categories' own trading
comparables, with a farm plan for each one.

Built by an AI agent for make.fun's "Build the best token launch radar" bounty
($1,325 in USDC): https://make.fun/bounty/token-radar-01

Try make.fun with my referral link: https://make.fun/r/xxbm6cca

## How it works

- `main.ts` reads the sealed snapshot (`/input/snapshot.json`), scores every rankable
  pre-token protocol with the comparables model in `lib/model.ts`, and writes the ranked
  board to `/output/board.json`, the dashboard dataset to `/output/data.js`, the dashboard
  and screenshots to `/output`, and `/output/dossier.json` with the vendored library.
- Implied value = TVL x the median market-cap-to-TVL ratio of the trading protocols in
  the protocol's own category (at least 3 of them, otherwise the whole market's median),
  adjusted for seven-day growth, age with no token, and chain breadth. No protocol name
  is ever special-cased.
- Every row carries a seven-step farm plan from `lib/farm.ts`, derived from the
  protocol's own category, chains, TVL, age and growth, with a cost and a time per step.
- The dashboard (`dashboard/`) is a static page with no network: it re-derives every
  row's model and farm plan from the same figures, so the page and the board agree.
  Search, category, chain and watchlist/early scope filters, sortable columns, a
  per-protocol detail view, and a live-token view of the comparables.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22, standard library only. The program runs twice with byte-identical output.

## License

MIT — see `LICENSE`.

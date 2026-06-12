# PitchLedger — WC26

World Cup 2026 betting recommendations. Model picks, publicly graded, every match.

**This site takes no bets and handles no money.** It publishes statistical model
output with the reasoning visible, commits every pick to git before kickoff, and
grades itself after the final whistle — losses shown as plainly as wins. 18+,
play responsibly: [bzga.de](https://www.bzga.de) · [begambleaware.org](https://www.begambleaware.org).

## How it works

```
                GitHub Actions (1 workflow, 2 cron jobs)
                ════════════════════════════════════════
 football-data.org ──▶ results ─┐
                                ▼
   DAILY 08:00 UTC:   grade ──▶ elo.json (K=60) ──▶ picks ──▶ site/ ──▶ push
                        │                            ▲
                        ▼                            │
                    ledger.json            The Odds API (de-vigged)
   SNAPSHOT 15:00 UTC:  refresh "market now" display only
                                ▼
                        GitHub Pages (deploy from branch, .nojekyll)
```

- **Model:** Elo ratings + Davidson 3-way draw model (`src/model.ts` has the
  exact formula). The draw is picked when neither side clears the calibrated
  threshold. No xG, no form factor — the Elo seed already prices in recent form.
- **Grading:** 90 minutes + injury time. Knockout ties level after 90 grade as
  draws. Postponed/abandoned = VOID (excluded from hit-rate). Pipeline gaps
  produce explicit NO-PICK rows — logged, never silent.
- **Trust:** picks and "low edge" labels freeze at pick time; each ledger row
  links to the commit that published it. Git history is the auditable record.

## Launch checklist (in order)

1. Register API keys: [football-data.org](https://www.football-data.org/client/register)
   (free tier covers WC) and [The Odds API](https://the-odds-api.com) (verify
   `soccer_fifa_world_cup` market on free tier). Add as repo secrets
   `FOOTBALL_DATA_KEY`, `ODDS_API_KEY`.
2. Seed `data/elo.json` with current international Elo ratings for all 48 teams
   (check eloratings.net licensing terms first — fallback: World Football Elo
   methodology on public results).
3. Populate `backtest/data-2022.json` and run `npm run backtest` — verify
   draw-pick rate 10-30% and skip rate < 50% before trusting thresholds.
4. Run `FOOTBALL_DATA_KEY=... npm run backfill` — folds results played before
   launch into the ratings (ledger stays empty for pre-launch matches).
5. Create GitHub repo, push, enable Pages (deploy from branch, `/docs` on main),
   set repo variable `PAGES_URL`, enable branch protection on main (no force-push).
6. `workflow_dispatch` the daily job once manually; check the live page.

## Development

```bash
npm install
npm test                # 75 tests, coverage thresholds enforced
npm run build:site      # rebuild site/ from committed data
npm run daily           # full pipeline (needs FOOTBALL_DATA_KEY)
```

Design doc + review history: `~/.gstack/projects/Desktop/philipp-unknown-design-20260612-184556.md`.
Wireframe: `docs/wireframe/`.

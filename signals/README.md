# Signals: reviewed official and press reports

Adds a "reported impacts" dot per barri from items a person has reviewed. Nothing reaches the map without approval.

```bash
npm run signals                    # read Ajuntament press API + Betevé RSS, write pending rows here
npm run signals -- --list          # pending rows, highest-priority barri first, with links; rows with no flood term last
npm run signals -- --approve <id> --mechanism slope_runoff --barri "Sant Genís dels Agudells" --by R1
npm run signals -- --reject <id> --reason "not Barcelona" --by R1
npm run signals -- --add <https url> --barri <code|name> --mechanism basement --date 2026-10-05T09:00Z --by R1
npm run signals -- --priority      # refresh priority per barri (live XEMA rain)
npm run signals:build              # also runs before dev, build, preview and qa
npm run signals:check              # self-check: filters, gazetteer, priority, build + qa end to end
```

Mechanisms: `street_overflow`, `basement`, `transformer_room`, `slope_runoff`. Reviewer codes only, never an email.
Before approving, open the link and confirm the date and place appear on the page.
Every allowlisted item is written, including ones the keyword regex misses (`"relevant": false`, listed last, dropped unreviewed after 72 h), because the feed watermark never re-reads an item. An expired or rejected row keeps no link and cannot be approved: publish it with `--add`. The build fails on two rows with the same `signal_id` (keep one line after a merge) and counts one page once, query string or not.

| File | What | Committed |
|---|---|---|
| `inbox.jsonl` | one row per official or press item: link, org name, dates, place, review. Never post text, titles, handles or media | yes, through a PR |
| `counts.json` | per-source watermark and health, written by `npm run signals` | yes, with the inbox |
| `allowlist.json` | hosts that may become a row or a card source; sets `source_kind` | yes |
| `gazetteer.json` | 73 barris (Open Data BCN, CC BY 4.0), Atlas aliases, districts, repo zone ids; rebuild with `scripts/signals-gazetteer.mjs` | yes |
| `barri_priors.json` | per-barri exposure, population, nearest XEMA station, from the backtest | yes |
| `config.json` | priority weights, window, expiry, User-Agent | yes |

Generated and gitignored: `data/geojson/signals.geojson`, `data/signals-cards.json`.

Rules: only allowlisted organisations become rows; individuals' posts are never read in this slice (Reddit, Instagram, TikTok, X, Telegram and YouTube RSS are ruled out). Health or injury items are dropped before any write. Places come from the gazetteer, never a model. With `TYPESAFE_API_KEY` set, Jev may pick a mechanism or one of the gazetteer's candidate places; it never writes text, coordinates or priority. Priority orders review and refresh only; it is not a risk score.

Twice an hour (optional): `7,37 * * * * cd <repo> && npm run signals -- --scheduled`. Calm weather reads the feeds every 4th tick.

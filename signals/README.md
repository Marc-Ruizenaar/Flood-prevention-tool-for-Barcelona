# Signals: reviewed official and press reports

Adds a "reported impacts" dot per barri from items a person has reviewed. Nothing reaches the map without approval.

```bash
npm run signals                    # read Ajuntament press API + Betevé RSS, write pending rows to pending.local.jsonl
npm run signals -- --list          # pending rows, highest-priority barri first, with links; rows with no flood term last
npm run signals -- --approve <id> --mechanism slope_runoff --barri "Sant Genís dels Agudells" --by R1
npm run signals -- --approve <id> --mechanism basement --barri "Sant Andreu" --place-on-page --by R1
npm run signals -- --reject <id> --reason "Not about flooding." --by R1
npm run signals -- --add <https url> --barri <code|name> --mechanism basement --date 2026-10-05T09:00Z --by R1
npm run signals -- --priority      # refresh priority per barri (live XEMA rain)
npm run signals:build              # also runs before dev, build, preview and qa
npm run signals:check              # self-check: filters, gazetteer, priority, build + qa end to end
```

Mechanisms: `street_overflow`, `basement`, `transformer_room`, `slope_runoff`. Reviewer codes only, never an email.
Before approving, open the link and confirm the date and place appear on the page.
`--approve --barri` only accepts a barri whose name or gazetteer alias was in the item's title or excerpt (the `candidates` the pipeline found). If the page names a barri the excerpt did not, read it there and add `--place-on-page`; the row then records who checked.
Every allowlisted item is written, including ones the keyword regex misses (`"relevant": false`, listed last, dropped unreviewed after 72 h), because the feed watermark never re-reads an item. An expired or rejected row keeps no link and cannot be approved: publish it with `--add`. The build fails on two rows with the same `signal_id` (keep one line after a merge) and counts one page once, query string or not.

| File | What | Committed |
|---|---|---|
| `reviewed.jsonl` | reviewer decisions only: approved rows (link, org name, dates, place, review) and rejected stubs (id and the reviewer's reason, no link). Never post text, titles, handles or media | yes, through a PR |
| `pending.local.jsonl` | unreviewed rows and expired stubs, written by `npm run signals` | no, gitignored |
| `counts.json` | per-source watermark and health, written by `npm run signals` | no, gitignored |
| `allowlist.json` | hosts that may become a row or a card source; sets `source_kind` | yes |
| `gazetteer.json` | 73 barris (Open Data BCN, CC BY 4.0), Atlas aliases, districts, repo zone ids; rebuild with `scripts/signals-gazetteer.mjs` | yes |
| `barri_priors.json` | per-barri exposure, population, nearest XEMA station, from the backtest | yes |
| `config.json` | priority weights, window, expiry, User-Agent, `sendTextToJev`, `minPublishConfidence` | yes |
| `feeds.json` | extra feeds (Apify tasks or datasets), each with a confidence cap; off by default | yes |

`inbox.jsonl` is retired and left empty: nothing reads or writes it. Generated and gitignored: `data/geojson/signals.geojson`, `data/signals-cards.json`.

Sources and confidence: every row carries `confidence` (`low`, `medium` or `high`) and `via` (the feed that delivered it). The host sets the level in `allowlist.json` (high for the body responsible, medium for press). A feed in `feeds.json` can only lower it with `maxConfidence`, never raise it. `--list` shows the level and sorts higher first; cards name it next to each source. `minPublishConfidence` in `config.json` (default `low`) keeps approved rows below it off the map.

Adding a source: an organisation's own feed is a new entry in `ADAPTERS` (`scripts/signals.mjs`) plus its host in `allowlist.json`. An Apify task or dataset needs no code: add it to `feeds.json` with `enabled: true`, a `task` (`user~task-name`) or `dataset`, `maxConfidence`, and `fields` if its keys are unusual. Set `APIFY_TOKEN` in the environment (a vault Variable, through `reliquary run`); it goes in a request header only. Apify only changes how an item reaches us: hosts off the allowlist are dropped, and social platforms (`NEVER_HOSTS` in `signals-lib.mjs`) are blocked in code even if someone allowlists them.

Publish window: the build keeps approved rows published in the 7 days before "now", and "now" is `SIGNALS_NOW` if set, else the clock at build time. For the demo, set `SIGNALS_NOW` to the demo time (for example `SIGNALS_NOW=2026-10-10T16:00Z npm run build`) so the map shows what it showed in rehearsal. Any later rebuild without it drops rows older than 7 days, so the dots disappear on their own.

Rules: only allowlisted organisations become rows; individuals' posts are never read in this slice (Reddit, Instagram, TikTok, X, Telegram and YouTube RSS are ruled out). Health or injury items are dropped before any write. Places come from the gazetteer, never a model. Jev (TypeSafe) is off: it runs only when `"sendTextToJev": true` in `config.json` and `TYPESAFE_API_KEY` is set, because it sends Ajuntament and Betevé titles and excerpts to a third party and the legal question is still open. With it on, Jev may pick a mechanism or one of the gazetteer's candidate places; it never writes text, coordinates or priority. Priority orders review and refresh only; it is not a risk score.

Twice an hour (optional): `7,37 * * * * cd <repo> && npm run signals -- --scheduled`. Calm weather reads the feeds every 4th tick.

# Next rain: ground-level flood signals (design, iteration 1)

For Andrés and the MAS team at the Barcelona AI Hackathon (code freeze Saturday 10 October 2026, 16:00 CEST). This document explains how "Next rain", the static Barcelona flood map in `Marc-Ruizenaar/hackathon-barcelona`, can take in ground-level flood signals: social posts, press, emergency services, open data and, later, citizen reports. It covers which sources are usable and legal, how records are stored, how a refresh twice an hour would run, how areas are prioritised, and what a blind test against the 2024, 2025 and 2026 storms showed. It merges five workstream sections written on the night of 9 to 10 October 2026. It is iteration 1 of at least 5, so some claims still wait for a second independent check.

**How to read the tags.** Every factual claim carries a tag and a ledger id in square brackets, for example [VERIFIED, src-C48]. The claims ledger in section 11 gives the URL or file behind each id.
- VERIFIED: fetched or computed during this run. For legal points, read in the primary text.
- AGENT: written by another agent (mostly the team's Reliquary vault) and not re-fetched here.
- UNVERIFIED: a source was found but could not be read or confirmed.
- ASSUMPTION: a design choice or an inference.
- CONTRADICTED: two sources, or two sections, disagree. Both sides are shown.

Ledger prefixes: `src-` sources, `leg-` legality, `sto-` storage, `flo-` flow and priority, `bt-` backtest, `int-` checks the integrator ran while merging. Source numbers S1 to S30 in section 3 are source ids, not claims.

The legal parts are compliance analysis, not legal advice. Points that need a lawyer or a data protection officer (DPO) are named as such.

## 1. Summary

1. **Recommended path for the hackathon:** the map shows only reviewed items from official, press and open-data sources. Each item is shown as one sentence in our own words plus a link. A person adds or approves each row, and a build script turns the approved rows into one dot per barri. `npm run qa` checks the result.
2. **Not shown, not stored:** individuals' social posts are never shown or stored, and never sent to the classifier. Reddit, Instagram, Facebook, TikTok, X, Telegram and YouTube RSS are out for automated reading (their terms or robots.txt forbid it).
3. **Automated reading** starts with the Ajuntament press API and Betevé RSS. A refresh costs 5 keyless requests a run, 240 a day. It is best run from a timer on an always-on machine. Priority per barri is a weighted sum computed in code. It orders refreshes and review, and it is not a risk score.
4. **Backtest, in one sentence:** in a blind barri-level test on 2024 and 2025, the Atlas flood layers and last year's reports ranked the barris that later filed rain reports only slightly better than chance (AUC about 0.6) and no better than population; the flow's priority score did no better than chance (AUC 0.49 to 0.57); and the live sources tell rain days apart, not places.
5. **The team must decide** (section 2): where review records live (D1; the sections disagree, and we recommend git outside `data/`), how much of the slice to build (D2), whether to read the 112 mirror (D3), which map group the dots join (D4), where the timer runs (D5), and what to do about the Tapioles hotspot, which sits 9.7 km from its official polygon while the blind-spot demo depends on it (D6).

## 2. Decisions the team must make

Each decision gives the recommended option first, then why.

**D1. Where review records live.** CONTRADICTED between sections.
- Storage says: in git, outside `data/`, as `signals/inbox.jsonl` on a review branch, merged by PR [AGENT, storage section §2].
- Flow and the legal section's "Where records live" row say: in a gitignored store on the machine that runs the job [AGENT, flow §1; legal §2].
- **Recommended: storage's git model.** Reasons:
  - It is the newer revision. Flow's open issues already ask the integrator to align file names with storage.
  - It works both on a local timer and on GitHub Actions, where every run starts from a fresh machine.
  - The PR is the review gate.
  - The legal objection to "records in git" was about individuals' data. In this design individuals never produce a row, and the same legal row allows official, press and open-data items in git [AGENT, legal §2 and §7].
- The hard rule that comes with it: nothing about an individual is ever committed, even to a branch, because git history survives deletion [VERIFIED, sto-S8].

**D2. How much to build in the 2 hours.** The two sections differ on how much the slice includes.
- **Recommended:**
  1. Build the manual path first: reviewer-entered rows, the build script, the 7 app and qa edits, and qa passing with an empty inbox and with one sample row. This is storage's slice.
  2. Add the Ajuntament press and Betevé feed readers, which write `pending` rows, only if time remains.
- Why: flow estimates its fuller slice at about 2 h 10 min [ASSUMPTION, flow §2]. The manual path proves the whole publish chain on its own, and an empty layer is honest.

**D3. Whether to read the Generalitat emergency-services mirror on Bluesky (S1).**
- **Recommended: not in slice 1.** Add it later as a per-barri count only, never shown, once the public data-notice page and the opt-out list exist.
- Why:
  - The account is a bot run by a private person that mirrors five Generalitat services. It says "(Mirall)" and is not the 112 service [VERIFIED, src-C39].
  - Legal treats it like an individual's account until someone shows who runs it. Counting individuals' posts still needs a written balancing test, a public notice and an opt-out [AGENT, legal bottom line 4].
  - Its yield is tiny: 8 posts in 6.5 months match a flood keyword and "Barcelona" [VERIFIED, src-C48].
- The sources section rates S1 "use, pending legal". This decision changes only when it starts.

**D4. Which map group the dots join.**
- **Recommended: storage's default.** Put the new `signals` layer in the existing proof group and rename the group from "Oct 2026 proof" to "Reported impacts". Change README line 36 to match.
- Why: it keeps `proof: false`, so qa passes and the layer is off on first load. The blind-spot button turns it on next to the proof points [VERIFIED, sto-S28]. Both layers are reviewed, organisation-sourced impacts.
- Alternative: a fifth group with its own toggle, about 25 lines across `types.ts`, `MapCanvas.tsx` and `App.tsx` [AGENT, storage §5].
- Flow suggested the label "Reviewed reports (official and press)". Either label avoids the word "live", which the slice cannot claim.

**D5. Where the twice-hourly job runs (after the slice).**
- **Recommended: a timer on a machine that stays on during the event,** at minutes 7 and 37 of each hour (UTC). It uses no Actions minutes and needs no repo setting.
- GitHub Actions is possible later, but only after three things:
  1. Marc enables "Allow GitHub Actions to create and approve pull requests". It is off by default for a personal-account repo, and this repo's value cannot be read by non-admins [VERIFIED, flo-F7].
  2. The workflow reaches `main` through a PR, because scheduled workflows run only from the default branch [VERIFIED, flo-F1].
  3. Someone times one run on a GitHub runner.
- Actions costs on a private repo:

  | Each run takes | Billed minutes a month | Free plan allowance |
  |---|---|---|
  | 60 s or less | 1,440 | 2,000 |
  | 61 to 120 s | 2,880 | 2,000 |

  The 2,000 minutes are shared across Marc's private repos [VERIFIED, flo-F4, flo-F5; computed]. Asking Marc is Andrés's call.

**D6. The misplaced Tapioles hotspot.** CONTRADICTED: the repo against the Atlas and the vault.
- **Recommended:** the repo owner moves `hotspot-tapioles` to the official Atlas polygon ("Torrent Tapioles", in Vallbona and Torre Baró), then re-reads the blind-spot story in README, `mvp.md` and `testplan.md`.
- The integrator re-measured it: the repo point [2.16371, 41.37208] is 9,691 m from the nearest vertex of that polygon, in el Poble-sec [VERIFIED, int-I2; sto-S20, sto-S24].
- 5 more of the 14 repo hotspot points sit off their polygons, from 106 m to 1,340 m [VERIFIED, sto-S20].
- `qa.mjs` passes either way, because its Torre Baró rule only checks links [VERIFIED, sto-S24].

**D7. How "signals" enter the priority score.**
- **Recommended:** keep flow's term for organisation items: items in the last 6 h divided by 3. When individuals' counts are added later, divide them by the barri's expected reports from `barri_priors.json` rather than adding raw density.
- Why: reporting density predicts where *reports* come from, not where impact is. On the only impact-selected labels (2026 press sites), density ranked barris the wrong way round [VERIFIED computed, bt-B16, bt-B20; backtest §5.6].
- All weights are unsupported defaults [ASSUMPTION, flo-F25].

**D8. Whether `mvp.md` changes.**
- **Recommended: no change for the hackathon.**
- `mvp.md` rules out claiming "citizen reports" [VERIFIED, sto-S27]. The slice stays inside that line.
- Showing individuals' posts, or sending their text to the classifier, needs a team decision to change `mvp.md` and a DPO review first [AGENT, legal bottom line 3].

**D9. Legal homework before any city use** (not needed for the demo). It needs a lawyer or DPO; the list of points is in section 4. Most urgent:
- who the data controller is
- the legitimate-interest balancing test
- the city's own legal basis

## 3. Sources (C1)

**Bottom line.**
- **Live set v1** (two signal feeds, plus three inputs that set priority and cadence):
  - Ajuntament press WP REST API (S5)
  - Betevé RSS (S8)
  - MeteoAlarm `ES181` "Litoral de Barcelona" (S30), for refresh cadence only, never shown
  - Meteocat XEMA rain (S29), owned by the vault's F1 and flow
  - the INUNCAT plan-phase row: Catalonia-wide, used only while Barcelona has rain
- **The Bluesky emergency-services mirror (S1)** is technically ready. It waits on D3.
- **Deferred to v2:**
  - the Betevé Bluesky mirror (S2), which duplicates S8
  - 3Cat RSS (S9), whose legal notice is unchecked
  - Bluesky search (S3), which returns individuals' posts and little else
- **Location.** None of the live feeds carries coordinates [VERIFIED, src-C04, src-C13]. Every signal is placed by a code gazetteer.
- **Volume.** Expect almost no per-barri signal. Rain and exposure decide the ranking; signals only confirm.
- **Red platforms.** Reddit, Instagram, Facebook, TikTok, X, Telegram and YouTube channel RSS are a no for automated reading (legal red). WhatsApp, Mapillary and Waze need an account or a partnership. These come in only as links a person pastes.

Integrator resolution: sources rates the 112 mirror (S1) "use, pending legal". Legal, storage and D3 keep it out of slice 1. The sources section owns the live list; flow's earlier list of 8 reads, which included S2 and S9, is superseded.

Live checks ran on 2026-10-09 (21:13 to 21:26 UTC, revision about 22:00 to 22:20 UTC), with a generic User-Agent, no keys and no accounts [VERIFIED, src-C01]. Raw responses are in the run's `raw/sources-*` directories.

Verdict columns:
- **(a)** live ingest twice an hour
- **(b)** historical labels for the backtest

Where a source works technically but legal says red, the verdict is "no".

| # | Source | Access, live result | Cost | Documented rate limit | 2024 / 2025 history | Location in posts | (a) live | (b) labels |
|---|---|---|---|---|---|---|---|---|
| S1 | **Generalitat emergency-services mirror on Bluesky** (handle `catalunya112.eurosky.social`, `getAuthorFeed`). Mirrors Mossos, Bombers, Protecció Civil, SEM and Trànsit, not the 112 service (src-C39) | 200, 100 posts per page, cursor works (src-C02). Peak 21 posts in one clock half-hour over its whole history, so one page per run misses nothing (src-C48) | free | AppView limits "generous", no number (src-C05) | **No.** Oldest post 2026-03-25 after a full page-through of 12,126 posts (src-C03) | text only; record keys `text, createdAt, embed, facets, langs` (src-C04) | **use, pending legal point 7** (provenance). Until then legal's mirrors row applies: zone count only, nothing shown (D3: not in slice 1). Fallback if downgraded: S5 | 2026 only |
| S2 | Betevé mirror on Bluesky `beteve.eurosky.social` | 200 (src-C02) | free | as S1 | **No.** Oldest post 2026-04-12, 7,503 posts (src-C03) | text only | no for v1 (duplicates S8, which is first-party and has no provenance question) | 2026 only |
| S3 | Bluesky `searchPosts` on `api.bsky.app` | 200. `public.api.bsky.app` returned 403 for the same call (src-C06). Deep pages can 403: page 2 of one query failed twice (src-C44) | free | as S1 | Yes, `since`/`until` work. Same four terms in each window: 9 hits in 3–5 Nov 2024, 32 in 10–12 Sep 2025, at least 204 in 2–7 Oct 2026, almost all from `pluja`/`lluvia` (src-C44) | text only | no for v1 (individuals: legal allows a zone count only; low yield). v2: 1–2 city-level searches in storm mode | maybe (city level, thin) |
| S4 | Bluesky Jetstream (live firehose) | WebSocket 101 with no auth on `jetstream.us-east.bsky.network` (src-C08) | free | none stated | No (bounded lookback, length not stated) (src-C08) | none | no (needs an always-on process) | no |
| S5 | **Ajuntament press, WP REST API** `ajuntament.barcelona.cat/premsa/wp-json/wp/v2/posts?search=` | 200, `X-WP-Total` header, date filters work (src-C09) | free | none found | **Yes.** 37 releases match "insuficiència drenant" from 2024-01-01 (search covers the body, not only the title). Municipal Emergency Plan (PAEM) activations: 2024-11-04, 2025-07-12, 2025-08-27, 2025-09-11, 2025-09-21, 2025-11-05, 2025-12-16, and eight in 2026 (two in emergency phase). The 2025-08-27 activation was "per previsió de pluges fortes", ahead of the rain (src-C09, src-C42). RSS pagination reaches Sep 2023 (src-C10) | district and street names in text | **use** | **use** (city-level activation days, each confirmed against rain; see below) |
| S6 | Ajuntament press, Mastodon bot `bcn_ajuntament_bot` | 200, 40 statuses from 3 to 9 Oct (src-C11) | free | 300 calls / 5 min per IP (src-C12) | not tested | none (no geo keys in status JSON) | no (duplicates S5; backup only) | no |
| S7 | Mastodon tag `#inundacions`, statuses search | Tag: 200, 40 posts from 3 accounts, 38 flagged bot. Unauthenticated search: empty result (src-C11) | free | as S6 | — | none | no | no |
| S8 | **Betevé RSS** `https://beteve.cat/feed/` | 200, 15 items covering about 6 h. `?paged=` and `?s=` return the same latest items (src-C13) | free | none found | No through the feed | text only | **use** (legal: no TDM reservation in robots.txt) | no |
| S9 | 3Cat RSS `https://api.3cat.cat/noticies?_format=rss&origen=frontal&frontal=n324-portada-noticia&version=2.0` (linked from 3cat.cat/3catinfo/). Served as ISO-8859-1, so decode it explicitly (src-C45) | 200, 31 items covering about 9.5 to 11 h (src-C13) | free | none found | No through the feed | text only | maybe for v2. robots.txt on both hosts has no TDM or AI reservation (src-C46); legal notice unchecked | no |
| S10 | La Vanguardia `https://www.lavanguardia.com/rss/home.xml`; El Nacional Barcelona feed | 200: 146 items over about 2 days; 50 items back to 24 Sep (src-C13) | free | none found | No through the feed | text only | maybe (national noise; legal: check each outlet's TDM reservation) | no |
| S11 | El Periódico, Ara | Feed index links found (`/es/rss/`, `/rss/`), not fetched | free | — | — | — | untested | untested |
| S12 | GDELT DOC 2.0 API | Throttled well beyond its stated limit: 429s persisted after 30–120 s gaps from this host (src-C14). One 2024 query returned 50 articles; a flood-term query in the same window returned `{}` (src-C43) | free | documented 1 request per 5 s; do not schedule on it (src-C14) | **Unclear.** The launch post says both "last 3 months" and "back to January 1, 2017" (src-C15, CONTRADICTED). Live: `barcelona`, 3–6 Nov 2024, returned articles seen 2024-11-05 22:15 to 2024-11-06 00:15 UTC (src-C43) | none | no for v1 (throttling, `{}` results) | maybe, pending a recall test for flood terms |
| S13 | GDELT raw 15-minute files (`masterfilelist.txt`) | 200, index of about 128 MB that grows every 15 min, starting 2015-02-18 (src-C16) | free | — | Yes, untested for Barcelona recall | GKG geocodes, not checked | no | maybe (heavy) |
| S14 | **Guàrdia Urbana incidents** (Open Data BCN `incidents-gestionats-gub`) | 200. Annual CSV resources for 2010–2025 (src-C17) | free, CC BY 4.0 | CKAN is slow (about 60–90 s per call measured) | **Yes.** "PLUJA TORRENCIAL" in 2024: 208 incidents in 145 barri×month rows (1 row has no barri code), 66 in 41 barris in November (src-C18). 2025: 322 in 176 rows, computed from the CSV (src-C18). 2010–2023 can give a climatology or persistence baseline (R4) | barri code, month only | no (annual file) | **use** (barri×month) |
| S15 | IRIS citizen reports (Open Data BCN) | 200. The 2026 CSV was created 2026-06-12 (src-C19); per vault F10 it ends 31 Mar | free, CC BY 4.0 | as S14 | Yes, but no flood category. Storm-drain grate proxy only (vault F10) | **coordinates** | no (published months late) | maybe (proxy) |
| S16 | AEMET warnings, Catalonia CAP/Atom `CAP_AFAC69_ATOM.xml` | 200, 3 entries, coastal yellow and orange for Empordà on 8–9 Oct (src-C20). Covers all of Catalonia; each entry links to a separate CAP file | free | none found | No through the feed | warning zone, per linked CAP file | no (S30 does the same job in one request) | no |
| S17 | Meteocat SMP warnings API | 403 `Forbidden` with no key (src-C21) | free with key | — | — | comarca | no (needs key) | no |
| S18 | Wikimedia Commons API | 200. Category "October 2026 Catalonia floods" lists Sabadell files only. Geosearch within 10 km of the centre hits the 500 cap (src-C22) | free | — | Yes, by category or date | **coordinates** on geotagged files | no | maybe (low yield) |
| S19 | YouTube | Data API: 403 "unregistered callers" (src-C23). Channel RSS answers 200 keyless (src-C24), but legal rates it R: robots.txt disallows `/feeds/videos.xml` and the Developer Policies ban scraping (leg-L32, leg-L39). Docs: `search.list` 100 calls a day, supports `location`, `locationRadius`, `publishedAfter`; location search only finds videos whose uploader set a location (src-C25) | free with key | 100 searches a day | Data API yes, with a key; RSS out | Data API geo search only | **no** (RSS legal R; API needs a key). Human-pasted links with keyless oEmbed only | no (key needed) |
| S20 | Reddit (r/barcelona, r/catalunya) | `.json` endpoints: 403 block page. `search.rss`: 200 with 6 hits back to 2025-07-12, then 429 on the next 2 calls (src-C26) | free tier needs OAuth | primary wiki returned 403; third-party figure of 100 QPM is UNVERIFIED (src-C27) | technically yes | none | **no** (legal R) | **no** (legal R) |
| S21 | X | `api.x.com/2/tweets/search/recent`: 401 (src-C28) | $0.005 per post read, 3M reads a month cap (src-C29) | — | full archive "back to 2006" (src-C30) | optional | **no** (cost, legal R) | no |
| S22 | Instagram (incl. Reels) | Profile page 200 with no post data; tag page redirects (src-C31). Graph hashtag search needs App Review (UNVERIFIED, doc 404). oEmbed metadata use for analytics prohibited (src-C32) | — | — | — | — | **no** | no |
| S23 | TikTok | Tag and profile HTML 200, no usable item list (src-C31). Research API: not for commercial users, 1,000 requests a day (src-C33) | — | 1,000 requests a day (research) | research only | — | **no** | no |
| S24 | Facebook, WhatsApp Channels | Meta Content Library: accredited not-for-profit research institutions only (src-C34). No WhatsApp Channels read API found | — | — | — | — | **no** | no |
| S25 | Telegram public channels | `t.me/s/<channel>` preview 200 with 20 messages for @telegram (src-C35). MTProto needs a Telegram account (src-C36). No Barcelona flood channel identified | free | — | preview pages only | none | **no** (legal R) | no |
| S26 | Mapillary | 500 "Invalid OAuth 2.0 Access Token". Docs: all requests "must be authorized" (src-C37) | free with token | search 10,000 per min per app (src-C37) | yes, `captured_at` | coordinates | no (token; few captures during floods, ASSUMPTION) | no |
| S27 | Waze for Cities | Government agencies or private road operators only (src-C38) | — | — | — | coordinates | no (unless the Ajuntament shares it) | no |
| S28 | Team tip form ("send us a link") | Not built. The app is static with no backend, no host is chosen, and legal rates citizen reports R in the MVP (an Art. 13 notice is needed later) | form host's tier | — | from launch only | place picked from the gazetteer list | **later** (needs a host, an Art. 13 notice and an `mvp.md` change) | no |
| S29 | Vault-owned, not re-tested here: Meteocat XEMA rain (F1), INUNCAT phase row (F18), Trànsit GML (F19) | see `flood-data.md` | free | — | F1 yes; F19 none | F19 points | F1 for priority; F19 maybe | F1 rain axis |
| S30 | **MeteoAlarm Spain Atom** `https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-spain` | 200, 57 KB, 36 entries; area `Litoral de Barcelona` (`ES181`) present in one request (src-C47) | free | none found | No (no history archive, flo-F16) | EMMA geocode per entry | **use as cadence trigger only** | no |

**Measured yield per source:**

| Source | Yield | Location |
|---|---|---|
| S1 | 12,126 posts in 6.5 months. 404 match a flood keyword, 166 of them from 14 Sep to 8 Oct 2026. Only 8 match a flood keyword and "Barcelona". At most 21 posts in one clock half-hour, against a page of 100 [VERIFIED, src-C48] | text only |
| S3 | 9, 32 and at least 204 posts per storm window in 2024, 2025 and 2026, for the same four terms. Almost all match "pluja" or "lluvia", not flood words [VERIFIED, src-C44] | text only |
| S5 | 37 releases since 2024 for "insuficiència drenant". 15 municipal emergency-plan activations [VERIFIED, src-C09] | some name districts |
| S8 | 15 items per about 6 h, all topics. Flood share not measured [VERIFIED, src-C13] | text only |

**Polling every 30 minutes loses nothing.** The shortest feed window measured is Betevé's RSS, at about 6 h [VERIFIED, src-C13].

**Rate limits.** No source in the set publishes a rate limit:
- Bluesky AppView: "generous", no number [VERIFIED, src-C05]
- WP API and RSS: none found

So every reader backs off on HTTP 429.

**Video and other media.** Video enters only as a link a person pastes. Nothing is downloaded: no file, frames, audio or scraped transcript.
- **YouTube:** oEmbed is keyless and returns title, author and thumbnail [VERIFIED, src-C40].
- **TikTok:** documents a keyless oEmbed [VERIFIED doc, src-C41]. The live call was not tested.
- **Instagram:** oEmbed metadata may not be used beyond a front-end view, including for analytics [VERIFIED, src-C32]. Show the official embed or a plain link.
- **The reviewer** records fixed facts:
  - place, picked from code-generated candidates, or "none"
  - mechanism, from the qa enum, or "can't tell"
  - when it was seen
  - whether it is an observation or aftermath

  No depths or damage unless the source states them.
- **The classifier (Jev)** may preselect candidates from public titles. It never outputs coordinates, a priority or card text (vault rule 7).

**Labels for the backtest.**
- **Guàrdia Urbana incidents (S14)** give barri × month for 2024 and 2025, and 2010 to 2023 for baselines [VERIFIED, bt-B7].
- **Ajuntament activations (S5)** give city-level days.
  - An activation is not a "yes" by itself: 2025-08-27 was activated ahead of forecast rain [VERIFIED, src-C09].
  - Releases must be classified on body text. The 2025-07-12 activation's title does not say so [VERIFIED, src-C42].
  - An absent activation is not evidence of no event: 2024 had one activation but 47 police rain incidents in October [VERIFIED, bt-B8].
- **The Bluesky mirrors** start in March and April 2026, so they cannot label 2024 or 2025 [VERIFIED, src-C03].

## 4. Legality (C2)

**Bottom line.**
1. **The two live feeds may be read, with conditions.**
   - The Ajuntament press WP API (S5) and Betevé RSS (S8) are open to our crawler under robots.txt [VERIFIED, leg-L49, leg-L53].
   - The Ajuntament robots.txt shuts out 130 named agents, mostly AI crawlers and AI assistants, including ClaudeBot, Claude-User, GPTBot and Google-Extended [VERIFIED, leg-L49].
   - Betevé's legal notice forbids any reproduction without written permission [VERIFIED, leg-L52].
   - **So neither adapter sends text to Jev. Each uses the keyword hint, and a person reviews every item,** until a lawyer answers points 12 and 13 below.
2. **What the map may show from them:** a fact in our own words, the source named, the date and a link. The Ajuntament's reuse conditions and Ley 37/2007 Art. 8 forbid altering or distorting the information and require citing the source; the Ajuntament's also forbid implying that it endorses the reuse [VERIFIED, leg-L50, leg-L51]. No verbatim text, no images, no Betevé video embeds.
3. **Open data is green.** These may be read twice an hour and used with attribution:
   - Open Data BCN (CC BY 4.0) [VERIFIED, leg-L57]
   - XEMA and INUNCAT (the Generalitat's open licence) [VERIFIED, leg-L55]
   - MeteoAlarm (CC BY 4.0 equivalent) [VERIFIED, leg-L54]

   MeteoAlarm warnings are never shown. Its terms require redistributed warnings to arrive within 10 minutes, which a 30-minute poll cannot meet [VERIFIED, leg-L54].
4. **Red for automated reading:**
   - Reddit, including RSS and `.json` [VERIFIED, leg-L28]
   - Instagram and Facebook [VERIFIED, leg-L29]
   - TikTok [VERIFIED, leg-L30]
   - X [VERIFIED, leg-L31]
   - Telegram [VERIFIED, leg-L35]
   - YouTube channel RSS [VERIFIED, leg-L32, leg-L39]

   No research-access programme covers this team: DSA Art. 40(12) is limited to research on risks the platform creates [VERIFIED text, leg-L25; ASSUMPTION on the purpose], and Meta's and TikTok's programmes need an institution [VERIFIED, leg-L26, leg-L27].
5. **Individuals: at most a count per zone in code,** never shown, stored or sent to Jev. This keeps the slice inside `mvp.md` [VERIFIED, sto-S27]. GDPR still applies to the counting [VERIFIED, leg-L16]:
   - Art. 6(1)(f) legitimate interest, with a written balancing test
   - one public notice page (Art. 14)
   - an opt-out list of handles
   - a code health filter first
   - an identifiable crawler User-Agent

   A city operator cannot use 6(1)(f) and needs a law-rank competence under 6(1)(e) [VERIFIED, leg-L3, leg-L4, leg-L5].

**GDPR turned into design rules:**
- **Health data.** A code regex drops health and injury items before any write or outside call [VERIFIED text, leg-L7; ASSUMPTION on third parties].
- **Transparency.** One public data-notice page lists:
  - controller and contact
  - purpose and basis
  - categories and sources
  - the crawler User-Agent
  - recipients
  - retention
  - rights, and complaint to the AEPD

  [VERIFIED, leg-L10]. Relying on Art. 14(5)(b) instead of notifying each person is a lawyer point [VERIFIED text, leg-L8].
- **Crawler identity.** `next-rain-hackathon/0.1 (+<notice page URL>)`. The slice sends it without the URL for now [VERIFIED, leg-L65]. The research scripts still send a browser-like UA [VERIFIED, leg-L46].
- **Processor.** Text sent to Jev makes TypeSafe a processor under Art. 28 [VERIFIED, leg-L41, leg-L42]. No individual's text goes there.
- **Retention.** Individuals: a count only. Official and press rows: 30 days after the window [ASSUMPTION, leg-L37].
- **Right to object.** An opt-out list [VERIFIED, leg-L11, leg-L14].
- **Git.** Nothing about an individual is ever committed [VERIFIED, sto-S8].

Integrator resolution (health filter, it1): the regex runs first, before any outside call. Legal owns that rule.

**Copyright and TDM.**
- **What the exceptions cover.** The EU and Spanish TDM exceptions (DSM Art. 4, RDL 24/2021 Art. 67) cover copying in order to analyse, not showing the content [VERIFIED, leg-L17, leg-L20].
  - TDM means "any automated analytical technique", so the keyword hint is TDM too [VERIFIED, leg-L59].
  - The exception does not apply where the rightholder has "expressly reserved" the use by appropriate means. Recital 18 lists machine-readable means, "including metadata and terms and conditions of a website or a service" [VERIFIED, leg-L59, leg-L60].
- **The Ajuntament's AI block.**
  - The `*` group allows our crawler on `/premsa/wp-json`; a matcher run on the slice's exact URL confirmed it [VERIFIED, leg-L49].
  - On a narrow reading, the 130-agent block binds only the agents it names.
  - On a purposive reading, it says the Ajuntament does not want its content processed by AI systems. That would cover sending its text to TypeSafe's classifier.
  - Undecided (lawyer point 12), so the default is no Jev.
  - It also means **AI agents must not fetch `ajuntament.barcelona.cat`** beyond robots.txt. This run's agents did so into at least 9 raw directories [VERIFIED, leg-L64]. Integration and backtest runs should use fixtures.
- **Betevé.**
  - robots.txt has no AI lines [VERIFIED, leg-L53].
  - Its avís legal reserves all reproduction and allows video embeds only on private individuals' sites [VERIFIED, leg-L52].
  - Whether that blanket clause is a TDM reservation is lawyer point 13. Reading the feed and matching keywords in memory rests on transient copies (TRLPI Art. 31.1) and the feed being offered for automated reading [VERIFIED text, leg-L63; ASSUMPTION on an implied licence].
- **Display.** Show facts in our own words plus a hyperlink [VERIFIED, leg-L23, leg-L24]. No verbatim headline by default.

**Database right** (Directive 96/9 Arts. 7(1), 7(5), 8(1), 8(2), 15; TRLPI Arts. 133-134) [VERIFIED, leg-L21, leg-L38, leg-L61, leg-L62].
- **The rule.** A maker's substantial investment in "obtaining, verification or presentation" of contents is protected.
  - A lawful user may take insubstantial parts for any purpose, and contract terms saying otherwise are void.
  - Repeated, systematic extraction of insubstantial parts is barred when it conflicts with normal exploitation or unreasonably prejudices the maker.
  - **Spain's TRLPI 133.2 says "repetidas o sistemáticas", "or" rather than the Directive's "and", so it is wider.**
  - RDL 24/2021 Art. 67(7) lets a lawful user extract a substantial part for TDM [VERIFIED, leg-L60].
  - The maker of an unprotected database may restrict use by contract (Ryanair) [VERIFIED, leg-L22].

| Source and pattern | Verdict |
|---|---|
| **Ajuntament WP API**, twice an hour, only new posts after the watermark, `title` and `excerpt` held in memory only [VERIFIED, leg-L65] | **A.** Whether it is a protected database is doubtful: the Ajuntament writes its own releases, and creating content is not "obtaining" it [ASSUMPTION]. Each run is insubstantial, but the polling is repeated and systematic, and over a year it reads every release. Prejudice is low: no copy of the archive is kept, and a public body must exercise its IP "de forma que se facilite su reutilización" (Ley 37/2007 Art. 3) [VERIFIED, leg-L51]. Lawyer point 14 |
| **Betevé RSS**, twice an hour, latest 15 items | **A.** The feed is made for automated reading, but the avís legal reserves all reproduction (lawyer point 13) |
| **Open Data BCN CSVs** (GUB, IRIS), annual files fetched once for the backtest | **G.** CC BY 4.0 §4 grants extraction of "all or a substantial portion" [VERIFIED, leg-L57, leg-L58]. No need to poll them twice an hour |
| **XEMA, INUNCAT** (Socrata), twice an hour | **G** with attribution under the open licence [VERIFIED, leg-L55]. That it covers the sui generis right is an ASSUMPTION. Respect `Crawl-delay: 1` [VERIFIED, leg-L56] |
| **MeteoAlarm**, twice an hour | **G** as a trigger under the CC BY 4.0-equivalent licence [VERIFIED, leg-L54] |

**Red, amber, green by source and activity.** G means allowed by the terms, with low GDPR risk under the record design. A means allowed only with the stated condition, or uncertain. R means prohibited without a key, agreement or permission, or high risk, or ruled out for the MVP. "Show" means a card or pin on the public map.

| Source | Read (automated) | Store text | Store media | Store author handle | Show on map | Link only (human-found) |
|---|---|---|---|---|---|---|
| **S5 Ajuntament press WP API** | **A** (`*` allows it [leg-L49]; never by an AI agent; DB-right repetition, point 14) | A: own-words summary only | R (images CC BY-NC-ND [leg-L50]; not needed) | G (organisation) | **G**: own-words fact + "Ajuntament de Barcelona" + date + link + "not endorsed by the Ajuntament" [leg-L50, leg-L51] | G |
| **S8 Betevé RSS** | **A** (robots.txt allows `/feed/`; avís legal reserves reproduction, point 13) | A: own words only | R | n/a | **G**: own-words fact + "betevé" + link | G |
| Betevé video embed | n/a | n/a | n/a | n/a | **R** (embeds allowed only on private individuals' sites [leg-L52]) | G |
| Open Data BCN (GUB, IRIS) | G (CC BY 4.0 [leg-L57]) | G | n/a | n/a | G with attribution | G |
| XEMA, INUNCAT | G (open licence [leg-L55]) | G | n/a | n/a | G, credited to "Generalitat de Catalunya. Departament de ..." with the update date; no logos | G |
| MeteoAlarm Atom (S30) | G (trigger only) | G (internal) | n/a | n/a | **R** (30-min poll cannot meet the ≤10 min rule [leg-L54]) | G |
| Bluesky, individuals | G (public API, back off on 429, identifiable UA) | R (count in code; nothing kept) | R | R | G as a zone count only; R as a pin in the MVP | R in the MVP |
| Bluesky mirrors of 112, Betevé, Ajuntament | A (provenance unverified; treat as individuals) | A | R | A | A with attribution, once provenance is established | G |
| Mastodon, individuals (mastodon.social) | G (A for other instances) | R | R | R | as Bluesky individuals | as Bluesky individuals |
| Reddit (API, `.json`, RSS, HTML) | R; A with an approved Data API token | R | R | R | R | G for official/press accounts only |
| Instagram / Facebook | R | R | R | R | R; A for an official embed | G for official/press accounts only |
| TikTok | R | R | R | R | R; A for an official embed | G for official/press accounts only |
| X | R | R | R | R | R; A for an official embed | G for official/press accounts only |
| YouTube Data API | A (needs a key) | A (30-day refresh) | R | A (30-day refresh) | A for an official player embed | G for official/press channels only |
| YouTube channel RSS | R | R | R | R | R | n/a |
| Telegram (incl. `t.me/s/`) | R | R | R | R | R | G for official/press channels only |
| Other press (3Cat, La Vanguardia, ...) | A (read each outlet's robots.txt **and** avís legal first) | A: own words | R | n/a | G as own-words fact + link | G |
| Citizen reports through our own form (future) | n/a | R in the MVP; later A with an Art. 13 notice | R in the MVP; later A with explicit opt-in | R | R in the MVP | n/a |

**Text to Jev, by source** (default until lawyer points 9, 12 and 13 are answered):
- **S5 Ajuntament: no.**
- **S8 Betevé: no.**
- Open data: allowed.
- Individuals: never.

`scripts/signals.mjs` today calls Jev for every relevant item, from any source, whenever `TYPESAFE_API_KEY` is set [VERIFIED, leg-L65]. The integration engineer should gate it per source and leave it off for S5 and S8. Without Jev, relevant items reach the reviewer as `unclassified`, which is the flow's existing fallback (section 6).

**Points for a lawyer or DPO** (from the legal section):
1. Who the controller is (team, sponsor or organiser), and who signs the notice.
2. The 6(1)(f) balancing test. Whether Art. 14(5)(b) is available. Whether the backtest counts as statistical processing under Art. 89.
3. City operation: Ley 7/1985 Art. 25.2.f with Catalan civil-protection law, which was not read. Art. 9(2)(g) or (i). Whether a DPIA is needed.
4. RDL 24/2021 Art. 67: whether terms of use count as a reservation, and whether the 67(3) reservation also limits 67(7).
5. Whether linking an individual's post on a flood map is ever proportionate.
6. Reuse terms (now read; see the legal section). Open questions:
   - whether press releases are reusable "informació" or protected "obres"
   - whether an own-words summary "alters" the information
   - whether internal MeteoAlarm use counts as "Redistribute"
   - the reuse terms for 112 posts
7. Who runs the `*.eurosky.social` mirrors.
8. Written permission from Reddit, Meta, TikTok, X and Telegram, and now from Betevé and the Ajuntament, before any city deployment.
9. TypeSafe as processor: Art. 28 terms, where it processes data, its retention.
10. Whether a keyless visitor is bound by platform terms or an avís legal, and whether a platform can reserve TDM for its users' posts.
11. Whether short news headlines are protected, and when TRLPI Art. 129 bis(6)(c) is met.
12. **The Ajuntament's per-agent AI block.**
    - Is it an Art. 4(3) / RDL 67(3) reservation against the named agents only, or against AI processing of the content generally?
    - Does it cover sending release text, fetched by our own unnamed crawler, to Jev?
13. **Betevé's avís legal.** Is a blanket ban on reproduction a TDM reservation under Recital 18? Does publishing an RSS feed imply a licence to read it automatically? Do either of these cover the keyword match, or a copy sent to Jev?
14. **Twice-hourly polling and the database right.** Are the Ajuntament and Betevé archives protected databases? Is polling the newest items "repetidas o sistemáticas" extraction under TRLPI 133.2?

## 5. Storage (C3)

**Bottom line.**
1. **Individuals produce no record.** Their posts become counters in memory, and the posts are discarded. Only `official`, `press` and `open_data` items get a row.
2. **Persistent files** live in git outside `data/` (decision D1):
   - `signals/inbox.jsonl`: organisation rows
   - `signals/counts.json`: aggregate counts and per-source watermarks
   - `signals/gazetteer.json`: the place-name gazetteer
   - `signals/allowlist.json`: which hosts may be a card source
   - `signals/barri_priors.json`: the backtest's priors

   Anything under `data/` is copied to `public/data` and precached on phones, so nothing private may go there [VERIFIED, sto-S2, sto-S3].
3. **The published view is generated, never committed.** `scripts/signals-build.mjs` writes `data/geojson/signals.geojson` and `data/signals-cards.json` before dev, build, preview and qa. Both files are gitignored. They are always written, empty when nothing is approved.
4. **The area key is the Open Data BCN `codi_barri`** (73 codes). It is the same code as the Atlas `c_barri`, so flow and storage share one join [VERIFIED, sto-S25, int-I1].

Integrator resolutions, where storage owns the schema:
- **File names.** The allowlist file is `signals/allowlist.json`; flow called it `signals/accounts.json`.
- **Hash.** IDs use sha256.
- **Map unit.** The published unit is **one feature per barri for the published window**, not one per barri per day. One per day would stack up to 7 dots on one label point, and only the top dot can be tapped.
- **Generated files are never committed.** Flow's phase-2 text had the reviewer commit the published files; with this model they are rebuilt from approved rows on every build.

**What the design must fit** (repo facts) [VERIFIED, sto-S1 to sto-S6, sto-S28]:
- **No backend.** The app only fetches static files: `/data/zones.json`, `/data/sources.json` and six GeoJSON files.
- **`qa.mjs` checks:**
  - each card has 8 fields, an https `sourceUrl`, and mechanisms from a 7-value enum
  - proof cards include `observed_impact`
  - no "forecast", "will rain", "mm expected", "€" or "guaranteed flood"
  - coordinates inside 2.05 to 2.25 E and 41.32 to 41.48 N, and all GeoJSON together at most 2 MiB
  - no dangling `relatedZoneIds`
  - `proof: false` in `src/types.ts`
  - the Torre Baró link rules
- **Today's layers:** 33 features, 108,087 bytes.
- **Labels are public text.** Feature `name`s are drawn on the map, and qa does not scan them today.
- **Group fallback.** A layer id missing from `FILE_GROUP` falls into the sewers group.

**Where each tier lives:**

| Tier | Where | Personal data |
|---|---|---|
| Individual posts | process memory, one run | yes, but never written. No file, no log, no Jev |
| Counts and watermarks | `signals/counts.json`, committed through the review PR | aggregates only (small-cell risk: see Open gaps) |
| Organisation rows | `signals/inbox.jsonl`, same PR | minimal. Our own summary and the institution's or outlet's name, never a journalist's byline |
| Published view | `data/geojson/signals.geojson`, `data/signals-cards.json`, generated, gitignored | none |
| Gazetteer, allowlist, priors | `signals/*.json`, committed, never shipped | none |
| Reliquary vault | not a data store (vault rule 8) [VERIFIED rule; ASSUMPTION reading, sto-S11] | none |
| Hosted DB (e.g. Supabase free: 500 MB, paused after 1 week idle) [VERIFIED, sto-S10] | not now: it would need a key and a live client, and break "no backend" | none |

**Inbox row** (`signals/inbox.jsonl`, one JSON object per line, organisation items only):

| Field | Rule |
|---|---|
| `signal_id` | first 16 hex of `sha256(platform + ":" + post_id)`, or of `sha256(source_url)` for web pages and reviewer rows |
| `platform` | `bluesky`, `mastodon`, `press`, `open_data` or `manual` |
| `source_kind` | `official`, `press` or `open_data`, taken only from `signals/allowlist.json`. Never decided by a model |
| `source_url` | https, and its host must be on the allowlist |
| `source_label` | the institution or outlet name, never a person |
| `published_at`, `fetched_at` | UTC, to the minute. `published_at` is the only date a card may print |
| `summary` | one sentence in our own words, from a code template or a person. No names, no health detail |
| `place` | `{level, barri, district, zone_ids, hotspot_fid, gaz}` from the gazetteer |
| `cls` | `{model, template, run_id, mechanism, p_mechanism}`. `null` on manual rows |
| `review` | `{status: pending, approved, rejected or expired; by: a reviewer code, never an email; at; reason}` |
| never written | post text, media, handles, display names, exact points, health or injury detail |

A worked example (653 bytes minified) is in the storage section §3a [VERIFIED computed, sto-S22].

**Counts** (`signals/counts.json`). Holds:
- per-source watermarks
- barri-hour counts for 48 h, rolled up into barri-day counts
- the last signal time per barri

No ids, no text and no URLs. Only non-zero cells are written. The watermark is committed with the counts it produced, which deduplicates individuals' posts without keeping post ids. In slice 1 nothing individual is counted, so the file holds only organisation-item counts.

**Gazetteer** (code, never the model). Built from:
- Open Data BCN barris: 73, CC BY 4.0 [VERIFIED, sto-S16]
- the 25 Atlas short names as aliases [VERIFIED, int-I1]
- the 10 districts
- `zones.json` ids. All 33 join a barri; 42 barris carry one [VERIFIED computed, sto-S21]

Streets come after the hackathon. Street names (4,770) and the street-to-barri join resolve 84.2% of streets [VERIFIED, sto-S17, sto-S18], but add 769 KB.

Rules, all in code:
- Match the most specific name first, after normalising.
- A street name matches only after a street type ("carrer de", "c/", "plaça").
- A street spanning several barris goes to the reviewer.
- Two or more district names in one item mean district precision only.
- River names (Besòs, Llobregat) are not places.
- Common-word names ("la Porta", "el Clot") match only when capitalised.
- A place outside Barcelona (L'Hospitalet, Badalona and others) vetoes the item for review.
- No match means not published.
- Jev may only choose among gazetteer candidates, always with a "none" option.

**Published view:**
- **Unit.** One feature per barri with at least one approved allowlisted row in the window: the current event plus 7 days, editable. Id `sig-<codi_barri>`, at the barri label point.
- **Duplicates.** A row whose link already appears on a `proof-oct2026` card is skipped, and that card is linked through `relatedZoneIds`.
- **Card text** comes from fixed templates. Example `whatCouldFail`: "On 4 and 5 October 2026, 3 reviewed reports from Betevé and the Ajuntament described slope runoff in Sant Genís dels Agudells. Linked reports, not a measurement of depth or damage."
- **Every printed date** is a row's own `published_at`. The reviewer confirms it appears on the linked page [VERIFIED, sto-S27].
- **Individuals' counts** never appear on a card or a name.
- **Size.** A feature is 209 B and a card 988 B. All 73 barris add 15 KB of GeoJSON and 70 KB of cards [VERIFIED computed, sto-S22].
- **Unconfirmed.** Whether MapLibre ignores the top-level `meta` member is an ASSUMPTION; the integration run confirms it.

**Retention** (design choices pending the DPO points, ASSUMPTION):

| Item | Kept |
|---|---|
| Individual post | until counted. A health-regex hit is not counted |
| Hour counts | 48 h, then rolled into days |
| Day counts | indefinitely, no ids |
| Pending row | 72 h, then `expired` |
| Approved row | published window + 30 days |
| Rejected or expired stub | 30 days, as dedupe memory |

**Takedown.**
- Set the row to `rejected` through a PR; the next build drops it.
- Git history keeps organisation links by design. Purging needs a history rewrite, and clones keep copies [VERIFIED, sto-S8].
- Old static-host deployments keep files until deleted [VERIFIED for Vercel, sto-S9].
- Offline phones keep the old cache until their next online visit.

**Backtest label files** (for 2026 storms onward):
- `signals/labels/<year>.csv` with columns `barri, period_start, period_end, grain (day | window2d | month), label (0/1), source_kind (iris_grate | gub_rain | proof_layer | press | official), source_url`
- predictions in `signals/predictions/<run>.csv`

Integrator resolution: storage's §9 columns had no `grain`, so they could not hold the police data's barri × month labels. The backtest's proposal can.

## 6. Pipeline and refresh (C4)

**Stages**, each in code. "Never" is a hard rule.

| Stage | What code does | Never |
|---|---|---|
| Ingest | One adapter per feed (`async (since) => items[]`), run in parallel with `Promise.allSettled` and a 20 s timeout. Slice 1: Ajuntament WP API (posts after the last watermark) and Betevé RSS. Priority inputs: XEMA, MeteoAlarm `ES181`, the INUNCAT row | Read a source that legal marks R. Follow links inside posts. Call Bluesky search |
| Normalise | `{platform, source_kind, post_id, url, published_at, text}` in memory. `source_kind` from `signals/allowlist.json` | Write `text` to disk or a log |
| Dedupe | `signal_id` against the inbox (rejected and expired stubs kept 30 days), plus a per-source `published_at` watermark committed with the run's output. A failed run leaves the watermark alone, so the next run re-reads the window | Keep post ids outside the inbox |
| Health filter | Regex on accent-stripped text, before any write or outside call: `\b(ferit|ferid|herid|lesionat|lesionad|mort|muert|falleci|ofegat|ofegad|ahogad|desaparegu|desapareci|atrapat|atrapad|rescat|hospitalitz|hospitaliz|ambulanc)` | Store the dropped item |
| Classify | With `TYPESAFE_API_KEY`: Jev Template A v2, mechanism choice including `other`. Auto-accept at confidence 0.95 or above; otherwise the reviewer picks. A place question only when the gazetteer returns 2 or more candidates, plus `none`. Without a key: a relevance regex, mechanism `unclassified`, and the reviewer picks | Ask Jev for a priority, a summary, coordinates or card text |
| Geolocate | Gazetteer rules (section 5) | Let the model produce or adjust a location |
| Review gate | Rows written `pending`. `npm run signals -- --list` prints them sorted by their barri's priority, each with a code-composed line and its link. `--approve <id> [--mechanism m] [--barri code]` or `--reject <id> --reason r`. The change reaches `main` through a PR | Auto-approve. Publish a pending row |
| Publish | `scripts/signals-build.mjs` writes the two files from approved, allowlisted rows (section 5) | Put card text through a model. Show euros or rainfall figures |

**Mechanism mapping** to the qa enum:

| Classifier output | Published as |
|---|---|
| `street_overflow` | `street_overflow` |
| `basement_flooding` | `basement` |
| `transformer_room` | `transformer_room` |
| `slope_runoff` | `slope_runoff` |
| `transport_disruption`, `aftermath_only`, `other`, `unclassified` | never published as a mechanism |

The vault's `proof_layer.csv` uses the same non-enum names, so it needs this mapping too.

**`preventiveAction` templates** (checked against the qa forbidden words):

| Mechanism | Template |
|---|---|
| street_overflow | "Keep street drains and gratings clear and avoid low crossings while water is running." |
| basement | "Check that basement and ground-floor entries and drains are clear before the next heavy rain." |
| transformer_room | "Report water near electrical rooms to the utility and keep away from flooded equipment." |
| slope_runoff | "Clear debris and inspect slopes and walls before the next intense rainfall." |

**Measured.**
- **Classifier.** Jev Template A v2 scored 36/52 (69%, Wilson 95% CI 0.56 to 0.80) on mechanism in the vault's golden-set run, against 0.46 for always picking the most common class [AGENT, flo-F27].
  - At confidence 0.95 or above it was right 24 of 26 times.
  - Caveat: the snippets are paraphrases by the agent that labelled them, and one person labelled them. 69% is optimistic.
- **Keyword fallback.** Scored 0.44 (CI 0.32 to 0.58), with recall 1/24 on publishable items [VERIFIED computed, flo-F22]. So without Jev, relevance hits go to a person, never to an auto-label.
- **Gazetteer.** Put 8 of 24 publishable golden snippets in the right barri and 4 in the right district. No wrong barri was found [VERIFIED computed, flo-F30]. Optimistic too: the rules were written after reading those snippets.
- **Health regex.** Recall cannot be measured: none of the 52 golden snippets mentions an injury [VERIFIED, flo-F31].
- **Fetch time.** One parallel read of 8 feeds took 0.4 to 0.7 s locally [VERIFIED, flo-F29].

**Twice an hour** (phase 2, after the slice): a timer at minutes 7 and 37 (cron `7,37 * * * *`, UTC). Minute 0 is avoided because GitHub can delay or drop jobs at the top of the hour [VERIFIED, flo-F2]; the same spacing is harmless locally. The demo needs no scheduler: run `npm run signals` by hand.

**Request and cost arithmetic** [computed by the integrator from flow's and sources' measurements, int-I6, int-I7]:

| Item | Per run | Per day (48 runs) | Limit |
|---|---|---|---|
| Ajuntament WP API, Betevé RSS | 2 | 96 | none published |
| MeteoAlarm Spain Atom (57 KB) | 1 | 48 | none published; licence CC BY 4.0 equivalent, T&C not read [VERIFIED feed, src-C47] |
| XEMA and INUNCAT (Socrata) | 2 | 96 | keyless calls share a per-IP pool, no number [VERIFIED, flo-F14] |
| **Total, recommended slice** | **5** | **240** | |
| + S1 mirror, once D3 allows | 6 | 288 | Bluesky "generous" [VERIFIED, src-C05] |
| Jev, typical | about 1.25 items (Betevé's measured rate; WP not measured) × 1,661 tokens | about $0.004 plus WP items | price $0.042 per million input tokens [AGENT, price UNVERIFIED, flo-F18] |
| Jev, worst case (cold start: a full Betevé page of 15 plus a WP page of 20, ASSUMPTION) | 35 items | about $0.12 | no published rate limit [VERIFIED, flo-F17] |

These totals replace earlier figures:
- Flow's 8 reads a run (384 a day) included S2 and S9, now dropped.
- Sources' 4 a run (192 a day) counted S1 and left out XEMA and INUNCAT.

Calm mode cuts this further: in calm weather a full run happens every 4th tick (section 7).

**Failure handling.**
- Each adapter and priority input fails on its own.
- Two retries with exponential backoff on 429, 5xx and timeouts.
- `last_ok` and `last_error` per source are recorded. Three failures in a row are flagged in the `--list` header.
- A Jev 401 or 422 switches the run to the fallback.
- Unknown inputs mean storm cadence.
- A missed tick only widens the next window, because the watermark is time-based.

## 7. Prioritisation (C5)

`P_b = Σ w_k · x_k,b` per barri. Each term is scaled to 0 to 1 and computed in code. The weights live in one editable file. The model never outputs a priority.

| Term | Default weight (ASSUMPTION, flo-F25) | Definition | Evidence |
|---|---|---|---|
| rain | 0.45 | Sum of the 6 newest 30-min slots at the nearest XEMA station (X4 el Raval, X8 Zona Universitària, D5 Fabra) ÷ 30 mm, capped at 1. Unknown → 1 | Slots are labelled at interval start in UTC and arrive about 16 min after the slot ends (n=2) [VERIFIED, flo-F12, flo-F26]. With three stations, rain saturates citywide in a real storm: on 3 Oct, X4 had 94.6 mm, X8 59.1 and D5 46.8 over the window [VERIFIED computed, flo-F24]. Untested at barri scale |
| exposure | 0.25 | max(percentile of Atlas modelled property damage per hectare at T10; 1 if the barri touches a `slopes-torrents` polygon). Never shown as euros | Replayed on 2024 and 2025: AUC 0.49 to 0.53. The slope flag alone scores 0.45 to 0.47, below chance on both IRIS tests [VERIFIED computed, bt-B24]. It is a declared override (vault C8), not a measure of risk |
| signals | 0.2 | Approved or pending organisation items in the barri in the last 6 h ÷ 3. Individual counts, later, ÷ expected reports (D7) | Near zero almost every hour (section 3) |
| staleness | 0.1 | Hours since the barri's last organisation item ÷ 6 | Code-defined |
| warning | cadence only | MeteoAlarm `ES181` (Moderate 0.5, Severe 0.8, Extreme 1) and the INUNCAT phase (0.33, 0.67, 1), the latter counted only while a Barcelona station shows rain | Both are citywide or wider, so they cannot change a ranking. On 9 Oct the INUNCAT row still read `ALERTA` on a dry evening [VERIFIED, flo-F13]. Warnings are never card text: qa forbids "forecast" |

Ties break on damage percentile, then barri code.

**What priority changes:**
1. **Cadence.** Storm mode runs fully every tick. It is triggered by any of these:
   - any station above 0 mm
   - any warning
   - any signal in the last 6 h
   - any unknown input

   Calm mode runs fully every 4th tick.
2. **Review order.** `--list` sorts pending rows by priority.
3. **Search budget.** Applies only when Bluesky search returns, in a later slice.

**Implementation.** `work/priority.mjs` v2 passes an assert-based self-check [VERIFIED, flo-F24]. It ran live at 21:39Z on 9 Oct: calm, with el Raval and the slope barris tied at 0.35. It replays 3 Oct as storm mode. The backtest's `barri_priors.json` (73 rows, 13.5 KB) [VERIFIED, int-I5] pre-bakes:
- population
- IRIS 2025 volume
- dry-day grate reports
- damage per hectare
- the slope flag
- exposure
- nearest station

`damage_t10_per_ha` is a ranking input only and must never reach card text.

**Honest framing.** No priority term beats population or last year's report volume in the backtest (section 8). The score schedules refreshes and orders review. It is not a risk claim, and "exposure" must not be described as risk.

## 8. Backtest (C6)

**Result in one sentence.** In a blind barri-level test on 2024 and 2025, the Atlas flood layers and last year's reports ranked the barris that later filed rain reports only slightly better than chance (AUC about 0.6) and no better than population; the flow's priority score did no better than chance; and the live sources tell rain days apart, not places.

**Design** (run on real data, keyless, 2026-10-09):
- **Unit:** the 73 barris.
- **Event day:** 30 mm or more in a day at XEMA X4, X8 or D5. 25 and 40 mm are a sensitivity check. This gives 2, 4, 8, 11 and 8 events in 2022 to 2026, including 16 Sep, 29 Sep, 3 Oct and 5 Oct 2026 [VERIFIED computed, bt-B2].
- **Labels:**
  - A: IRIS storm-drain grate reports in each event's 2-day window (2024, 2025, Jan to Mar 2026) [VERIFIED, bt-B3, bt-B4]
  - B: Guàrdia Urbana "PLUJA TORRENCIAL" incidents in event months (2024, 2025) [VERIFIED, bt-B8]
  - C: the vault's press-built proof layer for the Sep to Oct 2026 storms: 12 surface-water rows in 11 barris, or 24 rows in 20 barris [AGENT rows, bt-B20]
- **Blind:** year N predictors use only N−1 data.
- **Not blind:** the static Atlas layers are assumed to predate 2024; their update date cannot be read keyless [ASSUMPTION, bt-B21]. The slope layer is not blind for 2026. The repo's `slopes-torrents` file first appears in commit de65063 on 2026-10-09, after the storms, and it contains two labelled sites [VERIFIED, bt-B26]. That commit is the repo's only commit, so it dates the whole app, not the layer alone. Either way the layer was committed after the storms, so it is not blind for 2026 [VERIFIED, int-I4].
- **Metrics:** AUC with a bootstrap clustered by barri, and a permutation null band per predictor. Hit rate in the top 15 (random 0.21). Brier skill calibrated on N−1. The change in Brier when a predictor is added to a control (population plus IRIS volume).
- **Primaries,** fixed before the first run in a code comment (self-declared): T100 area, hotspot area, persistence.

**The labels are real rain signals** [VERIFIED computed, bt-B6, bt-B9]:
- Grate reports run 3.9 times higher in event windows than on dry days (95% CI 2.8 to 5.3, resampled by event).
- Police rain incidents average 32.5 a month in event months against 3.7 in other months (8.8 times, CI 4.7 to 19.8).
- Both hold at 25 and 40 mm.

**AUC by barri, 2024 to 2025** (IRIS 2024 / GUB 2024 / IRIS 2025 / GUB 2025) [VERIFIED computed, bt-B15 to bt-B19, bt-B24]:

| Predictor | AUC | Note |
|---|---|---|
| Atlas T100 area (primary) | .60 / .59 / .60 / .58 | clears its own null band by only 0.015 to 0.024 |
| Atlas hotspot area (primary) | .54 / .56 / .52 / .56 | worst Atlas layer at barri scale; 33 of 73 barris touch a hotspot |
| Modelled damage T10 | .58 / .60 / .61 / .59 | |
| Persistence, N−1 (primary) | .60 / .59 / .61 / .62 | worsens Brier on both IRIS years |
| Flow composite replay | .52 / .55 / .51 / .57 | |
| Flow exposure term | .49 / .53 / .50 / .52 | |
| Flow slope flag | .45 / .47 / .45 / .47 | below its null band on both IRIS tests |
| Control: population 2023 | .63 / .65 / .61 / .62 | |
| Control: all IRIS reports N−1 | .66 / .64 / .64 / .63 | |

**Brier.** Adding T100, hotspot or damage to the control changes Brier by at most 0.0012, and no interval excludes 0 [VERIFIED computed, bt-B17]. Intervals that do exclude 0 on the 2024 and 2025 tests, from `results.txt` [VERIFIED, int-I3]:
- Last year's dry-day grate reports improve Brier on IRIS 2024.
- Persistence worsens it on IRIS 2024 and IRIS 2025.
- The flow exposure term worsens it on IRIS 2024 (+0.0045, CI +0.0004 to +0.0087).
- The slope flag worsens it on IRIS 2024 (+0.0032, CI +0.0006 to +0.0065).

The backtest section's bottom line lists only the first two; the last two are added here.

**2026 (proof layer)** [VERIFIED computed from AGENT rows, bt-B20]:
- T100 0.65 on 11 surface-water barris, inside its null band.
- Population 0.40 and IRIS volume 0.45 point the wrong way: the press sites lean to the northern slopes.
- The exposure term's 0.72 is leakage from the post-hoc slope layer.
- These are the same 12 cases as the vault audit, so they are not independent evidence.

**Live sources by day, 2024 to 2025** [VERIFIED computed, bt-B28]:

| Source and term | Event days fired | Dry days fired | AUC, event vs dry |
|---|---|---|---|
| Bluesky "Barcelona pluja" | 79% of 19 | 18% | 0.84 |
| Bluesky "Barcelona lluvia" | 79% of 19 | 27% | 0.85 |
| Bluesky "inundació" / "inundación" | 5% | 1% | 0.52 |
| Ajuntament press "insuficiència drenant" | 26% | 1% | 0.63 |

Nothing here locates a barri. Bluesky volume is not stable: "Barcelona pluja" matched 21 posts in 2024 and 256 in 2025, "lluvia" 53 and 258, and the hit rates are not corrected for that growth [VERIFIED computed, backtest §4.3].

**Why the signal sources cannot be backtested per barri:**
- S1 and S2 start in 2026 [VERIFIED, src-C03].
- S3 has 9 to 32 posts per 2024 to 2025 storm [VERIFIED, src-C44].
- S5 is city level.
- S8 and S30 hold no history.

So the C6 criterion is met for the static and priority predictors on real data. For the signal feeds it is met as "cannot be backtested per barri", for these verified reasons.

**What it supports.**
- Reporting density predicts where *reports* come from. Use it as a normaliser, not a boost (D7).
- None of this supports "the map predicted where it flooded", nor any Atlas weight tuned from these results.

The full tables, threshold checks and reproduce commands are in the backtest section, and the code is in `backtest/` (stdlib Python run with `-I`, plus one Node helper, each with a self-check). A second run gave a byte-identical `results.txt`.

## 9. Integration: the slice in branch `signals-pipeline` (C7)

**State at merge time** [VERIFIED, int-I4]:
- Branch `signals-pipeline` holds one commit, `de65063`.
- `package.json` runs only `copy-data.mjs` before dev, build and preview, and has no `preqa`.
- No `signals/` directory or signals scripts exist yet.

**Planned slice**, reconciled from storage §5 and flow §2. No new runtime dependency; Node stdlib only.
1. Commit, outside `data/`:
   - `signals/allowlist.json`: `beteve.cat`, `ajuntament.barcelona.cat` and `opendata-ajuntament.barcelona.cat`, plus a Generalitat host the engineer names
   - `signals/gazetteer.json`: 73 barris, 25 aliases, 10 districts, zone ids
   - `signals/barri_priors.json`: copied from the backtest
   - an empty `signals/inbox.jsonl`
2. `scripts/signals-build.mjs`: approved, allowlisted rows → `data/geojson/signals.geojson` + `data/signals-cards.json`. Always writes both files. Exits non-zero on a malformed row.
3. The seven edits:
   1. `package.json`: `predev`, `prebuild` and `prepreview` become `node scripts/signals-build.mjs && node scripts/copy-data.mjs`. Add `"preqa": "node scripts/signals-build.mjs"` and a `signals` script.
   2. `.gitignore`: the two generated files.
   3. `src/lib/data.ts`: add `"signals"` to `GEOJSON_FILES`, and merge `/data/signals-cards.json` into `zones` (`{}` on failure).
   4. `src/types.ts`: `FILE_GROUP.signals = "proof"`, and the group label (D4).
   5. `LayerDock.tsx`: add `"signals"` to `GROUP_FILES.proof`.
   6. `MapCanvas.tsx`: feed the proof source from both files.
   7. `scripts/qa.mjs`, which must:
      - merge the cards file before the card checks
      - fail on a `sig-*` card whose host is not on the allowlist
      - run the forbidden-word list over `sig-*` names
      - fail on any individual-count field
4. The check: `npm run qa` green with an empty inbox and with one approved fixture row. One runnable self-check for the build script.
5. Stretch (D2): `scripts/signals.mjs` with the WP API and Betevé adapters, the health regex, the gazetteer, and `--list`, `--approve` and `--reject`.

Without edit 4 the cards land in the sewers group. Without edit 6 the dots never draw. Without the qa merge, every `sig-*` feature fails "no zones.json card".

**Built and run on 2026-10-10 around 00:20 CEST (live read at 2026-10-09 22:21Z), by the integration engineer, iteration 1.** Commit `208a974` on local branch `signals-pipeline` in `~/Code/hackathon-barcelona`, on top of `de65063`. Not pushed. No new dependency: Node stdlib only (`node:test`, `fetch`, `crypto`) [VERIFIED, int-I8].

**Files added**
- `scripts/signals.mjs`: the pipeline. Adapters for the Ajuntament WP REST API (`after=<watermark>`, `_fields=id,date_gmt,link,title,excerpt`, up to 4 pages of 50) and Betevé RSS. Then health regex, relevance regex, allowlist, dedupe by `signal_id`, gazetteer, mechanism hint, pending row. Review flags `--list`, `--approve`, `--reject`, `--add` (manual reviewer row), `--priority`, `--scheduled` (calm-mode cadence). Priority inputs XEMA, MeteoAlarm `ES181` and INUNCAT, each failing on its own. Two retries with backoff on 429, 5xx and timeouts. Retention as in section 5 (pending 72 h, approved window + 30 days, stubs 30 days).
- `scripts/signals-lib.mjs`: pure logic (filters, gazetteer resolver, keyword hint, priority `compose` and `cadence` lifted from `work/priority.mjs`, row validation, card templates).
- `scripts/signals-build.mjs`: approved rows to `data/geojson/signals.geojson` and `data/signals-cards.json`. Always writes both. Exits 1 on a malformed row, a host off the allowlist, a `source_kind` that differs from the allowlist, or a stored `text`, `title`, `handle`, `author`, `display_name`, `media` or `excerpt` field.
- `scripts/signals-gazetteer.mjs`: builds `signals/gazetteer.json` from the Open Data BCN barris CSV and the Atlas barri file. Output: 73 barris, 10 districts, 25 aliases, 33 zone ids in 42 barris, which reproduces sto-S21 with independent code [VERIFIED computed, int-I9].
- `scripts/signals.test.mjs`: the runnable check (8 tests). It covers the health and relevance regexes, the gazetteer rules, the keyword hint, the priority weights and cadence, and RSS parsing. One test runs the real build and `qa.mjs` in a temp copy with self-written fixture rows: approved, pending, out-of-window, rejected stub, and a duplicate of the Sant Genís proof URL. Another checks that build fails on a Reddit URL and on stored post text. A third checks qa passes with an empty inbox.
- `signals/`: `allowlist.json`, `config.json` (weights, window, expiry, User-Agent), `gazetteer.json` (13.9 KB), `barri_priors.json` (copied from the backtest, 13.5 KB), an empty `inbox.jsonl`, and a `README.md` with the commands.

**Edits** (the seven from the plan): `package.json` (`predev`, `prebuild`, `prepreview` run `signals-build` first; new `preqa`, `signals`, `signals:build`, `signals:check`); `.gitignore` (the two generated files); `src/lib/data.ts` (`signals` file, cards merged with `{}` on failure); `src/types.ts` (`FILE_GROUP.signals = "proof"`, group renamed "Reported impacts", `proof: false` unchanged); `LayerDock.tsx`; `MapCanvas.tsx` (proof source fed from both files); `scripts/qa.mjs`. In qa: cards merged first; a collision with `zones.json` fails; `sig-*` sources must be on the allowlist; `sig-*` names run through `FORBIDDEN`; `sig-*` cards and features may carry only whitelisted keys, so any count or handle field fails. README line 36 and two `testplan.md` lines follow the new label.

**Commands and results** (all run in the repo unless noted)

| Command | Exit | Result |
|---|---|---|
| `npm install --no-audit --no-fund` | 0 | 378 packages. esbuild's postinstall was blocked by the local npm allowScripts policy; build still works |
| `node scripts/signals-gazetteer.mjs <barris.csv> <barris_atlas.geojson>` | 0 | see above |
| `npm run signals:check` | 0 | 8 of 8 pass, 0.26 s |
| same check, scratch copy with proof dedupe disabled | 1 | the build + qa test fails, so the check catches that break |
| `node scripts/qa.mjs`, scratch copy with a bad `sig-*` card | 1 | 5 failures: extra feature field, forbidden word in name and card, extra card field `handle`, Reddit host |
| `npm run signals` (live, 2026-10-09 22:21Z) | 0 | 14.1 s wall. Ajuntament: 44 read, 7 relevant, 7 new. Betevé: 15 read, 0 relevant. 0 health drops [VERIFIED, int-I10]. XEMA 0 mm at X4, X8, D5; warning 0; mode calm |
| `npm run signals -- --list` | 0 | 7 pending rows, all Ajuntament releases from 3 to 9 Oct 2026; by URL, each is a drainage-emergency plan change or a storm update. None names a barri in title or excerpt, so none can publish without a person adding `--barri` |
| review flags, scratch copy | 1, 1, 0, 0, 1 | approve without a barri refused; approve with `other` refused; approve with a barri ok; reject ok; `--add` of a Reddit URL refused |
| `signals-build` then `qa.mjs`, same scratch copy | 0, 0 | 1 feature; "QA passed. 34 tappable features, 106 KB GeoJSON." |
| `npm run build` with one self-written approved fixture row, then `vite preview` and the browser pane at `/?zone=sig-39` | 0 | All 10 data files 200, `signals-cards.json` merged, card opens in "Reported impacts" with the Sant Genís proof card linked. Only console errors: service-worker registration in the pane |
| `npm run build` (empty inbox) | 0 | tsc and vite pass; PWA precache 37 entries |
| `npm run qa` (empty inbox) | 0 | "QA passed. 33 tappable features, 106 KB GeoJSON." |

**Not exercised or still open**
- **Jev path** not run: no `TYPESAFE_API_KEY` in this session. The code follows `tools/water/jev_golden.py`'s request and answer shape [AGENT, vault]. On 401 or 422 it falls back to the keyword hint for the rest of the run.
- **The dot itself** was not seen. The pane's map canvas drew blank for every layer, so this is an environment limit, not a signals error. Open gap 13: `meta` gave no console error and the file loaded, but drawing needs a check on a real browser.
- **The relevance regex** is now measured and no longer a gate: see "Update, commit `15b089c`" below.
- **Gazetteer common-word list.** `salut`, `coll` and `horta` were added to the capitalised-only list [ASSUMPTION]: "salut" means health and "coll" is a common noun.
- **Allowlist host for the Generalitat.** `interior.gencat.cat` was taken from the repo's own `sources.json`, which cites `dsp.interior.gencat.cat` [ASSUMPTION that it serves official Interior releases; not fetched this run].
- **Live rows not committed.** The 7 pending rows and `counts.json` from the live run are org links only, but nobody has reviewed them, so the commit holds an empty inbox. They are kept outside the repo in `raw/integration-live/` (sha256 `987ef956…`).
- **Deliberately left out:**
  - Bluesky and Mastodon readers, following D3 and S6, although the task text named them.
  - The street gazetteer.
  - The hours and days counts, since nothing individual is counted.
  - A GitHub Actions workflow (D5: needs Marc's PR setting and a merge to `main`); the timer line is in `signals/README.md`.
  - The backtest, which stays in `backtest/` (Python, large raw inputs).
- **Old label.** `mvp.md` and `technical.md` still say "Oct 2026 proof" (D8: no `mvp.md` change).
- **User-Agent.** It sends `next-rain-hackathon/0.1` with no notice-page URL, because no notice page exists yet.

**Update, commit `15b089c` (2026-10-10 about 00:40 CEST), integration engineer, iteration 1, second pass.** On top of `208a974`, same branch, not pushed, no new dependency. It closes the three S1 code gaps found against `208a974`. Files: `scripts/signals-lib.mjs`, `scripts/signals.mjs`, `scripts/signals.test.mjs`, `signals/README.md`. The app, `qa.mjs`, `package.json` and the committed inbox are unchanged.

1. **Regex misses are kept, not dropped.**
   - The problem: `ingest()` moves the watermark past every item it reads, so an item the regex rejected never came back.
   - Now every allowlisted item that passes the health filter becomes a pending row. A regex miss gets `"relevant": false`. It sorts last in `--list`, under a `--- N row(s) with no flood term ---` line.
   - Such a row gets no Jev call, does not count towards the priority signal term or staleness, and is deleted unreviewed after 72 h (no stub).
   - The regex now only orders the list. For allowlisted items, the pipeline drops only health items [VERIFIED computed, int-I11].
2. **Wider stems.** Added:
   - from rules_v2: `aigua`, `agua`
   - named by the gap: `negat` and `negad` (with a word end, so "negatiu" does not match), `fang`, `riada`, `aguacero`
   - from the live misses below: `aigues`, `pluge` (Catalan "pluges"), `plou` (ploure), and bare `temporal` in place of `temporal de`

   Measured on the vault golden set (52 snippets) [VERIFIED computed, int-I12]:

   | Regex | Flood snippets passed (of 42) | Unrelated passed (of 10) |
   |---|---|---|
   | `208a974` | 15 (0.36) | 2 (G43, G52) |
   | rules_v2 `RELEVANT` | 28 (0.67) | 2 |
   | `15b089c` | 32 (0.76) | 3 (G43, G45, G52) |

   Caveats:
   - The 32 is in-sample. The gap named stems after reading this set, so it overstates recall on new text.
   - The snippets are shorter than title plus excerpt.
   - Still missed: G03, G07, G30 to G32 (power cuts, "sense llum"), G34, G36, G39 to G41. Since nothing is dropped now, a miss costs ordering, not the item.
3. **Live check, out of sample** [VERIFIED, int-I13; slug reading AGENT]. Same feeds, same 7-day lookback, empty inbox, at 2026-10-09 22:35:58Z with the gap's stems only and at 22:38:34Z with the final regex:

   | Source | Read | Flagged relevant, gap stems | Flagged relevant, final |
   |---|---|---|---|
   | Ajuntament | 44 | 7 | 13 |
   | Betevé | 15 | 0 | 1 |

   - With the gap's stems, 7 of the 52 unflagged items had slugs about the storm ("pluges", "temporal", "ploure"); `208a974` would have lost all 7 for good. The final regex flags all 7.
   - By slug, none of the 45 still unflagged is a flood item. One is a weekend weather piece and one a Raval rubbish story.
   - Place levels: 13 of the 14 relevant rows name no place; one is the district case in point 6.
   - Cost: 59 rows, 43,596 bytes in a week of these two feeds (sha256 `c1d14c00…`, kept in `raw/integration-live-it1-final/`, not committed).
4. **Report counts.**
   - `buildPublished` throws `duplicate signal_id, keep one line`, so `signals-build` exits 1 with a message naming the row.
   - Among approved rows in the window, a page already counted is skipped. The key is the URL without query or fragment, lower-case host, trailing slash. A bare `/?p=123` keeps its query, because WordPress ids live there.
   - The proof-card match uses the same key.
   - A fixture with the same page plus `?utm_source=x#a` still yields "2 reviewed reports". A two-line duplicate fixture makes the build exit 1.
5. **Approve guard.**
   - `--approve` exits 1 unless the row is `pending` or `approved` and still has `source_url`. It names `--add` as the route for an expired item, and the inbox is left untouched.
   - `--add` replaces a stub with the same id. It refuses a page already in the inbox, matched by URL key; for a pending page it points to `--approve`.
   - The test runs the real CLI on an expired stub: approve exits 1, `--add` exits 0, the build exits 0, and a second `--add` with a query string exits 1.
6. **Gazetteer fix found live.**
   - The case: the 7 Oct Ajuntament item about Torre Baró lists Horta-Guinardó and Sarrià-Sant Gervasi in its excerpt. `208a974` returned district 05 with no candidate, so `--list` pointed the reviewer at the wrong district.
   - Now barri names found in a multi-district text stay as candidates. Hyphenated district names are removed before the barri search, so "Horta-Guinardó" no longer yields Horta and el Guinardó.
   - The live row now lists "one of 54 Torre Baró".
   - Approving it in a scratch copy produced no new dot. Its URL is already the source of `proof-torre-baro-2026-10`, so it is linked, not redrawn, as designed.

| Command (repo unless noted) | Exit | Result |
|---|---|---|
| `npm install` | not run | `node_modules` present from `208a974` |
| `npm run signals:check` | 0 | 10 of 10 pass, about 0.41 s |
| same check in 4 scratch copies, each with one fix removed (URL dedupe, duplicate-id throw, approve guard, new stems) | 1, 1, 1, 1 | each fails exactly the test for that fix |
| `node scripts/measure_relevance.mjs <repo> raw/golden/golden_set.csv` (scratch) | 0 | the table in point 2 |
| `node <repo>/scripts/signals.mjs`, cwd `raw/integration-live-it1-final/` (live, 22:38:34Z) | 0 | 1.4 s wall; Ajuntament 44 read, 13 relevant, 44 new; Betevé 15 read, 1 relevant, 15 new; 0 health drops; errors none; XEMA 0 mm at X4, X8, D5; warning 0; mode calm |
| same, `--list` | 0 | 14 relevant rows first, then the 45-row section |
| one keyless WP API read by slug, title and excerpt in memory only | 0 | showed the district-05 result in point 6 |
| scratch copy with the live inbox: `signals-build`, `--approve` the Torre Baró row, `signals-build`, `qa.mjs` | 0, 0, 0, 0 | 0 features from 59 rows (the approved row links to the proof card); "QA passed. 33 tappable features, 106 KB GeoJSON." |
| `npm run qa` (empty inbox) | 0 | "QA passed. 33 tappable features, 106 KB GeoJSON." |
| `npm run build` (empty inbox) | 0 | tsc and vite pass; PWA precache 37 entries |
| `git commit` | 128, then 0 | no git identity in this repo; committed with `-c` set to the identity of `208a974`; no config written |

Still open after this pass:
- **Section 6, "Classify" row.** It still says "a relevance regex". The regex is now a flag that orders the list, not a filter.
- **Jev path** not run (no key).
- **Bluesky and Mastodon readers** not added (D3).
- **No Actions workflow** (D5).
- **Reviewer load.** The `relevant: false` section adds about 45 links a week to `--list`. Whether a reviewer skims them is untested.

**Time for a teammate** [ASSUMPTION]: about 50 minutes to adopt the branch (5 more than at `208a974`, to read the new `--list` section).
- 5 min: `npm install`
- 5 min: `npm run signals:check && npm run qa && npm run build`
- 15 min: first live `npm run signals` and `--list`, open the links, approve one row with `--barri` and `--mechanism`
- 15 min: check the dot on a phone
- 5 min: decide D4 (the label)

Rebuilding the slice from this section alone matches flow's estimate of about 2 h 10 min.

## 10. What this cannot claim, and open gaps (C8)

**Cannot claim:**
- **Live coverage.** An item reaches a phone only after a person approves it, a PR merges, the build runs and the static host redeploys. The host is not chosen (Netlify, Vercel or GitHub Pages) [VERIFIED, sto-S27; host ASSUMPTION].
- **Citizen reports.** `mvp.md` rules them out [VERIFIED, sto-S27]. Individuals' counts never appear on a card.
- **Depth, damage or millimetre figures** on cards. Any mm figure in pitch copy needs the XEMA source beside it. Euro damage values never appear.
- **That the map, the Atlas or the priority score predicts where it floods.** Pitch and methods copy only, never card text, may say:
  - In a blind barri-level test for 2024 and 2025, the Atlas layers ranked barris that later reported rain incidents slightly better than chance (AUC about 0.6), and no better than population. Give n and the control.
  - Storm-drain reports run about 4 times above dry-day levels on days with 30 mm or more at a city station.
  - Public Bluesky posts mentioning rain in Barcelona rise on heavy-rain days.
- **That 2026 confirms the layers or the slope flag.** The labels are press-selected, and the slope layer was drawn after them.
- **Counts of floods.** IRIS grate tickets and police rain jobs are reports, not flood observations.
- **Rain resolution below three stations,** or any warning history for replays.

**Open gaps** (to iteration 2 unless noted):
1. **Not yet independently checked.** Claims marked "not checked", "lead rev1" or "needs verifier it2" in the ledger:
   - sources: src-C43, C44, C46
   - storage: sto-S22, S25
   - backtest: bt-B23 to B29
   - legal: leg-L41
   - integrator: int-I1 to I7
2. **Mirror provenance** (legal point 7, D3). Nobody knows who runs the `*.eurosky.social` accounts. If the mirror stops, emergency-services coverage is lost; there is no keyless primary feed.
3. **This run's raw data.** These files hold individuals' post text and pulls from red platforms (`raw/sources-live/`: Bluesky search, Mastodon tag, Reddit, TikTok, Telegram, Instagram, YouTube RSS) [VERIFIED, leg-L48]. The orchestrator should reduce them to uri, date and keyword flags, or delete them. No section deleted anything.
4. **Small-cell counts.** A barri-hour count of 1 could be traced back to a public post. Options: publish no count below 3, or keep hours for 6 h only. DPO point. Moot in slice 1.
5. **Area and time unit.** Legal wrote zone-day counts; storage uses barri-hour, then barri-day. The 33 zones cover only 42 of 73 barris. Legal should confirm; the privacy line is the same.
6. **Art. 21 objection** cannot be honoured going forward without storing an account id. DPO point.
7. **TypeSafe (Jev).** Retention, Art. 28 terms and where it processes data are unread. The classifier needs a re-run with:
   - gazetteer-derived place candidates
   - the health question
   - about 30 real article paragraphs

   The vault's own request.
8. **Health-regex recall** needs a small labelled set with injury mentions. "rescat" also drops some real reports.
9. **Backtest:**
   - a grid or point-level rerun on IRIS coordinates
   - per-station rain using the 19 area stations (vault F1, AGENT)
   - a dated source for B21
   - a slope layer that predates the storms
   - spot-checks of the 24 AGENT-geocoded 2026 points (P31 already looks misplaced)
   - IRIS 2014 to 2021 for longer persistence
   - Bluesky growth correction
   - GUB 2024 and 2025 files are cut at 29,999 rows: other categories and totals are incomplete; rain code 020 is complete [VERIFIED, bt-B30]
10. **Sources untested:**
    - El Periódico and Ara feeds
    - GDELT recall for flood terms (`barcelona inundaciones` returned `{}` [VERIFIED, src-C43])
    - Trànsit GML
    - the TikTok oEmbed live call
    - Betevé's flood share
    - 3Cat's legal notice
    - La Vanguardia's and El Nacional's TDM reservations
11. **Legal reads missing:**
    - Instagram and Facebook term pages (need JS)
    - the Dutch AP guidance (403)
    - EDPB Opinion 28/2024
    - Catalan civil-protection law
    - XEMA's reuse notice ("Propietat intel·lectual i industrial de METEOCAT"); used internally only, never shown
    - GS Media needs a successful re-fetch [UNVERIFIED, leg-L23b]
12. **Vault corrections for the orchestrator:**
    - `flood-data.md` F17: the 112 account is an unofficial mirror bot of five Generalitat services, created 2026-03-25, not the 112 service
    - `data/README.md`: the headline rule tightens to "our own words, no verbatim headline"
    - `flood-atlas-api.md`: 1,292 class-5 segments is now VERIFIED [bt-B11]; state the hotspot 14 and Torre Baró overlap and name the barri source
    - C2 "21 m from Torre Baró": the repo point is 9.7 km off (D6)
13. **Unconfirmed in the app:**
    - whether MapLibre ignores the GeoJSON `meta` member
    - qa's bbox floor (41.32) excludes the southern tip of Atlas barri polygons; publish label points only
14. **Statistical caveats.** 12 to 13 predictors × 7 tests: quote only the primaries. The IRIS Jan to Mar 2026 set has 7 positives. Dry days are resampled independently.

## 11. Claims ledger

Merged from the five sections' claims tables. Duplicates are joined in one row: the first id is the one kept, and the others are listed after it. Cross-references inside a row ("sources C17", "flow F19", "vault F10") point to section-local ids or to the vault. "same" URLs were expanded to the URL they referred to. Integrator rows `int-` come last; they were run during this merge on 2026-10-10.

| ids | claim | source | tag | checked-by |
|---|---|---|---|---|
| src-C01 | Live checks used a generic UA, no key and no account, 2026-10-09 21:13–21:26 UTC (revision pass about 22:00–22:20 UTC) | raw/sources-live/, raw/sources-rev1/ (local) | VERIFIED | not checked |
| src-C02 | `getAuthorFeed` for both mirrors returns 200, 100 posts and a cursor | https://api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=catalunya112.eurosky.social&limit=100&filter=posts_no_replies | VERIFIED | verifier it1 (both): confirmed |
| src-C03, bt-B13 | Emergency-services mirror oldest post 2026-03-25 (12,126 posts, feed exhausted); Betevé mirror oldest 2026-04-12 (7,503) | https://api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=catalunya112.eurosky.social&limit=100&filter=posts_no_replies, paged with `scripts/bsky_depth.py` | VERIFIED | verifier it1 (both): confirmed by full page-through; bt-B13: verifier it1 (both) |
| src-C04 | Bluesky post records carry no geo field (keys: $type, createdAt, embed, facets, langs, text) | https://api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=catalunya112.eurosky.social&limit=100&filter=posts_no_replies, | VERIFIED | verifier it1 (both): confirmed |
| src-C05, flo-F21, flo-F28 | Bluesky docs give no AppView rate-limit number ("generous") for api.bsky.app and public.api.bsky.app; the 3000 per 5 min IP limit is for hosted-account PDS requests; docs ask public web uses to call public.api.bsky.app | https://bsky.network/docs/rate-limits/ ; https://bsky.network/docs/rate-limits/ (docs.bsky.app redirects there) | VERIFIED / flo-F21: VERIFIED (re-fetched by lead, 200) / flo-F28: VERIFIED | verifier it1 (both): confirmed; flo-F21: verifier it1: refuted (v1 said "third-party only") / unverifiable; rewritten; flo-F28: lead rev1 (raised by verifier it1) |
| src-C06, flo-F20 | `searchPosts` works on api.bsky.app (200) and returns 403 on public.api.bsky.app | https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=inundaci%C3%B3%20Barcelona&limit=25 ; live requests 2026-10-09 21:3xZ (lead and verifiers) | VERIFIED | verifier it1 (both): confirmed; flo-F20: verifier it1 (both): confirmed; re-checked 21:39Z |
| src-C07 | First-pass Bluesky counts used different terms per window ("pluja/lluvia" for 2024 and 2025, "inundació/inundación" for 2026): 3 and 6; 19 and 13; 1 and 3. Not comparable across years; superseded by C44 | api.bsky.app searchPosts via `scripts/bsky_hist.py` | VERIFIED (numbers); superseded by src-C44; do not quote (flow's "1-3 hits per term" came from this row) | verifier it1 (both): numbers confirmed, term change flagged |
| src-C08 | Jetstream live tail needs no auth (101 handshake); lookback is "bounded", length not stated | https://bsky.network/docs/jetstream/ | VERIFIED | not checked |
| src-C09 | Ajuntament WP API search "insuficiència drenant" from 2024-01-01: 37 releases; activations 2024-11-04, 2025-07-12, 08-27, 09-11, 09-21, 11-05, 12-16 and eight in 2026 (06-04, 09-08, 09-16, 09-28, 09-30, 10-02 alert; 10-03, 10-05 emergency); 2025-08-27 title says "per previsió de pluges fortes" | https://ajuntament.barcelona.cat/premsa/wp-json/wp/v2/posts?search=insufici%C3%A8ncia%20drenant&after=2024-01-01T00:00:00 | VERIFIED | verifier it1 (acc): weakened, 2025-07-12 missing (fixed); (feas): confirmed, "per previsió" flagged (added) |
| src-C10 | Ajuntament press RSS `?paged=400` reaches 27–28 Sep 2023 | https://ajuntament.barcelona.cat/premsa/feed/?paged=400 | VERIFIED | verifier it1 (both): confirmed |
| src-C11 | Mastodon bot returns 40 statuses (3–9 Oct); `#inundacions` has 40 posts from 3 accounts, 38 bot-flagged; unauthenticated status search returns empty | https://mastodon.social/api/v1/timelines/tag/inundacions?limit=40 | VERIFIED | not checked |
| src-C12, flo-F15 | Mastodon default limit is 300 calls per 5 minutes per IP and per account | https://docs.joinmastodon.org/api/rate-limits/ | VERIFIED | verifier it1 (both): confirmed; flo-F15: verifier it1 (both): confirmed |
| src-C13 | Betevé RSS 15 items about 6 h with no paging; 3Cat 31 items about 9.5–11 h; La Vanguardia 146 items about 2 days; no geo tags in any feed | https://beteve.cat/feed/ ; https://api.3cat.cat/noticies?_format=rss&origen=frontal&frontal=n324-portada-noticia&version=2.0 ; https://www.lavanguardia.com/rss/home.xml | VERIFIED | verifier it1 (both): confirmed; URLs added |
| src-C14 | GDELT DOC API answered 429, asking for one request every 5 seconds; from this host 429s persisted after 30, 90 and 120 s gaps, and the revision pass got 429 then 200 after a 40 s wait | https://api.gdeltproject.org/api/v2/doc/doc?query=inundaciones%20barcelona&mode=artlist&format=json | VERIFIED | verifier it1 (acc): confirmed, stricter throttling added; (feas): weakened, got `{}` |
| src-C15 | GDELT DOC 2.0 launch post says the API searches "a rolling window of the last 3 months" and also that it "now searches back to January 1, 2017" | https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/ | CONTRADICTED (same page; live test C43 favours the longer range) | verifier it1 (acc): contradicted; (feas): confirmed the 3-month quote only |
| src-C16 | GDELT raw file index is keyless, about 128 MB and growing every 15 min, first entry 2015-02-18 | https://data.gdeltproject.org/gdeltv2/masterfilelist.txt | VERIFIED | verifier it1 (acc): size drift noted, reworded |
| src-C19 | IRIS 2026 CSV resource created 2026-06-12 | https://opendata-ajuntament.barcelona.cat/data/api/3/action/package_show?id=iris | VERIFIED | not checked |
| src-C20 | AEMET Catalonia CAP Atom feed is keyless (200) and lists current warnings for all of Catalonia | https://www.aemet.es/documentos_d/eltiempo/prediccion/avisos/rss/CAP_AFAC69_ATOM.xml | VERIFIED | verifier it1 (both): confirmed |
| src-C21 | Meteocat SMP warnings endpoint returns 403 without a key | https://api.meteo.cat/pronostic/v1/smp/episodis-oberts | VERIFIED | verifier it1 (both): confirmed |
| src-C22 | Commons category "October 2026 Catalonia floods" lists Sabadell files only; Commons geosearch returns coordinates | https://commons.wikimedia.org/w/api.php?action=query&list=categorymembers&cmtitle=Category:October_2026_Catalonia_floods | VERIFIED | not checked |
| src-C23 | YouTube Data API rejects keyless calls (403, unregistered callers) | https://www.googleapis.com/youtube/v3/search?part=snippet&q=inundacion%20barcelona | VERIFIED | verifier it1 (both): confirmed |
| src-C24 | YouTube channel RSS answers keyless (15 latest Betevé videos); legal rates it R | https://www.youtube.com/feeds/videos.xml?channel_id=UCenoiY7GMRPMCkMJmvV9hNA | VERIFIED | not checked by sources verifiers; legal L39 |
| src-C25 | `search.list`: 100 calls a day; supports location, locationRadius and publishedAfter; location matches only videos with a location in their metadata | https://developers.google.com/youtube/v3/docs/search/list | VERIFIED | verifier it1 (both): confirmed |
| src-C26 | Reddit `.json` gives 403; `search.rss` gave 200 (6 hits, oldest 2025-07-12), then 429 | https://www.reddit.com/r/barcelona/search.rss?q=inundaciones&restrict_sr=1&sort=new | VERIFIED | verifier it1 (both): 403 and 200 confirmed; 429 not re-triggered |
| src-C27 | Reddit free tier is 100 QPM per OAuth client (the primary wiki returned 403) | https://www.socialcrawl.dev/blog/reddit-api-key-limits-alternatives-2026 | UNVERIFIED | not checked |
| src-C28 | X recent search returns 401 without credentials | https://api.x.com/2/tweets/search/recent?query=inundacion%20barcelona | VERIFIED | verifier it1 (both): confirmed |
| src-C29 | X pay-per-use: $0.005 per post read; cap of 3 million post reads per monthly billing cycle (pricing and usage pages agree) | https://docs.x.com/x-api/getting-started/pricing ; https://docs.x.com/x-api/usage/introduction | VERIFIED | verifier it1 (acc): both pages say 3M, no 2M source; 2M figure dropped |
| src-C30 | X full-archive search reaches "back to 2006" | https://docs.x.com/x-api/introduction | VERIFIED | not checked |
| src-C31 | Instagram profile HTML has no post data; TikTok tag page has no item list | https://www.instagram.com/betevecat/ | VERIFIED | not checked |
| src-C32 | Instagram oEmbed: using metadata beyond a front-end view, including analytics, is "strictly prohibited" | https://developers.facebook.com/docs/instagram-platform/oembed | VERIFIED | verifier it1 (both): confirmed |
| src-C33 | TikTok Research Tools: commercial users excluded; 1,000 requests a day, up to 100,000 records | https://developers.tiktok.com/doc/research-api-faq | VERIFIED | verifier it1 (both): confirmed |
| src-C35 | Telegram `t.me/s/` web preview is keyless (200, 20 messages) | https://t.me/s/telegram | VERIFIED | not checked |
| src-C36 | Telegram api_id needs a Telegram account and my.telegram.org | https://core.telegram.org/api/obtaining_api_id | VERIFIED | not checked |
| src-C37 | Mapillary: every request must be authorized; search limit 10,000 per minute per app | https://www.mapillary.com/developer/api-documentation | VERIFIED | verifier it1 (both): confirmed |
| src-C38 | Waze for Cities: applicants "represent a government agency or a private road operator" | https://support.google.com/waze/partners/answer/10453062?hl=en | VERIFIED | not checked |
| src-C39, sto-S26 | `catalunya112` profile: displayName "Emergències i seguretat de Catalunya (Mirall)", self-applied `bot` label, created 2026-03-25; description lists Mossos, Bombers, Protecció Civil, SEM and Trànsit, names an individual maintainer, never mentions 112 or X. Betevé mirror says it reflects @beteve's X posts | https://api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=catalunya112.eurosky.social ; https://api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=catalunya112.eurosky.social (and `actor=beteve.eurosky.social`), fetched 21:43Z | VERIFIED | verifier it1 (both): confirmed; services and maintainer added; sto-S26: verifier it1 (A, 112 account); sources C39 |
| src-C40 | YouTube oEmbed is keyless and returns title, author_name, thumbnail_url | https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=_EAcyaj0zww&format=json | VERIFIED | verifier it1 (both): confirmed |
| src-C41 | TikTok documents `GET https://www.tiktok.com/oembed?url=` with no auth, returning title and author | https://developers.tiktok.com/docs/en/embed-videos | VERIFIED (doc); live call not validated | not checked |
| src-C42 | The 2025-07-12 release "Activada l'alerta per risc d'inundacions" says the Ajuntament activated the PAEM for insuficiència drenant in the alert phase | https://ajuntament.barcelona.cat/premsa/2025/07/12/activada-lalerta-per-risc-dinundacions/ (body via WP API, saved `raw/sources-rev1/wp_20250712.json`) | VERIFIED | raised by verifier it1 (acc); lead re-fetched |
| src-C43 | GDELT DOC, `query=barcelona`, 2024-11-03 to 2024-11-06, `maxrecords=50`: 200 with 50 articles, seendate 2024-11-05T22:15Z to 2024-11-06T00:15Z. `query=barcelona inundaciones`, same window: 200 with `{}` | https://api.gdeltproject.org/api/v2/doc/doc?query=barcelona&mode=artlist&format=json&maxrecords=50&startdatetime=20241103000000&enddatetime=20241106000000&sort=datedesc (saved `raw/sources-rev1/gdelt_2024*.json`) | VERIFIED | lead, revision pass; not yet independently checked |
| src-C44 | Bluesky search, same four terms ("Barcelona" plus pluja / lluvia / inundació / inundación) in each window: 3–5 Nov 2024: 3 / 6 / 0 / 0; 10–12 Sep 2025: 19 / 13 / 0 / 0; 2–7 Oct 2026: hitsTotal 113 (page 2 returned 403 twice) / 87 / 1 / 3 | api.bsky.app searchPosts via `scripts/bsky_hist_uniform.py`; counts in `raw/sources-rev1/bsky_hist_uniform.txt` (no post text kept) | VERIFIED | lead, revision pass; not yet independently checked |
| src-C45 | 3Cat feed URL is linked from www.3cat.cat/3catinfo/ and the XML declares `encoding="ISO-8859-1"` | https://api.3cat.cat/noticies?_format=rss&origen=frontal&frontal=n324-portada-noticia&version=2.0 (saved `raw/verify-src-acc1/3cat.xml`) | VERIFIED | verifier it1 (both) found it; lead read the saved header |
| src-C46 | robots.txt of www.3cat.cat and api.3cat.cat has no TDM or AI-crawler reservation (only path disallows and a Mediapartners-Google block) | https://www.3cat.cat/robots.txt ; https://api.3cat.cat/robots.txt (saved `raw/sources-rev1/`) | VERIFIED (robots.txt only; legal notice not read) | lead, revision pass; not yet independently checked |
| src-C47, flo-F16 | MeteoAlarm Spain Atom feed: keyless 200, 57 KB, 36 entries; areaDesc "Litoral de Barcelona" with geocode `ES181` present | https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-spain (saved `raw/sources-rev1/meteoalarm_es.xml`) ; https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-spain (listed at https://feeds.meteoalarm.org/) | VERIFIED / flo-F16: VERIFIED (T&C UNVERIFIED) | lead, revision pass; same feed is flow F16; flo-F16: verifier it1 (both): confirmed, reworded |
| src-C48, leg-L43 | S1 history: 12,126 posts; 404 match a flood keyword; 166 of those from 14 Sep to 8 Oct 2026; 8 match a flood keyword and "Barcelona" (2026-07-20 to 2026-10-05); at most 21 posts in one clock half-hour | `raw/backtest-bsky/cat112.json` (`flood_kw`, `bcn` fields), counted with `python3 -I` ; `raw/backtest-bsky/cat112.json`, counted with `python3 -I` over `flood_kw` and `bcn` fields | VERIFIED (computed 2026-10-09) | verifier it1 (feas) measured 8 and 166 (31 per 30 min with its own windowing); legal L43; leg-L43: verifier it1 (raised by verifier B); lead recomputed |
| leg-L1 | GDPR Art. 4(1) personal data includes "an online identifier" and "location data" | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679 | VERIFIED | not re-checked in it1 |
| leg-L2 | Art. 6(1)(f) legitimate interest is a lawful basis subject to the data subject's overriding interests, in particular a child's | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679 | VERIFIED | not re-checked in it1 |
| leg-L3 | Art. 6(1)(f) "shall not apply to processing carried out by public authorities in the performance of their tasks" | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679 | VERIFIED | verifier it1 (both) |
| leg-L4 | LOPDGDD Art. 8.2: a 6(1)(e) basis requires a competence attributed by a law-rank norm | https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673 | VERIFIED | verifier it1 (both) |
| leg-L5 | Ley 7/1985 Art. 25.2.f lists "protección civil" among municipal competences, exercised "en los términos de la legislación del Estado y de las Comunidades Autónomas" | https://www.boe.es/buscar/act.php?id=BOE-A-1985-5392 | VERIFIED | verifier it1 (both) |
| leg-L6 | Art. 89(1) imposes safeguards incl. minimisation; 89(2) lets Union/Member State law derogate from Arts. 15, 16, 18, 21 for research | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679 | VERIFIED | not re-checked in it1 |
| leg-L7 | Art. 9(1) prohibits processing health data; 9(2)(e) lifts it only for data manifestly made public by the data subject | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679 | VERIFIED (text); ASSUMPTION that a third party's injury falls outside 9(2)(e) | verifier it1 (both) |
| leg-L8 | Art. 14(5)(b): exemption for impossibility or disproportionate effort, then the controller must take measures "including making the information publicly available" | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679 | VERIFIED | verifier it1 (both) |
| leg-L9 | EDPB Guidelines 03/2026 v1.0, adopted 7 Jul 2026 for consultation, scope is scraping for generative-AI training by private entities; lists excluding login-only data and sites that clearly oppose scraping | https://www.edpb.europa.eu/system/files/2026-07/edpb_guidelines_2020603_webscraping_v1_en_0.pdf | VERIFIED | verifier it1 (both, via L10) |
| leg-L10 | EDPB draft para 27: 14(5)(b) "should not be routinely relied upon" by non-research controllers; para 30: public notice naming sources and crawler characteristics | https://www.edpb.europa.eu/system/files/2026-07/edpb_guidelines_2020603_webscraping_v1_en_0.pdf | VERIFIED | verifier it1 (both) |
| leg-L11 | CNIL (19 Jun 2025): excluding sites that clearly oppose scraping is a mandatory measure; opt-out list ("liste repoussoir") and per-content pseudonyms are suggested optional measures; CGU shape reasonable expectations; sensitive data deleted "autant que possible" immediately | https://www.cnil.fr/fr/focus-interet-legitime-collecte-par-moissonnage | VERIFIED (page text read 2026-10-09) | verifier it1 (both) |
| leg-L12 | EDPB draft treats C-136/17 as relevant only by analogy for incidental sensitive data; not a general exemption | https://www.edpb.europa.eu/system/files/2026-07/edpb_guidelines_2020603_webscraping_v1_en_0.pdf | VERIFIED | not re-checked in it1 |
| leg-L13, sto-S15 | Art. 5(1)(c) minimisation and 5(1)(e) storage limitation | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679 ; https://api.bsky.app/xrpc/app.bsky.feed.getPosts | VERIFIED | not re-checked in it1; sto-S15: not in it1 verifier output |
| leg-L14 | Art. 21(1) right to object applies to processing based on 6(1)(e) or (f) | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679 | VERIFIED | not re-checked in it1 |
| leg-L15 | Art. 11(1): no duty to keep extra data only to identify data subjects | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679 | VERIFIED | not re-checked in it1 |
| leg-L16 | AEPD criterion (25 Nov 2025, AI-00059-2024): scraping that collects personal data is processing; file closed because no processing of personal data was shown (aggregate chart, no identifiers kept). Supports aggregated display, not the collection | https://www.aepd.es/informes-y-resoluciones/criterios-juridicos-aepd/herramientas-data-scraping-para-evaluacion-de-tendencias | VERIFIED (page text read 2026-10-09) | verifier it1 (both; one weakened the inference, now reworded) |
| leg-L17 | DSM Art. 4(1) TDM exception for lawfully accessible works; 4(3) reservation "in an appropriate manner, such as machine-readable means" | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32019L0790 | VERIFIED | verifier it1 (both) |
| leg-L18 | DSM Art. 3 is limited to research organisations and cultural heritage institutions; Art. 2(1) defines research organisation | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32019L0790 | VERIFIED | verifier it1 (both) |
| leg-L19 | DSM Art. 7(1) makes contract terms unenforceable only against Arts. 3, 5 and 6, not Art. 4. Whether platform terms bind a keyless visitor, or count as a 4(3) reservation, is open | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32019L0790 | VERIFIED (text); inference is a lawyer point | verifier it1 (one confirmed, one weakened the inference, now reworded) |
| leg-L20 | Spain transposes TDM in RDL 24/2021 (2 Nov), Libro cuarto, Art. 67, with opt-out in 67(3); no TDM article in the TRLPI; no contract-override clause found in Arts. 65-79 | https://www.boe.es/buscar/act.php?id=BOE-A-2021-17910 | VERIFIED (absence found by text search) | verifier it1 (both) |
| leg-L21 | Directive 96/9 Art. 7(1) and 7(5); TRLPI Art. 133 | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:31996L0009 | VERIFIED | not re-checked in it1 |
| leg-L22 | Ryanair C-30/14: the Directive does not stop the maker of an unprotected database imposing contractual limits, "without prejudice to the applicable national law" | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62014CJ0030 | VERIFIED | verifier it1 (both) |
| leg-L23 | Svensson C-466/12 (links), BestWater C-348/13 (framing, no new public), VG Bild-Kunst C-392/19 (circumventing anti-framing) | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62012CJ0466 ; https://eur-lex.europa.eu/legal-content/DE/TXT/HTML/?uri=CELEX:62013CO0348 ; https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62019CJ0392 | VERIFIED | verifier it1 (both) |
| leg-L23b | GS Media C-160/15: links to unlawfully posted works provided for financial gain carry a presumption of knowledge | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62015CJ0160 | UNVERIFIED in verifier pass (EUR-Lex HTTP 202 twice; lead re-fetch 2026-10-09 got HTTP 302). The author's saved copy `raw/legal/gsmedia.txt` holds the operative text | verifier it1: not re-fetched |
| leg-L24 | TRLPI Art. 32.1 quotation limited to teaching or research; Art. 129 bis(6)(b) excludes hyperlinks outright; 129 bis(6)(c) excludes single words or very short extracts only "cuando dicho uso en línea no perjudique a las inversiones" | https://www.boe.es/buscar/act.php?id=BOE-A-1996-8930 | VERIFIED | verifier it1 (one confirmed, one weakened; condition now added) |
| leg-L25 | DSA Art. 40(8)(a) requires DSM-defined research-organisation affiliation for vetted status; 40(12) needs no affiliation but limits use to Art. 34(1) systemic-risk research, risks stemming from the platform's design, functioning or use | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32022R2065 | VERIFIED (text); ASSUMPTION that flood mapping is outside Art. 34(1) | verifier it1 (both) |
| leg-L26, src-C34 | Meta Content Library: applicants must be connected to a qualified research institution; CASD reviews applications. Eligibility wording: verifier A read "a qualified academic institution" or "not-for-profit research institution"; verifier B read "qualified academic or non-academic research institution" | https://developers.secure.facebook.com/docs/content-library-api/get-access ; https://developers.facebook.com/docs/content-library-and-api/get-access | VERIFIED (CASD, institutional affiliation; WebFetch, raw fetch HTTP 400); CONTRADICTED on exact wording (verifier A vs verifier B, same URL). Conclusion unchanged / src-C34: VERIFIED | verifier it1 (both); src-C34: not checked |
| leg-L27 | TikTok Research API eligibility: academic institutions in US/EEA/UK/CA/CH, EU not-for-profit or independent research bodies, DSA vetted researchers; Brazil path limited to youth safety | https://developers.tiktok.com/products/research-api/ | VERIFIED (WebFetch) | verifier it1 (both) |
| leg-L28 | Reddit UA §7 prohibits scraping without prior written consent; robots.txt `Disallow: /`; Data API needs identification and an OAuth token; licence is display-only, no modification | https://redditinc.com/policies/user-agreement ; https://redditinc.com/policies/data-api-terms ; https://www.reddit.com/robots.txt | VERIFIED | verifier it1 (both) |
| leg-L29 | Meta: Platform APIs are the only allowable programmatic access without prior written permission, logged in or not | https://developers.secure.facebook.com/docs/development/terms-and-policies/automated-data-collection | VERIFIED (WebFetch by both verifiers 2026-10-09; raw curl HTTP 400; saved `raw/legal-terms/meta-adc.txt` is an error page) | verifier it1 (both) |
| leg-L30 | TikTok EEA Terms bar automated extraction not provided or approved in writing by TikTok | https://www.tiktok.com/legal/page/eea/terms-of-service/en | VERIFIED | verifier it1 (both) |
| leg-L31 | X Terms (eff. 9 Oct 2026), EU section: scraping "in any form, for any purpose" without prior written consent prohibited; "except as required by applicable law" is in the general summary; robots.txt `Disallow: /`; Developer Policy: remove displayed content within 24 h of a removal request | https://x.com/en/tos ; https://developer.x.com/en/developer-terms/agreement-and-policy | VERIFIED | verifier it1 (both; attribution corrected) |
| leg-L32 | YouTube Developer Policies: no scraping; non-authorised data kept at most 30 calendar days, then deleted or refreshed | https://developers.google.com/youtube/terms/developer-policies | VERIFIED | verifier it1 (both) |
| leg-L33 | Bluesky: no anti-scraping clause in Terms; api.bsky.app robots.txt allows crawling the public API; Developer Guidelines require a deletion method | https://bsky.social/about/support/tos ; https://api.bsky.app/robots.txt ; https://bsky.network/docs/developer-guidelines | VERIFIED | verifier it1 (both) |
| leg-L34 | mastodon.social Terms (effective 2026-08-31) tell users content may be accessed via RSS, embeds, search engines and databases (a notice to users, not a grant) | https://mastodon.social/api/v1/instance/terms_of_service | VERIFIED | verifier it1 (both) |
| leg-L35 | Telegram Content Licensing page bars access beyond "ordinary, legitimate, and intended use"; its "firmly prohibits" sentence is limited to AI purposes; the page is undated; API Terms §1.5 bar using Telegram data to deploy AI | https://telegram.org/tos/content-licensing ; https://core.telegram.org/api/terms | VERIFIED | verifier it1 (both; one weakened the quote, now corrected) |
| leg-L36 | Dutch AP treats scraping by private parties as almost always unlawful | https://www.autoriteitpersoonsgegevens.nl/documenten/handreiking-scraping-door-particulieren-en-private-organisaties | UNVERIFIED (403); not relied on | not re-checked in it1 |
| leg-L37 | 30-day retention for official/press records | design choice | ASSUMPTION | n/a |
| leg-L38 | Directive 96/9 Art. 8(1): lawful user may extract insubstantial parts "for any purposes whatsoever"; Art. 15: contrary contract terms "null and void" | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:31996L0009 (saved `raw/legal/dbdir.txt`) | VERIFIED | verifier it1 (raised by verifier A) |
| leg-L39 | YouTube robots.txt, `User-agent: *`: `Disallow: /feeds/videos.xml` | https://www.youtube.com/robots.txt (saved `raw/legal-robots/www.youtube.com.txt`) | VERIFIED | verifier it1 (raised by verifier B); lead re-read saved file |
| leg-L40 | GDPR Art. 9(2)(g) (substantial public interest) and 9(2)(i) (public health) each require "the basis of Union or Member State law" | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679 (saved `raw/legal/gdpr.txt`) | VERIFIED | verifier it1 (raised by verifier A); lead re-read |
| leg-L41 | GDPR Art. 28(3): processing by a processor "shall be governed by a contract or other legal act"; Art. 14(1)(e) recipients must be in the notice | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679 | VERIFIED | lead re-read only; needs it2 verifier |
| leg-L42 | Jev is TypeSafe's hosted API (`api.typesafe.ai`), so post text sent to it goes to an outside provider | vault `ideas/water/jev.md`; flow section (`TYPESAFE_API_KEY`) | VERIFIED (repo `scripts/signals.mjs` line 145, read 2026-10-10) | verifier it1 (raised by verifier B) |
| leg-L46 | Run scripts send `Mozilla/5.0 (X11; Linux x86_64) research-check` (`scripts/bsky_depth.py`, `scripts/bsky_hist.py`) and `research-script` (`backtest/bsky_depth.py`); `work/priority.mjs` sends `next-rain-hackathon/0.1` | grep of the working dir, 2026-10-09 | VERIFIED | verifier it1 (raised by verifier B); lead re-grepped |
| leg-L47 | Superseded: sources S19 now rates YouTube channel RSS "no" (it said "maybe" when legal read it) | `sections/sources.md` | VERIFIED (superseded, resolved) | lead read 2026-10-09 |
| leg-L48 | `raw/sources-live/` holds individuals' post text (14, 25 and 40 text fields in three files) and pulls from Reddit, TikTok, Telegram, Instagram and YouTube RSS | `ls -la` and `grep -c` on the files, 2026-10-09 | VERIFIED | verifier it1 (raised by verifier B); lead recounted |
| leg-L49 | Ajuntament robots.txt `v2024-01-11__D10`: 130 user-agent lines in one group with `Disallow: /`, incl. ClaudeBot, Claude-User, anthropic-ai, GPTBot, Google-Extended, CCBot, Scrapy. `*` allows the slice's WP API URL and press-release paths; under `/premsa` only `?hilite=`/`&hilite=` disallowed | https://ajuntament.barcelona.cat/robots.txt (re-fetched 2026-10-10 to `raw/legal-it2/ajunt_robots.txt`, byte-identical to `raw/redteam-it1/ajunt_robots.out`; matched with `scratchpad/legal-scripts/robots_match.py`) | VERIFIED | it2 lead; needs it2 verifier |
| leg-L50 | Ajuntament avís legal (main and press site): reuse of "dades i informacions" allowed if not altered, not distorted, source cited, no implied sponsorship; reproduction of works beyond the law "requereix l'autorització del titular"; press-site images CC BY-NC-ND 4.0 | https://web.archive.org/web/20260201101027/https://ajuntament.barcelona.cat/ca/avis-legal ; https://web.archive.org/web/20260131022624/https://ajuntament.barcelona.cat/premsa/avis-legal/ (saved `raw/legal-it2/wb_*`) | VERIFIED (archived primary text; live page deliberately not fetched) | it2 lead; needs it2 verifier |
| leg-L51 | Ley 37/2007: applies to local entities (Art. 2(a)); public bodies' IP exercised "de forma que se facilite su reutilización" (Art. 3); public broadcasters' documents excluded (Art. 3.3(f)); conditions incl. no alteration, source, last update date (Art. 8) | https://www.boe.es/buscar/act.php?id=BOE-A-2007-19814 | VERIFIED | it2 lead; needs it2 verifier |
| leg-L52 | Betevé avís legal §4: reproduction and communication "estrictament prohibida" without written permission; disk copies for personal use only; opposes press clippings under TRLPI 32.1; video embeds only on private individuals' sites, non-commercial | https://beteve.cat/avis-legal/ (saved `raw/legal-it2/beteve_avis.txt`) | VERIFIED | it2 lead; needs it2 verifier |
| leg-L53 | beteve.cat robots.txt: `User-agent: *`, `Disallow: /wp-admin/`, `/cercador`; `/feed/` allowed; no AI lines | https://beteve.cat/robots.txt | VERIFIED | it2 lead; needs it2 verifier |
| leg-L54 | MeteoAlarm T&C (last updated 15/03/2024): CC BY 4.0 equivalent plus redistribution requirements (national service named, time of issue, link, disclaimer, average delay under 5 min and never over 10); "Redistribute" includes integrating Information into services; use means acceptance | https://meteoalarm.org/en/page/terms-and-conditions (text via its CMS API `cms-visualization.meteoalarm.org/api/v1/content-pages/terms-and-conditions`, saved `raw/legal-it2/ma/tc.txt`) | VERIFIED | it2 lead; needs it2 verifier |
| leg-L55 | XEMA `nzvn-apee` and INUNCAT `wj9c-j6vf`: licence "See Terms of Use", linked to the Llicència oberta d'ús d'informació – Catalunya (no alteration, no distortion, cite the Department, update date, no sublicensing, no logos) | https://analisi.transparenciacatalunya.cat/api/views/nzvn-apee.json ; https://web.gencat.cat/ca/generalitat/dades-indicadors/dades-obertes/llicencies | VERIFIED | it2 lead; needs it2 verifier |
| leg-L56 | analisi.transparenciacatalunya.cat robots.txt: one `*` group, `Crawl-delay: 1`, browse-filter disallows only; `/resource/` allowed | https://analisi.transparenciacatalunya.cat/robots.txt | VERIFIED | it2 lead; needs it2 verifier |
| leg-L57 | Open Data BCN GUB and IRIS packages: `license_id` CC-BY-4.0 | CKAN package metadata saved this run, `raw/sources-live/gub_pkg.json`, `iris_pkg.json` | VERIFIED (run's own fetch) | it2 lead; needs it2 verifier |
| leg-L58 | CC BY 4.0 §4 grants extraction and reuse of "all or a substantial portion" of database contents | https://creativecommons.org/licenses/by/4.0/legalcode.en | VERIFIED | it2 lead; needs it2 verifier |
| leg-L59 | DSM Art. 2(2) TDM definition; Recital 18: machine-readable means include "metadata and terms and conditions of a website or a service" | CELEX:32019L0790 (saved `raw/legal/dsm.txt`, this run) | VERIFIED | it2 lead; needs it2 verifier |
| leg-L60 | RDL 24/2021 Art. 67(3) reservation wording; 67(7) lawful database user may extract a substantial part for TDM | https://www.boe.es/buscar/act.php?id=BOE-A-2021-17910 (re-fetched 2026-10-10) | VERIFIED | it2 lead; needs it2 verifier |
| leg-L61 | TRLPI 133.1 (investment in "obtención, verificación o presentación"), 133.2 ("repetidas o sistemáticas"), 134.1, 134.2, 134.3 (contrary terms "nulo de pleno derecho") | https://www.boe.es/buscar/act.php?id=BOE-A-1996-8930 (saved `raw/legal/trlpi.txt`) | VERIFIED | it2 lead; needs it2 verifier |
| leg-L62 | Directive 96/9 Art. 7(5) "repeated and systematic"; Art. 8(2) lawful-user limits | CELEX:31996L0009 (saved `raw/legal/dbdir.txt`) | VERIFIED | it2 lead; needs it2 verifier |
| leg-L63 | TRLPI 31.1 temporary reproductions; Art. 13 excludes laws, judgments and public bodies' acts, not press releases | TRLPI URL above | VERIFIED | it2 lead; needs it2 verifier |
| leg-L64 | At least 9 raw directories of this run hold `ajuntament.barcelona.cat/premsa` responses fetched by agents | `grep -l -r` over `raw/`, 2026-10-10 | VERIFIED | it2 lead; needs it2 verifier |
| leg-L65 | Slice: Ajuntament adapter requests `id,date_gmt,link,title,excerpt` after a watermark; `jev()` is called for relevant items of any source when `TYPESAFE_API_KEY` is set; UA `next-rain-hackathon/0.1` | repo `scripts/signals.mjs` lines 70-84, 126-150, 201; `signals/config.json` (branch signals-pipeline) | VERIFIED (read 2026-10-10) | it2 lead; needs it2 verifier |
| sto-S1 | The app loads only static `/data/zones.json`, `/data/sources.json` and six GeoJSON files listed in `GEOJSON_FILES` | repo `src/lib/data.ts` (local clone, branch signals-pipeline) | VERIFIED | not in it1 verifier output (S6 check read `GEOJSON_FILES`: six files) |
| sto-S2 | `copy-data.mjs` runs `rmSync('public/data')` then copies all of `data/` there before dev, build and preview | repo `scripts/copy-data.mjs`, `package.json` | VERIFIED | verifier it1 (both) |
| sto-S3 | The PWA precaches `**/*.{js,css,html,svg,json,geojson,woff,woff2}` with `registerType: "autoUpdate"` | repo `vite.config.ts` | VERIFIED | verifier it1 (both) |
| sto-S4 | qa: 8 required fields, 7-value enum, https, proof rule, forbidden words, bbox, ≤2 MiB; also dangling `relatedZoneIds`, `proof: false` in `src/types.ts`, the Torre Baró link rules; reads `data/zones.json` only. Passes today with 33 features, 108,087 B | repo `scripts/qa.mjs`; `node scripts/qa.mjs` 2026-10-09 | VERIFIED | verifier it1 (both; extra rules raised by verifier B, re-read by lead) |
| sto-S5 | No `src/` file reads `priority`, `date`, `headline` or `mediaUrl`; the feature `name` is rendered as a map label (`text-field ["get","name"]`, `proof-label` minzoom 13) | `grep -rn` on `src/`; `src/components/MapCanvas.tsx` lines 245, 266 | VERIFIED (corrected: "card only" was wrong) | verifier it1 (A weakened, B confirmed); corrected |
| sto-S6 | `groupForZone` defaults to `"sewers"`; MapCanvas builds the proof source from `proof-oct2026` only; LayerDock `proof: ["proof-oct2026"]` drives only the missing-layer notice | repo `src/types.ts`, `MapCanvas.tsx`, `LayerDock.tsx` | VERIFIED | verifier it1 (both) |
| sto-S7, flo-F11, leg-L45 | Repo is private, default branch `main`; `.gitignore` excludes `public/data` and `.env*` and has no signals entry | `gh repo view --json visibility,isPrivate`; repo `.gitignore` ; `gh api repos/Marc-Ruizenaar/hackathon-barcelona` and `/actions/workflows` (2026-10-09 21:1x–21:3xZ) ; `gh repo view` (storage section S7); `mvp.md` static deploy | VERIFIED / leg-L45: VERIFIED (private, per storage S7); ASSUMPTION that the demo URL is public | verifier it1 (both); flo-F11: verifier it1 (both): confirmed; leg-L45: verifier it1 (raised by verifier B) |
| sto-S8 | Purging history needs a rewrite (git-filter-repo); clones, forks and PRs referencing the commit keep the data; cached views go through GitHub Support, which "won't remove non-sensitive data" | https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository | VERIFIED (caveat added) | verifier it1 (both) |
| sto-S9 | Vercel deployments persist until deleted (dashboard, API, SDK) or removed by a deployment retention policy. The team's host is not chosen (mvp.md line 143) | https://vercel.com/docs/deployments/managing-deployments ; repo `mvp.md` | VERIFIED (Vercel); host choice ASSUMPTION | verifier it1 (both) |
| sto-S10 | Supabase free plan: 500 MB database per project, 2 active projects, paused after 1 week of inactivity | https://supabase.com/pricing | VERIFIED (page text, 2026-10-09) | verifier it1 (both) |
| sto-S11 | Vault rule 8: keys and personal data stay out. Reading it as "the vault is not a signal store" is our inference | vault `ideas/water/README.md` (Reliquary 1e0313a5…) | VERIFIED (rule); inference ASSUMPTION | verifier it1 (both) |
| sto-S12 | GDPR Recital 26: pseudonymised data attributable with additional information is information on an identifiable person | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679 (live fetch WAF-blocked for verifiers; checked on this run's saved copy `raw/storage-gdpr/`) | VERIFIED | verifier it1 (both, saved copy) |
| sto-S13 | Bluesky `getPosts` returns the found posts and silently drops a non-existent rkey (2 requested, 1 returned), keyless on api.bsky.app. Now used only for a later individual-pin path | https://api.bsky.app/xrpc/app.bsky.feed.getPosts | VERIFIED (non-existent rkey); deleted post ASSUMPTION | verifier it1 (both) |
| sto-S14 | GDPR Art. 19: erasure under Arts. 16, 17(1), 18 communicated to each recipient "unless this proves impossible or involves disproportionate effort"; Art. 4(9) recipient "whether a third party or not". Mapping to TypeSafe or app visitors is ours | https://api.bsky.app/xrpc/app.bsky.feed.getPosts (saved copy) | VERIFIED (text); mapping ASSUMPTION / DPO | verifier it1 (both weakened); corrected |
| sto-S16 | Open Data BCN barris file: 73 rows, codes 01–73, WKT in ETRS89 and WGS84; districts 10 rows; CC-BY-4.0 | https://opendata-ajuntament.barcelona.cat/data/api/3/action/package_show?id=20170706-districtes-barris | VERIFIED (files sha256 4b133235…, 32820ab5…; package_show re-fetched 21:42Z, `raw/storage-licences/`) | verifier it1 (both) |
| sto-S17 | `carrerer`: 4,770 names, 4,770 distinct `codi_via`, no geometry; licence CC-BY-4.0 | https://opendata-ajuntament.barcelona.cat/data/api/3/action/package_show?id=carrerer | VERIFIED (counts sha256 e98b5ccd…; licence re-fetched by lead 21:42Z, `raw/storage-licences/carrerer.json`, sha256 0ea622ba…) | verifier it1 (counts, both); licence not yet independently re-checked |
| sto-S18 | `graf_viari_csv.zip`: 14,831 segments, `COORD_X/Y` ETRS89 (position on segment undocumented), `CVia_D/E`, cp1252, `;`; 4,014 of 4,770 streets (84.2%) resolve, 3,605 to one barri; 36 coordinates outside every barri; licence CC-BY-4.0 | https://opendata-ajuntament.barcelona.cat/data/api/3/action/package_show?id=mapa-graf-viari-carrers-wms | VERIFIED (zip sha256 5013bc0c…; licence re-fetched by lead 21:42Z, sha256 d7413597…; "midpoint" wording dropped) | verifier it1 (counts, both); licence not yet independently re-checked |
| sto-S19 | CARTO table `rcc_iu1_punts_critics` serves 14 polygons keyless; fid 14 "Torrent Tapioles" at lon 2.1816–2.1907, lat 41.4572–41.4640; of its 9 vertices 5 fall in Vallbona, 2 in Torre Baró, 2 outside every barri | https://urbisadmin.carto.com/api/v2/sql?q=select%20fid,annexdescr,the_geom%20from%20rcc_iu1_punts_critics&format=geojson (fetched 2026-10-09 by lead and by verifier; response bytes differ per fetch, 7dd0fcc9…/5,289 B and 97b577e8…/5,074 B, geometry identical) | VERIFIED | verifier it1 (both) |
| sto-S20 | Repo hotspot points versus their own Atlas polygon: **8 of 14 inside**; 6 off: `sant-pau` 106 m, `urgell-roma` 180 m (it sits inside fid 3, not its paired fid 2), `clot-navas` 250 m, `riera-blanca` 582 m, `rambla-prim` 1,340 m, `tapioles` about 9.7 km (script's flat scale 9,637 m; haversine 9,691 m) | https://urbisadmin.carto.com/api/v2/sql?q=select%20fid,annexdescr,the_geom%20from%20rcc_iu1_punts_critics&format=geojson + repo `data/geojson/resccue-hotspots.geojson`; `hotspot_pairs.py` re-run by lead 2026-10-09 | VERIFIED (corrected from "9 of 14") | verifier it1 (both refuted the old count); corrected |
| sto-S21 | All 33 zones.json ids join to ≥1 barri; 42 barris carry a zone id; the 5 proof points land in Torre Baró, Sant Andreu, la Vila de Gràcia, les Corts, Sant Genís dels Agudells | `gazetteer_proto.py` on S16 + repo data | VERIFIED (computed) | verifier it1 (both, own scripts) |
| sto-S22 | Exact §3/§5 objects, minified: inbox row 653 B, feature 209 B, card 988 B, count row 65 B; proof cards average 893 B; 73 barris = 15 KB GeoJSON, 70 KB cards | `flood-signals-scripts/sizes_v2.py` (sha256 5b25eb05…) | VERIFIED (computed; re-measured after it1) | it1 flagged old figures as a richer draft; new figures not yet independently re-run |
| sto-S23 | Legal §7: individuals produce no row; zone-day counters `{zone_id, date, platform, n}` with no ids; L37's 30 days covers official/press records only. This section now follows it | sections/legal.md §2, §7, L37 | AGENT (legal workstream) | verifier it1 (A refuted the old storage reading, B weakened); aligned |
| sto-S24 | Repo `hotspot-tapioles` point [2.16371, 41.37208] lies in el Poble-sec; the official polygon lies in Vallbona/Torre Baró (S19). The README (line 36), mvp and testplan blind-spot story and the `slope-torre-baro` card text ("none of the 14 published sewer points" is here) rest on the misplaced point. The qa Torre Baró rule is only a `relatedZoneIds` link check and would pass either way | repo `data/zones.json`, `README.md`, `scripts/qa.mjs`; vault `ideas/water/README.md` C2 | CONTRADICTED (repo versus Atlas and vault) | verifier it1 (A weakened framing, B confirmed); reworded |
| sto-S25, flo-F33 | Atlas `rcc_iu6` `c_barri` codes equal Open Data BCN `codi_barri` 01-73 one to one; 25 of 73 names differ, all in form (short names). Flow's count of 24 and a verifier's 9 are superseded by int-I1 | `raw/atlas-barri/barris_atlas.geojson` (sha256 5ea45249…, flow F19) vs `raw/storage-barris/barris.csv`; join run by lead 2026-10-09 ; inline Python on `raw/atlas-barri/barris_atlas.geojson` and `raw/storage-barris/barris.csv` | VERIFIED (computed; re-counted by integrator, int-I1) | new in revision; not yet independently checked; flo-F33: lead rev1 (verifier it1 counted 9) |
| sto-S27, leg-L44, flo-F34 | `mvp.md` "What we will not claim": exact storm dates unless quoted on `sourceUrl` (line 151); "citizen reports" (line 153) | repo `mvp.md` ; repo `mvp.md` (local clone, branch signals-pipeline) ; repo `mvp.md` (branch signals-pipeline) | VERIFIED | raised by verifier it1 (B); re-read by lead; leg-L44: verifier it1 (raised by verifier B); lead re-read; flo-F34: lead rev1 |
| sto-S28 | `src/types.ts` labels the proof group "Oct 2026 proof" and sets `proof: false`; App.tsx `blindSpot()` sets `proof: true`; README line 36 says "Turn on Oct 2026 proof" | repo files | VERIFIED | raised by verifier it1 (B); re-read by lead |
| flo-F1 | Shortest cron interval is 5 min; scheduled workflows run only on the default branch; in public repos they are disabled after 60 days without activity | https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows | VERIFIED | verifier it1 (both): confirmed |
| flo-F2 | Scheduled runs can be delayed under high load, and "some queued jobs may be dropped"; the start of every hour is high load | https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows | VERIFIED | verifier it1 (both): confirmed |
| flo-F4 | Actions is free for public repos on standard runners; Free includes 2,000 and Pro 3,000 min/month for private repos; without a payment method usage is blocked once the quota is used | https://docs.github.com/en/billing/concepts/product-billing/github-actions | VERIFIED | verifier it1 (both): confirmed |
| flo-F5 | Private-repo billable minutes are rounded up to the next minute per job; public repos have none | https://docs.github.com/en/actions/how-tos/monitor-workflows/view-job-execution-time | VERIFIED | verifier it1 (both): confirmed |
| flo-F6 | `GITHUB_TOKEN`-created PR opened, synchronize and reopened events create runs that need approval; other `GITHUB_TOKEN` events create none (except workflow_dispatch and repository_dispatch) | https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows | VERIFIED | verifier it1 (both): confirmed; synchronize added |
| flo-F7 | When a repo is created in a personal account, workflows are not allowed to create or approve pull requests by default; this repo's current setting is unknown (API 404 to non-admins) | https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository | VERIFIED (default); current value unknown | verifier it1 (both): confirmed, reworded |
| flo-F8 | Default `GITHUB_TOKEN` in a new personal-account repo has read access to `contents` and `packages` | https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository | VERIFIED | verifier it1 (both): confirmed |
| flo-F9 | GitHub CLI is preinstalled on all hosted runners; auth via `GH_TOKEN` per step | https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-github-cli | VERIFIED | verifier it1 (both): confirmed |
| flo-F10 | Concurrency: a new run cancels an existing pending one in the same group; `cancel-in-progress` also cancels running ones | https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax | VERIFIED | verifier it1 (both): confirmed |
| flo-F12 | XEMA newest precipitation slot was 20:00Z at 21:13Z (dataset modified 20:46:13Z) and 20:30Z at 21:20Z (modified 21:16:20Z; still the newest at 21:39Z); X4, X8, D5 are operational; X2 (Zoo) ended 2024-10-03 | https://analisi.transparenciacatalunya.cat/resource/nzvn-apee.json ; https://analisi.transparenciacatalunya.cat/api/views/nzvn-apee.json ; https://analisi.transparenciacatalunya.cat/resource/yqwd-vj5e.json | VERIFIED (n=2; X2 date from verifier it1) | verifier it1 (both): confirmed |
| flo-F13 | Civil-protection plans dataset (keyless): 1 row on 9 Oct, INUNCAT `ALERTA`, activated, `fasedatahora` 08/10/2026 17:14 (no time zone), "Emergència INUNCAT 3-7 Octubre"; no area field; INUNCAT is Catalonia-wide | https://analisi.transparenciacatalunya.cat/resource/wj9c-j6vf.json | VERIFIED (fields); Catalonia-wide scope per verifier it1 | verifier it1 (both): confirmed, "city-wide" corrected |
| flo-F14 | Socrata requests without an app token are throttled mainly by source IP, at a much lower limit; no number published | https://dev.socrata.com/docs/app-tokens.html | VERIFIED | verifier it1 (both): confirmed |
| flo-F17 | TypeSafe API: 429 and 529 → retry with exponential backoff; no rate-limit number and no price on the API page or llms.txt | https://docs.typesafe.ai/api.md | VERIFIED | verifier it1 (both): confirmed |
| flo-F18 | Jev Template A v2 used 86,398 tokens for 52 requests (about 1,661 each); price $0.042 per M input tokens, which the vault calls TypeSafe's published price but no fetched TypeSafe page shows | vault `ideas/water/jev.md` (written 2026-10-09T21:31:34Z) | AGENT (price UNVERIFIED) | verifier it1: weakened; recomputed |
| flo-F19, bt-B10 | Atlas `rcc_iu6_danys_propietats` is keyless: 73 barri polygons with `c_barri`, `n_barri`, `barri_ha` and damage columns; Torre Baró T10 = 3960.66, el Raval = 12431758.64; polygons reach lat 41.316924 | https://urbisadmin.carto.com/api/v2/sql (file sha256 `5ea45249…`) | VERIFIED (euro unit and "bas_ = current climate" ASSUMPTION) / bt-B10: VERIFIED | verifier it1 (both): confirmed; bt-B10: verifier it1 (both) |
| flo-F22 | Keyword fallback: accuracy 0.442 (CI 0.316–0.577) against a 0.462 majority baseline, publishable recall 1/24 | `work/rules.py` on vault `data/golden_set.csv` | VERIFIED (computed; "frozen before reading" is the author's statement) | verifier it1 (both): reproduced |
| flo-F23 | Gazetteer v1 matches 7/24 publishable snippets, 3/24 to the right barri | `work/gaz_probe.py` | VERIFIED (computed; correctness hand-judged) | verifier it1 (both): weakened; restated |
| flo-F24 | `priority.mjs` v2 (sha256 `33d922b8…`) passes an `assert/strict` self-check (exit 0; a failed assert exits non-zero); live 21:39Z → calm, top tie 0.35; replay 3 Oct 22:00Z → X4 94.6 mm, X8 59.1, D5 46.8, storm, warning n/a | `work/priority.mjs`; outputs `raw/flow-checks/priority_live_v2.json`, `priority_replay_v2.json` | VERIFIED (computed) | lead rev1; v1 confirmed by verifier it1 |
| flo-F25 | Rain cap 30 mm per 6 slots, 6-slot window, 90-min staleness, warning and phase mappings, weights, calm every 4th tick, K = 5, WP page size 20 | design choices | ASSUMPTION | verifier it1 (both): confirmed as labelled |
| flo-F26 | XEMA `data_lectura` is the reading's start time, "etiquetats per davant", in UT | https://analisi.transparenciacatalunya.cat/api/views/nzvn-apee.json (column description, re-fetched 21:4xZ) | VERIFIED | lead rev1 |
| flo-F27 | Jev Template A v2 golden set: mechanism 36/52, place 49/52 (60-name candidate list), during-storm 45/52, 24/26 right at confidence ≥ 0.95 | vault `ideas/water/jev.md` | AGENT | verifier it1 (S1) |
| flo-F29 | One parallel read of the 8 slice-1 feeds: 406–689 ms total, all 200 (n=3, local host, 21:40Z) | `work/time_fetch.mjs`; `raw/flow-rev1/time_fetch.jsonl` | VERIFIED (computed) | lead rev1 |
| flo-F30 | Gazetteer v2: barri 8/24, district 4/24, multi-barri street 1, vetoed 2 (1 wrongly), none 9 | `work/gaz_probe_v2.py` on storage's Open Data BCN files and the golden set | VERIFIED (computed; correctness hand-judged, rules tuned on the same set) | lead rev1 |
| flo-F31 | Neither health regex (v1 or the extended v2) flags any of the 52 golden snippets | inline Python on `raw/golden/golden_set.csv` | VERIFIED (computed) | lead rev1 |
| flo-F35 | `package.json` has `predev`, `prebuild`, `prepreview` → `copy-data.mjs` and no `preqa`; `copy-data.mjs` removes `public/data` first; `qa.mjs` reads `data/` | repo `package.json`, `scripts/copy-data.mjs`, `scripts/qa.mjs` | VERIFIED | verifier it1 (S3); lead rev1 |
| flo-F36 | AEMET Catalonia Atom entries carry a title and a link to a separate CAP file per warning | `raw/sources-warnings/aemet69.xml` (sources workstream) | VERIFIED (local file) | lead rev1 |
| bt-B1 | XEMA gives daily totals for X4, X8 and D5 from 2021-12 to 2026-10-09 with no key; 3 Oct 2026: X4 = 190.8 mm, X8 = 170.3, D5 = 104.3 (44 of 48 slots) | https://analisi.transparenciacatalunya.cat/resource/nzvn-apee.json | VERIFIED | verifier it1 (both) |
| bt-B2 | With a 30 mm max-station threshold there are 2/4/8/11/8 event days in 2022/23/24/25/26, including 16 Sep, 29 Sep, 3 Oct and 5 Oct 2026; 6 Oct (28.3 mm) falls below | https://analisi.transparenciacatalunya.cat/resource/nzvn-apee.json, computed by `prep.py` | VERIFIED (computed) | verifier it1 (both) |
| bt-B3 | IRIS yearly CSVs for 2022–2026 are keyless at `/resources/bcn/IRIS/`, CC BY 4.0; the 2026 file's last filing date is 2026-03-31; the package also lists 2014–2021 | https://opendata-ajuntament.barcelona.cat/resources/bcn/IRIS/2024_IRIS_Peticions_Ciutadanes_OpenData.csv | VERIFIED | verifier it1 (both); 2014–2021 from saved `iris_pkg.json`, lead rev1 |
| bt-B4 | IRIS has no flood category and no free-text column; the closest category is `Reixa embornal incidències` (706 rows in the 2024 file, 691 unique tickets) | https://opendata-ajuntament.barcelona.cat/resources/bcn/IRIS/2024_IRIS_Peticions_Ciutadanes_OpenData.csv | VERIFIED | verifier it1 (both) |
| bt-B5 | Yearly IRIS files overlap at year ends (6,810 rows filed in 2023 sit in the 2024 file) and repeat `FITXA_ID`s within a file (4,069 in 2024), so rows are deduped on `FITXA_ID` and dated by `DIA_/MES_/ANY_DATA_ALTA` (there is no `DATA_ALTA` column) | https://opendata-ajuntament.barcelona.cat/resources/bcn/IRIS/2024_IRIS_Peticions_Ciutadanes_OpenData.csv | VERIFIED (computed) | verifier it1 (both); wording corrected rev1 |
| bt-B6 | Grate reports: 4.44/day in event windows against 1.13/day on 510 dry days, ratio 3.94 (CI 2.78–5.29, bootstrap over events) | computed, `run.py` | VERIFIED (computed) | verifier it1 (both; point value); CI method changed rev1, not re-verified |
| bt-B7, src-C17 | GUB `incidents-gestionats-gub` has yearly CSVs for 2010–2025 (sources C17 says 2022–2025), CC BY 4.0, barri × month only; the 2024 and 2025 files are cut at 29,999 rows (codes ≤510) | https://opendata-ajuntament.barcelona.cat/data/api/3/action/package_show?id=incidents-gestionats-gub | VERIFIED | verifier it1 (both); truncation found by verifier it1, confirmed lead rev1; src-C17: verifier it1 (both): weakened (said 2022–2025), corrected |
| bt-B8, src-C18 | GUB "PLUJA TORRENCIAL": 2024 = 207 with barri + 1 without; 2025 = 319 + 3, top el Poble-sec 29; 62 and 67 of 73 barris positive at year level; code 020, unaffected by truncation | https://opendata-ajuntament.barcelona.cat/data/api/3/action/package_show?id=incidents-gestionats-gub ; https://opendata-ajuntament.barcelona.cat/data/api/3/action/datastore_search?resource_id=0a7c67f7-fe8c-4b95-9e71-68c26fafc3db&q=TORRENCIAL&limit=200 ; 2025 from `raw/backtest-odbcn/gub_2025.csv` | VERIFIED (computed) / src-C18: VERIFIED | verifier it1 (both); src-C18: verifier it1 (both): confirmed; (feas) computed 2025 from the CSV |
| bt-B9 | GUB rain incidents with a barri code average 32.5 a month in the 19 months with an event day, against 3.7 in the other 29 (2022–2025), ratio 8.8 (CI 4.7–19.8). With the 21 no-barri incidents: 33.1 against 4.0 (8.2) | computed, `run.py` | VERIFIED (computed) | verifier it1 (weakened: exclusion unstated, now stated); CI added rev1 |
| bt-B11 | `ar_xarxaini` diagnosis counts: class 5 = 1,292 segments, 63.8 km (1: 7,512; 2: 264; 3: 3,308; 4: 1,060) | https://urbisadmin.carto.com/api/v2/sql | VERIFIED | verifier it1 |
| bt-B12 | 33 of 73 barris intersect at least one of the 14 hotspot polygons; 70 have T10 mesh ≥0.3 m (by triangle centroid); 50 have class-5 sewer by segment centroid (52 by any intersection; 220 segments, 8.1 km, have centroids outside every barri polygon) | https://urbisadmin.carto.com/api/v2/sql; SQL in `raw/backtest-atlas/queries.sql` | VERIFIED (computed) | verifier it1 (weakened: method unstated, now stated and SQL saved); 52 and 220 re-run lead rev1 |
| bt-B14 | Padró 1 Jan 2023 by census section sums to 1,660,435 | https://opendata-ajuntament.barcelona.cat/data/api/3/action/package_show?id=pad_mdbas | VERIFIED (computed) | verifier it1 |
| bt-B15 | Atlas T100 AUC 0.60/0.59/0.60/0.58 on IRIS 2024, GUB 2024, IRIS 2025 and GUB 2025, with CI lower bounds 0.51–0.53; each clears its own null band by 0.01–0.02 | computed, `results.json` | VERIFIED (computed) | verifier it1 (both) |
| bt-B16, flo-F32 | Population AUC 0.61–0.65 and prior-year IRIS volume 0.63–0.66 on the same four tests | computed ; `raw/backtest-derived/results.txt` (backtest section) | VERIFIED (computed) / flo-F32: VERIFIED (computed; re-run byte-identical by verifier it1) | verifier it1 (both); flo-F32: verifier it1 |
| bt-B17 | Adding T100, hotspot or damage to the control (population + IRIS volume) changes Brier by at most 0.0012 in absolute value, and no 2024–2025 interval lies entirely on one side of 0 (hotspot on GUB 2024 has a zero-width interval and is footnoted). Dry-day grate habit improves Brier on IRIS 2024 (interval below 0); persistence worsens it on IRIS 2024 and 2025 | computed | VERIFIED (computed) | verifier it1 (both); added findings from verifier it1 |
| bt-B18 | Hotspot-area AUC is 0.52–0.56 on the 2024–2025 tests | computed | VERIFIED (computed) | verifier it1 (both) |
| bt-B19 | Persistence AUC 0.59–0.62; IRIS persistence BSS for 2025 −0.10 (−0.18 to −0.04) | computed | VERIFIED (computed) | verifier it1 (both); CI shifted by the rev1 RNG order |
| bt-B20 | 2026 proof surface-water labels: 12 geocoded rows in 11 barris; T100 AUC 0.65 (0.49–0.81), null band 0.32–0.68; population 0.40. Same 12 cases as the vault audit, not independent | vault `ideas/water/data/proof_layer.csv` + computed | VERIFIED (computed from AGENT rows) | verifier it1 (both) |
| bt-B21 | The Atlas T10/T100 meshes predate the 2024 test year. The PDISBA summary PDF is dated June 2021 (PDF CreationDate 2021-06-30); keyless `CDB_TableMetadata` returns "permission denied"; `layers.json` holds no date | https://www.diba.cat/documents/63810/351191002/20210628_PDISBA_RESUM.pdf/41a84801-d6a5-4fa0-a802-2738cc5cdfa8 ; https://coneixement-eu.bcn.cat/widget/atles-viewer-eng/conf/resccue/ar_rcc_iu1_t10_m1/layers.json | ASSUMPTION | verifier it1 (both: unverifiable); `layers.json` checked lead rev1 |
| bt-B22 | Cross-checks against the vault match: 706 grate rows (F10), 322 GUB 2025 with Poble-sec 29 (F11), 190.8 mm X4 (README rule 4), 1,292 class-5 segments (vault tag AGENT) | vault `flood-data.md`, `flood-atlas-api.md` | VERIFIED | verifier it1 (both) |
| bt-B23 | `fetch_atlas.py` re-runs the five saved CARTO queries keylessly and each output matches the saved JSON (to 1e-6 relative) | https://urbisadmin.carto.com/api/v2/sql | VERIFIED (computed) | lead rev1; needs verifier it2 |
| bt-B24 | Replayed on 2024–2025 labels, flow's composite scores AUC 0.51–0.57, the exposure term 0.49–0.53 and the slope flag 0.45–0.47 (below its null band on both IRIS tests) | computed, `run.py` + `exposure.mjs` (calls `work/priority.mjs` `compose`) | VERIFIED (computed) | lead rev1; needs verifier it2 |
| bt-B25 | Of the 73 barris, 10 get the slope flag from the 2-polygon `slopes-torrents` layer, and the nearest station is X4 for 44, D5 for 24 and X8 for 5 | computed, `exposure.mjs` | VERIFIED (computed) | lead rev1; needs verifier it2 |
| bt-B26 | `slopes-torrents.geojson` was added in commit de65063 on 2026-10-09 and holds Torre Baró and Sant Genís, both 2026 proof sites, so slope-based scores on 2026 labels are not blind | `git log` in the local repo clone | VERIFIED | lead rev1; needs verifier it2 |
| bt-B27 | Unauthenticated `searchPosts` returns 200 for a first page and 403 ("administrative rules") with a `cursor`, as of 2026-10-09 | https://api.bsky.app/xrpc/app.bsky.feed.searchPosts | VERIFIED | lead rev1; needs verifier it2 |
| bt-B28 | Detection 2024–2025: Bluesky "Barcelona pluja"/"lluvia" fire on 0.79 of 19 event days and 0.18/0.27 of 175 dry days (AUC .84/.85); flood terms on 0.05; WP "insuficiència drenant" on 0.26 of event days and 0.01 of dry days | computed, `detect.py` | VERIFIED (computed) | lead rev1; needs verifier it2 |
| bt-B29 | The conclusion holds at 25 and 40 mm thresholds (section 4.4) | computed, `BT_MM` runs | VERIFIED (computed) | lead rev1; needs verifier it2 |
| bt-B30 | GUB 2024 and 2025 CSVs have 29,999 rows with codes 000–510; 2022 and 2023 have 39,029 and 39,279 rows with codes −1 to 999 | local `raw/backtest-odbcn/gub_*.csv` from the package above | VERIFIED (computed) | verifier it1 (finding); lead rev1 |
| int-I1 | Atlas `rcc_iu6` and Open Data BCN barri files: 73 codes each, identical sets; 25 of 73 names differ (all short forms) | `raw/atlas-barri/barris_atlas.geojson` vs `raw/storage-barris/barris.csv`, `integrator/chk_names.py` | VERIFIED (computed) | integrator; settles sto-S25 (25) vs flo-F33 (24) |
| int-I2 | Repo `hotspot-tapioles` [2.16371, 41.37208] is 9,691 m (haversine) from the nearest vertex of Atlas fid 14 "Torrent Tapioles" | `raw/storage-hotspots/hotspots.geojson` + repo `data/geojson/resccue-hotspots.geojson`, `integrator/chk_tap.py` | VERIFIED (computed) | integrator; reproduces sto-S20 |
| int-I3 | `results.txt` dBrier intervals that exclude 0 (excluding controls): IRIS 2024 grate habit −0.0014, persistence +0.0058, flow exposure +0.0045 (+0.0004..+0.0087), slope flag +0.0032 (+0.0006..+0.0065); IRIS 2025 persistence +0.0048; IRIS 2026 Jan–Mar grate habit −0.0023, hotspot −0.0009 (7 positives) | `raw/backtest-derived/results.txt`, parsed by inline Python | VERIFIED (computed) | integrator; adds two findings to bt-B17 |
| int-I4 | Local repo branch `signals-pipeline` has 1 commit (de65063, 2026-10-09 20:47:21 +0200), which also adds `slopes-torrents.geojson`; `package.json` pre-scripts run only `copy-data.mjs`, no `preqa`, no `signals/` dir | `git log`, `git rev-list --count HEAD`, `package.json` in /home/magickappa/Code/hackathon-barcelona | VERIFIED | integrator |
| int-I5 | `barri_priors.json` holds `note` plus `rows` (73 rows), 13,535 bytes; first row el Raval, nearest station X4 | `raw/backtest-derived/barri_priors.json` | VERIFIED | integrator |
| int-I6 | Requests: recommended slice 2 signal feeds + MeteoAlarm + XEMA + INUNCAT = 5 per run, 240 per day; with S1 6 and 288 | arithmetic on src-C47, flo-F12, flo-F13 and the section 3 live set | VERIFIED (computed) | integrator |
| int-I7 | Jev daily cost: 1.25 items/run × 48 × 1,661 tokens × $0.042/M ≈ $0.004; worst case 35 items/run ≈ $0.12. Inputs are AGENT (tokens, price) and ASSUMPTION (WP page 20) | arithmetic on flo-F18 and flow §3 item rates | VERIFIED (arithmetic); inputs AGENT / UNVERIFIED | integrator |
| int-I8 | The slice adds no dependency; `package.json` dependencies unchanged; scripts use Node stdlib only | `git show 208a974 -- package.json` in `~/Code/hackathon-barcelona` | VERIFIED (computed) | integration engineer; not independently checked |
| int-I9 | Gazetteer built by `scripts/signals-gazetteer.mjs`: 73 barris, 10 districts, 25 aliases, 33 zone ids in 42 barris | `raw/storage-barris/barris.csv` + `raw/atlas-barri/barris_atlas.geojson` + repo `data/geojson/*` | VERIFIED (computed) | integration engineer; independent of storage's `gazetteer_proto.py` |
| int-I10 | Live `npm run signals` 2026-10-09 22:21Z: Ajuntament WP API 44 items in 7 days, 7 relevant; Betevé RSS 15 items, 0 relevant; 0 health drops; XEMA X4/X8/D5 0 mm | https://ajuntament.barcelona.cat/premsa/wp-json/wp/v2/posts ; https://beteve.cat/feed/ ; rows in `raw/integration-live/` | VERIFIED | integration engineer; not independently checked |
| int-I11 | At `15b089c`, `ingest()` writes every allowlisted, non-health item as a pending row; a regex miss gets `relevant: false`, sorts last in `--list`, gets no Jev call, is left out of the priority signal and staleness terms, and is deleted unreviewed after 72 h | `scripts/signals.mjs` at `15b089c` in `~/Code/hackathon-barcelona`; live run in `raw/integration-live-it1-final/` | VERIFIED (computed) | integration engineer; not independently checked |
| int-I12 | Relevance regex on the vault golden set (52 snippets; 42 not `unrelated`): `208a974` passes 15/42 and 2/10 unrelated; rules_v2 `RELEVANT` 28/42 and 2/10; `15b089c` 32/42 and 3/10 (G43, G45, G52). In-sample: stems were chosen after reading this set | `raw/golden/golden_set.csv`, `scripts/measure_relevance.mjs` (scratch) and an inline node run of the rules_v2 pattern | VERIFIED (computed) | integration engineer; reproduces the gap's 15/42 and 28/42 |
| int-I13 | Live 2026-10-09 22:38:34Z, 7-day lookback: Ajuntament 44 read, 13 flagged relevant; Betevé 15 read, 1; 59 rows, 43,596 bytes. With the gap's stems only (22:35:58Z), 7/44 and 0/15, and 7 of the 52 unflagged items had storm slugs; the final regex flags all 7 | https://ajuntament.barcelona.cat/premsa/wp-json/wp/v2/posts ; https://beteve.cat/feed/ ; `raw/integration-live-it1-final/` (inbox sha256 c1d14c00…) | VERIFIED (counts); AGENT (slug reading) | integration engineer; not independently checked |
| int-I14 | At `208a974`, the resolver returned district precision (05, 07) with no barri candidate for the 7 Oct Ajuntament Torre Baró item, because its excerpt lists two districts; at `15b089c` it keeps Torre Baró (54) as the candidate. The item's URL is already the source of `proof-torre-baro-2026-10`, so approving it links rather than adds a dot | https://ajuntament.barcelona.cat/premsa/wp-json/wp/v2/posts (slug query, title and excerpt read in memory); `data/zones.json` | VERIFIED (computed) | integration engineer; not independently checked |

## 12. Change log

- 2026-10-10, iteration 1 (integrator): first merge of the sources, legal, storage, flow and backtest sections into this document. Contradictions resolved:
  - **Live set:** sources' 4 feeds over flow's 8, and S1 kept out of slice 1 (D3).
  - **Published unit:** storage's barri-per-window over flow's barri-per-day.
  - **Mirror posts:** treated as individuals (legal), not organisation content (flow).
  - **Health filter:** regex first (legal), not Jev first (flow).
  - **Published files:** generated and never committed (storage), not committed by the reviewer (flow).
  - **Names and numbers:** allowlist name, seven edits, sha256.
  - **Atlas name differences:** 25, re-counted (int-I1).
  - **Bluesky volumes:** flow's stale figures replaced by src-C44.
  - **Warning feed:** flow's stale note about the feed choice closed (MeteoAlarm S30).
  - **Label schema:** the backtest's columns adopted.
  - **YouTube RSS:** legal's stale note closed (S19 is now "no").

  Left as team decisions: D1 (where records live; storage recommended, CONTRADICTED with flow and legal §2) and D6 (Tapioles hotspot, CONTRADICTED repo against Atlas). Added int-I1 to int-I7, including two Brier findings missing from the backtest bottom line. Merged 190 section claims (flow's F3 was already folded into F1) into 171 ledger rows, plus 7 integrator rows.
- 2026-10-10, iteration 2 (legal lead): §4 replaced. The Ajuntament robots.txt AI block (130 agents), the Ajuntament and Betevé legal notices, Ley 37/2007, the MeteoAlarm T&C and the Generalitat licence were read. S5 and S8 were re-rated, and Jev is off for S5 and S8. Database right applied per source. Lawyer points 12 to 14 added. Ledger rows leg-L49 to leg-L65 added.

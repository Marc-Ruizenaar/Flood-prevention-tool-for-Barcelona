# G1 evidence: XEMA open-data copy (Transparència Catalunya, nzvn-apee), 3–7 Oct 2026

Fetched 2026-10-09 (~21:20 UTC) by Agent 1 with `python -m bcnflood.data.xema_evidence`.
Every URL, query, fetch time (UTC), byte count and sha256 is in `manifests/raw/g1/provenance.json`.
The raw files are stored verbatim in `manifests/raw/g1/`.

Query (re-fetched for M2-A1-06): `codi_estacio='<S>' AND data_lectura >= '2026-10-01T22:00:00' AND data_lectura < '2026-10-07T22:00:00'`. That is exactly local days 2–7 Oct 2026 (CEST, UTC+2), with 2 Oct as the dry spin-up day,
covering all variables, for stations X4 el Raval, X8 Zona Universitària, D5 Observatori Fabra (all operational, in Barcelona municipality) and WU Badalona (neighbouring municipality).
Station X2 Zoo was dismantled on 2024-10-03 and AN on 2002-10-29, so neither has data for this period.

## Findings (sources: dataset column metadata `nzvn-apee_metadata.json` and the variables table `4fb2-n3yi`)
- **Timezone: VERIFIED UTC.** The `data_lectura` column description says: "Data i Hora Inicial de la lectura (els registres es troben etiquetats per davant). L'hora es facilita en Temps Universal (T.U.)". Timestamps are UTC and **label the start of the interval**.
- **Base:** all precipitation rows have `codi_base=SH`, which means 30 min.
- **Units:** var 35 Precipitació is mm (per 30-min record, 1 decimal). Var 72 PPT max 1 min is mm. 32/40/42 are °C, 33/3/44 are %, 34/1/2 are hPa, 30/50 are m/s, 31/51 are °, 36 is W/m². 16 variables in total.
- **QC (`codi_estat`):** blank = validation not started, T = in validation, V = valid. Invalid values are not published.
  Counts of var-35 records per local day (CEST), as VALID / NOT_VALIDATED:
  | station | 2 Oct | 3 Oct | 4 Oct | 5 Oct | 6 Oct | 7 Oct |
  |---|---|---|---|---|---|---|
  | X4 | 48/0 | 4/44 | 0/48 | 0/48 | 0/48 | 0/48 |
  | X8 | 48/0 | 4/44 | 0/48 | 0/48 | 0/48 | 0/48 |
  | D5 | 48/0 | 4/43 | 0/45 | 0/48 | 0/48 | 1/47 |
  | WU | 48/0 | 4/44 | 0/48 | 0/48 | 0/48 | 0/48 |
  No record has T. The 2 Oct spin-up day is complete and VALID for all four stations.
- **Completeness:** X4, X8 and WU have 288/288 records. **D5 has 284/288**. Missing intervals start at 2026-10-03T21:30, 22:00, 22:30 and 23:00 UTC, which is local 3 Oct 23:30 to 4 Oct 01:30 CEST. They stay MISSING and are never set to zero.
- No daily totals are given here. The old UTC-day sums were withdrawn. Local-day aggregation belongs to Agent 2 (timewindows.py) and works from these raw files.

## Caveats
- The evidence comes from the Transparència mirror's own metadata, not from the Meteocat API (no key). It is a secondary publication of Meteocat data.
- The values are provisional, and Meteocat validation may change them or drop them.

## G1 verdict: **NOT PASSED (CONDITIONAL)**
TZ, units and the meaning of the QC flags are verified. The data for the event period is not yet validated.
For G1 to pass, the data must be re-fetched after Meteocat validation (codi_estat=V), or the user must accept provisional data in writing.

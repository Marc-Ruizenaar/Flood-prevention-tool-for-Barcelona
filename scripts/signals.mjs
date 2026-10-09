// Signals pipeline: ingest -> health filter -> relevance -> dedupe -> classify -> gazetteer -> pending row.
// Nothing is published from here: a person approves rows, then scripts/signals-build.mjs makes the map files.
//
//   npm run signals                         read the feeds once, write pending rows, print priority
//   npm run signals -- --scheduled          same, but honour calm-mode cadence (for a twice-hourly timer)
//   npm run signals -- --list               pending rows, highest-priority barri first
//   npm run signals -- --priority           refresh priority per barri (live XEMA rain)
//   npm run signals -- --approve <id> --mechanism <m> [--barri <code|name>] --by R1
//   npm run signals -- --reject <id> --reason "<why>" --by R1
//   npm run signals -- --add <https url> --barri <code|name> --mechanism <m> --date <ISO> --by R1 [--summary "..."]
//
// Live feeds (legal: official and press only): Ajuntament press WP REST API, Betevé RSS.
// Priority inputs: Meteocat XEMA (rain), MeteoAlarm ES181 and INUNCAT (cadence only).
// Post text lives in memory for one run. Rows never hold text, titles, handles or media.
// Optional: TYPESAFE_API_KEY enables Jev Template A v2 (select only). Without it a keyword hint goes to the reviewer.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import {
  PUBLISH_MECH, allowEntry, cadence, compose, isHealth, isRelevant, keywordMechanism, makeResolver, norm, parseRss, rainFromRows, sha, signalId, stripHtml,
} from "./signals-lib.mjs";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const config = read("signals/config.json");
const allowlist = read("signals/allowlist.json");
const gazText = readFileSync("signals/gazetteer.json", "utf8");
const gaz = JSON.parse(gazText);
const priors = read("signals/barri_priors.json").rows;
const resolve = makeResolver(gaz);
const UA = { "User-Agent": process.env.SIGNALS_UA || config.userAgent };
const now = new Date();
const iso = (d) => new Date(d).toISOString().slice(0, 16) + "Z"; // UTC to the minute
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (name) => args.includes(`--${name}`);

// ---------- store ----------
const INBOX = "signals/inbox.jsonl", COUNTS = "signals/counts.json";
const loadInbox = () => readFileSync(INBOX, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
let counts;
try { counts = read(COUNTS); } catch { counts = { watermarks: {}, sources: {}, last_signal_at: {} }; }
function atomic(path, text) { writeFileSync(`${path}.tmp`, text); renameSync(`${path}.tmp`, path); }
const saveInbox = (rows) => atomic(INBOX, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
const saveCounts = () => atomic(COUNTS, JSON.stringify(counts, null, 1) + "\n");

function barriCode(value) {
  if (!value) return null;
  if (gaz.barris[value]) return value;
  const hit = Object.entries(gaz.barris).find(([, b]) => [b.name, ...b.aliases].some((n) => norm(n) === norm(value)));
  return hit?.[0] ?? null;
}
const reviewer = () => opt("by") || process.env.SIGNALS_REVIEWER || fail("give a reviewer code with --by R1 (or SIGNALS_REVIEWER), never an email");
function fail(message) { console.error(message); process.exit(1); }

// ---------- network ----------
async function get(url, kind = "json", tries = 3) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20e3) });
      if ((res.status === 429 || res.status >= 500) && i < tries - 1) throw Object.assign(new Error(`${res.status}`), { retry: true });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return { body: kind === "json" ? await res.json() : await res.text(), headers: res.headers };
    } catch (e) {
      if (i >= tries - 1 || !(e.retry || e.name === "TimeoutError" || e.name === "TypeError")) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i)); // 1 s, 2 s
    }
  }
}

// Adapters: async (since) => items [{platform, post_id, url, published_at, text}]. Text stays in memory.
const ADAPTERS = {
  async ajuntament(since) {
    const items = [];
    for (let page = 1; page <= 4; page++) {
      const url = `https://ajuntament.barcelona.cat/premsa/wp-json/wp/v2/posts?after=${since.toISOString().slice(0, 19)}&per_page=50&page=${page}&orderby=date&order=asc&_fields=id,date_gmt,link,title,excerpt`;
      const { body, headers } = await get(url);
      for (const p of body) items.push({ platform: "press", post_id: String(p.id), url: p.link, published_at: `${p.date_gmt}Z`, text: `${stripHtml(p.title?.rendered)}. ${stripHtml(p.excerpt?.rendered)}` });
      if (page >= Number(headers.get("x-wp-totalpages") ?? 1)) break;
    }
    return items;
  },
  async beteve(since) {
    const { body } = await get("https://beteve.cat/feed/", "text");
    return parseRss(body)
      .map((it) => ({ platform: "press", post_id: it.guid, url: it.link, published_at: new Date(it.pubDate).toISOString(), text: `${it.title}. ${it.description}` }))
      .filter((it) => new Date(it.published_at) > since);
  },
};

async function rainNow() {
  const since = iso(now - 4 * 3600e3).slice(0, 16), until = iso(now).slice(0, 16);
  const q = `https://analisi.transparenciacatalunya.cat/resource/nzvn-apee.json?$where=codi_variable='35' AND codi_estacio in(${config.stations.map((s) => `'${s}'`).join(",")}) AND data_lectura>='${since}' AND data_lectura<'${until}'&$limit=200`;
  try { return { rain3h: rainFromRows((await get(encodeURI(q))).body, now, config.stations, config.knobs) }; }
  catch (e) { return { rain3h: Object.fromEntries(config.stations.map((s) => [s, null])), error: `xema: ${e.message}` }; }
}

async function warningNow(rain3h) {
  const errors = [];
  let ma = null, inun = null;
  try {
    ma = 0;
    const SEV = { Moderate: 0.5, Severe: 0.8, Extreme: 1 }; // ASSUMPTION mapping
    for (const e of (await get("https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-spain", "text")).body.split("<entry>").slice(1)) {
      if (!e.includes("<value>ES181</value>")) continue; // Litoral de Barcelona
      const f = (t) => (e.match(new RegExp(`<cap:${t}>([^<]*)</cap:${t}>`)) ?? [])[1];
      if (/rain/i.test(f("event") ?? "") && new Date(f("onset")) <= now && now < new Date(f("expires"))) ma = Math.max(ma, SEV[f("severity")] ?? 1);
    }
  } catch (e) { ma = null; errors.push(`meteoalarm: ${e.message}`); }
  try {
    const PHASE = { PREALERTA: 0.33, ALERTA: 0.67, EMERGENCIA: 1, "EMERGÈNCIA": 1 }; // ASSUMPTION mapping
    const plans = (await get("https://analisi.transparenciacatalunya.cat/resource/wj9c-j6vf.json")).body.filter((p) => p.plaacronim === "INUNCAT" && p.plaactivat === "SI");
    inun = Math.max(0, ...plans.map((p) => PHASE[p.plafase] ?? 1));
  } catch (e) { inun = null; errors.push(`inuncat: ${e.message}`); }
  const bcnRain = Object.values(rain3h).some((v) => v > 0); // INUNCAT is Catalonia-wide: counts only while Barcelona has rain
  return { warning: ma === null ? null : Math.max(ma, bcnRain ? inun ?? 0 : 0), meteoalarm: ma, inuncat: inun, errors };
}

function signalTerms(rows) {
  const s6 = {}, stale = {};
  for (const r of rows) {
    if (!r.place?.barri || !["pending", "approved"].includes(r.review.status)) continue;
    if (now - Date.parse(r.published_at) <= 6 * 3600e3) s6[r.place.barri] = (s6[r.place.barri] ?? 0) + 1;
  }
  for (const [b, t] of Object.entries(counts.last_signal_at ?? {})) stale[b] = (now - Date.parse(t)) / 3600e3;
  return { s6, stale };
}

// ---------- Jev (optional, select only) ----------
let jevOff = !process.env.TYPESAFE_API_KEY;
const MECH_CRITERIA = {
  street_overflow: "Rainwater or sewer water overflowing onto a street, avenue, square, park or road",
  basement_flooding: "Water entering basements, garages or ground-floor rooms of a building",
  transformer_room: "A flooded electrical transformer room or substation, or power cuts caused by water in the electrical network",
  slope_runoff: "Water, mud or debris coming down a hillside, torrent or retaining wall, landslides",
  transport_disruption: "Metro, rail, tram, bus, airport or tunnel service stopped or closed because of water",
  aftermath_only: "Only cleanup, recovery, politics or reopening, no new failure described",
  other: "None of these, or not enough to tell",
};
async function jev(text, candidates) {
  if (jevOff) return null;
  const questions = { mechanism: { type: "choice", instructions: "Which failure mechanism does this report describe?", criteria: MECH_CRITERIA } };
  if (candidates.length >= 2) {
    questions.place = { type: "choice", instructions: "Which of these places is the report mainly about? Choose none if no listed place is named.",
      criteria: { ...Object.fromEntries(candidates.map((c) => [gaz.barris[c].name, null])), none: "No place from this list is named" } };
  }
  try {
    const res = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST", signal: AbortSignal.timeout(40e3),
      headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ state: { report: text }, model: "jev-latest", questions }),
    });
    if (res.status === 401 || res.status === 422) { jevOff = true; console.error(`jev ${res.status}: switching this run to the keyword hint`); return null; }
    if (!res.ok) return null;
    const a = (await res.json()).answers;
    const place = a.place && a.place.choice !== "none" ? candidates.find((c) => gaz.barris[c].name === a.place.choice) : undefined;
    return { mechanism: a.mechanism.choice, conf: a.mechanism.confidence, place, placeConf: a.place?.confidence };
  } catch { return null; }
}

// ---------- commands ----------
async function ingest() {
  const rows = loadInbox();
  const rain = await rainNow();
  const warn = await warningNow(rain.rain3h);
  const { s6, stale } = signalTerms(rows);
  const tick = Math.floor((now.getUTCHours() * 60 + now.getUTCMinutes()) / 30);
  const cad = cadence({ rain3h: rain.rain3h, warning: warn.warning, anySignal6h: Object.keys(s6).length > 0, tick, knobs: config.knobs });
  const errors = [rain.error, ...warn.errors].filter(Boolean);
  const report = { now: iso(now), mode: cad.mode, rain3h_mm: rain.rain3h, warning: warn.warning, sources: {}, new_pending: 0, dropped_health: 0, errors };

  if (has("scheduled") && !cad.fullRun) {
    report.skipped = "calm: feeds are read every 4th tick";
  } else {
    const seen = new Set(rows.map((r) => r.signal_id));
    const runId = `r_${iso(now).replace(/[-:]/g, "")}`;
    const gazTag = sha(gazText).slice(0, 8);
    const fallback = new Date(now - config.firstRunLookbackDays * 86400e3);
    const results = await Promise.allSettled(Object.entries(ADAPTERS).map(async ([name, fn]) => {
      const since = opt("since") ? new Date(opt("since")) : counts.watermarks[name] ? new Date(counts.watermarks[name]) : fallback;
      return { name, items: await fn(since) };
    }));
    for (const [i, res] of results.entries()) {
      const name = Object.keys(ADAPTERS)[i];
      const status = (counts.sources[name] ??= { last_ok: null, last_error: null, fails: 0 });
      if (res.status === "rejected") {
        Object.assign(status, { last_error: `${iso(now)} ${res.reason?.message ?? res.reason}`, fails: status.fails + 1 }); // watermark untouched
        report.sources[name] = `error: ${res.reason?.message ?? res.reason}`;
        continue;
      }
      let relevant = 0, added = 0, maxPub = counts.watermarks[name] ?? null;
      for (const item of res.value.items) {
        if (!maxPub || item.published_at > maxPub) maxPub = item.published_at;
        if (isHealth(item.text)) { report.dropped_health++; continue; } // dropped before any write or outside call
        if (!isRelevant(item.text)) continue;
        relevant++;
        const entry = allowEntry(item.url, allowlist);
        if (!entry) continue; // a link off the allowlist never becomes a row
        const id = signalId(item.platform, item.url);
        if (seen.has(id)) continue;
        const place = resolve(item.text);
        const j = await jev(item.text, place.barris);
        let barri = place.barris.length === 1 && place.level === "barri" ? place.barris[0] : null;
        if (!barri && j?.place && j.placeConf >= config.autoAcceptConfidence) barri = j.place;
        const cls = j
          ? { model: "jev-latest", template: "A-v2", run_id: runId, mechanism: j.mechanism, p_mechanism: +j.conf.toFixed(2) }
          : { model: "keyword-v2", template: null, run_id: runId, mechanism: keywordMechanism(item.text), p_mechanism: null };
        const where = barri ? gaz.barris[barri].name : place.level === "district" ? place.districts.map((d) => gaz.districts[d]).join(", ") : null;
        rows.push({
          signal_id: id, platform: item.platform, source_kind: entry.kind, source_url: item.url, source_label: entry.label,
          published_at: iso(item.published_at), fetched_at: iso(now),
          summary: `${entry.label} published an item matching flood terms${where ? ` that names ${where}` : ""}.`,
          place: { level: barri ? "barri" : place.level, barri, district: barri ? gaz.barris[barri].district : place.districts[0] ?? null,
            candidates: place.barris, zone_ids: barri ? gaz.barris[barri].zone_ids : [], hotspot_fid: null, gaz: gazTag },
          cls,
          review: { status: "pending", by: null, at: null, reason: null, mechanism: null },
        });
        seen.add(id);
        added++;
        if (barri) counts.last_signal_at[barri] = iso(item.published_at) > (counts.last_signal_at[barri] ?? "") ? iso(item.published_at) : counts.last_signal_at[barri];
      }
      if (maxPub) counts.watermarks[name] = maxPub;
      Object.assign(status, { last_ok: iso(now), fails: 0 });
      report.sources[name] = `${res.value.items.length} read, ${relevant} relevant, ${added} new`;
      report.new_pending += added;
    }
  }
  const kept = prune(rows);
  saveInbox(kept);
  saveCounts();
  const flagged = Object.entries(counts.sources).filter(([, s]) => s.fails >= 3).map(([n]) => n);
  if (flagged.length) report.flag = `3+ failures in a row: ${flagged.join(", ")}`;
  report.top_priority = compose({ priors, rain3h: rain.rain3h, signals6h: s6, staleH: stale, weights: config.weights, knobs: config.knobs })
    .slice(0, 8).map((p) => `${p.score} ${p.name} (${p.station})`);
  console.log(JSON.stringify(report, null, 1));
}

// Retention (design section 5): pending 72 h then expired; approved kept window + 30 days; stubs 30 days.
function prune(rows) {
  const stub = (r, status, reason) => ({ signal_id: r.signal_id, review: { ...r.review, status, at: r.review.at ?? iso(now), reason } });
  return rows.flatMap((r) => {
    const s = r.review.status;
    if (s === "pending" && now - Date.parse(r.fetched_at) > config.pendingExpiryHours * 3600e3) return [stub(r, "expired", "not reviewed in time")];
    if (s === "approved" && now - Date.parse(r.published_at) > (config.windowDays + config.keepApprovedDaysAfterWindow) * 86400e3) return [];
    if ((s === "rejected" || s === "expired") && now - Date.parse(r.review.at) > config.keepStubDays * 86400e3) return [];
    if ((s === "rejected" || s === "expired") && r.source_url) return [stub(r, s, r.review.reason)];
    return [r];
  });
}

async function list() {
  const rows = loadInbox().filter((r) => r.review.status === "pending");
  const { rain3h } = await rainNow();
  const { s6, stale } = signalTerms(rows);
  const rank = Object.fromEntries(compose({ priors, rain3h, signals6h: s6, staleH: stale, weights: config.weights, knobs: config.knobs }).map((p) => [p.c_barri, p.score]));
  const flagged = Object.entries(counts.sources ?? {}).filter(([, s]) => s.fails >= 3).map(([n]) => n);
  console.log(`${rows.length} pending${flagged.length ? `; FLAG 3+ failures: ${flagged.join(", ")}` : ""}`);
  rows.sort((a, b) => (rank[b.place.barri] ?? -1) - (rank[a.place.barri] ?? -1) || b.published_at.localeCompare(a.published_at));
  for (const r of rows) {
    const where = r.place.barri ? gaz.barris[r.place.barri].name : r.place.candidates?.length ? `one of ${r.place.candidates.map((c) => `${c} ${gaz.barris[c].name}`).join("; ")}`
      : r.place.level === "none" ? "no named place (pass --barri to approve)" : `${r.place.level} ${r.place.district ? gaz.districts[r.place.district] ?? "" : ""}`.trim();
    const hint = `${r.cls?.mechanism ?? "?"}${r.cls?.p_mechanism != null ? ` (${r.cls.model} ${r.cls.p_mechanism})` : ` (${r.cls?.model} hint)`}`;
    console.log(`${r.signal_id}  p=${rank[r.place.barri] ?? "-"}  ${hint} reported in ${where}, ${r.source_label}, ${r.published_at}\n    ${r.source_url}`);
  }
}

function updateRow(id, fn) {
  const rows = loadInbox();
  const row = rows.find((r) => r.signal_id === id) ?? fail(`no inbox row ${id}`);
  fn(row);
  saveInbox(rows);
  console.log(JSON.stringify(row));
}

function approve(id) {
  const by = reviewer();
  updateRow(id, (row) => {
    const auto = row.cls?.p_mechanism != null && row.cls.p_mechanism >= config.autoAcceptConfidence ? row.cls.mechanism : null;
    const mech = opt("mechanism") ?? auto;
    if (!PUBLISH_MECH[mech]) fail(`--mechanism must be one of ${Object.keys(PUBLISH_MECH).join(", ")}${row.cls ? ` (hint: ${row.cls.mechanism})` : ""}`);
    if (opt("barri")) {
      const code = barriCode(opt("barri")) ?? fail(`unknown barri ${opt("barri")}`);
      row.place = { ...row.place, level: "barri", barri: code, district: gaz.barris[code].district, zone_ids: gaz.barris[code].zone_ids };
    }
    if (!row.place?.barri) fail("this row has no barri: pass --barri <code|name>");
    if (opt("summary")) row.summary = opt("summary");
    row.review = { status: "approved", by, at: iso(now), reason: null, mechanism: mech };
    counts.last_signal_at[row.place.barri] = row.published_at > (counts.last_signal_at[row.place.barri] ?? "") ? row.published_at : counts.last_signal_at[row.place.barri];
    saveCounts();
  });
}

function add(url) {
  const by = reviewer();
  const entry = allowEntry(url, allowlist) ?? fail(`not https or host not on signals/allowlist.json: ${url}`);
  const code = barriCode(opt("barri")) ?? fail("--barri <code|name> is required and must be in the gazetteer");
  const mech = opt("mechanism");
  if (!PUBLISH_MECH[mech]) fail(`--mechanism must be one of ${Object.keys(PUBLISH_MECH).join(", ")}`);
  const date = opt("date") && !Number.isNaN(Date.parse(opt("date"))) ? opt("date") : fail("--date <ISO> is required: the item's own publication date, as shown on the linked page");
  const rows = loadInbox();
  const id = signalId("manual", url);
  if (rows.some((r) => r.signal_id === id)) fail(`already in the inbox: ${id}`);
  const row = {
    signal_id: id, platform: "manual", source_kind: entry.kind, source_url: url, source_label: entry.label,
    published_at: iso(date), fetched_at: iso(now),
    summary: opt("summary") ?? `${entry.label} reported ${mech.replace(/_/g, " ")} in ${gaz.barris[code].name}.`,
    place: { level: "barri", barri: code, district: gaz.barris[code].district, candidates: [code], zone_ids: gaz.barris[code].zone_ids, hotspot_fid: null, gaz: sha(gazText).slice(0, 8) },
    cls: null,
    review: { status: "approved", by, at: iso(now), reason: null, mechanism: mech },
  };
  saveInbox([...rows, row]);
  console.log(JSON.stringify(row));
}

async function priority() {
  const rain = await rainNow();
  const { s6, stale } = signalTerms(loadInbox());
  const ranked = compose({ priors, rain3h: rain.rain3h, signals6h: s6, staleH: stale, weights: config.weights, knobs: config.knobs });
  console.log(JSON.stringify({ now: iso(now), rain3h_mm: rain.rain3h, error: rain.error, weights: config.weights, top: ranked.slice(0, 12).map((p) => ({ barri: `${p.c_barri} ${p.name}`, score: p.score, parts: p.parts })) }, null, 1));
}

if (opt("approve")) approve(opt("approve"));
else if (opt("reject")) {
  const by = reviewer();
  const reason = opt("reason") ?? fail("--reason is required");
  updateRow(opt("reject"), (row) => { row.review = { ...row.review, status: "rejected", by, at: iso(now), reason }; });
} else if (opt("add")) add(opt("add"));
else if (has("list")) await list();
else if (has("priority")) await priority();
else await ingest();

// Public attention around the 3 to 7 Oct 2026 storms, as daily counts, written to data/attention.json.
// Every source is aggregate by design: Wikipedia pageviews per article per day, GDELT news article counts,
// Commons uploads per day in one category. No person, account, title or URL from a response is written.
// A source that fails keeps its series from the previous data/attention.json, if any, and is reported.
//
//   npm run attention
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const OUT = "data/attention.json";
const START = "2026-09-26", END = "2026-10-09"; // a normal week before the storm, then the storm and after
const UA = { "User-Agent": "next-rain-hackathon/0.1 (hackathon prototype)" };
const NO_WAIT = !!process.env.ATTENTION_NO_WAIT; // tests only
const sleep = (ms) => new Promise((r) => setTimeout(r, NO_WAIT ? 0 : ms));
const compact = (d) => d.replaceAll("-", "");
const days = [];
for (let t = Date.parse(START); t <= Date.parse(END); t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));

// Found with the MediaWiki search API on 2026-10-10. The event article was created 2026-10-04 and has no es/en version.
// ca "Clavegueram de Barcelona" was tried and has no article (pageviews 404).
const ARTICLES = [
  ["ca", "Aiguats d'octubre de 2026 a Catalunya"],
  ["ca", "Inundació"],
  ["es", "Inundación"],
  ["ca", "Gota freda"],
  ["es", "Gota fría"],
  ["es", "DANA"],
];
const COMMONS_CAT = "Category:October 2026 Catalonia floods";
const GDELT_QUERY = '(Barcelona) (inundaciones OR inundacions OR riada OR "lluvias torrenciales")';

async function get(url, { tries = 3, backoff = 6e3 } = {}) {
  for (let i = 1; ; i++) {
    let res;
    try {
      res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30e3) });
    } catch (e) { // network error or timeout: retry like a 429
      if (i >= tries) throw new Error(`${e.message}${e.cause ? ` (${e.cause.code ?? e.cause.message})` : ""} ${new URL(url).host}`);
      await sleep(backoff * i);
      continue;
    }
    if (res.ok) return res;
    if (res.status !== 429 || i >= tries) throw new Error(`HTTP ${res.status} ${new URL(url).host}`);
    await sleep(backoff * i);
  }
}
const series = (id, label, unit, source, source_url, counts) =>
  ({ id, label, unit, source, source_url, points: days.map((t) => ({ t, v: counts[t] ?? 0 })) });

async function wikipedia() {
  const out = [], total = {};
  for (const [lang, title] of ARTICLES) {
    const slug = encodeURIComponent(title.replaceAll(" ", "_"));
    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${lang}.wikipedia/all-access/user/${slug}/daily/${compact(START)}/${compact(END)}`;
    const { items = [] } = await (await get(url)).json();
    const counts = {}; // the API leaves out days with zero views, so a missing day is 0
    for (const it of items) {
      const t = `${it.timestamp.slice(0, 4)}-${it.timestamp.slice(4, 6)}-${it.timestamp.slice(6, 8)}`;
      counts[t] = Number(it.views) || 0;
      total[t] = (total[t] ?? 0) + counts[t];
    }
    out.push(series(`wikipedia:${lang}:${title}`, `${lang}.wikipedia "${title}"`, "views/day", "Wikimedia pageviews API",
      `https://${lang}.wikipedia.org/wiki/${slug}`, counts));
    await sleep(300);
  }
  const sum = series("wikipedia", "Wikipedia views of flood articles", "views/day", "Wikimedia pageviews API",
    "https://wikimedia.org/api/rest_v1/#/Pageviews%20data", total);
  return [sum, ...out];
}

async function gdelt() {
  const p = new URLSearchParams({ query: GDELT_QUERY, mode: "timelinevolraw", format: "json",
    startdatetime: `${compact(START)}000000`, enddatetime: `${compact(END)}235959` });
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?${p}`;
  const res = await get(url, { tries: 4, backoff: 7e3 }); // GDELT asks for one request every 5 s
  const body = await res.text();
  let json;
  try { json = JSON.parse(body); } catch { throw new Error(`GDELT answered non-JSON: ${body.slice(0, 80)}`); }
  const counts = {};
  for (const d of json.timeline?.[0]?.data ?? []) {
    const t = `${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}`;
    counts[t] = (counts[t] ?? 0) + (Number(d.value) || 0);
  }
  if (!Object.keys(counts).length) throw new Error("GDELT returned an empty timeline");
  return [series("gdelt", "News articles on Barcelona floods (GDELT)", "articles/day", "GDELT DOC 2.0 API", url, counts)];
}

async function commons() {
  const p = new URLSearchParams({ action: "query", format: "json", generator: "categorymembers", gcmtitle: COMMONS_CAT,
    gcmtype: "file", gcmlimit: "500", prop: "imageinfo", iiprop: "timestamp" });
  const json = await (await get(`https://commons.wikimedia.org/w/api.php?${p}`)).json();
  const counts = {};
  for (const page of Object.values(json.query?.pages ?? {})) {
    const t = page.imageinfo?.[0]?.timestamp?.slice(0, 10); // latest version's upload day
    if (t) counts[t] = (counts[t] ?? 0) + 1;
  }
  return [series("commons", "Files uploaded to Wikimedia Commons, October 2026 Catalonia floods", "files/day",
    "Wikimedia Commons API", `https://commons.wikimedia.org/wiki/${encodeURIComponent(COMMONS_CAT.replaceAll(" ", "_"))}`, counts)];
}

const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")).series ?? [] : [];
const all = [];
for (const [name, fn, prefix] of [["wikipedia", wikipedia, "wikipedia"], ["gdelt", gdelt, "gdelt"], ["commons", commons, "commons"]]) {
  try {
    const got = await fn();
    all.push(...got);
    console.log(`${name}: ${got.length} series`);
  } catch (e) {
    const kept = previous.filter((s) => s.id === prefix || s.id.startsWith(`${prefix}:`));
    all.push(...kept);
    console.error(`${name}: failed (${e.message}); kept ${kept.length} series from the previous file`);
  }
}
const generated_at = new Date().toISOString().slice(0, 16) + "Z";
writeFileSync(OUT, JSON.stringify({ schema: "attention-v1", generated_at, series: all }, null, 1) + "\n");
console.log(`wrote ${OUT}: ${all.length} series, ${days[0]} to ${days.at(-1)}`);

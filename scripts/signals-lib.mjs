// Pure logic for the signals pipeline: no I/O here, so scripts/signals.test.mjs can check it.
// Rules come from the flood-signals design (sections 5 to 7). Nothing in this file calls a model.
import { createHash } from "node:crypto";

// Lowercase, no accents, one space. Used for every match.
export const norm = (s) =>
  String(s ?? "").replace(/[’`]/g, "'").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const stripCase = (s) => String(s ?? "").replace(/[’`]/g, "'").normalize("NFKD").replace(/[̀-ͯ]/g, "");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Health and injury content is dropped before any write or outside call (legal section). Prefix match on purpose.
export const HEALTH = /\b(ferit|ferid|herid|lesionat|lesionad|mort|muert|falleci|ofegat|ofegad|ahogad|desaparegu|desapareci|atrapat|atrapad|rescat|hospitalitz|hospitaliz|ambulanc)/;
export const isHealth = (text) => HEALTH.test(norm(text));

// Relevance flag: orders the review list, never drops an item (signals.mjs writes misses as relevant: false).
// Golden set (vault data/golden_set.csv, 52 snippets): see design section 9 for the measured pass rates.
// "agua" needs a word end so "aguantar" does not match; "negat" too so "negatiu" does not.
export const RELEVANT = /\b(inund|pluj|pluge|plou|pluvi|lluvi|aiguat|aigua|aigues|aguas?\b|aguacero|a?negad|negats?\b|fang|riuad|riad|embass|tempest|tormenta|temporal\b|dana\b|claveguer|alcantarill|esllavissad|desprendiment|insuficiencia drenant|inuncat|riera|torrent)/;
export const isRelevant = (text) => RELEVANT.test(norm(text));

// Keyword mechanism suggestion (vault work/rules_v2.py, first match wins). Measured 0.44 accuracy on the golden set,
// so it is a hint for the reviewer only and is never accepted on its own.
const MECH_RULES = [
  ["aftermath_only", /\bnetej|limpieza|limpian|recuperar les zones|tasques de recuperacio/],
  ["transformer_room", /transformador|apagad|sense llum|sin luz|tall(s)? de llum|corte(s)? de luz|abonats sense|clientes sin/],
  ["slope_runoff", /\briera\b|torrent|\bfang\b|barro|esllavissad|desprendimiento|talus|talud|lodo/],
  ["basement_flooding", /soterrani|garatge|\bbaixos\b|planta baixa|sotano|garaje|\bbajos\b|aparcament|parking/],
  ["street_overflow", /carrer(s)? inundat|calle(s)? inundad|claveguer|alcantarill|embornal|imbornal|aigua als carrers|agua en las calles|desborda/],
];
export const keywordMechanism = (text) => MECH_RULES.find(([, re]) => re.test(norm(text)))?.[0] ?? "unclassified";

// Classifier names -> qa.mjs enum. Anything else is never published as a mechanism.
export const PUBLISH_MECH = { street_overflow: "street_overflow", basement_flooding: "basement", basement: "basement", transformer_room: "transformer_room", slope_runoff: "slope_runoff" };
export const PREVENTIVE = {
  street_overflow: "Keep street drains and gratings clear and avoid low crossings while water is running.",
  basement: "Check that basement and ground-floor entries and drains are clear before the next heavy rain.",
  transformer_room: "Report water near electrical rooms to the utility and keep away from flooded equipment.",
  slope_runoff: "Clear debris and inspect slopes and walls before the next intense rainfall.",
};
const MECH_PHRASE = { street_overflow: "water overflowing onto streets", basement: "water in basements or ground floors", transformer_room: "water in electrical rooms", slope_runoff: "slope runoff" };

// Same page, same key: drop fragment and query, add a trailing slash. A bare "/?p=123" keeps its query (WordPress ids).
export function normUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.pathname === "/" ? u.search : ""}`;
  } catch { return String(url); }
}

export const sha = (s) => createHash("sha256").update(s).digest("hex");
export const signalId = (platform, postIdOrUrl) => sha(postIdOrUrl.startsWith("https://") ? postIdOrUrl : `${platform}:${postIdOrUrl}`).slice(0, 16);

// Allowlist: exact host or a subdomain of it. source_kind comes only from here.
export function allowEntry(url, allowlist) {
  let host;
  try { host = new URL(url).hostname; } catch { return null; }
  if (!String(url).startsWith("https://")) return null;
  const key = Object.keys(allowlist.hosts).find((h) => host === h || host.endsWith(`.${h}`));
  return key ? { host: key, ...allowlist.hosts[key] } : null;
}

// Point in (multi)polygon, even-odd. polys: [[ring, ...], ...]
export function inPolys([x, y], polys) {
  return polys.some((poly) => {
    let inside = false;
    for (const ring of poly) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
}

// Gazetteer resolver (storage section 4, flow section 1). Code only, never a model.
const bare = (s) => norm(s).replace(/^(el |la |els |les |l')/, "");
const RIVERS = new Set(["besos", "llobregat"]); // a river is not a place unless "barri" precedes it
// Names that are also common words: match only when capitalised in the raw text. "salut", "coll", "horta" added here (ASSUMPTION).
const COMMON = new Set(["porta", "clot", "verneda", "salut", "coll", "horta"]);
const VETO = ["bellvitge", "collblanc", "la florida", "santa eulalia", "sant ildefons", "hospitalet", "santa coloma", "sant adria",
  "esplugues", "montcada", "badalona", "cornella", "sabadell", "terrassa"]; // outside Barcelona -> reviewer
const DIST_EXTRA = { "ciutat vella": "01", eixample: "02", sants: "03", montjuic: "03", corts: "04", sarria: "05", "sant gervasi": "05",
  gracia: "06", horta: "07", guinardo: "07", "nou barris": "08", "sant andreu": "09", "sant marti": "10" };

export function makeResolver(gaz) {
  const names = [];
  for (const [code, b] of Object.entries(gaz.barris)) for (const n of [b.name, ...b.aliases]) names.push([bare(n), code]);
  names.sort((a, b) => b[0].length - a[0].length);
  const dists = { ...DIST_EXTRA };
  for (const [code, n] of Object.entries(gaz.districts)) dists[bare(n)] = code;
  // Hyphenated district names ("Horta-Guinardó") contain barri names; they are never a barri, so barri search skips them.
  const compound = Object.values(gaz.districts).map(bare).filter((n) => n.includes("-")).map((n) => new RegExp(`\\b${esc(n)}\\b`, "g"));
  return function resolve(raw) {
    const t = norm(raw), cased = stripCase(raw);
    const tb = compound.reduce((s, re) => s.replace(re, " | "), t);
    if (VETO.some((v) => new RegExp(`\\b${esc(v)}\\b`).test(t))) return { level: "veto", barris: [], districts: [] };
    const ds = [...new Set(Object.entries(dists).filter(([a]) => new RegExp(`\\b${esc(a)}\\b`).test(t)).map(([, d]) => d))].sort();
    const found = new Set();
    for (const [n, code] of names) {
      if (!new RegExp(`\\b${esc(n)}\\b`).test(tb)) continue;
      if (RIVERS.has(n) && !new RegExp(`barri (de |del )?(l'|el |la )?${n}`).test(t)) continue;
      if (COMMON.has(n) && !new RegExp(`\\b${n[0].toUpperCase()}${n.slice(1)}\\b`).test(cased)) continue;
      found.add(code);
    }
    // A list of districts is district precision; barri names in it stay as candidates for the reviewer (live 2026-10-07:
    // a Torre Baró headline whose excerpt lists two other districts).
    if (ds.length >= 2) return { level: "district", barris: [...found].sort(), districts: ds };
    if (found.size === 1) return { level: "barri", barris: [...found], districts: ds };
    if (found.size > 1) return { level: "barri_multi", barris: [...found].sort(), districts: ds };
    if (ds.length) return { level: "district", barris: [], districts: ds };
    return { level: "none", barris: [], districts: [] };
  };
}

// RSS 2.0 items. Text is kept in memory only by the caller.
const decode = (s) => String(s ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&apos;|&#039;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();
export const stripHtml = decode;
export function parseRss(xml) {
  return [...String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)].map(([, body]) => {
    const get = (tag) => decode((body.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`)) ?? [])[1]);
    return { guid: get("guid") || get("link"), link: get("link"), title: get("title"), description: get("description"), pubDate: get("pubDate") };
  });
}

// C5 refresh priority. P_b = sum w_k * x_k,b, every term 0..1, composed in code from barri_priors.json.
// It orders refreshes and review. It is not a risk score and is never shown on a card.
const clamp01 = (x) => Math.max(0, Math.min(1, x));
export function compose({ priors, rain3h, signals6h = {}, staleH = {}, weights, knobs }) {
  return priors.map((b) => {
    const mm = rain3h[b.nearest_station];
    const parts = {
      rain: mm == null ? 1 : clamp01(mm / knobs.rainCapMm3h), // unknown rain -> treat as wet
      exposure: b.exposure,
      signals: clamp01((signals6h[b.c_barri] ?? 0) / knobs.signalCap6h),
      staleness: clamp01((staleH[b.c_barri] ?? knobs.staleCapH) / knobs.staleCapH),
    };
    const score = Object.entries(weights).reduce((s, [k, w]) => s + w * (parts[k] ?? 0), 0);
    return { c_barri: b.c_barri, name: b.name, station: b.nearest_station, score: +score.toFixed(3), parts, dmg: b.damage_t10_per_ha };
  }).sort((a, b) => b.score - a.score || b.dmg - a.dmg || a.c_barri.localeCompare(b.c_barri));
}

// warning: 0..1 when read, null when the read failed (-> storm), undefined when not read (ignored).
export function cadence({ rain3h, warning, anySignal6h, tick, knobs }) {
  const known = Object.values(rain3h).every((v) => v != null) && warning !== null;
  const wet = !known || Object.values(rain3h).some((v) => v > 0) || (warning ?? 0) > 0 || anySignal6h;
  return { mode: wet ? "storm" : "calm", fullRun: wet || tick % knobs.calmEveryNthTick === 0 };
}

// XEMA rows (Socrata nzvn-apee, variable 35, 30-min slots labelled at start, UTC) -> mm in the newest slots per station.
export function rainFromRows(rows, now, stations, knobs) {
  const out = {};
  for (const st of stations) {
    const s = rows.filter((r) => r.codi_estacio === st).sort((a, b) => (a.data_lectura < b.data_lectura ? 1 : -1)).slice(0, knobs.slots3h);
    const ageMin = s[0] ? (now - new Date(s[0].data_lectura.replace(/Z?$/, "Z"))) / 60e3 : Infinity;
    out[st] = s.length < knobs.slots3h || ageMin > knobs.maxSlotAgeMin ? null : +s.reduce((t, r) => t + Number(r.valor_lectura), 0).toFixed(1);
  }
  return out;
}

// ---------- publish (signals-build) ----------

const STATUSES = new Set(["pending", "approved", "rejected", "expired"]);
const PLATFORMS = new Set(["bluesky", "mastodon", "press", "open_data", "manual"]);

// Throws on a malformed row; returns the row's final mechanism (enum) when approved.
export function validateRow(row, { allowlist, gaz }) {
  const bad = (m) => { throw new Error(`inbox row ${row?.signal_id ?? "?"}: ${m}`); };
  if (!/^[0-9a-f]{16}$/.test(row?.signal_id ?? "")) bad("signal_id must be 16 hex");
  if (!STATUSES.has(row.review?.status)) bad("review.status invalid");
  if (row.review.status === "rejected" || row.review.status === "expired") return null; // stubs carry only id and review
  if (!PLATFORMS.has(row.platform)) bad("platform invalid");
  const entry = allowEntry(row.source_url, allowlist);
  if (!entry) bad(`source_url not https or host not on signals/allowlist.json: ${row.source_url}`);
  if (row.source_kind !== entry.kind) bad(`source_kind ${row.source_kind} does not match the allowlist (${entry.kind})`);
  if (!row.source_label) bad("source_label missing");
  if (Number.isNaN(Date.parse(row.published_at))) bad("published_at invalid");
  for (const k of ["text", "title", "handle", "author", "display_name", "media", "excerpt"]) if (k in row) bad(`field ${k} must never be stored`);
  if (row.review.status !== "approved") return null;
  if (!gaz.barris[row.place?.barri]) bad(`approved row needs place.barri as a gazetteer code (got ${row.place?.barri})`);
  const mech = PUBLISH_MECH[row.review.mechanism];
  if (!mech) bad(`approved row needs review.mechanism in ${Object.keys(PUBLISH_MECH).join(", ")}`);
  return mech;
}

const TZ = "Europe/Madrid";
const dayKey = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD local
const fmt = (key, month) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month, year: "numeric" });
const andList = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
function longDays(keys) {
  const sameMonth = keys.every((k) => k.slice(0, 7) === keys[0].slice(0, 7));
  if (!sameMonth) return andList(keys.map((k) => fmt(k, "long")));
  return `${andList(keys.map((k) => String(+k.slice(8))))} ${fmt(keys[0], "long").replace(/^\d+ /, "")}`;
}
const shortRange = (keys) => (keys.length === 1 ? fmt(keys[0], "short")
  : keys[0].slice(0, 7) === keys.at(-1).slice(0, 7) ? `${+keys[0].slice(8)}–${fmt(keys.at(-1), "short")}` : `${fmt(keys[0], "short")} – ${fmt(keys.at(-1), "short")}`);

// Approved, allowlisted rows inside the window -> one feature and one card per barri. Card text is template-only.
export function buildPublished({ rows, gaz, allowlist, zones, now, windowDays, meta }) {
  const proofByUrl = new Map();
  for (const card of Object.values(zones)) {
    if (card.layerType !== "proof") continue;
    for (const url of [card.sourceUrl, ...(card.sources ?? []).map((s) => s.url)]) proofByUrl.set(normUrl(url), card.id);
  }
  const since = now - windowDays * 86400e3;
  const byBarri = new Map(), proofLinks = new Map(), ids = new Set(), urls = new Set();
  for (const row of rows) {
    // A merge that appends the same row twice must not double a card's count: fail loudly, a person deletes one line.
    const mech = validateRow(row, { allowlist, gaz });
    if (ids.has(row.signal_id)) throw new Error(`inbox row ${row.signal_id}: duplicate signal_id, keep one line`);
    ids.add(row.signal_id);
    if (!mech || Date.parse(row.published_at) < since || Date.parse(row.published_at) > now) continue;
    const url = normUrl(row.source_url);
    if (urls.has(url)) continue; // same page under two ids (e.g. with a query string): one report
    urls.add(url);
    const b = row.place.barri;
    if (proofByUrl.has(url)) { // already a hand-curated proof dot: link it, do not duplicate it
      if (!proofLinks.has(b)) proofLinks.set(b, new Set());
      proofLinks.get(b).add(proofByUrl.get(url));
      continue;
    }
    if (!byBarri.has(b)) byBarri.set(b, []);
    byBarri.get(b).push({ ...row, mech });
  }
  const features = [], cards = {};
  for (const [code, list] of [...byBarri].sort(([a], [b]) => a.localeCompare(b))) {
    const g = gaz.barris[code];
    list.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at)); // newest first
    const days = [...new Set(list.map((r) => dayKey(r.published_at)))].sort();
    const counts = {};
    for (const r of list) counts[r.mech] = (counts[r.mech] ?? 0) + 1;
    const mechs = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
    const orgs = [...new Set(list.map((r) => r.source_label))];
    const label = (r) => `${r.source_label}, ${fmt(dayKey(r.published_at), "short")}`;
    const id = `sig-${code}`;
    const name = `${g.name}: reviewed reports, ${shortRange(days)}`;
    const related = [...new Set([...g.zone_ids, ...(proofLinks.get(code) ?? [])])].filter((z) => zones[z]);
    // days: Barcelona-local publication dates of the approved rows behind this dot, for the app's day filter.
    features.push({ type: "Feature", geometry: { type: "Point", coordinates: g.label }, properties: { id, name, layer: "signals", tappable: true, days } });
    cards[id] = {
      id,
      name,
      layerIds: ["signals"],
      layerType: "proof",
      mechanisms: ["observed_impact", ...mechs],
      whatCouldFail: `On ${longDays(days)}, ${list.length} reviewed report${list.length === 1 ? "" : "s"} from ${andList(orgs)} described ${andList(mechs.map((m) => MECH_PHRASE[m]))} in ${g.name}. Linked reports, not a measurement of depth or damage.`,
      preventiveAction: PREVENTIVE[mechs[0]],
      sourceLabel: label(list[0]),
      sourceUrl: list[0].source_url,
      ...(list.length > 1 ? { sources: list.slice(1, 6).map((r) => ({ label: label(r), url: r.source_url })) } : {}),
      ...(related.length ? { relatedZoneIds: related } : {}),
      geometryNote: "Barri label point, not the place of each report.",
    };
  }
  return { geojson: { type: "FeatureCollection", meta, features }, cards };
}

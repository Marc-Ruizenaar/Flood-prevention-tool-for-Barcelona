// Bluesky rain chatter pulse: citywide counts of public posts per hour, written to data/pulse.json.
// It tells us when people are talking about rain in Barcelona, not where it floods (vault signals/backtest.md point 5).
// Off unless signals/pulse.json says enabled, or --force for a test run.
// Post text, authors, handles, DIDs and links live in memory for one request and are never written.
// Kept: hourly counts per word group. Sums under minCount are written as null. Notice: public/data-notice.html.
//
//   npm run pulse                          one run, writes data/pulse.json
//   npm run pulse -- --force               run even though signals/pulse.json has enabled: false
//   npm run pulse -- --force --until 2026-10-08T00:00Z --hours 120   replay a past window (here 3 to 7 Oct)
//   npm run pulse -- --optout <handle|did> exclude an account: stores a one-way hash of its DID, nothing else
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { isHealth } from "./signals-lib.mjs";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const cfg = read("signals/pulse.json");
const OPTOUT = "signals/pulse-optout.json";
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const API = "https://api.bsky.app/xrpc";
const HOUR = 3600e3;
const hash = (did) => createHash("sha256").update(did).digest("hex");
const iso = (t) => new Date(t).toISOString().slice(0, 16) + "Z";

async function get(path) {
  const res = await fetch(`${API}/${path}`, { headers: { "User-Agent": cfg.userAgent }, signal: AbortSignal.timeout(15e3) });
  if (!res.ok) throw new Error(`${res.status} ${path.split("?")[0]}`); // no query string in errors: it holds search words only, but keep logs short
  return res.json();
}

if (opt("optout")) {
  const who = opt("optout");
  const did = who.startsWith("did:") ? who : (await get(`com.atproto.identity.resolveHandle?handle=${encodeURIComponent(who.replace(/^@/, ""))}`)).did;
  const list = read(OPTOUT);
  if (!list.did_sha256.includes(hash(did))) list.did_sha256.push(hash(did));
  writeFileSync(OPTOUT, JSON.stringify(list, null, 1) + "\n");
  console.log(`opted out: ${list.did_sha256.length} hash(es) stored, no handle or DID`);
  process.exit(0);
}
if (!cfg.enabled && !args.includes("--force")) {
  console.log("pulse is off (signals/pulse.json enabled: false). Use --force for a test run.");
  process.exit(0);
}

const optedOut = new Set(read(OPTOUT).did_sha256);
const until = opt("until") ? Date.parse(opt("until")) : null;
if (until !== null && Number.isNaN(until)) throw new Error("--until needs an ISO time, e.g. 2026-10-08T00:00Z");
const span = Number(opt("hours") ?? cfg.hours);
if (!Number.isInteger(span) || span < 1 || span > 240) throw new Error("--hours must be a whole number from 1 to 240");
// Default: the current, partial hour is the last bucket. A replay ends at --until.
const end = until !== null ? Math.ceil(until / HOUR) * HOUR : Math.floor(Date.now() / HOUR) * HOUR + HOUR;
const hours = Array.from({ length: span }, (_, i) => end - (span - i) * HOUR);
const raw = {}, capped = new Set();
let dropped = 0;
for (const [group, queries] of Object.entries(cfg.groups)) {
  raw[group] = [];
  for (const h of hours) {
    const seen = new Set(); // post ids for one hour and one group, in memory only
    for (const q of queries) {
      const params = new URLSearchParams({ q, sort: "latest", since: new Date(h).toISOString(), until: new Date(h + HOUR).toISOString(), limit: "100" });
      const { posts = [] } = await get(`app.bsky.feed.searchPosts?${params}`);
      if (until !== null) await new Promise((r) => setTimeout(r, 150)); // a replay makes many calls: keep it gentle
      // ponytail: one page per hour per word (unauthenticated paging returns 403), so a busy hour is a lower bound
      if (posts.length >= 100) capped.add(group);
      for (const p of posts) {
        if (seen.has(p.uri)) continue;
        if (optedOut.has(hash(p.author?.did ?? "")) || isHealth(p.record?.text ?? "")) { dropped++; continue; }
        seen.add(p.uri);
      }
    }
    raw[group].push(seen.size);
  }
}

// Small counts are suppressed. last3h sums the shown values only, so it cannot be differenced back to a hidden hour.
const shown = (n) => (n === 0 ? 0 : n < cfg.minCount ? null : n);
// A window with posts only in hidden hours reads "fewer than minCount" (null), never 0.
const window3h = (vals) => {
  const sum = vals.map(shown).reduce((t, n) => t + (n ?? 0), 0);
  return sum === 0 && vals.some((n) => n > 0) ? null : shown(sum);
};
const last3h = Object.fromEntries(Object.keys(raw).map((g) => [g, window3h(raw[g].slice(-3))]));
const rain = last3h.rain ?? 0;
const out = {
  schema: "pulse-v1",
  generated_at: iso(Date.now()),
  source: "Bluesky public search (api.bsky.app)",
  scope: "Barcelona, citywide. Counts only: no post text, author, handle or link is kept.",
  min_count: cfg.minCount,
  groups: cfg.groups,
  hours: hours.map((h, i) => ({ hour: iso(h), ...Object.fromEntries(Object.keys(raw).map((g) => [g, shown(raw[g][i])])) })),
  last3h,
  level: rain >= cfg.highAt ? "high" : rain >= cfg.minCount ? "normal" : "quiet",
  level_rule: `high when rain posts in the last 3 h reach ${cfg.highAt} (ASSUMPTION, untested threshold)`,
  capped: [...capped],
  notice: "data-notice.html",
  ...(until !== null ? { replay: true, window: { from: iso(hours[0]), to: iso(end) } } : {}),
};
const text = JSON.stringify(out, null, 1) + "\n";
// Last line of defence: nothing that points at a person may reach the file.
if (/did:|at:\/\/|bsky\.app\/profile|\.bsky\.social/.test(text)) throw new Error("pulse output holds an account reference; not written");
writeFileSync("data/pulse.json", text);
console.log(`pulse: ${out.level}, last 3 h ${JSON.stringify(last3h)}, ${hours.length} h x ${Object.keys(raw).length} groups, ${dropped} dropped (opt-out or health)${capped.size ? `, capped: ${[...capped]}` : ""}`);

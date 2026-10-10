import { locale, t } from "../lib/i18n";
import { useEffect, useState } from "react";
import { formatMm, peakOf, RAIN_SOURCE_URL, type Gauge } from "../lib/rain";
import { formatDay, shortDay, type DayWeather } from "../lib/weather";
import type { ZoneMap } from "../types";

type Props = {
  day: string;
  days: DayWeather[];
  gauges: Record<string, Gauge>;
  rainLive: boolean | null;
  zones: ZoneMap;
  onSelectDay: (date: string) => void;
  onOpenReport: (id: string) => void;
  onClose: () => void;
};

export function WeatherPanel({
  day,
  days,
  gauges,
  rainLive,
  zones,
  onSelectDay,
  onOpenReport,
  onClose,
}: Props) {
  return (
    <div className="about-backdrop" onClick={onClose} role="presentation">
      <article
        className="about weather"
        role="dialog"
        aria-labelledby="weather-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sheet-bar">
          <h2 id="weather-title">{t("2–3 October")}</h2>
          <button type="button" className="close" onClick={onClose}>
            {t("Close")}
          </button>
        </header>
        <div className="sheet-body">
          <p>
            {t("Each day is looked up in Meteocat’s daily station file, at el Raval, Fabra and Zona Universitària. Street depth is the flood model, not these station totals.")}
            {rainLive === false ? t(" The live file did not load, so this is the saved copy.") : ""}
          </p>
          <RainPulse day={day} />
          <Attention day={day} />
          <ol className="day-list">
            {days.map((entry) => {
              const reports = entry.reportIds.filter((id) => zones[id]);
              const gauge = gauges[entry.date];
              const peak = peakOf(gauge);
              return (
                <li key={entry.date}>
                  <button
                    type="button"
                    className="day-row"
                    aria-pressed={entry.date === day}
                    onClick={() => onSelectDay(entry.date)}
                  >
                    <span className="day-kicker">
                      {shortDay(entry.date)} · {entry.stance === "measured" ? t("Measured") : t("Outlook")}
                    </span>
                    <span className="day-title">{formatDay(entry.date)}</span>
                    <span className="day-condition">{entry.condition}</span>
                    {peak && gauge ? (
                      <span className="day-reading">
                        <strong>{t("{mm} mm at {name}", { mm: formatMm(peak.mm), name: peak.name })}</strong>
                        <span>
                          el Raval {formatMm(gauge.raval)} · Fabra {formatMm(gauge.fabra)} · Zona
                          Universitària {formatMm(gauge.universitaria)}
                        </span>
                      </span>
                    ) : entry.reading ? (
                      <span className="day-reading">
                        <strong>{entry.reading.value}</strong>
                        <span>{entry.reading.detail}</span>
                      </span>
                    ) : null}
                    <span className="day-summary">{entry.summary}</span>
                  </button>
                  <ul className="day-meta">
                    {uniqueBy(
                      [
                        ...(gauge ? [{ label: t("Meteocat XEMA daily rainfall"), url: RAIN_SOURCE_URL }] : []),
                        ...entry.sources,
                      ],
                      (source) => source.url,
                    ).map((source) => (
                      <li key={source.url}>
                        <a href={source.url} target="_blank" rel="noopener noreferrer">
                          {source.label}
                        </a>
                      </li>
                    ))}
                    {uniqueBy(reports, (id) => id).map((id) => (
                      <li key={id}>
                        <button type="button" className="day-report" onClick={() => onOpenReport(id)}>
                          {zones[id].name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
        </div>
      </article>
    </div>
  );
}

// Keeps the first item per key, so a source or report listed twice renders once.
function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(key(item)) ? false : (seen.add(key(item)), true)));
}

type PulseCount = number | null;

type Pulse = {
  schema: "pulse-v1";
  generated_at: string;
  min_count: number;
  hours: { hour: string; rain: PulseCount; flood?: PulseCount }[];
  last3h: { rain: PulseCount };
  replay?: boolean;
  level: "quiet" | "normal" | "high";
  capped: string[];
};

const PULSE_LEVELS: Record<Pulse["level"], string> = { quiet: "Quiet", normal: "Normal", high: "High" };

const pulseTime = new Intl.DateTimeFormat(locale, {
  timeZone: "Europe/Madrid",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const pulseHour = new Intl.DateTimeFormat(locale, {
  timeZone: "Europe/Madrid",
  hour: "2-digit",
  minute: "2-digit",
});

function isPulse(value: unknown): value is Pulse {
  const pulse = value as Pulse | null;
  return (
    !!pulse &&
    pulse.schema === "pulse-v1" &&
    pulse.level in PULSE_LEVELS &&
    Array.isArray(pulse.hours) &&
    Array.isArray(pulse.capped) &&
    typeof pulse.last3h === "object" &&
    pulse.last3h !== null
  );
}

const shortDayOf = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });
const madridDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });

// Sum of shown hours; hidden hours (under min_count) make it a lower bound.
function daySum(values: PulseCount[]): { total: number; partial: boolean } {
  return { total: values.reduce<number>((t, v) => t + (v ?? 0), 0), partial: values.some((v) => v === null) };
}

function RainPulse({ day }: { day: string }) {
  const [pulse, setPulse] = useState<Pulse | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/data/pulse.json")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: unknown) => {
        if (live && isPulse(data)) setPulse(data);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  if (!pulse) return null;

  const min = pulse.min_count ?? 5;
  const rain = pulse.last3h.rain;
  const atLeast = pulse.capped.includes("rain") ? t(" (at least)") : "";
  const count = typeof rain === "number" ? `${rain}${atLeast}` : t("fewer than {min}", { min });
  const generated = new Date(pulse.generated_at);
  // A file that covers the selected day (a replay) shows that day; otherwise the latest hours.
  const ofDay = pulse.hours.filter((entry) => madridDate(entry.hour) === day);
  const hours = ofDay.length > 0 ? ofDay : pulse.hours.slice(-24);
  const rainDay = daySum(ofDay.map((entry) => entry.rain));
  const floodDay = daySum(ofDay.map((entry) => (entry.flood === undefined ? 0 : entry.flood)));
  // Hidden hours hold 1 to 4 posts each, so a day with only hidden hours had "a few", not 0.
  const says = (sum: { total: number; partial: boolean }) =>
    sum.partial ? (sum.total === 0 ? t("a few") : t("at least {n}", { n: sum.total })) : `${sum.total}`;
  const byDay = new Map<string, PulseCount[]>();
  for (const entry of pulse.hours) byDay.set(madridDate(entry.hour), [...(byDay.get(madridDate(entry.hour)) ?? []), entry.rain]);
  const weekLine = [...byDay]
    .map(([d, values]) => `${shortDayOf(d)} ${says(daySum(values))}`)
    .join(", ");
  const peak = Math.max(1, ...hours.map((entry) => entry.rain ?? 0));
  const hidden = hours.filter((entry) => entry.rain === null).length;
  const cellLabel = (entry: { hour: string; rain: PulseCount }) => {
    const at = pulseHour.format(new Date(entry.hour));
    return entry.rain === null ? t("{at}: under {min}", { at, min }) : `${at}: ${entry.rain}`;
  };

  return (
    <section className="pulse">
      <h3>{t("Rain chatter on Bluesky")}</h3>
      {pulse.replay ? (
        <p className="geometry-note">{t("Rain posts per day in the replay: {days}.", { days: weekLine })}</p>
      ) : null}
      {ofDay.length > 0 ? (
        <p>
          <strong>{pulse.replay ? t("Replay") : t("This day")}:</strong>{" "}
          {t("{rain} posts mentioning rain and {flood} mentioning flooding in Barcelona, over {hours} hours.", {
            rain: says(rainDay),
            flood: says(floodDay),
            hours: ofDay.length,
          })}
        </p>
      ) : (
        <p>
          <strong>{t(PULSE_LEVELS[pulse.level])}:</strong>{" "}
          {rain === 1
            ? t("{count} post mentioning rain in Barcelona in the last 3 hours.", { count })
            : t("{count} posts mentioning rain in Barcelona in the last 3 hours.", { count })}
        </p>
      )}
      {hours.length > 0 ? (
        <div
          className="pulse-bars"
          role="img"
          aria-label={t("Rain posts per hour, last {hours} hours. Highest {peak}. {hidden} hours under {min}, not shown.", {
            hours: hours.length,
            peak: `${peak}${atLeast}`,
            hidden,
            min,
          })}
        >
          {hours.map((entry) => (
            <span
              key={entry.hour}
              className={entry.rain === null ? "pulse-cell is-hidden" : "pulse-cell"}
              title={cellLabel(entry)}
            >
              {entry.rain !== null ? (
                <span style={{ height: `${Math.max(entry.rain > 0 ? 8 : 0, (entry.rain / peak) * 100)}%` }} />
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
      <p className="geometry-note">
        {t("Citywide only. Counts, never posts or people. It says when, not where.")}
        {Number.isNaN(generated.getTime()) ? "" : t(" Updated {time}.", { time: pulseTime.format(generated) })}
        {hours.length > 0 ? t(" Bars: one per hour, hatched means under {min}.", { min }) : ""}{" "}
        <a href="/data-notice.html">{t("How this is counted")}</a>
      </p>
    </section>
  );
}

type AttentionSeries = { id: string; label: string; unit: string; source: string; source_url: string; points: { t: string; v: number }[] };

// Open, anonymous-by-design attention signals (scripts/attention.mjs): one line per series for the selected day.
function Attention({ day }: { day: string }) {
  const [series, setSeries] = useState<AttentionSeries[]>([]);

  useEffect(() => {
    let live = true;
    fetch("/data/attention.json")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { schema?: string; series?: AttentionSeries[] } | null) => {
        if (live && data?.schema === "attention-v1" && Array.isArray(data.series)) setSeries(data.series);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  // Totals only (ids without a colon); per-article series stay in the file for anyone checking the sum.
  const lines = series.filter((s) => !s.id.includes(":")).flatMap((s) => {
    // Hourly points are summed per local day so every series compares days.
    const byDay = new Map<string, number>();
    for (const p of s.points) {
      const key = p.t.length > 10 ? madridDate(p.t) : p.t;
      byDay.set(key, (byDay.get(key) ?? 0) + p.v);
    }
    const value = byDay.get(day);
    if (value === undefined) return [];
    const others = [...byDay].filter(([k]) => k !== day).map(([, v]) => v).sort((a, b) => a - b);
    const median = others.length ? others[Math.floor(others.length / 2)] : 0;
    const ratio = median > 0 ? t(" ({ratio}x a normal day)", { ratio: (value / median).toFixed(1) }) : "";
    const [peakDay, peakValue] = [...byDay].sort((a, b) => b[1] - a[1])[0];
    const peak =
      peakDay === day ? "" : t("; peak {day}, {value}", { day: shortDayOf(peakDay), value: peakValue.toLocaleString(locale) });
    return [{ s, text: `${value.toLocaleString(locale)}${ratio}${peak}` }];
  });
  if (lines.length === 0) return null;

  return (
    <section className="pulse">
      <h3>{t("Public attention")}</h3>
      <ul className="day-meta">
        {lines.map(({ s, text }) => (
          <li key={s.id}>
            {t(s.label)}: {text}.{" "}
            <a href={s.source_url} target="_blank" rel="noreferrer">
              {t(s.source)}
            </a>
          </li>
        ))}
      </ul>
      <p className="geometry-note">{t("Counts of page views and uploads. No person is counted.")}</p>
    </section>
  );
}

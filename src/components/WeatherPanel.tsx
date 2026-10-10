import { useEffect, useState } from "react";
import { readFlooding, STATION_LIST_URL, type FloodReading } from "../lib/flooding";
import { formatMm, peakOf, RAIN_SOURCE_URL, type Gauge } from "../lib/rain";
import { formatDay, shortDay, type DayWeather } from "../lib/weather";
import type { ReliefFile, ZoneMap } from "../types";

type Props = {
  past: boolean;
  day: string;
  days: DayWeather[];
  gauges: Record<string, Gauge>;
  rainLive: boolean | null;
  zones: ZoneMap;
  relief: ReliefFile | null;
  onSelectDay: (date: string) => void;
  onOpenReport: (id: string) => void;
  onClose: () => void;
};

export function WeatherPanel({
  past,
  day,
  days,
  gauges,
  rainLive,
  zones,
  relief,
  onSelectDay,
  onOpenReport,
  onClose,
}: Props) {
  const reading: FloodReading | null = relief
    ? readFlooding({ day, gauges, zones, relief })
    : null;
  return (
    <div className="about-backdrop" onClick={onClose} role="presentation">
      <article
        className="about weather"
        role="dialog"
        aria-labelledby="weather-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sheet-bar">
          <h2 id="weather-title">{past ? "3–7 October" : "5–11 October"}</h2>
          <button type="button" className="close" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="sheet-body">
          <p>
            Each day is looked up in Meteocat’s daily station file. The map uses the highest of el Raval,
            Fabra and Zona Universitària. Under 10 mm the flood spots stay off. From 10 mm, sewers. From
            40 mm, slopes. From 100 mm, buried streams.
            {rainLive === false ? " The live file did not load, so this is the saved copy." : ""}
          </p>
          {reading ? (
            <section className="flood-reading">
              <h3>Possible flooding</h3>
              <p>{reading.summary}</p>
              {reading.places.length > 0 ? (
                <ul className="flood-list">
                  {reading.places.map((place) => (
                    <li key={place.id}>
                      <button type="button" className="flood-place" onClick={() => onOpenReport(place.id)}>
                        <strong>{place.name}</strong>
                        <span>{place.why}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {reading.held.length > 0 ? (
                <ul className="flood-held">
                  {reading.held.map((place) => (
                    <li key={place.id}>
                      <button type="button" className="day-report" onClick={() => onOpenReport(place.id)}>
                        {place.name}
                      </button>
                      <span>{place.why}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="geometry-note">
                <a href={STATION_LIST_URL} target="_blank" rel="noopener noreferrer">
                  Meteocat station list
                </a>
                . Not a depth, and not a place outside the published layers.
              </p>
            </section>
          ) : null}
          <RainPulse day={day} />
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
                      {shortDay(entry.date)} · {entry.stance === "measured" ? "Measured" : "Outlook"}
                    </span>
                    <span className="day-title">{formatDay(entry.date)}</span>
                    <span className="day-condition">{entry.condition}</span>
                    {peak && gauge ? (
                      <span className="day-reading">
                        <strong>
                          {formatMm(peak.mm)} mm at {peak.name}
                        </strong>
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
                    {gauge ? (
                      <li key="xema">
                        <a href={RAIN_SOURCE_URL} target="_blank" rel="noopener noreferrer">
                          Meteocat XEMA daily rainfall
                        </a>
                      </li>
                    ) : null}
                    {entry.sources.map((source) => (
                      <li key={source.url}>
                        <a href={source.url} target="_blank" rel="noopener noreferrer">
                          {source.label}
                        </a>
                      </li>
                    ))}
                    {reports.map((id) => (
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

const pulseTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const pulseHour = new Intl.DateTimeFormat("en-GB", {
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
  const atLeast = pulse.capped.includes("rain") ? " (at least)" : "";
  const count = typeof rain === "number" ? `${rain}${atLeast}` : `fewer than ${min}`;
  const noun = rain === 1 ? "post" : "posts";
  const generated = new Date(pulse.generated_at);
  // A file that covers the selected day (a replay) shows that day; otherwise the latest hours.
  const ofDay = pulse.hours.filter((entry) => madridDate(entry.hour) === day);
  const hours = ofDay.length > 0 ? ofDay : pulse.hours.slice(-24);
  const rainDay = daySum(ofDay.map((entry) => entry.rain));
  const floodDay = daySum(ofDay.map((entry) => entry.flood ?? 0));
  const says = (sum: { total: number; partial: boolean }) => (sum.partial ? `at least ${sum.total}` : `${sum.total}`);
  const peak = Math.max(1, ...hours.map((entry) => entry.rain ?? 0));
  const hidden = hours.filter((entry) => entry.rain === null).length;
  const cellLabel = (entry: { hour: string; rain: PulseCount }) => {
    const at = pulseHour.format(new Date(entry.hour));
    return entry.rain === null ? `${at}: under ${min}` : `${at}: ${entry.rain}`;
  };

  return (
    <section className="pulse">
      <h3>Rain chatter on Bluesky</h3>
      {ofDay.length > 0 ? (
        <p>
          <strong>{pulse.replay ? "Replay" : "This day"}:</strong> {says(rainDay)} posts mentioning rain and{" "}
          {says(floodDay)} mentioning flooding in Barcelona, over {ofDay.length} hours.
        </p>
      ) : (
        <p>
          <strong>{PULSE_LEVELS[pulse.level]}:</strong> {count} {noun} mentioning rain in Barcelona in the last
          3 hours.
        </p>
      )}
      {hours.length > 0 ? (
        <div
          className="pulse-bars"
          role="img"
          aria-label={`Rain posts per hour, last ${hours.length} hours. Highest ${peak}${atLeast}. ${hidden} ${
            hidden === 1 ? "hour" : "hours"
          } under ${min}, not shown.`}
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
        Citywide only. Counts, never posts or people. It says when, not where.
        {Number.isNaN(generated.getTime()) ? "" : ` Updated ${pulseTime.format(generated)}.`}
        {hours.length > 0 ? ` Bars: one per hour, hatched means under ${min}.` : ""}{" "}
        <a href="/data-notice.html">How this is counted</a>
      </p>
    </section>
  );
}

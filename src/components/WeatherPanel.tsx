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

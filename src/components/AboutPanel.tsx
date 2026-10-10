import type { SourceEntry } from "../lib/data";

type Props = {
  sources: Record<string, SourceEntry>;
  onClose: () => void;
};

const RETIRED_SOURCES = new Set([
  "sewer-t10-stress",
  "resccue-hotspots",
  "buried-streams",
  "retention-tanks",
  "slopes-torrents",
]);

export function AboutPanel({ sources, onClose }: Props) {
  const entries = Object.entries(sources)
    .filter(([id]) => !RETIRED_SOURCES.has(id))
    .map(([, entry]) => entry);
  return (
    <div className="about-backdrop" onClick={onClose} role="presentation">
      <article
        className="about"
        role="dialog"
        aria-labelledby="about-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sheet-bar">
          <h2 id="about-title">About this map</h2>
          <button type="button" className="close" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="sheet-body">
          <p>
            Street flooding on this map comes from the neighbourhood flood model, for the days that were
            simulated. Black dots are impacts reported after the October rains.
          </p>
          <p>
            River flood (ACA, T100) and coastal flood sit in other plans. This storm’s geography, and
            this tool, is pluvial drainage plus the Collserola edge.
          </p>
          <p>
            The city is a slope, from Collserola down to the sea. The brown contour lines trace
            ground height from the ICGC 5 m terrain model. Every card reads the height and the fall at
            that place from the finer 2022 lidar model. A steep fall sheds rain
            as runoff. A level street holds it in the drains. The number is ground height, not a flood
            depth.
          </p>
          <section>
            <h3>What was measured</h3>
            <p>
              The city reported that 3 October 2026 was the rainiest day in Barcelona’s record, with a
              maximum of 206 litres per square metre and a citywide mean of 152.3. That figure is an
              observation, quoted here, and it is not a layer on the map.{" "}
              <a
                href="https://ajuntament.barcelona.cat/gracia/es/noticias/activada-la-emergencia-por-riesgo-de-inundaciones-41745"
                target="_blank"
                rel="noopener noreferrer"
              >
                Distrito de Gràcia, Ajuntament de Barcelona
              </a>
            </p>
          </section>
          <section>
            <h3>Sources by layer</h3>
            <ul className="about-sources">
              {entries.map((entry) => (
                <li key={entry.primary}>
                  <a href={entry.primary} target="_blank" rel="noopener noreferrer">
                    {entry.label}
                  </a>
                  {entry.note ? <span>{entry.note}</span> : null}
                </li>
              ))}
            </ul>
          </section>
          <p className="geometry-note">
            Every tappable place has a source link. Weather looks up each day in the Meteocat station
            file, at el Raval, Fabra and Zona Universitària. The map covers 2–3 October only.
          </p>
        </div>
      </article>
    </div>
  );
}

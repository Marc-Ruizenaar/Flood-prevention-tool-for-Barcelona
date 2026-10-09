import type { SourceEntry } from "../lib/data";

type Props = {
  sources: Record<string, SourceEntry>;
  onClose: () => void;
};

export function AboutPanel({ sources, onClose }: Props) {
  const entries = Object.values(sources);
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
            A briefing map of where the next heavy rain is already described in Barcelona’s published
            layers: sewer stress, buried streams, and slopes. It does not predict a storm, a depth, or
            a cost.
          </p>
          <p>
            River flood (ACA, T100) and coastal flood sit in other plans. This storm’s geography, and
            this tool, is pluvial drainage plus the Collserola edge.
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
            Every tappable place has a source link. Outlines are simplified traces for a phone briefing,
            not official flood contours. The October proof stays off until you turn it on.
          </p>
        </div>
      </article>
    </div>
  );
}

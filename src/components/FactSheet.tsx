import { RELIEF_BAND_LABEL, reliefBand, reliefCopy } from "../lib/relief";
import {
  MECHANISM_LABEL,
  groupForZone,
  type ReliefReading,
  type ZoneCard,
  type ZoneMap,
} from "../types";

type Props = {
  zone: ZoneCard;
  zones: ZoneMap;
  relief: ReliefReading | undefined;
  reliefSourceUrl: string | undefined;
  onClose: () => void;
  onOpen: (id: string) => void;
};

export function FactSheet({ zone, zones, relief, reliefSourceUrl, onClose, onOpen }: Props) {
  const mitigation = zone.mechanisms.includes("mitigation") && zone.layerType !== "proof";
  const related = (zone.relatedZoneIds ?? []).filter((id) => zones[id]);
  const band = relief ? reliefBand(relief) : null;

  return (
    <article className="sheet" role="dialog" aria-labelledby="sheet-title">
      <header className="sheet-bar">
        <span className="handle" aria-hidden="true" />
        <button type="button" className="close" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="sheet-body">
        <div className="chips">
          {zone.layerType === "proof" ? <span className="chip chip-observed">Observed</span> : null}
          {relief && band ? (
            <span className="chip chip-ground">
              {relief.meters} m · {RELIEF_BAND_LABEL[band]}
            </span>
          ) : null}
          {zone.atlasTerm ? <span className="chip">{zone.atlasTerm}</span> : null}
          {zone.mechanisms.map((mechanism) => (
            <span key={mechanism} className="chip chip-quiet">
              {MECHANISM_LABEL[mechanism]}
            </span>
          ))}
        </div>
        <h2 id="sheet-title">{zone.name}</h2>
        {zone.geometryNote ? <p className="geometry-note">{zone.geometryNote}</p> : null}

        {relief ? (
          <section>
            <h3>The ground</h3>
            <p>{reliefCopy(relief, mitigation)}</p>
            <p className="geometry-note">
              {relief.meters} m at the marked place, and the drop to the lowest ground {relief.spanMeters} m
              away. ICGC terrain model, 2022. Not a flood depth.
              {reliefSourceUrl ? (
                <>
                  {" "}
                  <a href={reliefSourceUrl} target="_blank" rel="noopener noreferrer">
                    ICGC territorial elevations
                  </a>
                </>
              ) : null}
            </p>
          </section>
        ) : null}

        <section>
          <h3>{mitigation ? "What it changes" : "What could fail"}</h3>
          <p>{zone.whatCouldFail}</p>
        </section>
        <section>
          <h3>One action</h3>
          <p>{zone.preventiveAction}</p>
        </section>
        <section>
          <h3>Source</h3>
          <p>
            <a href={zone.sourceUrl} target="_blank" rel="noopener noreferrer">
              {zone.sourceLabel}
            </a>
          </p>
          {zone.sources?.length ? (
            <ul className="source-list">
              {zone.sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noopener noreferrer">
                    {source.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
        {related.length ? (
          <section>
            <h3>Also see</h3>
            <div className="related">
              {related.map((id) => {
                const other = zones[id];
                const proof = other.layerType === "proof";
                return (
                  <button key={id} type="button" className="related-btn" onClick={() => onOpen(id)}>
                    {other.name}
                    {proof ? <span>Observed</span> : null}
                    {!proof && groupForZone(other) !== groupForZone(zone) ? <span>Other layer</span> : null}
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </article>
  );
}

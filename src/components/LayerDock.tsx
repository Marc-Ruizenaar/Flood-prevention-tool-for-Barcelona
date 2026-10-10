import type { FloodReading } from "../lib/flooding";
import { atlasLocked, formatMm } from "../lib/rain";
import type { GroupId, LayerGroup } from "../types";
import { GROUPS } from "../types";
const GROUP_FILES: Record<GroupId, string[]> = {
  relief: ["relief"],
  sewers: ["sewer-t10-stress", "resccue-hotspots"],
  streams: ["buried-streams", "retention-tanks"],
  slopes: ["slopes-torrents"],
  proof: ["proof-oct2026"],
};

type Props = {
  visibility: Record<GroupId, boolean>;
  failed: string[];
  dayLabel: string;
  mm: number | null;
  hasReports: boolean;
  proofLegend?: string;
  reading: FloodReading | null;
  onToggle: (id: GroupId) => void;
  onBlindSpot: () => void;
  onOpenPlace: (id: string) => void;
};

function Swatch({ color, shape }: LayerGroup["swatches"][number]) {
  return <span className={`swatch swatch-${shape}`} style={{ background: color }} />;
}

export function LayerDock({
  visibility,
  failed,
  dayLabel,
  mm,
  hasReports,
  proofLegend,
  reading,
  onToggle,
  onBlindSpot,
  onOpenPlace,
}: Props) {
  return (
    <aside className="dock">
      <div className="dock-scroll">
        {reading ? (
          <section className="reading" aria-label="Possible flooding">
            <p className="layer-name">Possible flooding</p>
            <p className="layer-legend">{reading.summary}</p>
            {reading.places.length > 0 ? (
              <ul className="reading-places">
                {reading.places.slice(0, 4).map((place) => (
                  <li key={place.id}>
                    <button type="button" onClick={() => onOpenPlace(place.id)}>
                      {place.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
        {GROUPS.map((group) => {
          const missing = GROUP_FILES[group.id].filter((file) => failed.includes(file));
          const unavailable = missing.length === GROUP_FILES[group.id].length;
          const locked =
            (group.id === "sewers" || group.id === "streams" || group.id === "slopes") && atlasLocked(mm)
              ? true
              : group.id === "proof" && !hasReports && atlasLocked(mm);
          return (
            <button
              key={group.id}
              type="button"
              className={`layer-toggle${group.id === "relief" ? " layer-wide" : ""}${visibility[group.id] ? " is-on" : ""}`}
              aria-pressed={visibility[group.id]}
              disabled={unavailable || locked}
              onClick={() => onToggle(group.id)}
            >
              <span className="swatches">
                {group.swatches.map((swatch) => (
                  <Swatch key={swatch.color} {...swatch} />
                ))}
              </span>
              <span className="layer-copy">
                <span className="layer-name">{group.label}</span>
                <span className="layer-legend">
                  {unavailable
                    ? "This layer did not load."
                    : locked
                      ? mm == null
                        ? `Off on ${dayLabel}. No daily total published yet.`
                        : `Off on ${dayLabel}. ${formatMm(mm)} mm is under 10, so this stays hidden.`
                      : group.id === "streams" && !visibility.streams && mm != null && mm < 100
                        ? `${formatMm(mm)} mm at the highest station. Buried streams come on from 100 mm.`
                        : group.id === "slopes" && !visibility.slopes && mm != null && mm < 40
                          ? `${formatMm(mm)} mm at the highest station. Slopes come on from 40 mm.`
                      : group.id === "proof"
                        ? (proofLegend ?? `Reports dated ${dayLabel} only.`)
                        : group.legend}
                  {missing.length > 0 && !unavailable ? " Part of this layer did not load." : ""}
                </span>
              </span>
            </button>
          );
        })}
        <button type="button" className="blind-spot" onClick={onBlindSpot} disabled={atlasLocked(mm)}>
          <span className="layer-name">Blind spot</span>
          <span className="layer-legend">
            {atlasLocked(mm)
              ? `Off on ${dayLabel}. Under 10 mm there is no flood map to compare.`
              : "Hide sewers. Show slopes and the October proof."}
          </span>
        </button>
      </div>
    </aside>
  );
}

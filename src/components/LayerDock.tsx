import type { GroupId, LayerGroup } from "../types";
import { GROUPS } from "../types";
import type { GeoFile } from "../lib/data";

const GROUP_FILES: Record<GroupId, GeoFile[]> = {
  sewers: ["sewer-t10-stress", "resccue-hotspots"],
  streams: ["buried-streams", "retention-tanks"],
  slopes: ["slopes-torrents"],
  proof: ["proof-oct2026", "signals"],
};

type Props = {
  visibility: Record<GroupId, boolean>;
  failed: string[];
  onToggle: (id: GroupId) => void;
  onBlindSpot: () => void;
};

function Swatch({ color, shape }: LayerGroup["swatches"][number]) {
  return <span className={`swatch swatch-${shape}`} style={{ background: color }} />;
}

export function LayerDock({ visibility, failed, onToggle, onBlindSpot }: Props) {
  return (
    <aside className="dock">
      <div className="dock-scroll">
        {GROUPS.map((group) => {
          const missing = GROUP_FILES[group.id].filter((file) => failed.includes(file));
          const unavailable = missing.length === GROUP_FILES[group.id].length;
          return (
            <button
              key={group.id}
              type="button"
              className={`layer-toggle${visibility[group.id] ? " is-on" : ""}`}
              aria-pressed={visibility[group.id]}
              disabled={unavailable}
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
                  {unavailable ? "This layer did not load." : group.legend}
                  {missing.length > 0 && !unavailable ? " Part of this layer did not load." : ""}
                </span>
              </span>
            </button>
          );
        })}
        <button type="button" className="blind-spot" onClick={onBlindSpot}>
          <span className="layer-name">Blind spot</span>
          <span className="layer-legend">Hide sewers. Show slopes and the October proof.</span>
        </button>
      </div>
    </aside>
  );
}

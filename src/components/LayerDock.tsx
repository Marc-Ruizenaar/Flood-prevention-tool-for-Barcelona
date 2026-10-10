import { atlasLocked, formatMm } from "../lib/rain";
import type { GroupId, LayerGroup } from "../types";
import { GROUPS } from "../types";

const GROUP_FILES: Partial<Record<GroupId, string[]>> = {
  relief: ["relief"],
  proof: ["proof-oct2026", "signals"],
};

type Props = {
  visibility: Record<GroupId, boolean>;
  failed: string[];
  dayLabel: string;
  mm: number | null;
  hasReports: boolean;
  proofLegend?: string;
  onToggle: (id: GroupId) => void;
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
  onToggle,
}: Props) {
  return (
    <aside className="dock">
      <div className="dock-scroll">
        {GROUPS.map((group) => {
          const files = GROUP_FILES[group.id] ?? [];
          const missing = files.filter((file) => failed.includes(file));
          const unavailable = files.length > 0 && missing.length === files.length;
          const locked = group.id === "proof" && !hasReports && atlasLocked(mm);
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
                      : group.id === "proof"
                        ? (proofLegend ?? `Reports dated ${dayLabel} only.`)
                        : group.legend}
                  {missing.length > 0 && !unavailable ? " Part of this layer did not load." : ""}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

import { t } from "../lib/i18n";
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
  onClose: () => void;
};

function Swatch({ color, shape }: LayerGroup["swatches"][number]) {
  return <span className={`swatch swatch-${shape}`} style={{ background: color }} />;
}

// One row per layer, switch on the right, the legend under the name: nothing hides behind a scroll.
export function LayerDock({ visibility, failed, dayLabel, mm, hasReports, proofLegend, onToggle, onClose }: Props) {
  return (
    <div className="about-backdrop" onClick={onClose} role="presentation">
      <section className="layers" role="dialog" aria-label={t("Map layers")} onClick={(event) => event.stopPropagation()}>
        <header className="sheet-bar">
          <h2>{t("Map layers")}</h2>
          <button type="button" className="close" onClick={onClose}>
            {t("Close")}
          </button>
        </header>
        <ul className="layer-list">
          {GROUPS.map((group) => {
            const files = GROUP_FILES[group.id] ?? [];
            const missing = files.filter((file) => failed.includes(file));
            const unavailable = files.length > 0 && missing.length === files.length;
            const locked = group.id === "proof" && !hasReports && atlasLocked(mm);
            const legend = unavailable
              ? t("This layer did not load.")
              : locked
                ? mm == null
                  ? t("Off on {day}. No daily total published yet.", { day: dayLabel })
                  : t("Off on {day}. {mm} mm is under 10, so this stays hidden.", { day: dayLabel, mm: formatMm(mm) })
                : group.id === "proof"
                  ? (proofLegend ?? t("Reports dated {day} only.", { day: dayLabel }))
                  : group.legend;
            return (
              <li key={group.id}>
                <button
                  type="button"
                  className="layer-row"
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
                      {legend}
                      {missing.length > 0 && !unavailable ? t(" Part of this layer did not load.") : ""}
                    </span>
                  </span>
                  <span className="toggle" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

import { t } from "../lib/i18n";
import { FLOOD_CLASSES, FLOOD_COLORS, FLOOD_LABELS } from "../lib/modelStyle";

export function FloodLegend() {
  return (
    <div className="flood-legend" data-testid="flood-legend" aria-label={t("Street flood depth legend")}>
      <p className="flood-legend-title">{t("Water on the street")}</p>
      <p className="sr-only">{t("Deeper water also draws wider street lines and taller hotspot columns.")}</p>
      <ul className="flood-legend-list">
        {FLOOD_CLASSES.map((floodClass) => (
          <li key={floodClass} title={FLOOD_LABELS[floodClass]}>
            <span style={{ background: FLOOD_COLORS[floodClass] }} aria-hidden />
            <em aria-hidden>{FLOOD_LABELS[floodClass].split(" ")[0]}</em>
            <span className="sr-only">{FLOOD_LABELS[floodClass]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

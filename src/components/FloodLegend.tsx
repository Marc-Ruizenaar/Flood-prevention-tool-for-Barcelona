import { FLOOD_CLASSES, FLOOD_COLORS, FLOOD_LABELS } from "../lib/modelStyle";

export function FloodLegend() {
  return (
    <div className="flood-legend" data-testid="flood-legend" aria-label="Street flood depth legend">
      <p className="flood-legend-title">Street depth</p>
      <ul className="flood-legend-list">
        {FLOOD_CLASSES.map((floodClass) => (
          <li key={floodClass}>
            <span style={{ background: FLOOD_COLORS[floodClass] }} aria-hidden />
            {FLOOD_LABELS[floodClass]}
          </li>
        ))}
      </ul>
      <p className="flood-legend-note">Wider lines are deeper water.</p>
    </div>
  );
}

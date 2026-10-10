import { DAYS, dayLabels } from "@/lib/format";

type DaySelectorProps = {
  day: string;
  onChange: (day: string) => void;
  available?: string[] | null;
};

export function DaySelector({ day, onChange, available = null }: DaySelectorProps) {
  return (
    <div className="days" role="group" aria-label="Model day">
      {DAYS.map((iso) => {
        const labels = dayLabels(iso);
        const selected = iso === day;
        const enabled = available == null || available.includes(iso);
        return (
          <button
            key={iso}
            type="button"
            aria-pressed={selected}
            aria-label={enabled ? labels.long : `${labels.long} is not in this run`}
            data-day={iso}
            disabled={!enabled}
            onClick={() => onChange(iso)}
          >
            {labels.short}
          </button>
        );
      })}
    </div>
  );
}

export type DayWeather = {
  date: string;
  condition: string;
  summary: string;
  stance: "measured" | "outlook";
  reading?: { value: string; detail: string };
  sources: { label: string; url: string }[];
  reportIds: string[];
  proofLegend?: string;
};

export const APP_DAYS = ["2026-10-02", "2026-10-03"] as const;

export const DEFAULT_DAY = "2026-10-03";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const PROOF_DAY: Record<string, string> = {
  "proof-sant-genis-2026-10": "2026-10-03",
  "proof-torre-baro-2026-10": "2026-10-03",
  "proof-sant-andreu-2026-10": "2026-10-03",
  "proof-gracia-2026-10": "2026-10-03",
  "proof-les-corts-2026-10": "2026-10-03",
};

const STORM_PROOF_IDS = [
  "proof-torre-baro-2026-10",
  "proof-sant-andreu-2026-10",
  "proof-gracia-2026-10",
  "proof-les-corts-2026-10",
  "proof-sant-genis-2026-10",
];

const DAYS: DayWeather[] = [
  {
    date: "2026-10-02",
    condition: "Moderate rain",
    stance: "measured",
    summary:
      "About 15 mm at each of the three city stations — a wet Friday, but well below Saturday’s record. No October proof is dated this day.",
    sources: [
      {
        label: "Aiguats d’octubre de 2026",
        url: "https://ca.wikipedia.org/wiki/Aiguats_d%27octubre_de_2026_a_Catalunya",
      },
    ],
    reportIds: [],
  },
  {
    date: "2026-10-03",
    condition: "Record rain",
    stance: "measured",
    summary:
      "The heaviest day at the three city stations. The city also reported a maximum of 206 litres per square metre and a citywide mean of 152.3. Can Bruixa recorded 207 litres through Saturday. The October proof is on for this rain: the landslide reported on Sunday, and the Torre Baró cleanup and transformer-room cuts reported on Wednesday.",
    sources: [
      {
        label: "Distrito de Gràcia, Ajuntament de Barcelona",
        url: "https://ajuntament.barcelona.cat/gracia/es/noticias/activada-la-emergencia-por-riesgo-de-inundaciones-41745",
      },
      {
        label: "Betevé — Can Bruixa",
        url: "https://beteve.cat/medi-ambient/aiguats-mes-200-litres-barcelona-episodi-pluja-historica/",
      },
    ],
    reportIds: [...STORM_PROOF_IDS, "proof-sant-genis-2026-10"],
    proofLegend: "Impacts from this rain, reported in the days after 3 October.",
  },
];

const BY_DATE = new Map(DAYS.map((day) => [day.date, day]));

export function dayByDate(date: string): DayWeather {
  const day = BY_DATE.get(date);
  if (!day) throw new Error(`missing weather for ${date}`);
  return day;
}

export function listedDays(): DayWeather[] {
  return APP_DAYS.map((date) => dayByDate(date));
}

export function formatDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return `${WEEKDAYS[date.getUTCDay()]} ${day} October`;
}

export function shortDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return `${WEEKDAYS[date.getUTCDay()].slice(0, 3)} ${day}`;
}

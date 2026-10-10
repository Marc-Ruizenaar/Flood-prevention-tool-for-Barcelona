import { lang, locale, t } from "./i18n";

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

// ponytail: today is a fixed date for the demo; swap for new Date() when the app runs past the hackathon.
export const TODAY = "2026-10-10";
export const APP_DAYS = ["2026-10-02", "2026-10-03", TODAY] as const;

export const DEFAULT_DAY = "2026-10-03";

const dayName = (date: Date, weekday: "long" | "short") =>
  new Intl.DateTimeFormat(locale, { weekday, timeZone: "UTC" }).format(date);
const monthName = (date: Date) => new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(date);

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
    condition: t("Moderate rain"),
    stance: "measured",
    summary: t("About 15 mm at each of the three city stations — a wet Friday, but well below Saturday’s record. No October proof is dated this day."),
    sources: [
      {
        label: t("October 2026 floods (Wikipedia)"),
        url: "https://ca.wikipedia.org/wiki/Aiguats_d%27octubre_de_2026_a_Catalunya",
      },
    ],
    reportIds: [],
  },
  {
    date: "2026-10-03",
    condition: t("Record rain"),
    stance: "measured",
    summary: t("The heaviest day at the three city stations. The city also reported a maximum of 206 litres per square metre and a citywide mean of 152.3. Can Bruixa recorded 207 litres through Saturday. The October proof is on for this rain: the landslide reported on Sunday, and the Torre Baró cleanup and transformer-room cuts reported on Wednesday."),
    sources: [
      {
        label: t("Gràcia district, Ajuntament de Barcelona"),
        url: "https://ajuntament.barcelona.cat/gracia/es/noticias/activada-la-emergencia-por-riesgo-de-inundaciones-41745",
      },
      {
        label: t("Betevé: Can Bruixa"),
        url: "https://beteve.cat/medi-ambient/aiguats-mes-200-litres-barcelona-episodi-pluja-historica/",
      },
    ],
    reportIds: STORM_PROOF_IDS,
    proofLegend: t("Impacts from this rain, reported in the days after 3 October."),
  },
  {
    date: TODAY,
    condition: t("Today, live"),
    stance: "outlook",
    summary: t("Rain so far today, summed from Meteocat’s half-hourly station readings. No flood model has run for today, so the street layers stay empty."),
    sources: [
      {
        label: t("Meteocat XEMA half-hourly readings"),
        url: "https://analisi.transparenciacatalunya.cat/Medi-Ambient/Dades-meteorol-giques-de-la-XEMA/nzvn-apee",
      },
    ],
    reportIds: [],
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
  return locale === "en-GB" ? `${dayName(date, "long")} ${day} October` : `${dayName(date, "long")} ${day} ${lang === "ca" ? "d’" : "de "}${monthName(date)}`;
}

export function shortDay(iso: string): string {
  if (iso === TODAY) return t("Today");
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return `${dayName(date, "short").replace(".", "")} ${day}`;
}

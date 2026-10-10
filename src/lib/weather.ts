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

export const THIS_WEEK = [
  "2026-10-05",
  "2026-10-06",
  "2026-10-07",
  "2026-10-08",
  "2026-10-09",
  "2026-10-10",
  "2026-10-11",
] as const;

export const PAST_WEEK = [
  "2026-10-03",
  "2026-10-04",
  "2026-10-05",
  "2026-10-06",
  "2026-10-07",
] as const;

export const DEFAULT_DAY = {
  this: "2026-10-09",
  past: "2026-10-03",
} as const;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const PROOF_DAY: Record<string, string> = {
  "proof-sant-genis-2026-10": "2026-10-04",
  "proof-torre-baro-2026-10": "2026-10-07",
  "proof-sant-andreu-2026-10": "2026-10-07",
  "proof-gracia-2026-10": "2026-10-07",
  "proof-les-corts-2026-10": "2026-10-07",
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
    reportIds: STORM_PROOF_IDS,
    proofLegend: "Impacts from this rain, reported on 4 and 7 October.",
  },
  {
    date: "2026-10-04",
    condition: "A few millimetres",
    stance: "measured",
    summary:
      "Sunday’s gauge day is a few millimetres. Saturday’s record is already in Saturday’s total. Flood spots stay off. The map keeps the landslide on Carrer de Cànoves, which is dated this day.",
    sources: [
      {
        label: "Betevé — mountain neighborhoods",
        url: "https://beteve.cat/societat/pluja-barris-muntanya-esllavissades-rescat-barca/",
      },
    ],
    reportIds: ["proof-sant-genis-2026-10"],
  },
  {
    date: "2026-10-05",
    condition: "Heavier on the hill",
    stance: "measured",
    summary:
      "A new burst, well under Saturday. Fabra, on the hill, is the highest of the three stations, so sewers and slopes come on. Buried streams stay off.",
    sources: [
      {
        label: "Aiguats d’octubre de 2026",
        url: "https://ca.wikipedia.org/wiki/Aiguats_d%27octubre_de_2026_a_Catalunya",
      },
    ],
    reportIds: [],
  },
  {
    date: "2026-10-06",
    condition: "Moderate rain",
    stance: "measured",
    summary:
      "The city stations stay under 40 mm, so only the sewer layer is on. Slopes and buried streams stay off. No report is dated this day.",
    sources: [
      {
        label: "Aiguats d’octubre de 2026",
        url: "https://ca.wikipedia.org/wiki/Aiguats_d%27octubre_de_2026_a_Catalunya",
      },
    ],
    reportIds: [],
  },
  {
    date: "2026-10-07",
    condition: "Cleanup in the neighborhoods",
    stance: "measured",
    summary:
      "Almost no rain at the city stations. Flood spots stay off. The map keeps the reports dated this day: Torre Baró, and the transformer rooms in Les Corts, Sant Andreu and Gràcia.",
    sources: [
      {
        label: "Ajuntament de Barcelona press, 7 Oct 2026",
        url: "https://ajuntament.barcelona.cat/premsa/2026/10/07/lajuntament-desplega-un-operatiu-especial-per-recuperar-les-zones-afectades-per-les-pluges-a-torre-baro/",
      },
      {
        label: "Betevé — power cuts",
        url: "https://beteve.cat/societat/810-abonats-sense-llum-pluja-filtracions-aigua-xarxa-electrica/",
      },
    ],
    reportIds: [
      "proof-torre-baro-2026-10",
      "proof-les-corts-2026-10",
      "proof-sant-andreu-2026-10",
      "proof-gracia-2026-10",
    ],
  },
  {
    date: "2026-10-08",
    condition: "Emergency stepped down",
    stance: "measured",
    summary:
      "The daily station file has not published Thursday yet, so flood spots stay off. Protecció Civil had already lowered INUNCAT from emergency to alert.",
    sources: [
      {
        label: "Aiguats d’octubre de 2026",
        url: "https://ca.wikipedia.org/wiki/Aiguats_d%27octubre_de_2026_a_Catalunya",
      },
    ],
    reportIds: [],
  },
  {
    date: "2026-10-09",
    condition: "Sunny and cooler",
    stance: "outlook",
    reading: {
      value: "12–22°C",
      detail: "Morning 12–14°C in the centre, midday 18–22°C, about 20°C by early evening. No rain expected in the metropolitan area.",
    },
    summary: "Betevé published this for Friday: a clear, dry day and a sharp drop from the days before.",
    sources: [
      {
        label: "Betevé — Friday 9 October",
        url: "https://beteve.cat/medi-ambient/temps-barcelona-divendres-9-octubre-refrescada-tardor/",
      },
    ],
    reportIds: [],
  },
  {
    date: "2026-10-10",
    condition: "Sunny",
    stance: "outlook",
    summary:
      "The same Barcelona note expected a mostly sunny Saturday, mornings still cool and afternoons a little warmer. No rain was expected in the city.",
    sources: [
      {
        label: "Betevé — Friday 9 October",
        url: "https://beteve.cat/medi-ambient/temps-barcelona-divendres-9-octubre-refrescada-tardor/",
      },
    ],
    reportIds: [],
  },
  {
    date: "2026-10-11",
    condition: "More cloud",
    stance: "outlook",
    summary: "Cloud was expected to build from Sunday, with a changeable sky. No city rain total is published for the day.",
    sources: [
      {
        label: "Betevé — Friday 9 October",
        url: "https://beteve.cat/medi-ambient/temps-barcelona-divendres-9-octubre-refrescada-tardor/",
      },
    ],
    reportIds: [],
  },
];

const BY_DATE = new Map(DAYS.map((day) => [day.date, day]));

export function weekDates(past: boolean): readonly string[] {
  return past ? PAST_WEEK : THIS_WEEK;
}

export function dayByDate(date: string): DayWeather {
  const day = BY_DATE.get(date);
  if (!day) throw new Error(`missing weather for ${date}`);
  return day;
}

export function daysForWeek(past: boolean): DayWeather[] {
  return weekDates(past).map((date) => dayByDate(date));
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

import { t } from "./i18n";
import type { ReliefReading } from "../types";

export type ReliefBand = "steep" | "sloping" | "flat";

export function reliefBand(relief: ReliefReading): ReliefBand {
  if (relief.fallMeters >= 15) return "steep";
  if (relief.fallMeters >= 5) return "sloping";
  return "flat";
}

export const RELIEF_BAND_LABEL: Record<ReliefBand, string> = {
  steep: t("Steep fall"),
  sloping: t("Downhill"),
  flat: t("Nearly level"),
};

export function reliefCopy(relief: ReliefReading, mitigation: boolean): string {
  const band = reliefBand(relief);
  const { meters, fallMeters, spanMeters, toward } = relief;

  if (band === "steep") {
    return `About ${meters} m up, falling ${fallMeters} m in ${spanMeters} m toward the ${toward}. Rain runs off a fall this steep, as slope water.`;
  }

  if (band === "sloping") {
    const place = mitigation
      ? `The tank sits at about ${meters} m, on ground that falls ${fallMeters} m in ${spanMeters} m toward the ${toward}.`
      : `About ${meters} m, falling ${fallMeters} m in ${spanMeters} m toward the ${toward}.`;
    return mitigation ? place : `${place} Rain keeps moving downhill, toward the lower streets.`;
  }

  if (mitigation) {
    const grade = fallMeters === 0 ? "barely at all" : `only ${fallMeters} m`;
    return `The tank sits at about ${meters} m. The ground around it falls ${grade} in ${spanMeters} m, so water that arrives here has little grade to leave.`;
  }

  const level =
    fallMeters === 0
      ? `About ${meters} m, and level for ${spanMeters} m around this place.`
      : `About ${meters} m, with only ${fallMeters} m of fall in ${spanMeters} m.`;
  return `${level} With so little grade, rain stays on the street and in the drains.`;
}

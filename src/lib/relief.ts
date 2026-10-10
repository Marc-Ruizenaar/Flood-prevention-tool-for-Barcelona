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
  const { meters, fallMeters, spanMeters } = relief;
  const toward = t(relief.toward);
  const v = { meters, fall: fallMeters, span: spanMeters, toward };

  if (band === "steep") {
    return t("About {meters} m up, falling {fall} m in {span} m toward the {toward}. Rain runs off a fall this steep, as slope water.", v);
  }

  if (band === "sloping") {
    const place = mitigation
      ? t("The tank sits at about {meters} m, on ground that falls {fall} m in {span} m toward the {toward}.", v)
      : t("About {meters} m, falling {fall} m in {span} m toward the {toward}.", v);
    return mitigation ? place : `${place} ${t("Rain keeps moving downhill, toward the lower streets.")}`;
  }

  if (mitigation) {
    const grade = fallMeters === 0 ? t("barely at all") : t("only {fall} m", v);
    return t("The tank sits at about {meters} m. The ground around it falls {grade} in {span} m, so water that arrives here has little grade to leave.", { ...v, grade });
  }

  const level =
    fallMeters === 0
      ? t("About {meters} m, and level for {span} m around this place.", v)
      : t("About {meters} m, with only {fall} m of fall in {span} m.", v);
  return `${level} ${t("With so little grade, rain stays on the street and in the drains.")}`;
}

import { t } from "./lib/i18n";
export type Mechanism =
  | "street_overflow"
  | "basement"
  | "transformer_room"
  | "slope_runoff"
  | "torrent"
  | "mitigation"
  | "observed_impact";

export type ZoneCard = {
  id: string;
  name: string;
  layerIds: string[];
  mechanisms: Mechanism[];
  whatCouldFail: string;
  preventiveAction: string;
  sourceLabel: string;
  sourceUrl: string;
  atlasTerm?: string;
  relatedZoneIds?: string[];
  layerType?: "proof";
  sources?: { label: string; url: string }[];
  geometryNote?: string;
  notes?: string;
};

export type ZoneMap = Record<string, ZoneCard>;

export type GroupId = "terrain" | "relief" | "sewers" | "streams" | "slopes" | "proof";

export type ReliefReading = {
  meters: number;
  fallMeters: number;
  spanMeters: number;
  toward: string;
  at: [number, number];
};

export type ReliefFile = {
  sourceUrl: string;
  model: string;
  spanMeters: number;
  bounds: [number, number, number, number];
  image: string;
  places: Record<string, ReliefReading>;
};

export type LayerGroup = {
  id: GroupId;
  label: string;
  legend: string;
  swatches: { color: string; shape: "square" | "dot" | "line" }[];
};

export const GROUPS: LayerGroup[] = [
  {
    id: "terrain",
    label: t("Where terrain pools water"),
    legend: t("Lidar terrain only: hollows and flat lowland across the metro. Not a simulation: no rain, no drains, no depth."),
    swatches: [{ color: "#2b6cb0", shape: "square" }],
  },
  {
    id: "relief",
    label: t("Height of the ground"),
    legend: t("Contour lines in metres, Collserola down to the sea. The fall is on each card. Not a flood depth."),
    swatches: [{ color: "#9a6b3f", shape: "line" }],
  },
  {
    id: "proof",
    label: t("Reported impacts"),
    legend: t("Oct 2026 proof and reviewed official and press reports. Off until you compare."),
    swatches: [{ color: "#1c1917", shape: "dot" }],
  },
];

export const DEFAULT_VISIBILITY: Record<GroupId, boolean> = {
  terrain: true,
  relief: true,
  sewers: false,
  streams: false,
  slopes: false,
  proof: false,
};

export const MECHANISM_LABEL: Record<Mechanism, string> = {
  street_overflow: t("Street overflow"),
  basement: t("Basement"),
  transformer_room: t("Transformer room"),
  slope_runoff: t("Slope runoff"),
  torrent: t("Torrent"),
  mitigation: t("Mitigation"),
  observed_impact: t("Observed impact"),
};

const FILE_GROUP: Record<string, GroupId> = {
  "sewer-t10-stress": "sewers",
  "resccue-hotspots": "sewers",
  "buried-streams": "streams",
  "retention-tanks": "streams",
  "slopes-torrents": "slopes",
  "proof-oct2026": "proof",
  signals: "proof",
};

export function groupForZone(zone: ZoneCard): GroupId {
  for (const layerId of zone.layerIds) {
    const group = FILE_GROUP[layerId];
    if (group) return group;
  }
  return "sewers";
}

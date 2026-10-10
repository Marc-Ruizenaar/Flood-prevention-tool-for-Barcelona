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

export type GroupId = "relief" | "sewers" | "streams" | "slopes" | "proof";

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
    id: "relief",
    label: "Height of the ground",
    legend: "Collserola down to the sea. The fall is on each card. Not a flood depth.",
    swatches: [{ color: "#8d877c", shape: "square" }],
  },
  {
    id: "proof",
    label: "Oct 2026 proof",
    legend: "What was reported after the rains.",
    swatches: [{ color: "#1c1917", shape: "dot" }],
  },
];

export const DEFAULT_VISIBILITY: Record<GroupId, boolean> = {
  relief: true,
  sewers: false,
  streams: false,
  slopes: false,
  proof: false,
};

export const MECHANISM_LABEL: Record<Mechanism, string> = {
  street_overflow: "Street overflow",
  basement: "Basement",
  transformer_room: "Transformer room",
  slope_runoff: "Slope runoff",
  torrent: "Torrent",
  mitigation: "Mitigation",
  observed_impact: "Observed impact",
};

const FILE_GROUP: Record<string, GroupId> = {
  "sewer-t10-stress": "sewers",
  "resccue-hotspots": "sewers",
  "buried-streams": "streams",
  "retention-tanks": "streams",
  "slopes-torrents": "slopes",
  "proof-oct2026": "proof",
};

export function groupForZone(zone: ZoneCard): GroupId {
  for (const layerId of zone.layerIds) {
    const group = FILE_GROUP[layerId];
    if (group) return group;
  }
  return "sewers";
}

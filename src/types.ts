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

export type GroupId = "sewers" | "streams" | "slopes" | "proof";

export type LayerGroup = {
  id: GroupId;
  label: string;
  legend: string;
  swatches: { color: string; shape: "square" | "dot" | "line" }[];
};

export const GROUPS: LayerGroup[] = [
  {
    id: "sewers",
    label: "Next rain — sewers",
    legend: "T10 atlas baseline and the 14 published hotspots. Not a live forecast.",
    swatches: [
      { color: "#e07a2f", shape: "square" },
      { color: "#b42318", shape: "dot" },
    ],
  },
  {
    id: "streams",
    label: "Buried streams",
    legend: "Riera traces, named avenues, and tanks. Green is in service; amber is approved, not yet protection.",
    swatches: [
      { color: "#0f5f73", shape: "line" },
      { color: "#0f766e", shape: "dot" },
    ],
  },
  {
    id: "slopes",
    label: "Slopes & torrents",
    legend: "Collserola-facing neighborhoods the sewer hotspots do not cover.",
    swatches: [{ color: "#6d28d9", shape: "square" }],
  },
  {
    id: "proof",
    label: "Oct 2026 proof",
    legend: "What was reported after the rains. Off until you compare.",
    swatches: [{ color: "#1c1917", shape: "dot" }],
  },
];

export const DEFAULT_VISIBILITY: Record<GroupId, boolean> = {
  sewers: true,
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

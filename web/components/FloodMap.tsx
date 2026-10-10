"use client";

import type { Feature, GeoJsonObject } from "geojson";
import L from "leaflet";
import type { Layer, PathOptions } from "leaflet";
import { useEffect } from "react";
import { CircleMarker, GeoJSON, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import { formatDepth } from "@/lib/format";
import { FLOOD_COLORS, hotspotRadius, streetWeight } from "@/lib/style";
import type { FloodClass, HotspotsCollection, Loaded, StreetProps, StreetsCollection } from "@/lib/types";
import { HotspotCard } from "./HotspotCard";
import "leaflet/dist/leaflet.css";

type MapFocus = { lat: number; lon: number; nonce: number };

type FloodMapProps = {
  day: string;
  streets: Loaded<StreetsCollection>;
  hotspots: Loaded<HotspotsCollection>;
  mapFocus?: MapFocus | null;
};

function streetStyle(feature?: Feature): PathOptions {
  const props = feature?.properties as StreetProps | null | undefined;
  const floodClass = props?.flood_class ?? "dry";
  const color = floodClass in FLOOD_COLORS ? FLOOD_COLORS[floodClass as FloodClass] : FLOOD_COLORS.dry;
  return {
    color,
    weight: streetWeight(props?.max_depth_m),
    opacity: floodClass === "dry" ? 0.72 : 0.95,
    lineCap: "round",
    lineJoin: "round",
  };
}

function onStreet(feature: Feature, layer: Layer) {
  const props = feature.properties as StreetProps | null;
  if (!props) return;
  const name = props.name || props.segment_id;
  layer.bindTooltip(`${name} · ${props.flood_class} · ${formatDepth(props.max_depth_m)}`, {
    sticky: true,
  });
}

function FitStreets({ streets }: { streets: StreetsCollection }) {
  const map = useMap();
  useEffect(() => {
    const bounds = L.latLngBounds([]);
    for (const feature of streets.features) {
      for (const pair of feature.geometry.coordinates) {
        const lon = pair[0];
        const lat = pair[1];
        if (Number.isFinite(lon) && Number.isFinite(lat)) bounds.extend([lat, lon]);
      }
    }
    if (!bounds.isValid()) return;
    const wide = window.innerWidth >= 860;
    map.fitBounds(bounds, {
      paddingTopLeft: wide ? L.point(28, 158) : L.point(16, 128),
      paddingBottomRight: wide ? L.point(400, 28) : L.point(16, Math.round(window.innerHeight * 0.46)),
      maxZoom: 17,
    });
  }, [streets, map]);
  return null;
}

function FlyToFocus({ focus }: { focus: MapFocus | null | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (!focus) return;
    map.flyTo([focus.lat, focus.lon], Math.max(map.getZoom(), 15), { duration: 0.65 });
  }, [focus, map]);
  return null;
}

function ZoomButtons() {
  const map = useMap();
  useEffect(() => {
    const position = window.matchMedia("(max-width: 859px)").matches ? "topright" : "bottomleft";
    const control = L.control.zoom({ position });
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map]);
  return null;
}

export function FloodMap({ day, streets, hotspots, mapFocus }: FloodMapProps) {
  const streetData = streets.status === "ready" ? streets.data : null;
  const hotspotData = hotspots.status === "ready" ? hotspots.data : null;
  const streetKey = `${day}-${streets.status === "ready" ? streets.source : "pending"}-${streetData?.features.length ?? 0}`;

  return (
    <MapContainer
      className="flood-map"
      center={[41.3874, 2.1686]}
      zoom={13}
      zoomControl={false}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        subdomains="abcd"
      />
      <ZoomButtons />
      <FlyToFocus focus={mapFocus} />
      {streetData ? <FitStreets streets={streetData} /> : null}
      {streetData && streetData.features.length > 0 ? (
        <GeoJSON
          key={streetKey}
          data={streetData as unknown as GeoJsonObject}
          style={streetStyle}
          onEachFeature={onStreet}
        />
      ) : null}
      {hotspotData?.features.map((feature) => {
        const [lon, lat] = feature.geometry.coordinates;
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
        const props = feature.properties;
        const fill = props.flood_class in FLOOD_COLORS ? FLOOD_COLORS[props.flood_class] : FLOOD_COLORS.moderate;
        return (
          <CircleMarker
            key={`${day}-${props.cell_id}`}
            center={[lat, lon]}
            radius={hotspotRadius(props.peak_depth_m)}
            pathOptions={{ color: "#142028", weight: 1.5, fillColor: fill, fillOpacity: 0.95 }}
          >
            <Popup minWidth={280} maxWidth={340}>
              <HotspotCard properties={props} />
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}

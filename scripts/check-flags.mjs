import { readFileSync } from "node:fs";

const sewers = JSON.parse(readFileSync("data/geojson/sewer-t10-stress.geojson", "utf8"));
const streams = JSON.parse(readFileSync("data/geojson/buried-streams.geojson", "utf8"));
const slopes = JSON.parse(readFileSync("data/geojson/slopes-torrents.geojson", "utf8"));
const tanks = JSON.parse(readFileSync("data/geojson/retention-tanks.geojson", "utf8"));
const relief = JSON.parse(readFileSync("data/relief.json", "utf8"));

function ringsOf(geometry) {
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lon, lat, geometry) {
  const rings = ringsOf(geometry);
  if (!rings.length) return false;
  if (!pointInRing(lon, lat, rings[0])) return false;
  return true;
}

function segments(geometry) {
  const lines = [];
  const pushLine = (line) => {
    for (let i = 1; i < line.length; i++) lines.push([line[i - 1], line[i]]);
  };
  if (geometry.type === "LineString") pushLine(geometry.coordinates);
  if (geometry.type === "MultiLineString") geometry.coordinates.forEach(pushLine);
  return lines;
}

function side(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function crosses(a, b, c, d) {
  const ab = side(a[0], a[1], b[0], b[1], c[0], c[1]) * side(a[0], a[1], b[0], b[1], d[0], d[1]);
  const cd = side(c[0], c[1], d[0], d[1], a[0], a[1]) * side(c[0], c[1], d[0], d[1], b[0], b[1]);
  return ab < 0 && cd < 0;
}

function lineHitsPolygon(geometry, polygon) {
  const ring = ringsOf(polygon)[0] ?? [];
  for (const [a, b] of segments(geometry)) {
    if (pointInPolygon(a[0], a[1], polygon) || pointInPolygon(b[0], b[1], polygon)) return true;
    for (let i = 1; i < ring.length; i++) {
      if (crosses(a, b, ring[i - 1], ring[i])) return true;
    }
  }
  return false;
}

function metres(a, b) {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (a[0] - b[0]) * 111320 * Math.cos(lat);
  const dy = (a[1] - b[1]) * 110540;
  return Math.hypot(dx, dy);
}

function vertices(geometry) {
  const points = [];
  const walk = (value) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number") {
      points.push(value);
      return;
    }
    value.forEach(walk);
  };
  walk(geometry.coordinates);
  return points;
}

const namedStreams = streams.features.filter((feature) => feature.properties?.tappable !== false);

for (const sewer of sewers.features) {
  const place = relief.places[sewer.properties.id];
  const inside = pointInPolygon(place.at[0], place.at[1], sewer.geometry);
  console.log(
    `sewer ${sewer.properties.id} fall ${place.fallMeters} inside ${inside}`,
  );
}

for (const slope of slopes.features) {
  const place = relief.places[slope.properties.id];
  const inside = pointInPolygon(place.at[0], place.at[1], slope.geometry);
  const hits = sewers.features
    .filter((sewer) => lineHitsPolygon(slope.geometry, sewer.geometry) || pointInPolygon(place.at[0], place.at[1], sewer.geometry))
    .map((sewer) => sewer.properties.id);
  console.log(`slope ${slope.properties.id} fall ${place.fallMeters} inside ${inside} sewers ${hits.join(",") || "none"}`);
}

for (const stream of namedStreams) {
  const place = relief.places[stream.properties.id];
  const hits = sewers.features
    .filter((sewer) => lineHitsPolygon(stream.geometry, sewer.geometry) || pointInPolygon(place.at[0], place.at[1], sewer.geometry))
    .map((sewer) => sewer.properties.id);
  const near = tanks.features.map((tank) => ({
    id: tank.properties.id,
    status: tank.properties.status,
    m: Math.round(metres(place.at, tank.geometry.coordinates)),
  }));
  console.log(
    `stream ${stream.properties.id} fall ${place.fallMeters} sewers ${hits.join(",") || "none"} tanks ${near.map((tank) => `${tank.id}:${tank.status}:${tank.m}m`).join(" ")}`,
  );
}

for (const slope of slopes.features) {
  for (const stream of namedStreams) {
    const hit = lineHitsPolygon(stream.geometry, slope.geometry);
    if (hit) console.log(`stream ${stream.properties.id} meets slope ${slope.properties.id}`);
  }
}

import { useEffect, useRef, useState } from "react";
import { AboutPanel } from "./components/AboutPanel";
import { FactSheet } from "./components/FactSheet";
import { LayerDock } from "./components/LayerDock";
import { MapCanvas, type MapHandle } from "./components/MapCanvas";
import { useFloodData } from "./lib/data";
import { DEFAULT_VISIBILITY, groupForZone, type GroupId } from "./types";

export function App() {
  const data = useFloodData();
  const [visibility, setVisibility] = useState(DEFAULT_VISIBILITY);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [aboutOpen, setAboutOpen] = useState(false);
  const mapRef = useRef<MapHandle>(null);

  useEffect(() => {
    if (!data.ready || !data.zones) return;
    const id = new URLSearchParams(window.location.search).get("zone");
    if (!id || !data.zones[id]) return;
    const zone = data.zones[id];
    setVisibility((current) => ({ ...current, [groupForZone(zone)]: true }));
    setSelectedId(id);
    setFocusNonce((nonce) => nonce + 1);
  }, [data.ready, data.zones]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setAboutOpen(false);
      setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function remember(id: string | null) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("zone", id);
    else url.searchParams.delete("zone");
    window.history.replaceState(null, "", url);
  }

  function openZone(id: string, fly: boolean) {
    if (!data.zones?.[id]) return;
    setVisibility((current) => ({ ...current, [groupForZone(data.zones![id])]: true }));
    setSelectedId(id);
    remember(id);
    if (fly) setFocusNonce((nonce) => nonce + 1);
  }

  function blindSpot() {
    setVisibility({ sewers: false, streams: false, slopes: true, proof: true });
    setSelectedId("slope-torre-baro");
    remember("slope-torre-baro");
    setFocusNonce((nonce) => nonce + 1);
  }

  const zone = selectedId && data.zones ? data.zones[selectedId] : undefined;

  return (
    <div className={`app${zone ? " sheet-open" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <div>
            <p className="kicker">Barcelona</p>
            <h1>Next rain</h1>
          </div>
        </div>
        <div className="top-actions">
          <button type="button" className="pill" onClick={() => mapRef.current?.reset()}>
            City
          </button>
          <button type="button" className="pill" onClick={() => setAboutOpen(true)}>
            About
          </button>
        </div>
      </header>

      {data.fatal ? (
        <div className="banner banner-bad" role="alert">
          The fact cards did not load. {data.fatal}
        </div>
      ) : null}
      {!data.fatal && data.failed.length > 0 ? (
        <div className="banner" role="status">
          Some layers did not load: {data.failed.join(", ")}. The rest of the map is still available.
        </div>
      ) : null}
      {!data.ready && !data.fatal ? <div className="banner">Loading published layers…</div> : null}

      {data.ready && data.zones ? (
        <MapCanvas
          ref={mapRef}
          collections={data.collections}
          visibility={visibility}
          selectedId={selectedId}
          focusNonce={focusNonce}
          onSelect={(id) => openZone(id, false)}
        />
      ) : (
        <div className="map map-pending" />
      )}

      <LayerDock
        visibility={visibility}
        failed={data.failed}
        onToggle={(id: GroupId) => setVisibility((current) => ({ ...current, [id]: !current[id] }))}
        onBlindSpot={blindSpot}
      />

      {zone && data.zones ? (
        <FactSheet
          key={zone.id}
          zone={zone}
          zones={data.zones}
          onClose={() => {
            setSelectedId(null);
            remember(null);
          }}
          onOpen={(id) => openZone(id, true)}
        />
      ) : null}

      {aboutOpen ? <AboutPanel sources={data.sources} onClose={() => setAboutOpen(false)} /> : null}
    </div>
  );
}

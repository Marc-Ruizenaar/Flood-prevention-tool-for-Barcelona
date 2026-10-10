import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import maplibregl from "maplibre-gl";
// maplibre's stylesheet must come before ours: it sets position: relative on the map element and
// styles.css overrides that with position: absolute.
import "maplibre-gl/dist/maplibre-gl.css";
import { App } from "./App";
import { CitizenApp } from "./CitizenApp";
import "./styles.css";

maplibregl.setMaxParallelImageRequests(16);

// ponytail: the 3D intro (components/IntroScreen.tsx) is switched off; the app opens on the map.
function Root() {
  return window.location.pathname.startsWith("/citizen") ? <CitizenApp /> : <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* ponytail: two views, one path check. A router earns its place at the third view. */}
    <Root />
  </StrictMode>,
);

import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
// maplibre's stylesheet must come before ours: it sets position: relative on the map element and
// styles.css overrides that with position: absolute. Loading it with the lazy map chunk put it after
// ours and collapsed the map to zero height in production.
import "maplibre-gl/dist/maplibre-gl.css";
import { App } from "./App";
import "./styles.css";

// The resident view carries its own copy of the map code; keep it out of the city view's first download.
const CitizenApp = lazy(() => import("./CitizenApp").then((m) => ({ default: m.CitizenApp })));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* ponytail: two views, one path check. A router earns its place at the third view. */}
    {window.location.pathname.startsWith("/citizen") ? (
      <Suspense fallback={<div className="citizen" />}>
        <CitizenApp />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);

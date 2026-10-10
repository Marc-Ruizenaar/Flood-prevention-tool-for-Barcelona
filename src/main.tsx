import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "@fontsource/fraunces/latin-500.css";
import "@fontsource/fraunces/latin-600-italic.css";
import "@fontsource/fraunces/latin-ext-500.css";
import "@fontsource/fraunces/latin-ext-600-italic.css";
import "@fontsource/outfit/latin-400.css";
import "@fontsource/outfit/latin-500.css";
import "@fontsource/outfit/latin-600.css";
import "@fontsource/outfit/latin-ext-400.css";
import "@fontsource/outfit/latin-ext-500.css";
import "@fontsource/outfit/latin-ext-600.css";
import { App } from "./App";
import { CitizenApp } from "./CitizenApp";
import "./styles.css";

maplibregl.setMaxParallelImageRequests(16);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* ponytail: two views, one path check. A router earns its place at the third view. */}
    {window.location.pathname.startsWith("/citizen") ? <CitizenApp /> : <App />}
  </StrictMode>,
);

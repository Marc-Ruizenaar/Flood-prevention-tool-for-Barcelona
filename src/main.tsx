import { StrictMode, useCallback, useState } from "react";
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
import { IntroScreen, type IntroDoneOptions } from "./components/IntroScreen";
import "./styles.css";

maplibregl.setMaxParallelImageRequests(16);

const INTRO_KEY = "introSeen";

// Main route only. ?intro=0 skips it, ?intro=1 always shows it, otherwise once per session.
function shouldShowIntro(): boolean {
  if (window.location.pathname.startsWith("/citizen")) return false;
  const flag = new URLSearchParams(window.location.search).get("intro");
  if (flag === "0") return false;
  if (flag === "1") return true;
  try {
    return window.sessionStorage.getItem(INTRO_KEY) !== "1";
  } catch {
    return true;
  }
}

function focusAppStart(): void {
  const target = document.querySelector<HTMLElement>("h1, main, [role=main]");
  if (!target) return;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
}

function Root() {
  const [intro, setIntro] = useState(shouldShowIntro);

  const done = useCallback((options?: IntroDoneOptions) => {
    try {
      window.sessionStorage.setItem(INTRO_KEY, "1");
    } catch {
      /* private mode: the intro may show again, which is harmless */
    }
    setIntro(false);
    // Wait one tick so the app is no longer inert and the layer is gone.
    window.setTimeout(() => {
      if (options?.openPlanner) window.dispatchEvent(new CustomEvent("open-scenario-planner"));
      else focusAppStart();
    }, 0);
  }, []);

  if (window.location.pathname.startsWith("/citizen")) return <CitizenApp />;

  return (
    <>
      <div style={{ display: "contents" }} inert={intro}>
        <App />
      </div>
      {intro && <IntroScreen onDone={done} />}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* ponytail: two views, one path check. A router earns its place at the third view. */}
    <Root />
  </StrictMode>,
);

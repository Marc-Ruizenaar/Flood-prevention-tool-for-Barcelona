"use client";

import dynamic from "next/dynamic";

const FloodApp = dynamic(() => import("./FloodApp"), {
  ssr: false,
  loading: () => (
    <div className="boot">
      <p>Loading the Barcelona flood map…</p>
    </div>
  ),
});

export function FloodMapLoader() {
  return <FloodApp />;
}

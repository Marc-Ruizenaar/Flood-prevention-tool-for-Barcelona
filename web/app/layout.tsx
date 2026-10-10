import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource/fraunces/500.css";
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/600.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Barcelona flood streets",
  description: "Modelled street flooding for Barcelona, 2–7 October 2026.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

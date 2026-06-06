import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { ThemeProvider } from "../components/ThemeProvider";
import { PostHogProvider } from "../components/PostHogProvider";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "IUCN Red List Assessments Dashboard",
  description: "IUCN Red List and GBIF occurrence data explorer",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <PostHogProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </PostHogProvider>
        {/* Server-rendered footer: gives crawlers & LLMs (which see only this
            shell, not the client-rendered app) a path into the data. */}
        <footer style={{ textAlign: "center", padding: "1rem", fontSize: "0.8rem", opacity: 0.6 }}>
          <a href="/browse">Text / no-JS view (for LLMs &amp; crawlers)</a>
          {" · "}
          <a href="/llms.txt">llms.txt</a>
        </footer>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}

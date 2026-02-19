"use client";

import React, { useState, memo } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  Line,
  Marker,
  ZoomableGroup,
} from "react-simple-maps";
import { ALPHA2_TO_NAME } from "./WorldMap";

const GEO_URL =
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// Reverse mapping: country name (as used in TopoJSON) -> alpha-2 code
const NAME_TO_ALPHA2 = Object.fromEntries(
  Object.entries(ALPHA2_TO_NAME).map(([code, name]) => [name, code])
);

// Approximate centroids (lon, lat) for countries likely to appear in CITES trade
const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  AF: [67.7, 33.9], AL: [20.2, 41.2], DZ: [3.0, 28.0], AO: [17.9, -12.3],
  AR: [-63.6, -38.4], AM: [45.0, 40.1], AU: [133.8, -25.3], AT: [14.6, 47.7],
  AZ: [47.6, 40.1], BD: [90.4, 23.7], BY: [27.9, 53.7], BE: [4.5, 50.5],
  BJ: [2.3, 9.3], BT: [90.4, 27.5], BO: [-63.6, -16.3], BA: [17.8, 43.9],
  BW: [24.7, -22.3], BR: [-51.9, -14.2], BN: [114.7, 4.5], BG: [25.5, 42.7],
  BF: [-1.6, 12.3], BI: [29.9, -3.4], KH: [105.0, 12.6], CM: [12.4, 6.0],
  CA: [-106.3, 56.1], CF: [21.0, 6.6], TD: [18.7, 15.5], CL: [-71.5, -35.7],
  CN: [104.2, 35.9], CO: [-74.3, 4.6], CG: [15.8, -0.2], CD: [21.8, -4.0],
  CR: [-84.0, 9.7], CI: [-5.5, 7.5], HR: [15.2, 45.1], CU: [-77.8, 21.5],
  CY: [33.4, 35.1], CZ: [15.5, 49.8], DK: [9.5, 56.3], DJ: [42.6, 11.8],
  DO: [-70.2, 18.7], EC: [-78.2, -1.8], EG: [30.8, 26.8], SV: [-88.9, 13.8],
  GQ: [10.3, 1.7], ER: [39.8, 15.2], EE: [25.0, 58.6], SZ: [31.5, -26.5],
  ET: [40.5, 9.1], FJ: [178.1, -17.7], FI: [25.7, 61.9], FR: [2.2, 46.2],
  GA: [11.6, -0.8], GM: [-15.3, 13.4], GE: [43.4, 42.3], DE: [10.5, 51.2],
  GH: [-1.0, 7.9], GR: [21.8, 39.1], GT: [-90.2, 15.8], GN: [-9.9, 9.9],
  GW: [-15.2, 12.0], GY: [-58.9, 5.0], HT: [-72.3, 19.0], HN: [-86.2, 15.0],
  HU: [19.5, 47.2], IS: [-19.0, 65.0], IN: [78.9, 20.6], ID: [113.9, -0.8],
  IR: [53.7, 32.4], IQ: [44.0, 33.2], IE: [-8.2, 53.4], IL: [34.9, 31.0],
  IT: [12.6, 41.9], JM: [-77.3, 18.1], JP: [138.3, 36.2], JO: [36.2, 30.6],
  KZ: [67.0, 48.0], KE: [38.0, -0.0], KP: [127.5, 40.3], KR: [128.0, 35.9],
  KW: [47.5, 29.3], KG: [74.8, 41.2], LA: [102.5, 19.9], LV: [24.6, 56.9],
  LB: [35.9, 33.9], LS: [28.2, -29.6], LR: [-9.4, 6.4], LY: [17.2, 26.3],
  LT: [23.9, 55.2], LU: [6.1, 49.8], MG: [46.9, -18.8], MW: [34.3, -13.3],
  MY: [101.9, 4.2], MV: [73.5, 3.2], ML: [-4.0, 17.6], MT: [14.4, 35.9],
  MR: [-10.9, 21.0], MU: [57.6, -20.3], MX: [-102.6, 23.6], MD: [28.4, 47.4],
  MN: [103.8, 46.9], ME: [19.4, 42.7], MA: [-7.1, 31.8], MZ: [35.5, -18.7],
  MM: [96.0, 21.9], NA: [18.5, -22.0], NP: [84.1, 28.4], NL: [5.3, 52.1],
  NZ: [174.9, -40.9], NI: [-85.2, 12.9], NE: [8.1, 17.6], NG: [8.7, 9.1],
  NO: [8.5, 60.5], OM: [55.9, 21.5], PK: [69.3, 30.4], PA: [-80.8, 8.5],
  PG: [143.9, -6.3], PY: [-58.4, -23.4], PE: [-75.0, -9.2], PH: [121.8, 12.9],
  PL: [19.1, 51.9], PT: [-8.2, 39.4], QA: [51.2, 25.4], RO: [24.7, 45.9],
  RU: [105.3, 61.5], RW: [29.9, -1.9], SA: [45.1, 23.9], SN: [-14.5, 14.5],
  RS: [21.0, 44.0], SG: [103.8, 1.4], SK: [19.7, 48.7], SI: [14.5, 46.2],
  SB: [160.2, -9.6], SO: [46.2, 5.2], ZA: [22.9, -30.6], SS: [31.3, 6.9],
  ES: [-3.7, 40.5], LK: [80.8, 7.9], SD: [30.2, 12.9], SR: [-56.0, 4.0],
  SE: [18.6, 60.1], CH: [8.2, 46.8], SY: [39.0, 34.8], TW: [121.0, 23.7],
  TJ: [71.3, 38.9], TZ: [34.9, -6.4], TH: [100.9, 15.9], TL: [125.7, -8.9],
  TG: [1.2, 8.6], TT: [-61.2, 10.7], TN: [9.5, 33.9], TR: [35.2, 39.9],
  TM: [59.6, 38.9], UG: [32.3, 1.4], UA: [31.2, 48.4], AE: [53.8, 23.4],
  GB: [-3.4, 55.4], US: [-95.7, 37.1], UY: [-55.8, -32.5], UZ: [64.6, 41.4],
  VU: [166.9, -15.4], VE: [-66.6, 6.4], VN: [108.3, 14.1], YE: [48.5, 15.6],
  ZM: [27.8, -13.1], ZW: [29.2, -19.0],
  // Smaller territories that may appear in CITES trade
  HK: [114.2, 22.3], MO: [113.5, 22.2], RE: [55.5, -21.1], GP: [-61.6, 16.0],
  MQ: [-61.0, 14.6], GF: [-53.1, 4.0], NC: [165.6, -21.1], PF: [-149.4, -17.7],
  CW: [-69.0, 12.2], AW: [-70.0, 12.5], BM: [-64.8, 32.3], KY: [-81.3, 19.5],
  SC: [55.5, -4.7], BS: [-77.4, 25.0], BB: [-59.5, 13.2], LC: [-61.0, 13.9],
  AG: [-61.8, 17.1], DM: [-61.4, 15.4], GD: [-61.7, 12.1], KN: [-62.7, 17.4],
  VC: [-61.2, 13.3], BZ: [-88.5, 17.2], FO: [-6.9, 62.0], GL: [-42.6, 71.7],
  PS: [35.2, 32.0], XK: [21.0, 42.6], MK: [21.7, 41.5],
};

interface TradeFlow {
  from: string;
  to: string;
  records: number;
  quantity: number;
}

interface TradeFlowMapProps {
  flows: TradeFlow[];
}

function countryName(code: string): string {
  return ALPHA2_TO_NAME[code] || code;
}

function fmtQty(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return n.toLocaleString();
}

function TradeFlowMap({ flows }: TradeFlowMapProps) {
  const [hoveredFlow, setHoveredFlow] = useState<number | null>(null);

  if (flows.length === 0) return null;

  // Collect unique exporter/importer codes
  const exporterCodes = new Set(flows.map((f) => f.from));
  const importerCodes = new Set(flows.map((f) => f.to));

  // Only render flows where we have centroids for both endpoints
  const renderableFlows = flows.filter(
    (f) => COUNTRY_CENTROIDS[f.from] && COUNTRY_CENTROIDS[f.to]
  );

  if (renderableFlows.length === 0) return null;

  const maxRecords = Math.max(...renderableFlows.map((f) => f.records));

  return (
    <div className="relative">
      {/* Hover tooltip */}
      {hoveredFlow !== null && renderableFlows[hoveredFlow] && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-zinc-800 dark:bg-zinc-700 text-white text-[11px] px-3 py-1.5 rounded-lg shadow-lg pointer-events-none whitespace-nowrap">
          <span className="font-medium">
            {countryName(renderableFlows[hoveredFlow].from)}
          </span>
          <span className="text-zinc-300 mx-1.5">&rarr;</span>
          <span className="font-medium">
            {countryName(renderableFlows[hoveredFlow].to)}
          </span>
          <span className="text-zinc-400 ml-2">
            {renderableFlows[hoveredFlow].records.toLocaleString()} records
          </span>
          {renderableFlows[hoveredFlow].quantity > 0 && (
            <span className="text-zinc-400 ml-1">
              / {fmtQty(renderableFlows[hoveredFlow].quantity)} items
            </span>
          )}
        </div>
      )}

      <ComposableMap
        projection="geoNaturalEarth1"
        projectionConfig={{ scale: 160, center: [0, 0] }}
        style={{ width: "100%", height: "auto" }}
        width={800}
        height={400}
      >
        <ZoomableGroup center={[10, 10]} zoom={1} minZoom={1} maxZoom={1}>
          {/* Base map */}
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies
                .filter((geo) => geo.properties.name !== "Antarctica")
                .map((geo) => {
                  const name = geo.properties.name;
                  const alpha2 = NAME_TO_ALPHA2[name];
                  const isExporter = alpha2
                    ? exporterCodes.has(alpha2)
                    : false;
                  const isImporter = alpha2
                    ? importerCodes.has(alpha2)
                    : false;

                  let fill = "#f4f4f5"; // zinc-100
                  if (isExporter && isImporter)
                    fill = "#e0e7ff"; // indigo-100 (both)
                  else if (isExporter) fill = "#fee2e2"; // red-100
                  else if (isImporter) fill = "#dbeafe"; // blue-100

                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill={fill}
                      stroke="#d4d4d8"
                      strokeWidth={0.4}
                      style={{
                        default: { outline: "none" },
                        hover: { outline: "none", fill },
                        pressed: { outline: "none" },
                      }}
                    />
                  );
                })
            }
          </Geographies>

          {/* Flow lines */}
          {renderableFlows.map((flow, i) => {
            const from = COUNTRY_CENTROIDS[flow.from];
            const to = COUNTRY_CENTROIDS[flow.to];
            // Stroke width: 1.5 to 4 based on relative volume
            const ratio = maxRecords > 0 ? flow.records / maxRecords : 0;
            const strokeWidth = 1.5 + ratio * 2.5;
            const isHovered = hoveredFlow === i;

            return (
              <Line
                key={`${flow.from}-${flow.to}`}
                from={from}
                to={to}
                stroke={isHovered ? "#f59e0b" : "#ef4444"}
                strokeWidth={isHovered ? strokeWidth + 1 : strokeWidth}
                strokeLinecap="round"
                strokeOpacity={isHovered ? 0.9 : 0.5}
                fill="transparent"
                onMouseEnter={() => setHoveredFlow(i)}
                onMouseLeave={() => setHoveredFlow(null)}
                style={{ cursor: "pointer" }}
              />
            );
          })}

          {/* Endpoint markers (deduplicated) */}
          {(() => {
            const seen = new Set<string>();
            const markers: React.ReactNode[] = [];
            for (const flow of renderableFlows) {
              if (!seen.has(flow.from)) {
                seen.add(flow.from);
                const coords = COUNTRY_CENTROIDS[flow.from];
                const isBoth = importerCodes.has(flow.from);
                markers.push(
                  <Marker key={`m-${flow.from}`} coordinates={coords}>
                    <circle r={2.5} fill={isBoth ? "#6366f1" : "#ef4444"} stroke="#fff" strokeWidth={0.5} />
                  </Marker>
                );
              }
              if (!seen.has(flow.to)) {
                seen.add(flow.to);
                const coords = COUNTRY_CENTROIDS[flow.to];
                const isBoth = exporterCodes.has(flow.to);
                markers.push(
                  <Marker key={`m-${flow.to}`} coordinates={coords}>
                    <circle r={2.5} fill={isBoth ? "#6366f1" : "#3b82f6"} stroke="#fff" strokeWidth={0.5} />
                  </Marker>
                );
              }
            }
            return markers;
          })()}
        </ZoomableGroup>
      </ComposableMap>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
          Exporter
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
          Importer
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block w-4 h-[2px] rounded bg-red-500"
            style={{ opacity: 0.5 }}
          />
          Trade flow
        </span>
      </div>
    </div>
  );
}

export default memo(TradeFlowMap);

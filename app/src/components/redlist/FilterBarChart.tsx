"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";

interface FilterBarChartProps {
  data: Array<{
    code?: string;
    shortRange?: string;
    count: number;
    label: string;
    color?: string;
    range?: string;
  }>;
  dataKey: "code" | "shortRange";
  selectedItems: Set<string>;
  onBarClick: (data: { payload?: { code?: string; range?: string } }, event: React.MouseEvent) => void;
  barColor?: string;
  yAxisWidth?: number;
  leftMargin?: number;
  rightMargin?: number;
  labelFormatter?: (label: string) => string;
  /** Fix the X axis max so bar lengths stay comparable across pages */
  xAxisMax?: number;
  /** Items to highlight with a ring/glow (e.g. search matches) */
  highlightedItems?: Set<string>;
  /** Truncate Y axis labels to this many characters */
  yAxisTickMaxLength?: number;
}

interface RowBackgroundProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: { code?: string; range?: string };
  onRowClick?: (payload: { code?: string; range?: string }, event: React.MouseEvent<SVGRectElement>) => void;
}

function RowBackground({ x = 0, y = 0, width = 0, height = 0, payload, onRowClick }: RowBackgroundProps) {
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill="transparent"
      style={{ cursor: "pointer" }}
      onClick={(event) => {
        if (payload && onRowClick) onRowClick(payload, event);
      }}
    />
  );
}

interface YAxisTickProps {
  x?: number;
  y?: number;
  payload?: { value: string };
  tickWidth: number;
  maxLength?: number;
  onTickClick: (value: string, event: React.MouseEvent<SVGGElement>) => void;
}

function YAxisTick({ x = 0, y = 0, payload, tickWidth, maxLength, onTickClick }: YAxisTickProps) {
  const value = payload?.value ?? "";
  const display =
    maxLength && value.length > maxLength ? value.slice(0, maxLength) + "…" : value;
  return (
    <g style={{ cursor: "pointer" }} onClick={(event) => onTickClick(value, event)}>
      <rect
        x={x - tickWidth}
        y={y - 10}
        width={tickWidth}
        height={20}
        fill="transparent"
      />
      <text x={x} y={y} dy={4} textAnchor="end" fontSize={11} fill="#a1a1aa">
        {display}
      </text>
    </g>
  );
}

export default function FilterBarChart({
  data,
  dataKey,
  selectedItems,
  onBarClick,
  barColor,
  yAxisWidth = 36,
  leftMargin = 5,
  rightMargin = 85,
  labelFormatter,
  xAxisMax,
  highlightedItems,
  yAxisTickMaxLength,
}: FilterBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 5, right: rightMargin, left: leftMargin, bottom: 5 }}
        barCategoryGap={4}
      >
        <XAxis type="number" hide domain={xAxisMax ? [0, xAxisMax] : undefined} />
        <YAxis
          type="category"
          dataKey={dataKey}
          tick={
            <YAxisTick
              tickWidth={yAxisWidth}
              maxLength={yAxisTickMaxLength}
              onTickClick={(value, event) => {
                const entry = data.find(
                  (d) => (dataKey === "code" ? d.code : d.shortRange) === value,
                );
                if (entry) {
                  onBarClick(
                    { payload: { code: entry.code, range: entry.range } },
                    event as unknown as React.MouseEvent,
                  );
                }
              }}
            />
          }
          tickLine={false}
          axisLine={false}
          width={yAxisWidth}
          interval={0}
        />
        <Tooltip
          formatter={(value: number) => [value.toLocaleString(), "Species"]}
          labelFormatter={labelFormatter}
          contentStyle={{
            backgroundColor: "#18181b",
            border: "1px solid #3f3f46",
            borderRadius: "8px",
          }}
          itemStyle={{ color: "#fff" }}
          labelStyle={{ color: "#a1a1aa" }}
        />
        <Bar
          dataKey="count"
          radius={[0, 4, 4, 0]}
          cursor="pointer"
          onClick={(barData, _index, event) => onBarClick(barData, event as React.MouseEvent)}
          background={
            <RowBackground
              onRowClick={(payload, event) => onBarClick({ payload }, event as unknown as React.MouseEvent)}
            />
          }
        >
          {data.map((entry, index) => {
            const itemKey = entry.code || entry.range || "";
            const isHighlighted = highlightedItems?.has(itemKey);
            const isDimmed = selectedItems.size > 0 && !selectedItems.has(itemKey);
            return (
              <Cell
                key={`cell-${index}`}
                fill={entry.color || barColor || "#3b82f6"}
                opacity={isDimmed && !isHighlighted ? 0.3 : 1}
                stroke={isHighlighted ? "#fff" : "none"}
                strokeWidth={isHighlighted ? 1.5 : 0}
              />
            );
          })}
          <LabelList
            dataKey="label"
            position="right"
            style={{ fontSize: 11, fill: "#a1a1aa" }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

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

const CHART_TOP_MARGIN = 5;
const CHART_BOTTOM_MARGIN = 5;

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
  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (data.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const plotHeight = rect.height - CHART_TOP_MARGIN - CHART_BOTTOM_MARGIN;
    if (plotHeight <= 0) return;
    const relativeY = event.clientY - rect.top - CHART_TOP_MARGIN;
    const index = Math.floor((relativeY / plotHeight) * data.length);
    if (index < 0 || index >= data.length) return;
    const entry = data[index];
    onBarClick({ payload: { code: entry.code, range: entry.range } }, event);
  };

  return (
    <div onClick={handleClick} style={{ width: "100%", height: "100%", cursor: "pointer" }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: CHART_TOP_MARGIN, right: rightMargin, left: leftMargin, bottom: CHART_BOTTOM_MARGIN }}
          barCategoryGap={4}
        >
          <XAxis type="number" hide domain={xAxisMax ? [0, xAxisMax] : undefined} />
          <YAxis
            type="category"
            dataKey={dataKey}
            tick={{ fontSize: 11, fill: "#a1a1aa" }}
            tickLine={false}
            axisLine={false}
            width={yAxisWidth}
            interval={0}
            tickFormatter={yAxisTickMaxLength ? (value: string) =>
              value.length > yAxisTickMaxLength ? value.slice(0, yAxisTickMaxLength) + "…" : value
            : undefined}
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
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
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
    </div>
  );
}

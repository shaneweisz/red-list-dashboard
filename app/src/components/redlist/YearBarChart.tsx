"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface YearBarChartProps {
  /** Data sorted ascending by year (chronological left-to-right) */
  data: Array<{
    code: string; // e.g. "2024"
    count: number;
    label: string; // e.g. "123 (4.5%)"
  }>;
  selectedItems: Set<string>;
  onBarClick: (data: { payload?: { code?: string } }, event: React.MouseEvent) => void;
  barColor?: string;
  /** Fixed Y-axis max so the scale stays stable across pagination */
  yMax?: number;
}

export default function YearBarChart({
  data,
  selectedItems,
  onBarClick,
  barColor = "#3b82f6",
  yMax,
}: YearBarChartProps) {
  // Compact number formatter for Y-axis ticks (e.g. 12000 → "12k")
  const formatTick = (value: number): string => {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k`;
    return String(value);
  };
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        margin={{ top: 8, right: 8, left: 4, bottom: 4 }}
        barCategoryGap={2}
      >
        <XAxis
          dataKey="code"
          type="category"
          tick={{ fontSize: 10, fill: "#a1a1aa" }}
          tickLine={false}
          axisLine={{ stroke: "#3f3f46" }}
          interval={0}
          angle={-45}
          textAnchor="end"
          height={40}
        />
        <YAxis
          type="number"
          tick={{ fontSize: 10, fill: "#a1a1aa" }}
          tickLine={false}
          axisLine={false}
          width={40}
          allowDecimals={false}
          domain={yMax != null ? [0, yMax] : undefined}
          tickFormatter={formatTick}
        />
        <Tooltip
          formatter={(value: number) => [value.toLocaleString(), "Species"]}
          labelFormatter={(year: string) => `Assessed ${year}`}
          contentStyle={{
            backgroundColor: "#18181b",
            border: "1px solid #3f3f46",
            borderRadius: "8px",
          }}
          itemStyle={{ color: "#fff" }}
          labelStyle={{ color: "#a1a1aa" }}
          cursor={{ fill: "#3f3f46", opacity: 0.2 }}
        />
        <Bar
          dataKey="count"
          radius={[3, 3, 0, 0]}
          cursor="pointer"
          onClick={(barData, _index, event) => onBarClick(barData, event as React.MouseEvent)}
        >
          {data.map((entry, index) => {
            const isDimmed = selectedItems.size > 0 && !selectedItems.has(entry.code);
            return (
              <Cell
                key={`cell-${index}`}
                fill={barColor}
                opacity={isDimmed ? 0.3 : 1}
              />
            );
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

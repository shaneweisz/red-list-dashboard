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
  rightMargin?: number;
}

export default function FilterBarChart({
  data,
  dataKey,
  selectedItems,
  onBarClick,
  barColor,
  yAxisWidth = 36,
  rightMargin = 85,
}: FilterBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 5, right: rightMargin, left: 5, bottom: 5 }}
        barCategoryGap={4}
      >
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey={dataKey}
          tick={{ fontSize: 11, fill: "#a1a1aa" }}
          tickLine={false}
          axisLine={false}
          width={yAxisWidth}
          interval={0}
        />
        <Tooltip
          formatter={(value: number) => [value.toLocaleString(), "Species"]}
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
        >
          {data.map((entry, index) => {
            const itemKey = entry.code || entry.range || "";
            return (
              <Cell
                key={`cell-${index}`}
                fill={entry.color || barColor || "#3b82f6"}
                opacity={selectedItems.size > 0 && !selectedItems.has(itemKey) ? 0.3 : 1}
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

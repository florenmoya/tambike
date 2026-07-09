"use client";

import * as React from "react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type AdminChartPoint = {
  date: string;
  published: number;
  registrations: number;
};

const chartConfig = {
  published: {
    label: "Published events",
    color: "var(--primary)",
  },
  registrations: {
    label: "Registrations",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

export function ChartAreaInteractive({ data }: { data: AdminChartPoint[] }) {
  const [range, setRange] = React.useState("90d");

  const filteredData = React.useMemo(() => {
    const days = range === "30d" ? 30 : range === "7d" ? 7 : 90;
    const reference = new Date(data.at(-1)?.date ?? "2026-07-31");
    const start = new Date(reference);
    start.setDate(start.getDate() - days);
    return data.filter((item) => new Date(item.date) >= start);
  }, [data, range]);

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Event operations</CardTitle>
        <CardDescription>
          Published events and rider registration movement across the review window.
        </CardDescription>
        <CardAction>
          <ToggleGroup
            type="single"
            value={range}
            onValueChange={(value) => value && setRange(value)}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:px-4! @[760px]/card:flex"
          >
            <ToggleGroupItem value="90d">90 days</ToggleGroupItem>
            <ToggleGroupItem value="30d">30 days</ToggleGroupItem>
            <ToggleGroupItem value="7d">7 days</ToggleGroupItem>
          </ToggleGroup>
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger
              className="flex w-32 @[760px]/card:hidden"
              size="sm"
              aria-label="Select chart range"
            >
              <SelectValue placeholder="90 days" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="90d">90 days</SelectItem>
              <SelectItem value="30d">30 days</SelectItem>
              <SelectItem value="7d">7 days</SelectItem>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[260px] w-full">
          <AreaChart data={filteredData}>
            <defs>
              <linearGradient id="fillPublished" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-published)" stopOpacity={0.9} />
                <stop offset="95%" stopColor="var(--color-published)" stopOpacity={0.08} />
              </linearGradient>
              <linearGradient id="fillRegistrations" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-registrations)" stopOpacity={0.55} />
                <stop offset="95%" stopColor="var(--color-registrations)" stopOpacity={0.08} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={(value) =>
                new Date(value).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })
              }
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) =>
                    new Date(value).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })
                  }
                  indicator="dot"
                />
              }
            />
            <Area
              dataKey="registrations"
              type="natural"
              fill="url(#fillRegistrations)"
              stroke="var(--color-registrations)"
              stackId="a"
            />
            <Area
              dataKey="published"
              type="natural"
              fill="url(#fillPublished)"
              stroke="var(--color-published)"
              stackId="a"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

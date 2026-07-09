import type { ReactNode } from "react";
import { TrendingUpIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type SectionCard = {
  label: string;
  value: string;
  detail: string;
  trend?: string;
  icon?: ReactNode;
};

export function SectionCards({ cards }: { cards: SectionCard[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      {cards.map((card) => (
        <Card
          className="@container/card bg-gradient-to-t from-primary/5 to-card shadow-xs"
          key={card.label}
        >
          <CardHeader>
            <CardDescription>{card.label}</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {card.value}
            </CardTitle>
            <CardAction>
              <Badge variant="outline">
                {card.icon ?? <TrendingUpIcon data-icon="inline-start" />}
                {card.trend ?? "Live"}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="text-muted-foreground">{card.detail}</div>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}

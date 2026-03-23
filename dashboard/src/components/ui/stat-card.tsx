import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "./card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: number;
  icon: LucideIcon;
  trend?: { value: number; label: string };
  color?: string;
  delay?: number;
}

const colorMap: Record<string, { bg: string; icon: string; ring: string }> = {
  blue: {
    bg: "bg-blue-50 dark:bg-blue-950/30",
    icon: "text-blue-600 dark:text-blue-400",
    ring: "ring-blue-200 dark:ring-blue-800",
  },
  purple: {
    bg: "bg-purple-50 dark:bg-purple-950/30",
    icon: "text-purple-600 dark:text-purple-400",
    ring: "ring-purple-200 dark:ring-purple-800",
  },
  amber: {
    bg: "bg-amber-50 dark:bg-amber-950/30",
    icon: "text-amber-600 dark:text-amber-400",
    ring: "ring-amber-200 dark:ring-amber-800",
  },
  emerald: {
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    icon: "text-emerald-600 dark:text-emerald-400",
    ring: "ring-emerald-200 dark:ring-emerald-800",
  },
  rose: {
    bg: "bg-rose-50 dark:bg-rose-950/30",
    icon: "text-rose-600 dark:text-rose-400",
    ring: "ring-rose-200 dark:ring-rose-800",
  },
  indigo: {
    bg: "bg-indigo-50 dark:bg-indigo-950/30",
    icon: "text-indigo-600 dark:text-indigo-400",
    ring: "ring-indigo-200 dark:ring-indigo-800",
  },
};

export function StatCard({ label, value, icon: Icon, trend, color = "indigo", delay = 0 }: StatCardProps) {
  const colors = colorMap[color] ?? colorMap.indigo;

  return (
    <Card
      hover
      className="animate-fade-in-up overflow-hidden"
      style={{ animationDelay: `${delay}ms` }}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {label}
            </p>
            <p className="text-3xl font-bold font-mono tracking-tight animate-count-up">
              {value.toLocaleString()}
            </p>
            {trend && (
              <div className="flex items-center gap-1">
                <span
                  className={cn(
                    "text-xs font-medium",
                    trend.value >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                  )}
                >
                  {trend.value >= 0 ? "↑" : "↓"} {Math.abs(trend.value)}%
                </span>
                <span className="text-[10px] text-muted-foreground">{trend.label}</span>
              </div>
            )}
          </div>
          <div className={cn("rounded-xl p-2.5 ring-1", colors.bg, colors.ring)}>
            <Icon className={cn("h-5 w-5", colors.icon)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

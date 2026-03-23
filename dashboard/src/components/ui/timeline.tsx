import { cn } from "@/lib/utils";
import { Activity, Shield, AlertTriangle, Clock } from "lucide-react";

export interface TimelineEvent {
  id: string | number;
  timestamp: string;
  title: string;
  description?: string;
  type: "masking" | "alert" | "session" | "info";
  severity?: "info" | "warning" | "critical";
  metadata?: Record<string, string | number>;
}

const typeConfig = {
  masking: { icon: Shield, color: "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400", line: "bg-indigo-300 dark:bg-indigo-700" },
  alert: { icon: AlertTriangle, color: "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400", line: "bg-amber-300 dark:bg-amber-700" },
  session: { icon: Activity, color: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400", line: "bg-emerald-300 dark:bg-emerald-700" },
  info: { icon: Clock, color: "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400", line: "bg-blue-300 dark:bg-blue-700" },
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface TimelineProps {
  events: TimelineEvent[];
  maxItems?: number;
}

export function Timeline({ events, maxItems = 50 }: TimelineProps) {
  const displayed = events.slice(0, maxItems);
  let lastDate = "";

  return (
    <div className="relative" role="list" aria-label="Event timeline">
      {displayed.map((event, i) => {
        const config = typeConfig[event.type];
        const Icon = config.icon;
        const date = formatDate(event.timestamp);
        const showDate = date !== lastDate;
        lastDate = date;

        return (
          <div key={event.id} role="listitem">
            {showDate && (
              <div className="flex items-center gap-2 py-2 pl-10">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  {date}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>
            )}
            <div className="flex gap-3 group">
              {/* Timeline line + icon */}
              <div className="flex flex-col items-center w-8 flex-shrink-0">
                <div className={cn("rounded-full p-1.5", config.color)}>
                  <Icon className="h-3 w-3" aria-hidden="true" />
                </div>
                {i < displayed.length - 1 && (
                  <div className={cn("w-0.5 flex-1 min-h-[16px]", config.line, "opacity-30")} />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pb-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium truncate">{event.title}</span>
                  <span className="text-[10px] text-muted-foreground flex-shrink-0">
                    {formatTime(event.timestamp)}
                  </span>
                </div>
                {event.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {event.description}
                  </p>
                )}
                {event.metadata && (
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {Object.entries(event.metadata).map(([key, val]) => (
                      <span
                        key={key}
                        className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5"
                      >
                        <span className="font-medium">{key}:</span> {val}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {events.length > maxItems && (
        <p className="text-xs text-muted-foreground text-center py-2">
          Showing {maxItems} of {events.length} events
        </p>
      )}
    </div>
  );
}

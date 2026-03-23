import { useState } from "react";
import { Filter, X, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "./button";
import { Badge } from "./badge";
import { cn } from "@/lib/utils";
import type { FilterState } from "@/lib/filters";
import { defaultFilters, isFilterActive, toggleArrayItem } from "@/lib/filters";

interface FilterPanelProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  availableProviders?: string[];
  availablePiiTypes?: string[];
}

export function FilterPanel({
  filters,
  onChange,
  availableProviders = [],
  availablePiiTypes = [],
}: FilterPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const active = isFilterActive(filters);

  return (
    <div className="space-y-2" role="region" aria-label="Advanced filters">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={expanded}
        aria-controls="filter-panel-content"
      >
        <Filter className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Filters</span>
        {active && (
          <Badge variant="secondary" className="text-[10px] px-1.5">
            Active
          </Badge>
        )}
        {expanded ? (
          <ChevronUp className="h-3 w-3" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        )}
      </button>

      {expanded && (
        <div
          id="filter-panel-content"
          className="rounded-xl border border-border bg-card p-4 space-y-4 animate-fade-in"
        >
          {/* Date range */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="filter-date-from" className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium block mb-1">
                From
              </label>
              <input
                id="filter-date-from"
                type="date"
                value={filters.dateFrom}
                onChange={(e) => onChange({ ...filters, dateFrom: e.target.value })}
                className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div>
              <label htmlFor="filter-date-to" className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium block mb-1">
                To
              </label>
              <input
                id="filter-date-to"
                type="date"
                value={filters.dateTo}
                onChange={(e) => onChange({ ...filters, dateTo: e.target.value })}
                className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          {/* Provider filter */}
          {availableProviders.length > 0 && (
            <div>
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium block mb-1.5">
                Provider
              </span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by provider">
                {availableProviders.map((p) => (
                  <button
                    key={p}
                    onClick={() => onChange({ ...filters, providers: toggleArrayItem(filters.providers, p) })}
                    className={cn(
                      "px-2.5 py-1 rounded-full text-xs font-medium transition-colors border",
                      filters.providers.includes(p)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                    )}
                    aria-pressed={filters.providers.includes(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* PII type filter */}
          {availablePiiTypes.length > 0 && (
            <div>
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium block mb-1.5">
                PII Type
              </span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by PII type">
                {availablePiiTypes.map((t) => (
                  <button
                    key={t}
                    onClick={() => onChange({ ...filters, piiTypes: toggleArrayItem(filters.piiTypes, t) })}
                    className={cn(
                      "px-2.5 py-1 rounded-full text-xs font-medium transition-colors border",
                      filters.piiTypes.includes(t)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                    )}
                    aria-pressed={filters.piiTypes.includes(t)}
                  >
                    {t.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Clear */}
          {active && (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onChange(defaultFilters)}
                className="text-xs"
              >
                <X className="h-3 w-3 mr-1" aria-hidden="true" />
                Clear filters
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

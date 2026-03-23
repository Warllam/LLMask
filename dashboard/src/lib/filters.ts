/**
 * Filter state and helpers for advanced filtering
 */

export interface FilterState {
  providers: string[];
  piiTypes: string[];
  dateFrom: string;
  dateTo: string;
  severity: string[];
  searchQuery: string;
}

export const defaultFilters: FilterState = {
  providers: [],
  piiTypes: [],
  dateFrom: "",
  dateTo: "",
  severity: [],
  searchQuery: "",
};

export function isFilterActive(filters: FilterState): boolean {
  return (
    filters.providers.length > 0 ||
    filters.piiTypes.length > 0 ||
    filters.dateFrom !== "" ||
    filters.dateTo !== "" ||
    filters.severity.length > 0 ||
    filters.searchQuery !== ""
  );
}

export function toggleArrayItem<T>(arr: T[], item: T): T[] {
  return arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
}

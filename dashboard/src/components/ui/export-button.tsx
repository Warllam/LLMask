import { useState } from "react";
import { Download, FileJson, FileSpreadsheet } from "lucide-react";

interface ExportButtonProps {
  onExportJSON: () => void;
  onExportCSV: () => void;
  label?: string;
}

export function ExportButton({ onExportJSON, onExportCSV, label = "Export" }: ExportButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors border border-border"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${label} data`}
      >
        <Download className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full mt-1 z-50 w-40 rounded-xl border border-border bg-card shadow-lg py-1 animate-fade-in"
            role="menu"
          >
            <button
              className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted transition-colors"
              onClick={() => { onExportJSON(); setOpen(false); }}
              role="menuitem"
            >
              <FileJson className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
              Export JSON
            </button>
            <button
              className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted transition-colors"
              onClick={() => { onExportCSV(); setOpen(false); }}
              role="menuitem"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
              Export CSV
            </button>
          </div>
        </>
      )}
    </div>
  );
}

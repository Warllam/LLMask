import { Shield, MessageSquare, Home, Keyboard, Menu, Activity, Settings, HeartPulse } from "lucide-react";
import { useState } from "react";
import type { View } from "@/lib/types";
import { cn } from "@/lib/utils";

interface HeaderProps {
  currentView: View;
  sessionTitle: string | null;
  onToggleSidebar?: () => void;
}

const viewConfig: Record<View, { label: string; icon: typeof Home }> = {
  welcome: { label: "Overview", icon: Home },
  activity: { label: "Activity Feed", icon: Activity },
  config: { label: "Configuration", icon: Settings },
  health: { label: "System Health", icon: HeartPulse },
  chat: { label: "Chat", icon: MessageSquare },
  conversation: { label: "Conversation", icon: Shield },
};

const shortcuts = [
  { key: "c", label: "Chat" },
  { key: "h", label: "Health" },
  { key: "/", label: "Search" },
  { key: "[", label: "Sidebar" },
  { key: "t", label: "Theme" },
  { key: "Esc", label: "Home" },
];

export function Header({ currentView, sessionTitle, onToggleSidebar }: HeaderProps) {
  const [showShortcuts, setShowShortcuts] = useState(false);
  const config = viewConfig[currentView];
  const title = currentView === "conversation" ? (sessionTitle ?? "Conversation") : config.label;
  const Icon = config.icon;

  return (
    <header className="flex items-center h-12 px-4 md:px-6 border-b border-border bg-card/80 glass sticky top-0 z-20" role="banner">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="md:hidden p-1.5 rounded-md hover:bg-muted transition-colors mr-1"
            aria-label="Toggle navigation menu"
          >
            <Menu className="h-4 w-4" />
          </button>
        )}
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Shield className="h-3.5 w-3.5 hidden sm:block" />
          <span className="text-xs hidden sm:inline">LLMask</span>
          <span className="text-xs hidden sm:inline">/</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-primary" />
          <span className="text-sm font-medium truncate">{title}</span>
        </div>
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="relative">
        <button
          onClick={() => setShowShortcuts((p) => !p)}
          className="hidden md:flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <Keyboard className="h-3.5 w-3.5" />
          <span className="text-[10px]">Shortcuts</span>
        </button>
        {showShortcuts && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowShortcuts(false)} />
            <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-xl border border-border bg-card shadow-lg p-3 animate-fade-in">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                Keyboard Shortcuts
              </p>
              <div className="space-y-1.5">
                {shortcuts.map((s) => (
                  <div key={s.key} className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{s.label}</span>
                    <kbd className={cn(
                      "inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded",
                      "bg-muted border border-border text-[10px] font-mono font-medium"
                    )}>
                      {s.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </header>
  );
}

import { Shield, MessageSquare, Home, Keyboard, Menu, Activity, Settings, HeartPulse, Lock, ClipboardList, SlidersHorizontal, LogOut, User, Filter, Terminal, Monitor } from "lucide-react";
import { useState } from "react";
import type { View } from "@/lib/types";
import type { AuthUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

interface HeaderProps {
  currentView: View;
  sessionTitle: string | null;
  onToggleSidebar?: () => void;
  currentUser?: AuthUser | null;
  onLogout?: () => void;
}

const viewConfig: Record<View, { label: string; icon: typeof Home }> = {
  welcome: { label: "Accueil / Overview", icon: Home },
  activity: { label: "Activité en direct / Live Activity", icon: Activity },
  config: { label: "Configuration avancée", icon: Settings },
  health: { label: "État du système / System Health", icon: HeartPulse },
  chat: { label: "Assistant IA / AI Chat", icon: MessageSquare },
  conversation: { label: "Conversation", icon: Shield },
  gdpr: { label: "Conformité RGPD / GDPR Compliance", icon: Lock },
  settings: { label: "Réglages / Settings", icon: SlidersHorizontal },
  requestlog: { label: "Journal des requêtes / Request Log", icon: ClipboardList },
  "custom-rules": { label: "Règles personnalisées / Custom Rules", icon: Filter },
  sessions: { label: "Sessions de code / Code Sessions", icon: Terminal },
  "cli-monitor": { label: "CLI Monitor / Activity", icon: Monitor },
};

const shortcuts = [
  { key: "c", label: "Chat" },
  { key: "h", label: "Health" },
  { key: "/", label: "Search" },
  { key: "[", label: "Sidebar" },
  { key: "t", label: "Theme" },
  { key: "Esc", label: "Home" },
];

export function Header({ currentView, sessionTitle, onToggleSidebar, currentUser, onLogout }: HeaderProps) {
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

      {/* Right-side controls */}
      <div className="flex items-center gap-1">
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

        {/* Current user + logout */}
        {currentUser && (
          <div className="flex items-center gap-1.5 pl-2 border-l border-border ml-1">
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-muted-foreground">
              <User className="h-3.5 w-3.5" />
              <span className="font-medium">{currentUser.username}</span>
              <span className={cn(
                "px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide",
                currentUser.role === "admin"
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground"
              )}>
                {currentUser.role}
              </span>
            </div>
            {onLogout && (
              <button
                onClick={onLogout}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline text-[10px]">Sign out</span>
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

import { useState, useRef, useEffect, useMemo, type ElementType } from "react";
import {
  Search,
  Shield,
  MessageSquare,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeft,
  MoreHorizontal,
  Pencil,
  Trash2,
  Plus,
  Home,
  Activity,
  Settings,
  HeartPulse,
  Lock,
  ClipboardList,
  SlidersHorizontal,
  Filter,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTheme } from "./ThemeProvider";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { SessionSummary, View } from "@/lib/types";

interface SidebarProps {
  sessions: SessionSummary[];
  loading: boolean;
  selectedSession: string | null;
  currentView: View;
  collapsed: boolean;
  onSelectSession: (traceId: string) => void;
  onNavigate: (view: View, opts?: { chatSessionId?: string }) => void;
  onToggleCollapse: () => void;
  onDeleteSession?: (traceId: string) => void;
  onRenameSession?: (traceId: string, newTitle: string) => void;
}

function groupByDate(sessions: SessionSummary[]): { label: string; sessions: SessionSummary[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);

  const groups: Record<string, SessionSummary[]> = {
    Today: [],
    Yesterday: [],
    "This Week": [],
    Older: [],
  };

  for (const s of sessions) {
    const d = new Date(s.lastRequestAt);
    if (d >= today) groups.Today.push(s);
    else if (d >= yesterday) groups.Yesterday.push(s);
    else if (d >= weekAgo) groups["This Week"].push(s);
    else groups.Older.push(s);
  }

  return Object.entries(groups)
    .filter(([, arr]) => arr.length > 0)
    .map(([label, sessions]) => ({ label, sessions }));
}

export function Sidebar({
  sessions,
  loading,
  selectedSession,
  currentView,
  collapsed,
  onSelectSession,
  onNavigate,
  onToggleCollapse,
  onDeleteSession,
  onRenameSession,
}: SidebarProps) {
  const { theme, toggle: toggleTheme } = useTheme();
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  useEffect(() => {
    if (renaming) renameInputRef.current?.focus();
  }, [renaming]);

  const filtered = sessions.filter(
    (s) =>
      !search ||
      s.title.toLowerCase().includes(search.toLowerCase()) ||
      s.previewMessage?.toLowerCase().includes(search.toLowerCase())
  );

  const groupedSessions = useMemo(() => groupByDate(filtered), [filtered]);

  if (collapsed) {
    return (
      <aside className="hidden md:flex flex-col items-center w-14 border-r border-border bg-card py-3 gap-1" role="navigation" aria-label="Collapsed sidebar">
        <Button variant="ghost" size="icon" onClick={onToggleCollapse} className="mb-2" aria-label="Expand sidebar">
          <PanelLeft className="h-4 w-4" />
        </Button>
        <div className="w-8 h-px bg-border mb-1" />
        {(
          [
            { view: "welcome", icon: Home, label: "Accueil" },
            { view: "requestlog", icon: ClipboardList, label: "Requêtes" },
            { view: "activity", icon: Activity, label: "Activité" },
            { view: "chat", icon: MessageSquare, label: "Chat" },
            { view: "custom-rules", icon: Filter, label: "Custom Rules" },
          ] as const
        ).map(({ view, icon: Icon, label }) => (
          <Button
            key={view}
            variant="ghost"
            size="icon"
            onClick={() => onNavigate(view)}
            className={cn(currentView === view && "bg-primary/10 text-primary")}
            title={label}
          >
            <Icon className="h-4 w-4" />
          </Button>
        ))}
        <div className="flex-1" />
        {(
          [
            { view: "health", icon: HeartPulse, label: "Health" },
            { view: "gdpr", icon: Lock, label: "GDPR Compliance" },
            { view: "settings", icon: SlidersHorizontal, label: "Réglages" },
            { view: "config", icon: Settings, label: "Config" },
          ] as const
        ).map(({ view, icon: Icon, label }) => (
          <Button
            key={view}
            variant="ghost"
            size="icon"
            onClick={() => onNavigate(view)}
            className={cn(currentView === view && "bg-primary/10 text-primary")}
            title={label}
          >
            <Icon className="h-4 w-4" />
          </Button>
        ))}
        <Button variant="ghost" size="icon" onClick={toggleTheme} data-theme-toggle>
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </aside>
    );
  }

  return (
    <>
      {/* Mobile overlay */}
      <div
        className="fixed inset-0 z-40 bg-black/40 md:hidden"
        onClick={onToggleCollapse}
        aria-hidden="true"
      />
    <aside className="flex flex-col w-[280px] border-r border-border bg-card sidebar-mobile" role="navigation" aria-label="Main navigation">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 p-1.5">
            <Shield className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="text-[15px] font-bold tracking-tight gradient-text">LLMask</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" onClick={toggleTheme} data-theme-toggle className="h-8 w-8" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
            {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={onToggleCollapse} className="h-8 w-8" aria-label="Collapse sidebar">
            <PanelLeftClose className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* New chat button */}
      <div className="px-3 pt-3 pb-1">
        <button
          onClick={() => onNavigate("chat")}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-xl border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/5 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New Chat
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search sessions…"
            className="pl-8 h-8 text-xs rounded-lg"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-search-input
            aria-label="Search sessions"
          />
        </div>
      </div>

      {/* Sessions list with date groups */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-3 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            {search ? "No matching sessions" : "No sessions yet"}
          </div>
        ) : (
          groupedSessions.map((group) => (
            <div key={group.label}>
              <div className="px-4 py-1.5 sticky top-0 bg-card/95 glass z-10">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                  {group.label}
                </span>
              </div>
              {group.sessions.map((session) => (
                <div
                  key={session.traceId}
                  className={cn(
                    "group relative w-full text-left px-3 py-2.5 border-l-2 border-transparent transition-all cursor-pointer",
                    selectedSession === session.traceId
                      ? "bg-primary/5 border-l-primary"
                      : "hover:bg-muted/50"
                  )}
                  onClick={() => onSelectSession(session.traceId)}
                >
                  {renaming === session.traceId ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const trimmed = renameValue.trim();
                        if (trimmed && onRenameSession) onRenameSession(session.traceId, trimmed);
                        setRenaming(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        ref={renameInputRef}
                        className="w-full text-[13px] font-medium bg-background border border-input rounded-md px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => {
                          const trimmed = renameValue.trim();
                          if (trimmed && onRenameSession) onRenameSession(session.traceId, trimmed);
                          setRenaming(null);
                        }}
                        onKeyDown={(e) => { if (e.key === "Escape") setRenaming(null); }}
                      />
                    </form>
                  ) : (
                    <div className="text-[13px] font-medium truncate pr-6">{session.title}</div>
                  )}
                  {session.previewMessage && renaming !== session.traceId && (
                    <div className="text-xs text-muted-foreground truncate mt-0.5">{session.previewMessage}</div>
                  )}
                  <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-0.5">
                      <Activity className="h-2.5 w-2.5" />
                      {session.requestCount}
                    </span>
                    <span>·</span>
                    <span className="inline-flex items-center gap-0.5">
                      <Shield className="h-2.5 w-2.5" />
                      {session.totalTransforms}
                    </span>
                    <span>·</span>
                    <span>{formatRelativeTime(session.lastRequestAt)}</span>
                  </div>

                  {renaming !== session.traceId && (
                    <button
                      className="absolute top-2.5 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen(menuOpen === session.traceId ? null : session.traceId);
                      }}
                    >
                      <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  )}

                  {menuOpen === session.traceId && (
                    <div
                      ref={menuRef}
                      className="absolute right-2 top-8 z-50 w-36 rounded-xl border border-border bg-card shadow-lg py-1 animate-fade-in"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-muted transition-colors"
                        onClick={() => {
                          setMenuOpen(null);
                          setRenameValue(session.title);
                          setRenaming(session.traceId);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                        Rename
                      </button>
                      <button
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 transition-colors"
                        onClick={() => {
                          setMenuOpen(null);
                          if (onDeleteSession) onDeleteSession(session.traceId);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Nav bottom */}
      <div className="border-t border-border p-2 space-y-0.5">
        <NavItem icon={Home} view="welcome" label="Accueil" sublabel="Overview" currentView={currentView} onNavigate={onNavigate} />
        <NavItem icon={ClipboardList} view="requestlog" label="Journal des requêtes" sublabel="Request log" currentView={currentView} onNavigate={onNavigate} />
        <NavItem icon={Activity} view="activity" label="Activité en direct" sublabel="Live activity" currentView={currentView} onNavigate={onNavigate} />
        <NavItem icon={MessageSquare} view="chat" label="Assistant IA" sublabel="AI chat" currentView={currentView} onNavigate={onNavigate} />
        <NavItem icon={Filter} view="custom-rules" label="Règles personnalisées" sublabel="Custom rules" currentView={currentView} onNavigate={onNavigate} />
        <div className="h-px bg-border/50 my-1" />
        <NavItem icon={HeartPulse} view="health" label="État du système" sublabel="System health" currentView={currentView} onNavigate={onNavigate} />
        <NavItem icon={Lock} view="gdpr" label="Conformité RGPD" sublabel="GDPR compliance" currentView={currentView} onNavigate={onNavigate} />
        <NavItem icon={SlidersHorizontal} view="settings" label="Réglages" sublabel="Settings" currentView={currentView} onNavigate={onNavigate} />
        <NavItem icon={Settings} view="config" label="Configuration" sublabel="Advanced config" currentView={currentView} onNavigate={onNavigate} />
      </div>
    </aside>
    </>
  );
}

function NavItem({
  icon: Icon,
  view,
  label,
  sublabel,
  currentView,
  onNavigate,
}: {
  icon: ElementType;
  view: View;
  label: string;
  sublabel: string;
  currentView: View;
  onNavigate: (view: View) => void;
}) {
  const active = currentView === view;
  return (
    <button
      onClick={() => onNavigate(view)}
      className={cn(
        "flex items-center gap-2.5 w-full px-3 py-2 rounded-lg transition-colors text-left",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
      )}
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      <div className="min-w-0">
        <div className={cn("text-[13px] leading-tight truncate", active && "font-semibold")}>{label}</div>
        <div className="text-[10px] opacity-60 truncate">{sublabel}</div>
      </div>
    </button>
  );
}

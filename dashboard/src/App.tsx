import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { ToastProvider } from "@/components/ui/toast";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { Welcome } from "@/components/views/Welcome";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { api } from "@/lib/api";
import type { SessionSummary, View } from "@/lib/types";

// Lazy-loaded heavy views
const Conversation = lazy(() => import("@/components/views/Conversation").then((m) => ({ default: m.Conversation })));
const Chat = lazy(() => import("@/components/views/Chat").then((m) => ({ default: m.Chat })));
const ActivityFeed = lazy(() => import("@/components/views/ActivityFeed").then((m) => ({ default: m.ActivityFeed })));
const Configuration = lazy(() => import("@/components/views/Configuration").then((m) => ({ default: m.Configuration })));
const SystemHealth = lazy(() => import("@/components/views/SystemHealth").then((m) => ({ default: m.SystemHealth })));

function ViewFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="animate-pulse text-sm text-muted-foreground">Loading…</div>
    </div>
  );
}

export function App() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<View>("welcome");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth < 768);

  // Load sessions
  const refreshSessions = useCallback(() => {
    api.sessions().then(setSessions).catch(console.error);
  }, []);

  useEffect(() => {
    refreshSessions();
    setSessionsLoading(false);
  }, [refreshSessions]);

  // Hash routing
  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.slice(1);
      if (hash.startsWith("chat/")) {
        const traceId = decodeURIComponent(hash.slice(5));
        setChatSessionId(traceId);
        setCurrentView("chat");
        setSelectedSession(null);
      } else if (hash === "activity") {
        setCurrentView("activity");
        setSelectedSession(null);
      } else if (hash === "config") {
        setCurrentView("config");
        setSelectedSession(null);
      } else if (hash === "health") {
        setCurrentView("health");
        setSelectedSession(null);
      } else if (hash === "chat") {
        setChatSessionId(null);
        setCurrentView("chat");
        setSelectedSession(null);
      } else if (hash.startsWith("session/")) {
        const traceId = decodeURIComponent(hash.slice(8));
        setSelectedSession(traceId);
        setCurrentView("conversation");
      } else {
        setCurrentView("welcome");
        setSelectedSession(null);
      }
    };

    handleHash();
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  const handleSelectSession = useCallback((traceId: string) => {
    setSelectedSession(traceId);
    setChatSessionId(traceId);
    setCurrentView("chat");
    window.location.hash = `chat/${encodeURIComponent(traceId)}`;
  }, []);

  const handleNavigate = useCallback((view: View, opts?: { chatSessionId?: string }) => {
    setCurrentView(view);
    setSelectedSession(null);
    if (view === "chat") {
      const sid = opts?.chatSessionId ?? null;
      setChatSessionId(sid);
      window.location.hash = sid ? `chat/${encodeURIComponent(sid)}` : "chat";
    } else if (view === "activity") {
      window.location.hash = "activity";
    } else if (view === "config") {
      window.location.hash = "config";
    } else if (view === "health") {
      window.location.hash = "health";
    } else {
      window.location.hash = "";
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      // Don't hijack browser shortcuts (Ctrl/Cmd+C, Ctrl/Cmd+V, etc.)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key) {
        case "/":
          e.preventDefault();
          document.querySelector<HTMLInputElement>("[data-search-input]")?.focus();
          break;
        case "c":
          handleNavigate("chat");
          break;
        case "h":
          handleNavigate("health");
          break;
        case "t":
          // Theme toggle is handled by ThemeProvider
          document.querySelector<HTMLButtonElement>("[data-theme-toggle]")?.click();
          break;
        case "[":
          setSidebarCollapsed((p) => !p);
          break;
        case "Escape":
          handleNavigate("welcome");
          break;
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleNavigate]);

  const handleDeleteSession = useCallback((traceId: string) => {
    api.deleteSession(traceId).then(() => {
      setSessions((prev) => prev.filter((s) => s.traceId !== traceId));
      if (selectedSession === traceId || chatSessionId === traceId) {
        handleNavigate("welcome");
      }
    }).catch(console.error);
  }, [selectedSession, chatSessionId, handleNavigate]);

  const handleRenameSession = useCallback((traceId: string, newTitle: string) => {
    api.updateSessionTitle(traceId, newTitle).then(({ title }) => {
      setSessions((prev) =>
        prev.map((s) => s.traceId === traceId ? { ...s, title } : s)
      );
    }).catch(console.error);
  }, []);

  const sessionTitle =
    sessions.find((s) => s.traceId === selectedSession)?.title ?? null;

  return (
    <ThemeProvider>
      <ToastProvider>
      <div className="flex h-screen overflow-hidden bg-background" role="application" aria-label="LLMask Dashboard">
        <Sidebar
          sessions={sessions}
          loading={sessionsLoading}
          selectedSession={selectedSession}
          currentView={currentView}
          collapsed={sidebarCollapsed}
          onSelectSession={handleSelectSession}
          onNavigate={handleNavigate}
          onToggleCollapse={() => setSidebarCollapsed((p) => !p)}
          onDeleteSession={handleDeleteSession}
          onRenameSession={handleRenameSession}
        />

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <Header
            currentView={currentView}
            sessionTitle={sessionTitle}
            onToggleSidebar={() => setSidebarCollapsed((p) => !p)}
          />

          <main className="flex-1 overflow-hidden" role="main" aria-label="Main content">
            <ErrorBoundary>
            <Suspense fallback={<ViewFallback />}>
              {currentView === "welcome" && <Welcome />}
              {currentView === "conversation" && selectedSession && (
                <Conversation traceId={selectedSession} />
              )}
              {currentView === "activity" && <ActivityFeed />}
              {currentView === "config" && <Configuration />}
              {currentView === "health" && <SystemHealth />}
              {currentView === "chat" && <Chat sessionId={chatSessionId} onSessionUpdate={refreshSessions} />}
            </Suspense>
            </ErrorBoundary>
          </main>
        </div>
      </div>
      </ToastProvider>
    </ThemeProvider>
  );
}

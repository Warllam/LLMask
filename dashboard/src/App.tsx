import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { ToastProvider } from "@/components/ui/toast";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { Welcome } from "@/components/views/Welcome";
import { LoginPage } from "@/components/auth/LoginPage";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { api } from "@/lib/api";
import { authStore, logout, type AuthUser } from "@/lib/auth";
import type { SessionSummary, View } from "@/lib/types";

// Lazy-loaded heavy views
const Conversation = lazy(() => import("@/components/views/Conversation").then((m) => ({ default: m.Conversation })));
const Chat = lazy(() => import("@/components/views/Chat").then((m) => ({ default: m.Chat })));
const ActivityFeed = lazy(() => import("@/components/views/ActivityFeed").then((m) => ({ default: m.ActivityFeed })));
const Configuration = lazy(() => import("@/components/views/Configuration").then((m) => ({ default: m.Configuration })));
const SystemHealth = lazy(() => import("@/components/views/SystemHealth").then((m) => ({ default: m.SystemHealth })));
const GdprCompliance = lazy(() => import("@/components/views/GdprCompliance").then((m) => ({ default: m.GdprCompliance })));
const Settings = lazy(() => import("@/components/views/Settings").then((m) => ({ default: m.Settings })));
const RequestLog = lazy(() => import("@/components/views/RequestLog").then((m) => ({ default: m.RequestLog })));
const CustomRules = lazy(() => import("@/components/views/CustomRules").then((m) => ({ default: m.CustomRules })));
const Sessions = lazy(() => import("@/components/views/Sessions").then((m) => ({ default: m.Sessions })));
const CliMonitor = lazy(() => import("@/components/views/CliMonitor").then((m) => ({ default: m.CliMonitor })));

function ViewFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="animate-pulse text-sm text-muted-foreground">Loading…</div>
    </div>
  );
}

export function App() {
  // Auth state — initialized from in-memory store (populated if user already logged in this session)
  const [authedUser, setAuthedUser] = useState<AuthUser | null>(() => authStore.getUser());

  const handleLogin = useCallback((user: AuthUser) => {
    setAuthedUser(user);
  }, []);

  const handleLogout = useCallback(async () => {
    await logout();
    setAuthedUser(null);
  }, []);

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
      } else if (hash === "gdpr") {
        setCurrentView("gdpr");
        setSelectedSession(null);
      } else if (hash === "settings") {
        setCurrentView("settings");
        setSelectedSession(null);
      } else if (hash === "requestlog") {
        setCurrentView("requestlog");
        setSelectedSession(null);
      } else if (hash === "custom-rules") {
        setCurrentView("custom-rules");
        setSelectedSession(null);
      } else if (hash === "sessions") {
        setCurrentView("sessions");
        setSelectedSession(null);
      } else if (hash === "cli-monitor") {
        setCurrentView("cli-monitor");
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
    } else if (view === "gdpr") {
      window.location.hash = "gdpr";
    } else if (view === "settings") {
      window.location.hash = "settings";
    } else if (view === "requestlog") {
      window.location.hash = "requestlog";
    } else if (view === "custom-rules") {
      window.location.hash = "custom-rules";
    } else if (view === "sessions") {
      window.location.hash = "sessions";
    } else if (view === "cli-monitor") {
      window.location.hash = "cli-monitor";
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

  // Show login page when unauthenticated
  if (!authedUser) {
    return (
      <ThemeProvider>
        <LoginPage onLogin={handleLogin} />
      </ThemeProvider>
    );
  }

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
            currentUser={authedUser}
            onLogout={handleLogout}
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
              {currentView === "gdpr" && <GdprCompliance />}
              {currentView === "settings" && <Settings />}
              {currentView === "requestlog" && <RequestLog />}
              {currentView === "custom-rules" && <CustomRules />}
              {currentView === "sessions" && <Sessions />}
              {currentView === "cli-monitor" && <CliMonitor />}
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

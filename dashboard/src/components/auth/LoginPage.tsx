import { useState, useCallback } from "react";
import { Shield } from "lucide-react";
import { login, type AuthUser } from "@/lib/auth";

interface LoginPageProps {
  onLogin: (user: AuthUser) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setLoading(true);
      try {
        const user = await login(username, password);
        onLogin(user);
      } catch (err) {
        setError((err as Error).message || "Login failed");
      } finally {
        setLoading(false);
      }
    },
    [username, password, onLogin]
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo / branding */}
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">LLMask</h1>
          <p className="text-sm text-muted-foreground">Sign in to your dashboard</p>
        </div>

        {/* Login form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="username" className="text-sm font-medium">
              Username
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={[
                "w-full rounded-lg border bg-background px-3 py-2 text-sm",
                "placeholder:text-muted-foreground",
                "focus:outline-none focus:ring-2 focus:ring-primary/40",
                "disabled:opacity-50",
                error ? "border-destructive" : "border-input",
              ].join(" ")}
              placeholder="admin"
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={[
                "w-full rounded-lg border bg-background px-3 py-2 text-sm",
                "placeholder:text-muted-foreground",
                "focus:outline-none focus:ring-2 focus:ring-primary/40",
                "disabled:opacity-50",
                error ? "border-destructive" : "border-input",
              ].join(" ")}
              placeholder="••••••••"
              disabled={loading}
            />
          </div>

          {error && (
            <p className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            className={[
              "w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground",
              "hover:bg-primary/90 transition-colors",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "focus:outline-none focus:ring-2 focus:ring-primary/40",
            ].join(" ")}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

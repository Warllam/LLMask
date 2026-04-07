/**
 * In-memory JWT store — intentionally NOT persisted to localStorage/sessionStorage
 * to avoid XSS token theft. Token lives only for the current page session.
 */

export type AuthUser = {
  id: string;
  username: string;
  role: "admin" | "viewer";
};

let _token: string | null = null;
let _user: AuthUser | null = null;

export const authStore = {
  getToken(): string | null {
    return _token;
  },
  getUser(): AuthUser | null {
    return _user;
  },
  isAuthenticated(): boolean {
    return _token !== null;
  },
  set(token: string, user: AuthUser): void {
    _token = token;
    _user = user;
  },
  clear(): void {
    _token = null;
    _user = null;
  },
};

/** Call the login endpoint and populate the auth store on success. */
export async function login(username: string, password: string): Promise<AuthUser> {
  const res = await fetch("/dashboard/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body?.error?.message ?? "Login failed");
  }
  const data = await res.json() as { token: string; user: AuthUser };
  authStore.set(data.token, data.user);
  return data.user;
}

/** Call the logout endpoint and clear the auth store. */
export async function logout(): Promise<void> {
  const token = authStore.getToken();
  authStore.clear();
  if (token) {
    await fetch("/dashboard/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => { /* best-effort */ });
  }
}

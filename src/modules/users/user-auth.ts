import { sign, verify } from "jsonwebtoken";
import { compare, hash } from "bcryptjs";
import type { UserStore } from "./user-store";

export type JwtPayload = {
  sub: string;      // user id
  username: string;
  role: "admin" | "viewer";
  iat: number;
  exp: number;
};

export type AuthedUser = {
  id: string;
  username: string;
  role: "admin" | "viewer";
};

const BCRYPT_ROUNDS = 12;
const JWT_EXPIRY = "8h";

export class UserAuthService {
  private readonly store: UserStore;
  private readonly jwtSecret: string;
  /** In-memory revoked token set — cleared on restart (tokens expire in 8h anyway). */
  private revokedTokens = new Set<string>();

  constructor(store: UserStore, jwtSecret: string) {
    this.store = store;
    this.jwtSecret = jwtSecret;
  }

  hashPassword(password: string): Promise<string> {
    return hash(password, BCRYPT_ROUNDS);
  }

  verifyPassword(password: string, passwordHash: string): Promise<boolean> {
    return compare(password, passwordHash);
  }

  async login(
    username: string,
    password: string
  ): Promise<{ token: string; user: AuthedUser } | null> {
    const row = this.store.getUserByUsername(username);
    if (!row) return null;

    const ok = await this.verifyPassword(password, row.password_hash);
    if (!ok) return null;

    this.store.updateLastLogin(row.id);

    const token = sign(
      { sub: row.id, username: row.username, role: row.role },
      this.jwtSecret,
      { expiresIn: JWT_EXPIRY }
    );

    return {
      token,
      user: { id: row.id, username: row.username, role: row.role },
    };
  }

  logout(token: string): void {
    this.revokedTokens.add(token);
    // Prevent unbounded growth — prune oldest half when large
    if (this.revokedTokens.size > 10_000) {
      const arr = Array.from(this.revokedTokens);
      this.revokedTokens = new Set(arr.slice(5_000));
    }
  }

  verifyToken(token: string): JwtPayload | null {
    if (this.revokedTokens.has(token)) return null;
    try {
      return verify(token, this.jwtSecret) as JwtPayload;
    } catch {
      return null;
    }
  }
}

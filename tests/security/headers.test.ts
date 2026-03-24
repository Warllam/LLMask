import { describe, it, expect } from "vitest";
import { buildCsp, applySecurityHeaders } from "../../src/modules/security/headers";

describe("buildCsp", () => {
  it("joins directives", () => {
    const csp = buildCsp({ "default-src": "'self'", "script-src": "'none'" });
    expect(csp).toBe("default-src 'self'; script-src 'none'");
  });
});

describe("applySecurityHeaders", () => {
  it("sets all security headers", () => {
    const headers: Record<string, string> = {};
    const reply = { header: (k: string, v: string) => { headers[k] = v; } } as any;

    applySecurityHeaders(reply, { cspEnabled: true, frameOptions: "DENY" }, "/dashboard");

    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Strict-Transport-Security"]).toContain("max-age=");
    expect(headers["Content-Security-Policy"]).toContain("default-src");
    expect(headers["Cache-Control"]).toContain("no-store");
  });

  it("skips CSP when disabled", () => {
    const headers: Record<string, string> = {};
    const reply = { header: (k: string, v: string) => { headers[k] = v; } } as any;

    applySecurityHeaders(reply, { cspEnabled: false }, "/api");
    expect(headers["Content-Security-Policy"]).toBeUndefined();
  });

  it("respects cspPaths", () => {
    const headers: Record<string, string> = {};
    const reply = { header: (k: string, v: string) => { headers[k] = v; } } as any;

    applySecurityHeaders(reply, { cspEnabled: true, cspPaths: ["/dashboard"] }, "/api");
    expect(headers["Content-Security-Policy"]).toBeUndefined();

    applySecurityHeaders(reply, { cspEnabled: true, cspPaths: ["/dashboard"] }, "/dashboard/x");
    expect(headers["Content-Security-Policy"]).toBeDefined();
  });

  it("includes HSTS preload when configured", () => {
    const headers: Record<string, string> = {};
    const reply = { header: (k: string, v: string) => { headers[k] = v; } } as any;

    applySecurityHeaders(reply, { cspEnabled: false, hstsPreload: true }, "/");
    expect(headers["Strict-Transport-Security"]).toContain("preload");
  });
});

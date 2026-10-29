import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { publicError, SERVER_ERROR, UserError } from "./errors.ts";
import { AuthError } from "./accounts.ts";
import { FeedError } from "./feed.ts";

describe("what a player sees when something fails", () => {
  it("shows messages written for the player, with their status", () => {
    expect(publicError(new UserError("Finish the game first."))).toEqual({ status: 400, message: "Finish the game first.", expected: true });
    expect(publicError(new FeedError("Only the organiser can do that.", 403))).toMatchObject({ status: 403, message: "Only the organiser can do that." });
    expect(publicError(new AuthError("Wrong email or password.", 400))).toMatchObject({ status: 400, message: "Wrong email or password." });
  });

  it("keeps anything else (storage paths, bugs) on the server", () => {
    const leak = new Error('Supabase storage read users/abc123/games/xyz.json: permission denied for table objects');
    expect(publicError(leak)).toEqual({ status: 500, message: SERVER_ERROR, expected: false });
    expect(publicError(new TypeError("Cannot read properties of undefined (reading 'state')")).message).toBe(SERVER_ERROR);
  });

  it("passes on Express's own bad-request errors", () => {
    const tooBig = Object.assign(new Error("request entity too large"), { status: 413, expose: true });
    expect(publicError(tooBig)).toMatchObject({ status: 413, message: "request entity too large" });
    // An exposed 5xx is still the server's business.
    expect(publicError(Object.assign(new Error("db down"), { status: 503, expose: true })).message).toBe(SERVER_ERROR);
  });
});

describe("links that leave the app", () => {
  it("never take their address from the request's Host header", async () => {
    process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "thorgrim-origin-"));
    // No APP_URL: the production address Vercel reports wins over a faked Host header.
    delete process.env.APP_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "thorgrim.co";
    const app = (await import("./app.ts")).default;
    const srv = app.listen(0);
    try {
      const port = (srv.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${port}/api/public/report-page/${"a".repeat(32)}`, { headers: { host: "evil.example" } });
      const html = await res.text();
      expect(html).toContain("https://thorgrim.co/og-report.png");
      expect(html).not.toContain("evil.example");
    } finally {
      srv.close();
    }
  });
});

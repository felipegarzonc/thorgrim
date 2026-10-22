import { afterEach, describe, expect, it, vi } from "vitest";
import { omnissiahReady, runMetaTool } from "./omnissiah.ts";

describe("Omnissiah tools", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("are off until both the URL and the key are set", () => {
    vi.stubEnv("OMNISSIAH_URL", "");
    vi.stubEnv("OMNISSIAH_KEY", "k");
    expect(omnissiahReady()).toBe(false);
    vi.stubEnv("OMNISSIAH_URL", "https://omni.example/");
    expect(omnissiahReady()).toBe(true);
  });

  it("ask the API with the key and pass the answer on", async () => {
    vi.stubEnv("OMNISSIAH_URL", "https://omni.example/");
    vi.stubEnv("OMNISSIAH_KEY", "secret-key");
    const calls: { url: string; auth: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, auth: (init.headers as Record<string, string>).authorization });
      return new Response(JSON.stringify(url.includes("nope") ? { error: 'Unknown faction "nope".' } : { ok: true }), { status: url.includes("nope") ? 404 : 200 });
    });
    expect(await runMetaTool("aos_matchup", { faction: "Ogors", opponent: "Skaven" })).toBe('{"ok":true}');
    await runMetaTool("aos_tournament_lists", { faction: "ogors", min_wins: 4, limit: 50 });
    expect(calls[0]).toEqual({ url: "https://omni.example/matchup?a=Ogors&b=Skaven", auth: "Bearer secret-key" });
    expect(calls[1].url).toBe("https://omni.example/lists?faction=ogors&minWins=4&limit=10");
    await expect(runMetaTool("aos_faction_meta", { faction: "nope" })).rejects.toThrow(/Unknown faction/);
  });
});

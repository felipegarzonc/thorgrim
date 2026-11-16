import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "thorgrim-accounts-"));
delete process.env.SUPABASE_URL;
const { recordUsage, usageOf, checkBudget, usageByMonth } = await import("./accounts.ts");
const { blobs } = await import("./blobs.ts");
const { runAs } = await import("./context.ts");

describe("coach usage", () => {
  it("adds up tokens and an estimated cost per user and month", async () => {
    const player = { id: "p1", name: "Medina", isAdmin: false, prefix: "users/p1/" };
    await runAs(player, async () => {
      await recordUsage({ input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 0 } as never);
      await recordUsage({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 3 } } as never);
    });
    const u = await usageOf("p1");
    expect(u.requests).toBe(2);
    expect(u.costUsd).toBeCloseTo(4 + 2 + 0.2 + 0.03, 5);
    expect((await usageOf("someone-else")).requests).toBe(0);
  });
  it("adds up each month for the admin: the total, and who spent it, biggest first", async () => {
    const usage = (requests: number, costUsd: number) => JSON.stringify({ requests, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, costUsd });
    await blobs().write("usage/ana/2026-11.json", usage(4, 1.5));
    await blobs().write("usage/ben/2026-11.json", usage(10, 3.25));
    await blobs().write("usage/ana/2026-09.json", usage(2, 0.4));
    const accounts = [
      { id: "ana", name: "Ana" },
      { id: "ben", name: "Ben" },
      { id: "cat", name: "Cat" },
    ];
    // Asked in January: the months go back across the year's start.
    const months = await usageByMonth(accounts, 5, new Date("2027-01-15T12:00:00Z"));
    expect(months.map((m) => m.month)).toEqual(["2027-01", "2026-12", "2026-11", "2026-10", "2026-09"]);
    expect(months[0]).toEqual({ month: "2027-01", requests: 0, costUsd: 0, players: [] });
    expect(months[2]).toEqual({
      month: "2026-11",
      requests: 14,
      costUsd: 4.75,
      players: [
        { id: "ben", name: "Ben", requests: 10, costUsd: 3.25 },
        { id: "ana", name: "Ana", requests: 4, costUsd: 1.5 },
      ],
    });
    expect(months[4].players).toEqual([{ id: "ana", name: "Ana", requests: 2, costUsd: 0.4 }]);
  });

  it("has no limit without accounts (your own computer)", async () => {
    await runAs({ id: "p1", name: "", isAdmin: false, prefix: "users/p1/" }, () => expect(checkBudget()).resolves.toBeUndefined());
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "thorgrim-accounts-"));
delete process.env.SUPABASE_URL;
const { recordUsage, usageOf, checkBudget } = await import("./accounts.ts");
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
  it("has no limit without accounts (your own computer)", async () => {
    await runAs({ id: "p1", name: "", isAdmin: false, prefix: "users/p1/" }, () => expect(checkBudget()).resolves.toBeUndefined());
  });
});

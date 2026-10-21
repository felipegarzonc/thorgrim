import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "thorgrim-jobs-"));
const { jobs, startJob } = await import("./jobs.ts");
const { currentUser, runAs } = await import("./context.ts");

const settle = async (id: string) => {
  for (let i = 0; i < 50; i++) {
    const j = await jobs.get(id);
    if (j && j.status !== "running") return j;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("job never finished");
};

describe("background jobs", () => {
  it("returns at once and saves the result when the work ends", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const job = await startJob("plan", async () => {
      await gate;
      return { summary: "Hold the centre." };
    });
    expect(job.status).toBe("running");
    expect((await jobs.get(job.id))?.status).toBe("running");
    release();
    expect(await settle(job.id)).toMatchObject({ status: "done", result: { summary: "Hold the centre." } });
  });

  it("records failures with their message", async () => {
    const job = await startJob("tips", async () => {
      throw new Error("Monthly limit reached");
    });
    expect(await settle(job.id)).toMatchObject({ status: "failed", error: "Monthly limit reached" });
  });

  it("runs as the user who started it, in their own space", async () => {
    const player = { id: "p9", name: "Ana", isAdmin: false, prefix: "users/p9/" };
    const job = await runAs(player, () => startJob("tips", async () => currentUser().id));
    await runAs(player, async () => expect(await settle(job.id)).toMatchObject({ status: "done", result: "p9" }));
    expect(await jobs.get(job.id)).toBeUndefined(); // not in the owner's space
  });
});

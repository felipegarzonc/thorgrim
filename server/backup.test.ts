import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it, vi } from "vitest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "thorgrim-backup-"));
process.env.STORAGE_DIR = path.join(root, "storage");
delete process.env.SUPABASE_URL;

vi.mock("./accounts.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./accounts.ts")>()),
  listAccounts: async () => [
    { id: "ana", email: "ana@example.com", name: "Ana", role: "admin", owner: true },
    { id: "ben", email: "ben@example.com", name: "Ben", role: "admin" },
  ],
}));
const sent: { to: string; attachments?: { filename: string; content: Buffer }[] }[] = [];
vi.mock("./mail.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./mail.ts")>()),
  sendMail: async (m: (typeof sent)[number]) => {
    sent.push(m);
    return true;
  },
}));

const { blobs, backupBlobs } = await import("./blobs.ts");
const { makeBackup, runBackup } = await import("./backup.ts");
const unzip = (b: Buffer) => JSON.parse(zlib.gunzipSync(b).toString("utf8")) as { format: string; files: Record<string, unknown> };

describe("backups", () => {
  it("gathers every record, in every space, and leaves out secrets, photos and passing work", async () => {
    const s = blobs();
    await s.write("settings/users.json", JSON.stringify([{ id: "ana" }]));
    await s.write("settings/secrets.json", JSON.stringify({ anthropicKey: "sk-ant-secret" }));
    await s.write("settings/push-keys.json", JSON.stringify({ privateKey: "vapid-secret" }));
    await s.write("games/g1.json", JSON.stringify({ id: "g1" }));
    await s.write("users/ben/lists/l1.json", JSON.stringify({ id: "l1" }));
    await s.write("users/ben/settings/prefs.json", JSON.stringify({ lang: "es" }));
    await s.write("clubs/c1/posts/p1.json", JSON.stringify({ id: "p1" }));
    await s.write("game-photos/g1/1.jpg", Buffer.from("jpeg"));
    await s.write("clubs/c1/post-photos/p1/0.jpg", Buffer.from("jpeg"));
    await s.write("library-files/d1.pdf", Buffer.from("%PDF"));
    await s.write("build-data/aos.json", JSON.stringify({ units: {} }));
    await s.write("jobs/j1.json", JSON.stringify({ id: "j1" }));
    const b = await makeBackup(new Date("2026-11-16T08:13:00Z"));
    const got = unzip(b.data);
    expect(got.format).toBe("thorgrim-backup-1");
    expect(Object.keys(got.files).sort()).toEqual(["clubs/c1/posts/p1.json", "games/g1.json", "settings/users.json", "users/ben/lists/l1.json", "users/ben/settings/prefs.json"]);
    expect(got.files["users/ben/lists/l1.json"]).toEqual({ id: "l1" });
    expect(JSON.stringify(got)).not.toContain("secret");
    expect(b.name).toBe("thorgrim-2026-11-16-08-13.json.gz");
  });

  it("keeps the last 8 in the backup store and emails the owner a copy", async () => {
    sent.length = 0;
    for (let d = 1; d <= 9; d++) await runBackup(new Date(`2026-11-${String(d).padStart(2, "0")}T08:13:00Z`));
    const kept = (await backupBlobs().list("backups")).sort();
    expect(kept).toHaveLength(8);
    expect(kept[0]).toBe("thorgrim-2026-11-02-08-13.json.gz");
    // A separate store: not inside the app's own storage.
    expect(await blobs().list("backups")).toEqual([]);
    // Only the owner gets it, with the backup attached.
    expect(sent.every((m) => m.to === "ana@example.com")).toBe(true);
    expect(sent).toHaveLength(9);
    expect(unzip(sent.at(-1)!.attachments![0].content).files["games/g1.json"]).toEqual({ id: "g1" });
  });
});

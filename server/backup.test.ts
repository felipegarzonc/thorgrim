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
const { listBackups, makeBackup, readBackup, restoreBackup, restorePlan, runBackup, storedBackup } = await import("./backup.ts");
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

  it("restores: lost and changed records come back, newer ones stay, and today's copy is saved first", async () => {
    const s = blobs();
    const backup = readBackup((await makeBackup(new Date("2026-11-20T08:00:00Z"))).data);
    // Since the backup: one game lost, one list changed, one new game made.
    await s.remove("games/g1.json");
    await s.write("users/ben/lists/l1.json", JSON.stringify({ id: "l1", name: "changed" }));
    await s.write("games/g2.json", JSON.stringify({ id: "g2" }));
    const plan = await restorePlan(backup);
    expect(plan).toMatchObject({ records: 5, missing: 1, changed: 1, same: 3, newer: 1 });
    // Looking changes nothing.
    expect(await s.read("games/g1.json")).toBeFalsy();

    const done = await restoreBackup(backup, new Date("2026-11-21T09:30:00Z"));
    expect(JSON.parse((await s.read("games/g1.json"))!.toString())).toEqual({ id: "g1" });
    expect(JSON.parse((await s.read("users/ben/lists/l1.json"))!.toString())).toEqual({ id: "l1" });
    expect(JSON.parse((await s.read("games/g2.json"))!.toString())).toEqual({ id: "g2" });
    // The secrets weren't in the backup and are still there.
    expect((await s.read("settings/secrets.json"))!.toString()).toContain("sk-ant-secret");
    // How things were just before is kept, so the restore can be taken back.
    expect(done.savedFirst).toBe("thorgrim-2026-11-21-09-30-before-restore.json.gz");
    expect(await listBackups()).toContain(done.savedFirst);
    const before = readBackup(await storedBackup(done.savedFirst));
    expect(before.files["users/ben/lists/l1.json"]).toEqual({ id: "l1", name: "changed" });
    expect(before.files["games/g1.json"]).toBeUndefined();
  });

  it("refuses files that aren't backups, and never writes secrets or outside the records", async () => {
    expect(() => readBackup(Buffer.from("not a backup"))).toThrow(/isn't a Thorgrim backup/);
    expect(() => readBackup(zlib.gzipSync(JSON.stringify({ format: "other", files: {} })))).toThrow(/isn't a Thorgrim backup/);
    const crafted = readBackup(
      zlib.gzipSync(
        JSON.stringify({
          format: "thorgrim-backup-1",
          files: { "settings/secrets.json": { anthropicKey: "stolen" }, "users/x/settings/secrets.json": {}, "../outside.json": {}, "jobs/j9.json": {}, "games/photo.jpg": {}, "games/ok.json": { id: "ok" } },
        }),
      ),
    );
    expect(Object.keys(crafted.files)).toEqual(["games/ok.json"]);
    await expect(storedBackup("../settings/secrets.json")).rejects.toThrow(/kept backups/);
  });
});

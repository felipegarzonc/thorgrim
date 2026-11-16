// Backups of the app's records. Every JSON record in storage (accounts,
// clubs, lists, games, reports, settings) is gathered into one gzipped file:
// weekly by the scheduled job (server/cron.ts), or on demand by the owner
// (Profile). It goes to a separate private store (backupBlobs: online the
// "<bucket>-backups" bucket), the last few are kept, and the owner gets it by
// email when email is set up, so a copy also lives outside Supabase.
//
// Left out: photos, rule books and the army data (large binaries, kept or
// re-uploadable elsewhere), passing work (jobs, reset links), and secrets
// (the saved Claude key, the push keys), which must not travel by email.
//
// The file is { format, createdAt, files: { "<path>": <the record> } }.
// Restoring (the owner, from the profile) writes each record back at its
// path: records the backup has come back as they were, and records made
// since stay. A fresh backup is saved first, so a restore can be taken back.
// Sign-ins live in Supabase Auth, not here: a restore doesn't touch them.

import zlib from "node:zlib";
import { listAccounts } from "./accounts.ts";
import { backupBlobs, blobs } from "./blobs.ts";
import { UserError } from "./errors.ts";
import { sendMail } from "./mail.ts";

const SKIP_FOLDERS = new Set(["game-photos", "post-photos", "showcase-photos", "library-files", "build-data", "jobs", "password-resets"]);
const SECRET_FILES = new Set(["settings/secrets.json", "settings/push-keys.json"]);
const KEEP = 8;
/** Email providers refuse big attachments; a backup over this stays in storage only. */
const MAX_ATTACHMENT = 15 * 1024 * 1024;

export interface Backup {
  name: string;
  data: Buffer;
  files: number;
}

/** Every record path in storage, folder by folder. */
async function recordPaths(folder = ""): Promise<string[]> {
  const store = blobs();
  const here = folder ? `${folder}/` : "";
  const paths = (await store.list(folder)).filter((n) => n.endsWith(".json")).map((n) => `${here}${n}`);
  for (const sub of await store.folders(folder)) {
    if (SKIP_FOLDERS.has(sub)) continue;
    paths.push(...(await recordPaths(`${here}${sub}`)));
  }
  return paths;
}

/** Leaves out the secrets wherever a space keeps its settings (the owner's, or users/<id>/settings/…). */
const isSecret = (p: string) => [...SECRET_FILES].some((s) => p === s || p.endsWith(`/${s}`));

/** Gather every record into one gzipped file (not saved). */
export async function makeBackup(now = new Date()): Promise<Backup> {
  const paths = (await recordPaths()).filter((p) => !isSecret(p)).sort();
  const files: Record<string, unknown> = {};
  await Promise.all(
    paths.map(async (p) => {
      const raw = await blobs().read(p);
      if (!raw) return;
      try {
        files[p] = JSON.parse(raw.toString("utf8"));
      } catch {
        files[p] = { unreadable: raw.toString("base64") };
      }
    }),
  );
  const body = JSON.stringify({ format: "thorgrim-backup-1", createdAt: now.toISOString(), files });
  const stamp = now.toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return { name: `thorgrim-${stamp}.json.gz`, data: zlib.gzipSync(body, { level: 9 }), files: Object.keys(files).length };
}

/** The weekly backup: saved to the backup store (the oldest beyond the last KEEP go), and emailed to the owner. */
export async function runBackup(now = new Date()): Promise<{ name: string; files: number; bytes: number; kept: number; emailed: string[] }> {
  const b = await makeBackup(now);
  const store = backupBlobs();
  await store.write(`backups/${b.name}`, b.data, "application/gzip");
  const all = (await store.list("backups")).filter((n) => n.endsWith(".json.gz")).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) await store.remove(`backups/${old}`);
  const owners = (await listAccounts()).filter((a) => a.owner && !a.disabled);
  const emailed: string[] = [];
  const mb = (b.data.length / 1024 / 1024).toFixed(1);
  for (const o of owners) {
    const attach = b.data.length <= MAX_ATTACHMENT;
    const text = [
      `Thorgrim's weekly backup: ${b.files} records (${mb} MB), ${now.toISOString().slice(0, 10)}.`,
      attach ? "It's attached; keep it somewhere safe. It is also kept in storage (the last 8)." : "It was too big to attach; it is kept in storage (the last 8), and you can download it from your profile.",
      "It holds every player's lists, games and accounts (no passwords, no keys): don't share it.",
    ];
    const ok = await sendMail({
      to: o.email,
      subject: `Thorgrim backup ${now.toISOString().slice(0, 10)}`,
      text: text.join("\n\n"),
      html: text.map((t) => `<p>${t}</p>`).join(""),
      ...(attach ? { attachments: [{ filename: b.name, content: b.data }] } : {}),
    });
    if (ok) emailed.push(o.email);
  }
  return { name: b.name, files: b.files, bytes: b.data.length, kept: Math.min(all.length, KEEP), emailed };
}

// ---------- restoring ----------

const FORMAT = "thorgrim-backup-1";
/** A backup unzipped can't be bigger than this (a made-up file must not fill the memory). */
const MAX_UNZIPPED = 300 * 1024 * 1024;

export interface BackupContents {
  createdAt: string;
  files: Record<string, unknown>;
}

/** The backups kept in the backup store, newest first. */
export async function listBackups(): Promise<string[]> {
  return (await backupBlobs().list("backups")).filter((n) => n.endsWith(".json.gz")).sort().reverse();
}

/** A kept backup by name, as its file. */
export async function storedBackup(name: unknown): Promise<Buffer> {
  if (typeof name !== "string" || !/^[\w.-]+\.json\.gz$/.test(name)) throw new UserError("That isn't one of the kept backups.");
  const data = await backupBlobs().read(`backups/${name}`);
  if (!data) throw new UserError("That backup isn't kept any more.", 404);
  return data;
}

/** May a restore write this path? Only records a backup would hold: no secrets, no skipped folders, nothing outside storage. */
const restorable = (p: string) =>
  /^[\w.@-]+(\/[\w.@-]+)*\.json$/.test(p) && !p.split("/").some((part) => part === "." || part === ".." || SKIP_FOLDERS.has(part)) && !isSecret(p);

/** Open a backup file and check it is one. */
export function readBackup(data: Buffer): BackupContents {
  let parsed: { format?: unknown; createdAt?: unknown; files?: unknown };
  try {
    parsed = JSON.parse(zlib.gunzipSync(data, { maxOutputLength: MAX_UNZIPPED }).toString("utf8"));
  } catch {
    throw new UserError("That file isn't a Thorgrim backup (it should be the .json.gz file from the backup email or your profile).");
  }
  if (parsed?.format !== FORMAT || !parsed.files || typeof parsed.files !== "object" || Array.isArray(parsed.files))
    throw new UserError("That file isn't a Thorgrim backup (it should be the .json.gz file from the backup email or your profile).");
  const files: Record<string, unknown> = {};
  for (const [p, v] of Object.entries(parsed.files as Record<string, unknown>)) if (restorable(p)) files[p] = v;
  return { createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "", files };
}

const body = (record: unknown): Buffer => {
  const raw = (record as { unreadable?: unknown } | null)?.unreadable;
  return typeof raw === "string" && Object.keys(record as object).length === 1 ? Buffer.from(raw, "base64") : Buffer.from(JSON.stringify(record));
};

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

export interface RestorePlan {
  createdAt: string;
  records: number;
  /** Missing now: the restore brings them back. */
  missing: number;
  /** Different now: the restore puts back the backup's version. */
  changed: number;
  same: number;
  /** Records made since the backup: a restore leaves them. */
  newer: number;
}

/** What restoring this backup would do, without doing it. */
export async function restorePlan(b: BackupContents): Promise<RestorePlan> {
  const plan: RestorePlan = { createdAt: b.createdAt, records: Object.keys(b.files).length, missing: 0, changed: 0, same: 0, newer: 0 };
  await inBatches(Object.entries(b.files), 20, async ([p, record]) => {
    const now = await blobs().read(p);
    if (!now) plan.missing++;
    else if (same(now, record)) plan.same++;
    else plan.changed++;
  });
  const current = (await recordPaths()).filter((p) => !isSecret(p));
  plan.newer = current.filter((p) => !(p in b.files)).length;
  return plan;
}

function same(now: Buffer, record: unknown): boolean {
  try {
    return JSON.stringify(JSON.parse(now.toString("utf8"))) === JSON.stringify(record);
  } catch {
    return now.equals(body(record));
  }
}

/** Write the backup's records back. Today's records are saved as a backup first (`savedFirst`). */
export async function restoreBackup(b: BackupContents, now = new Date()): Promise<RestorePlan & { savedFirst: string }> {
  const plan = await restorePlan(b);
  const before = await makeBackup(now);
  const savedFirst = before.name.replace(/\.json\.gz$/, "-before-restore.json.gz");
  await backupBlobs().write(`backups/${savedFirst}`, before.data, "application/gzip");
  await inBatches(Object.entries(b.files), 10, async ([p, record]) => {
    const now = await blobs().read(p);
    if (now && same(now, record)) return;
    await blobs().write(p, body(record), "application/json");
  });
  return { ...plan, savedFirst };
}

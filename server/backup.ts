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
// The file is { format, createdAt, files: { "<path>": <the record> } }: to
// restore, write each record back at its path.

import zlib from "node:zlib";
import { listAccounts } from "./accounts.ts";
import { backupBlobs, blobs } from "./blobs.ts";
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

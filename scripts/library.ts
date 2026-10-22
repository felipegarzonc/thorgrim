// Manage the rules library from the command line (developers only).
// Players can read and search the books in the app; adding, removing and
// reading scanned pages is done here, with the app password.
//
//   THORGRIM_URL=https://thorgrim.co APP_ACCESS_KEY=… npx tsx scripts/library.ts list
//   … upload ./ghb-2026.pdf --title "General's Handbook 2026-27" --category season
//   … upload ./into-the-fire.jpg --title "Into the Fire" --category battleplan
//   … read <id>       (finish reading scanned pages)
//   … delete <id>
//
// Categories: core, season, battletome, battleplan, map, other. Battleplan
// cards and maps are matched to games by the battleplan name in the title.

import fs from "node:fs";
import path from "node:path";

export const base = (process.env.THORGRIM_URL ?? "http://localhost:8787").replace(/\/$/, "");
export const key = process.env.APP_ACCESS_KEY ?? "";
const CATEGORIES = ["core", "season", "battletome", "battleplan", "map", "other"];
const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".txt": "text/plain",
  ".md": "text/plain",
};

export interface Doc {
  id: string;
  title: string;
  category: string;
  kind: string;
  pages: number;
  transcription?: {
    status: string;
    pages: number[];
    done: number;
    error?: string;
  };
}

export async function api<T>(p: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const res = await fetch(`${base}/api${p}`, {
    method: init.method ?? (init.json ? "POST" : "GET"),
    headers: {
      "x-access-key": key,
      ...(init.json ? { "content-type": "application/json" } : {}),
    },
    body: init.json ? JSON.stringify(init.json) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(`${p}: ${data.error ?? `HTTP ${res.status}`}`);
  return data as T;
}

const status = (d: Doc) =>
  !d.transcription || d.transcription.status === "done"
    ? "searchable"
    : `${d.transcription.status} ${d.transcription.done}/${d.transcription.pages.length} scanned pages${d.transcription.error ? ` (${d.transcription.error})` : ""}`;

export async function list() {
  const docs = await api<Doc[]>("/library");
  if (!docs.length) return console.log("The library is empty.");
  for (const d of docs) console.log(`${d.id}  [${d.category}] ${d.title}  (${d.kind}${d.kind === "pdf" ? `, ${d.pages} pages` : ""}, ${status(d)})`);
}

/** Read scanned pages with Claude, batch by batch, until done. */
export async function read(id: string) {
  const meta = await api<{ backgroundJobs?: boolean }>("/meta");
  for (;;) {
    const r = await api<{ transcription?: Doc["transcription"] }>(`/library/${id}/transcribe`, { json: {} });
    let t = r.transcription;
    if (meta.backgroundJobs) {
      // On a computer the server reads in the background: watch it.
      await new Promise((ok) => setTimeout(ok, 5000));
      t = (await api<Doc[]>("/library")).find((d) => d.id === id)?.transcription;
    }
    if (!t) return console.log("Nothing to read.");
    console.log(`  read ${t.done}/${t.pages.length} scanned pages (${t.status})`);
    if (t.status === "done") return;
    if (t.status === "failed") throw new Error(t.error ?? "Reading failed");
  }
}

export async function upload(file: string, title: string, category: string, opts: { read?: boolean; bytes?: Buffer; filename?: string } = {}) {
  if (!CATEGORIES.includes(category)) throw new Error(`--category must be one of: ${CATEGORIES.join(", ")}`);
  const filename = opts.filename ?? path.basename(file);
  const mime = MIME[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
  const body = opts.bytes ?? fs.readFileSync(file);
  const { doc, target } = await api<{
    doc: Doc;
    target: { url: string; viaApi: boolean; headers: Record<string, string> };
  }>("/library/uploads", {
    json: { title, category, filename, mime },
  });
  console.log(`Uploading ${filename} (${(body.length / 1e6).toFixed(1)} MB)…`);
  const put = await fetch(target.viaApi ? `${base}${target.url}` : target.url, {
    method: "PUT",
    headers: {
      ...target.headers,
      ...(target.viaApi ? { "x-access-key": key } : {}),
    },
    body: new Uint8Array(body),
  });
  if (!put.ok) throw new Error(`Upload failed: HTTP ${put.status} ${await put.text()}`);
  const done = await api<Doc>(`/library/${doc.id}/finish`, { json: {} });
  console.log(`Added ${done.id}: ${done.title} (${status(done)})`);
  if (opts.read !== false && done.transcription && done.transcription.status !== "done") {
    console.log("Reading scanned pages with Claude…");
    await read(done.id);
  }
  return done;
}

export async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (name: string) => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };

  try {
    if (!key && !base.includes("localhost")) throw new Error("Set APP_ACCESS_KEY (the app password).");
    if (cmd === "list") await list();
    else if (cmd === "upload" && rest[0]) await upload(rest[0], flag("title") ?? path.basename(rest[0]).replace(/\.[^.]+$/, ""), flag("category") ?? "other");
    else if (cmd === "read" && rest[0]) await read(rest[0]);
    else if (cmd === "delete" && rest[0]) {
      await api(`/library/${rest[0]}`, { method: "DELETE" });
      console.log("Deleted.");
    } else {
      console.log("Usage: library.ts list | upload <file> --title <title> --category <core|season|battletome|battleplan|map|other> | read <id> | delete <id>");
      process.exitCode = 1;
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  }
}

// Run as a command (not when imported by another script).
if (process.argv[1]?.endsWith("library.ts")) await main();

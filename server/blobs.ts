// Where the app keeps its files. On your own computer: a folder on disk
// (STORAGE_DIR, default ./storage). Online (Vercel): a private Supabase
// Storage bucket, because serverless functions have no lasting disk.
// Both use the same paths, e.g. "lists/<id>.json" or "library-files/<id>.pdf".

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { StorageClient } from "@supabase/storage-js";

export interface UploadTarget {
  /** Where the browser sends the file with a PUT request. */
  url: string;
  /** Same-origin targets go through the API and need the app password. */
  viaApi: boolean;
  headers: Record<string, string>;
}

export interface BlobStore {
  readonly kind: "file" | "supabase";
  read(p: string): Promise<Buffer | undefined>;
  write(p: string, data: Buffer | string, contentType?: string): Promise<void>;
  remove(p: string): Promise<void>;
  /** File names (not paths) directly inside a folder. */
  list(folder: string): Promise<string[]>;
  /** The same, with when each file last changed (ms since epoch), without reading them. */
  listTimes(folder: string): Promise<{ name: string; updatedAt: number }[]>;
  /** Lets the browser upload a large file directly (bypassing body limits). */
  uploadTarget(p: string, contentType: string, apiPath: string): Promise<UploadTarget>;
  /** A short-lived link to download a file, or null to stream it through the API. */
  downloadUrl(p: string): Promise<string | null>;
}

const safe = (p: string) => {
  const parts = p.split("/");
  if (!p || p.startsWith("/") || parts.some((s) => !s || s === "." || s === "..")) throw new Error(`bad storage path: ${p}`);
  return p;
};

export class FileBlobStore implements BlobStore {
  readonly kind = "file" as const;
  constructor(readonly root: string) {}
  private full(p: string) {
    return path.join(this.root, safe(p));
  }
  async read(p: string) {
    const f = this.full(p);
    return fs.existsSync(f) ? fs.readFileSync(f) : undefined;
  }
  async write(p: string, data: Buffer | string) {
    const f = this.full(p);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(`${f}.tmp`, data);
    fs.renameSync(`${f}.tmp`, f);
  }
  async remove(p: string) {
    const f = this.full(p);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  async list(folder: string) {
    const d = this.full(folder);
    return fs.existsSync(d) ? fs.readdirSync(d).filter((n) => !n.endsWith(".tmp") && fs.statSync(path.join(d, n)).isFile()) : [];
  }
  async listTimes(folder: string) {
    const d = this.full(folder);
    return (await this.list(folder)).map((name) => ({ name, updatedAt: fs.statSync(path.join(d, name)).mtimeMs }));
  }
  async uploadTarget(_p: string, contentType: string, apiPath: string) {
    return { url: apiPath, viaApi: true, headers: { "content-type": contentType } };
  }
  async downloadUrl() {
    return null;
  }
}

/**
 * At most `max` storage requests at a time from this server instance. Each
 * Supabase Storage request holds one of the project's database connections
 * while it runs, and a page listing many records (all notices, all posts)
 * would otherwise ask for all of them at once ("Too many connections").
 */
export class Gate {
  private running = 0;
  private waiting: (() => void)[] = [];
  constructor(readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.max) await new Promise<void>((go) => this.waiting.push(go));
    else this.running++;
    try {
      return await fn();
    } finally {
      // Hand the slot straight to the next in line, or free it.
      const next = this.waiting.shift();
      if (next) next();
      else this.running--;
    }
  }
}

/** Supabase out of connections or rate-limiting: worth one more try after a moment. */
export const busyError = (message: string) => /too many connections|too many requests|rate limit|timeout|ECONNRESET|503|502|429/i.test(message);

export class SupabaseBlobStore implements BlobStore {
  readonly kind = "supabase" as const;
  private client: StorageClient;
  private ready: Promise<void> | null = null;
  private gate = new Gate(Number(process.env.SUPABASE_MAX_REQUESTS) || 6);
  constructor(
    storageUrl: string,
    serviceKey: string,
    readonly bucket = "thorgrim",
  ) {
    this.client = new StorageClient(storageUrl, { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` });
  }
  /** A storage request through the gate; when Supabase is busy, once more after a short wait. */
  private async call<R extends { error: { message: string } | null }>(fn: () => Promise<R>): Promise<R> {
    const first = await this.gate.run(fn);
    if (!first.error || !busyError(first.error.message)) return first;
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 500));
    return this.gate.run(fn);
  }
  /** Create the private bucket on first use. */
  private ensureBucket() {
    this.ready ??= (async () => {
      const { error } = await this.client.getBucket(this.bucket);
      if (!error) return;
      const created = await this.client.createBucket(this.bucket, { public: false });
      if (created.error && !/already exists/i.test(created.error.message)) {
        this.ready = null;
        throw new Error(`Supabase storage: could not create bucket "${this.bucket}": ${created.error.message}`);
      }
    })();
    return this.ready;
  }
  private get files() {
    return this.client.from(this.bucket);
  }
  async read(p: string) {
    await this.ensureBucket();
    // A fresh nonce skips Supabase's CDN, which would otherwise serve the
    // previous version of a record for a while after it was overwritten.
    const { data, error } = await this.call(() => this.files.download(safe(p), { cacheNonce: crypto.randomUUID() }, { cache: "no-store" }));
    if (error) {
      if (/not.?found|does not exist|404/i.test(`${error.message} ${(error as { statusCode?: string }).statusCode ?? ""}`)) return undefined;
      throw new Error(`Supabase storage read ${p}: ${error.message}`);
    }
    return Buffer.from(await data.arrayBuffer());
  }
  async write(p: string, data: Buffer | string, contentType = "application/json") {
    await this.ensureBucket();
    const body = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    const { error } = await this.call(() => this.files.upload(safe(p), body, { upsert: true, contentType, cacheControl: "0" }));
    if (error) throw new Error(`Supabase storage write ${p}: ${error.message}`);
  }
  async remove(p: string) {
    await this.ensureBucket();
    const { error } = await this.call(() => this.files.remove([safe(p)]));
    if (error) throw new Error(`Supabase storage remove ${p}: ${error.message}`);
  }
  async list(folder: string) {
    return (await this.listTimes(folder)).map((f) => f.name);
  }
  async listTimes(folder: string) {
    await this.ensureBucket();
    const files: { name: string; updatedAt: number }[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await this.call(() => this.files.list(safe(folder), { limit: 1000, offset }));
      if (error) throw new Error(`Supabase storage list ${folder}: ${error.message}`);
      // Folders come back with a null id; keep files only.
      for (const o of data) if (o.id) files.push({ name: o.name, updatedAt: Date.parse(o.updated_at ?? o.created_at ?? "") || 0 });
      if (data.length < 1000) break;
    }
    return files;
  }
  async uploadTarget(p: string, contentType: string) {
    await this.ensureBucket();
    const { data, error } = await this.files.createSignedUploadUrl(safe(p), { upsert: true });
    if (error) throw new Error(`Supabase storage upload link ${p}: ${error.message}`);
    return { url: data.signedUrl, viaApi: false, headers: { "content-type": contentType, "x-upsert": "true" } };
  }
  async downloadUrl(p: string) {
    await this.ensureBucket();
    const { data, error } = await this.files.createSignedUrl(safe(p), 600);
    if (error) throw new Error(`Supabase storage download link ${p}: ${error.message}`);
    return data.signedUrl;
  }
}

let store: BlobStore | null = null;

/** Supabase when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set, else a local folder. */
export function blobs(): BlobStore {
  if (store) return store;
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (url && key) {
    const storageUrl = process.env.SUPABASE_STORAGE_URL?.trim() || `${url.replace(/\/$/, "")}/storage/v1`;
    store = new SupabaseBlobStore(storageUrl, key, process.env.SUPABASE_BUCKET?.trim() || "thorgrim");
  } else {
    store = new FileBlobStore(path.resolve(process.env.STORAGE_DIR ?? "storage"));
  }
  return store;
}

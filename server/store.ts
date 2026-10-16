// Tiny JSON-file store. One user, a handful of records: no database needed.
// Everything lives under STORAGE_DIR (default ./storage), which is gitignored.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const storageDir = path.resolve(process.env.STORAGE_DIR ?? "storage");

export function newId() {
  return crypto.randomBytes(6).toString("hex");
}

export class Collection<T extends { id: string }> {
  private dir: string;
  constructor(name: string) {
    this.dir = path.join(storageDir, name);
    fs.mkdirSync(this.dir, { recursive: true });
  }
  private file(id: string) {
    if (!/^[a-z0-9-]+$/i.test(id)) throw new Error("bad id");
    return path.join(this.dir, `${id}.json`);
  }
  list(): T[] {
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(fs.readFileSync(path.join(this.dir, f), "utf8")) as T);
  }
  get(id: string): T | undefined {
    const f = this.file(id);
    return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as T) : undefined;
  }
  save(item: T): T {
    const f = this.file(item.id);
    fs.writeFileSync(`${f}.tmp`, JSON.stringify(item, null, 2));
    fs.renameSync(`${f}.tmp`, f);
    return item;
  }
  delete(id: string) {
    const f = this.file(id);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

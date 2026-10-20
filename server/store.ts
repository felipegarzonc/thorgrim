// Records (lists, games, conversations, library entries) stored as one JSON
// file each, at "<prefix><collection>/<id>.json" in the blob store: a folder
// on your computer (STORAGE_DIR, default ./storage), or Supabase Storage
// online. The prefix is the signed-in user's space ("" for the owner, so the
// original data stays where it was; "users/<id>/" for invited players).

import crypto from "node:crypto";
import { blobs } from "./blobs.ts";
import { currentUser } from "./context.ts";

export function newId() {
  return crypto.randomBytes(6).toString("hex");
}

export class Collection<T extends { id: string }> {
  /** Without a fixed prefix, each call uses the current user's space. */
  constructor(
    private name: string,
    private fixedPrefix?: string,
  ) {}
  /** The same collection in another space (e.g. the shared library). */
  in(prefix: string) {
    return new Collection<T>(this.name, prefix);
  }
  private folder() {
    return `${this.fixedPrefix ?? currentUser().prefix}${this.name}`;
  }
  private file(id: string) {
    if (!/^[a-z0-9-]+$/i.test(id)) throw new Error("bad id");
    return `${this.folder()}/${id}.json`;
  }
  async list(): Promise<T[]> {
    const folder = this.folder();
    const names = (await blobs().list(folder)).filter((n) => n.endsWith(".json"));
    const items = await Promise.all(names.map((n) => blobs().read(`${folder}/${n}`)));
    return items.filter((b): b is Buffer => Boolean(b)).map((b) => JSON.parse(b.toString("utf8")) as T);
  }
  async get(id: string): Promise<T | undefined> {
    if (!/^[a-z0-9-]+$/i.test(id)) return undefined;
    const b = await blobs().read(this.file(id));
    return b ? (JSON.parse(b.toString("utf8")) as T) : undefined;
  }
  async save(item: T): Promise<T> {
    await blobs().write(this.file(item.id), JSON.stringify(item, null, 2), "application/json");
    return item;
  }
  async delete(id: string) {
    await blobs().remove(this.file(id));
  }
}

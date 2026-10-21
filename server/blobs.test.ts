import { describe, expect, it } from "vitest";
import { SupabaseBlobStore } from "./blobs.ts";

/** A fake Supabase Storage API that records each request. */
const fakeStorage = () => {
  const calls: { method: string; url: URL; headers: Headers; cache?: RequestCache }[] = [];
  const objects = new Map<string, string>();
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    calls.push({ method, url, headers: new Headers(init.headers), cache: init.cache });
    if (url.pathname.endsWith("/bucket/thorgrim")) return Response.json({ id: "thorgrim" });
    const key = url.pathname.split("/object/thorgrim/")[1];
    if (method === "GET") {
      const v = objects.get(key);
      return v === undefined ? Response.json({ statusCode: "404", error: "not_found", message: "Object not found" }, { status: 400 }) : new Response(v);
    }
    objects.set(key, Buffer.from(init.body as Uint8Array).toString("utf8"));
    return Response.json({ Id: key, Key: `thorgrim/${key}` });
  }) as typeof fetch;
  return { calls, store: new SupabaseBlobStore("https://example.test/storage/v1", "key", "thorgrim", fetchImpl) };
};

describe("Supabase blob store", () => {
  it("writes records without a cache lifetime, so overwrites show up at once", async () => {
    const { calls, store } = fakeStorage();
    await store.write("library/abc.json", JSON.stringify({ uploading: true }));
    await store.write("library/abc.json", JSON.stringify({ uploading: false }));
    const uploads = calls.filter((c) => c.method === "POST");
    expect(uploads).toHaveLength(2);
    for (const u of uploads) {
      expect(u.headers.get("cache-control")).toBe("max-age=0");
      expect(u.headers.get("x-upsert")).toBe("true");
    }
  });

  it("reads past any cache and returns the latest version", async () => {
    const { calls, store } = fakeStorage();
    await store.write("library/abc.json", JSON.stringify({ uploading: true }));
    await store.write("library/abc.json", JSON.stringify({ uploading: false }));
    expect(JSON.parse(String(await store.read("library/abc.json")))).toEqual({ uploading: false });
    await store.read("library/abc.json");
    const reads = calls.filter((c) => c.method === "GET" && c.url.pathname.includes("/object/"));
    expect(reads).toHaveLength(2);
    for (const r of reads) expect(r.cache).toBe("no-store");
    const nonces = reads.map((r) => r.url.searchParams.get("cacheNonce"));
    expect(nonces[0]).toBeTruthy();
    expect(nonces[0]).not.toBe(nonces[1]);
  });

  it("treats a missing object as undefined", async () => {
    const { store } = fakeStorage();
    expect(await store.read("library/missing.json")).toBeUndefined();
  });
});

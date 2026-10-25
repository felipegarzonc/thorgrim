import { describe, expect, it } from "vitest";
import { busyError, Gate } from "./blobs.ts";
import { hot } from "./hot.ts";

describe("storage under load", () => {
  it("runs at most a few requests at a time, and all of them", async () => {
    const gate = new Gate(3);
    let running = 0;
    let most = 0;
    const done = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        gate.run(async () => {
          running++;
          most = Math.max(most, running);
          await new Promise((r) => setTimeout(r, 2));
          running--;
          return i;
        }),
      ),
    );
    expect(most).toBe(3);
    expect(done).toEqual(Array.from({ length: 20 }, (_, i) => i));
    // A failing request frees its slot too.
    await expect(gate.run(() => Promise.reject(new Error("no")))).rejects.toThrow("no");
    expect(await gate.run(async () => "still works")).toBe("still works");
  });

  it("knows when Supabase is only busy", () => {
    expect(busyError("Too many connections issued to the database")).toBe(true);
    expect(busyError("Object not found")).toBe(false);
  });

  it("keeps hot settings a few seconds, each caller with its own copy", async () => {
    let reads = 0;
    const accounts = hot(async () => (reads++, [{ id: "a", name: "Ana" }]), 50);
    const [x, y] = await Promise.all([accounts(), accounts()]);
    expect(reads).toBe(1);
    x[0].name = "changed";
    expect(y[0].name).toBe("Ana");
    expect((await accounts())[0].name).toBe("Ana");
    accounts.forget();
    await accounts();
    expect(reads).toBe(2);
    await new Promise((r) => setTimeout(r, 60));
    await accounts();
    expect(reads).toBe(3);
  });
});

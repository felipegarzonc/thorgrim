import { beforeAll, describe, expect, it } from "vitest";

// The bits of a browser the sound module touches, without audio: cues are seen through the event it sends.
const heardCues: string[] = [];
const kept = new Map<string, string>();
beforeAll(() => {
  const target = new EventTarget();
  Object.assign(globalThis, {
    window: Object.assign(target, { matchMedia: () => ({ matches: false }) }),
    document: { hidden: false },
    localStorage: { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => kept.set(k, v) },
    CustomEvent: class extends Event {
      detail: unknown;
      constructor(type: string, init: { detail: unknown }) {
        super(type);
        this.detail = init.detail;
      }
    },
  });
  target.addEventListener("thorgrim-sound", (e) => heardCues.push((e as unknown as { detail: string }).detail));
});

describe("sounds", () => {
  it("plays what the setting allows, once per key, nothing when off or hidden", async () => {
    const { CUES, feedback, feedbackOnce, heard, setSoundLevel, setSoundVolume, soundLevel } = await import("../web/src/sound.ts");
    expect(soundLevel()).toBe("important");
    expect(heard("score", "important")).toBe(true);
    expect(heard("tap", "important")).toBe(false);
    expect(heard("tap", "all")).toBe(true);
    expect(Object.keys(CUES).every((c) => !heard(c as keyof typeof CUES, "off"))).toBe(true);

    feedback("tap");
    feedback("round");
    feedbackOnce("result-g1", "victory");
    feedbackOnce("result-g1", "victory");
    expect(heardCues).toEqual(["round", "victory"]);

    setSoundLevel("all");
    feedback("tap");
    (globalThis as unknown as { document: { hidden: boolean } }).document.hidden = true;
    feedback("score");
    (globalThis as unknown as { document: { hidden: boolean } }).document.hidden = false;
    setSoundLevel("off");
    feedback("victory");
    expect(heardCues).toEqual(["round", "victory", "tap"]);

    setSoundVolume(3);
    expect(kept.get("thorgrim-sound")).toBe("off");
    expect(kept.get("thorgrim-volume")).toBe("1");
  });

  it("reads Thorgrim's markdown as plain speech", async () => {
    const { spoken } = await import("../web/src/media.tsx");
    expect(spoken("### Plan\n- **Charge** the [Gutbusters](https://x.y) first\n| a | b |\n| 1 | 2 |\n`code` done")).toBe("Plan Charge the Gutbusters first code done");
  });
});

import { describe, expect, it } from "vitest";
import { screenOf } from "../web/src/analytics.tsx";

describe("analytics screens", () => {
  it("names the screen, never its ids or tokens", () => {
    expect(screenOf("")).toBe("/home");
    expect(screenOf("#/games/e452615f3876/round-3")).toBe("/games/[id]/round");
    expect(screenOf("#/games/e452615f3876/results")).toBe("/games/[id]/results");
    expect(screenOf("#/club/ladder")).toBe("/club/ladder");
    expect(screenOf("#/club/abc123")).toBe("/club/post/[id]");
    expect(screenOf("#/club/event/ev1")).toBe("/club/event/[id]");
    expect(screenOf("#/join/SECRETtoken_123")).toBe("/join/[token]");
    expect(screenOf("#/r/SECRET")).toBe("/r/[token]");
    expect(screenOf("#/play/SECRET")).toBe("/play/[token]");
    expect(screenOf("#/Weird-Thing")).toBe("/other");
  });
});

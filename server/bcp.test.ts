import { describe, expect, it } from "vitest";
import { bcpUrl } from "../shared/bcp.ts";

describe("Best Coast Pairings links", () => {
  it("takes BCP links only, cleaned to https", () => {
    expect(bcpUrl("https://www.bestcoastpairings.com/event/AbC123")).toBe("https://www.bestcoastpairings.com/event/AbC123");
    expect(bcpUrl("bestcoastpairings.com/event/x")).toBe("https://bestcoastpairings.com/event/x");
    expect(bcpUrl("http://www.bestcoastpairings.com/e")).toBe("https://www.bestcoastpairings.com/e");
    expect(bcpUrl("")).toBeUndefined();
    expect(bcpUrl("javascript:alert(1)")).toBeUndefined();
    expect(bcpUrl("https://bestcoastpairings.com.evil.example/x")).toBeUndefined();
    expect(bcpUrl("https://evil.example/?bestcoastpairings.com")).toBeUndefined();
  });
});

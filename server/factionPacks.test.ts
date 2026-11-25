import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FactionPack, GameData } from "../shared/types.ts";
import { currentFactions, readPacks, withPacks } from "./data.ts";

const unit = (id: string, name: string, faction: string) => ({ id, name, faction, keywords: [], models: 1, weapons: [], abilities: [] });
const base = (): GameData => ({
  source: "test",
  commit: "x",
  builtAt: "2026-11-01T00:00:00Z",
  units: { fs1: unit("fs1", "Auric Runefather", "Fyreslayers"), og1: unit("og1", "Tyrant", "Ogor Mawtribes") },
  factions: {
    Fyreslayers: { name: "Fyreslayers", units: [{ id: "fs1", points: 100 }], rules: [] },
    "Fyreslayers - Lofnir Drothkeepers": { name: "Fyreslayers - Lofnir Drothkeepers", units: [{ id: "fs1", points: 100 }], rules: [] },
    "Ogor Mawtribes": { name: "Ogor Mawtribes", units: [{ id: "og1", points: 150 }], rules: [] },
  },
  core: [],
});
const pack: FactionPack = {
  name: "Khazalite Holds",
  source: "Battletome",
  replaces: ["Fyreslayers"],
  units: { kh1: unit("kh1", "Auric Runefather", "Khazalite Holds") },
  factions: { "Khazalite Holds": { name: "Khazalite Holds", units: [{ id: "kh1", points: 0 }], rules: [] } },
};

describe("faction packs", () => {
  it("adds the pack's army and retires the one it replaces, with its armies of renown", () => {
    const d = withPacks(base(), [pack]);
    expect(d.units.kh1.faction).toBe("Khazalite Holds");
    expect(d.retired).toEqual(["Fyreslayers", "Fyreslayers - Lofnir Drothkeepers"]);
    expect(currentFactions(d)).toEqual(["Khazalite Holds", "Ogor Mawtribes"]);
    // Old Fyreslayers lists still find their warscrolls.
    expect(d.factions.Fyreslayers.units).toHaveLength(1);
    expect(d.packs).toEqual([{ name: "Khazalite Holds", source: "Battletome" }]);
  });

  it("is a no-op without packs, and merging the same pack twice changes nothing", () => {
    expect(withPacks(base(), [])).toEqual(base());
    const once = withPacks(base(), [pack]);
    expect(withPacks(once, [pack])).toEqual(once);
  });

  it("reads the packs in a folder and skips a broken one", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "packs-"));
    fs.writeFileSync(path.join(dir, "khazalite-holds.json"), JSON.stringify(pack));
    fs.writeFileSync(path.join(dir, "broken.json"), "{ not json");
    fs.writeFileSync(path.join(dir, "notes.txt"), "ignored");
    expect(readPacks(dir).map((p) => p.name)).toEqual(["Khazalite Holds"]);
    expect(readPacks(path.join(dir, "missing"))).toEqual([]);
  });
});

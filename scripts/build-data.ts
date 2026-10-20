// Builds data/aos.json from the community BSData "age-of-sigmar-4th" files.
//
//   npm run data                 # downloads BSData into .cache/bsdata (git pull if it is a git checkout)
//   BSDATA_DIR=/path npm run data  # use an existing checkout
//
// The output is a normalised view of every faction: units (stats, weapons,
// abilities, points) and faction-level rules (battle traits, formations,
// enhancements, lores), plus the game-system rules (battle tactics, core
// abilities). It is regenerated after each Battlescroll and not committed.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DOMParser, type Element } from "@xmldom/xmldom";
import type { Ability, Faction, FactionRule, GameData, Unit, Weapon } from "../shared/types.ts";

const REPO = "https://github.com/BSData/age-of-sigmar-4th";
const root = process.cwd();
const bsDir = process.env.BSDATA_DIR ?? path.join(root, ".cache", "bsdata");
const outFile = path.join(root, "data", "aos.json");

const TARBALL = process.env.BSDATA_TARBALL_URL || "https://codeload.github.com/BSData/age-of-sigmar-4th/tar.gz/HEAD";

/**
 * Get the BSData files. An existing git checkout is updated with git;
 * otherwise the latest archive is downloaded and unpacked, so git is not
 * required (a fresh Mac has no git until the developer tools are installed).
 * Returns a short id for the data version.
 */
async function ensureCheckout(): Promise<string> {
  if (process.env.BSDATA_DIR || fs.existsSync(path.join(bsDir, ".git"))) {
    if (!process.env.BSDATA_DIR) {
      console.log("Updating BSData checkout…");
      execFileSync("git", ["-C", bsDir, "pull", "--ff-only", "-q"], { stdio: "inherit" });
    }
    try {
      return execFileSync("git", ["-C", bsDir, "rev-parse", "--short", "HEAD"]).toString().trim();
    } catch {
      return "local";
    }
  }
  console.log("Downloading BSData…");
  const res = await fetch(TARBALL);
  if (!res.ok) throw new Error(`BSData download failed: ${res.status} ${res.statusText}`);
  const archive = path.join(path.dirname(bsDir), "bsdata.tar.gz");
  fs.mkdirSync(path.dirname(bsDir), { recursive: true });
  fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  const top = execFileSync("tar", ["-tzf", archive]).toString().split("\n")[0].replace(/\/.*$/, "");
  fs.rmSync(bsDir, { recursive: true, force: true });
  fs.mkdirSync(bsDir, { recursive: true });
  execFileSync("tar", ["-xzf", archive, "-C", bsDir, "--strip-components=1"]);
  fs.rmSync(archive);
  // The archive's top folder is "<repo>-<commit sha>".
  return /-([0-9a-f]{7,40})$/.exec(top)?.[1].slice(0, 7) ?? "download";
}

const clean = (s: string | null | undefined) =>
  (s ?? "").replace(/\^\^/g, "").replace(/\r/g, "").trim();

function children(el: Element, tag?: string): Element[] {
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (!tag || (n as Element).tagName === tag)) out.push(n as Element);
  }
  return out;
}

function descendants(el: Element, tag: string): Element[] {
  return Array.from(el.getElementsByTagName(tag)) as Element[];
}

function characteristics(profile: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of descendants(profile, "characteristic")) {
    out[c.getAttribute("name") ?? ""] = clean(c.textContent);
  }
  return out;
}

const ABILITY_FIELDS = new Set(["Timing", "Declare", "Effect", "Keywords", "Used By"]);

function toAbility(profile: Element): Ability {
  const ch = characteristics(profile);
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(ch)) if (!ABILITY_FIELDS.has(k) && v) extra[k] = v;
  return {
    name: clean(profile.getAttribute("name")),
    kind: profile.getAttribute("typeName") ?? "",
    timing: ch.Timing || undefined,
    declare: ch.Declare || undefined,
    effect: ch.Effect ?? "",
    keywords: ch.Keywords || undefined,
    extra: Object.keys(extra).length ? extra : undefined,
  };
}

function toWeapon(profile: Element): Weapon {
  const ch = characteristics(profile);
  const ranged = profile.getAttribute("typeName") === "Ranged Weapon";
  return {
    name: clean(profile.getAttribute("name")),
    kind: ranged ? "ranged" : "melee",
    range: ranged ? ch.Rng : undefined,
    attacks: ch.Atk ?? "",
    hit: ch.Hit ?? "",
    wound: ch.Wnd ?? "",
    rend: ch.Rnd ?? "",
    damage: ch.Dmg ?? "",
    ability: ch.Ability ?? "-",
  };
}

const isAbilityType = (t: string | null) =>
  !!t && (t.startsWith("Ability") || t === "Manifestation" || t === "Battle Tactic Card");

async function main() {
  const commit = await ensureCheckout();
  const files = fs.readdirSync(bsDir).filter((f) => f.endsWith(".cat") || f.endsWith(".gst"));
  const parser = new DOMParser();

  type Doc = { file: string; name: string; library: boolean; root: Element; gst: boolean };
  const docs: Doc[] = files.map((file) => {
    const xml = fs.readFileSync(path.join(bsDir, file), "utf8");
    const root = parser.parseFromString(xml, "text/xml").documentElement as unknown as Element;
    return {
      file,
      name: root.getAttribute("name") ?? file,
      library: root.getAttribute("library") === "true",
      root,
      gst: file.endsWith(".gst"),
    };
  });

  // Global id index (links can cross files).
  const byId = new Map<string, Element>();
  for (const d of docs) {
    for (const tag of ["selectionEntry", "selectionEntryGroup", "profile", "rule"]) {
      for (const el of descendants(d.root, tag)) {
        const id = el.getAttribute("id");
        if (id && !byId.has(id)) byId.set(id, el);
      }
    }
  }

  const baseFaction = (catName: string) => catName.replace(/ - Library$/, "");

  // ---- Units ----
  const units: Record<string, Unit> = {};
  for (const d of docs) {
    if (d.gst) continue;
    for (const el of descendants(d.root, "selectionEntry")) {
      if (el.getAttribute("type") !== "unit") continue;
      const id = el.getAttribute("id")!;
      if (units[id]) continue;
      units[id] = parseUnit(el, d.library ? baseFaction(d.name) : d.name.split(" - ")[0]);
    }
  }

  function parseUnit(el: Element, faction: string): Unit {
    const keywords = descendants(el, "categoryLink")
      .map((c) => c.getAttribute("name") ?? "")
      .filter((k) => k && !k.startsWith("non-"));
    const profiles = [...descendants(el, "profile")];
    // Profiles can also be pulled in by infoLinks.
    for (const link of descendants(el, "infoLink")) {
      const target = byId.get(link.getAttribute("targetId") ?? "");
      if (target?.tagName === "profile") profiles.push(target);
    }
    const unit: Unit = {
      id: el.getAttribute("id")!,
      name: clean(el.getAttribute("name")),
      faction,
      keywords: [...new Set(keywords)],
      models: 0,
      weapons: [],
      abilities: [],
    };
    const seen = new Set<string>();
    for (const p of profiles) {
      const type = p.getAttribute("typeName");
      const key = `${type}:${p.getAttribute("name")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (type === "Unit" && !unit.stats) {
        const ch = characteristics(p);
        unit.stats = { move: ch.Move, health: ch.Health, save: ch.Save, control: ch.Control };
      } else if (type === "Melee Weapon" || type === "Ranged Weapon") {
        unit.weapons.push(toWeapon(p));
      } else if (isAbilityType(type)) {
        const a = toAbility(p);
        unit.abilities.push(a);
        const ward = /^Ward \((\d\+)\)/.exec(a.name);
        if (ward && unit.stats) unit.stats.ward = ward[1];
      }
    }
    if (unit.stats && !unit.stats.ward) {
      const ward = unit.abilities.map((a) => /^Ward \((\d\+)\)/.exec(a.name)).find(Boolean);
      if (ward) unit.stats.ward = ward[1];
    }
    // Model count = sum of the minimum of each model entry.
    for (const m of descendants(el, "selectionEntry")) {
      if (m.getAttribute("type") !== "model") continue;
      const min = children(m, "constraints")
        .flatMap((c) => children(c, "constraint"))
        .find((c) => c.getAttribute("type") === "min" && c.getAttribute("scope") === "parent");
      unit.models += min ? Number(min.getAttribute("value")) || 1 : 1;
      const base = descendants(m, "rule").find((r) => r.getAttribute("name") === "Base Size");
      if (base && !unit.baseSize) unit.baseSize = clean(base.textContent);
    }
    if (unit.models === 0) unit.models = 1;
    return unit;
  }

  // ---- Rules walker for faction-level and core rules ----
  function collectRules(start: Element[], visited = new Set<string>()): FactionRule[] {
    const out: FactionRule[] = [];
    const walk = (el: Element, group: string, entry: string) => {
      const tag = el.tagName;
      if (tag === "selectionEntry" && el.getAttribute("type") === "unit") return;
      if (tag === "profile") {
        if (isAbilityType(el.getAttribute("typeName"))) out.push({ group, entry, ability: toAbility(el) });
        return;
      }
      if (tag === "rule") {
        const desc = descendants(el, "description")[0];
        const text = clean(desc?.textContent);
        if (text && el.getAttribute("name") !== "Base Size") {
          out.push({ group, entry, ability: { name: clean(el.getAttribute("name")), kind: "Rule", effect: text } });
        }
        return;
      }
      if (tag === "entryLink" || tag === "infoLink") {
        const id = el.getAttribute("targetId") ?? "";
        const target = byId.get(id);
        if (!target || visited.has(id)) return;
        visited.add(id);
        walk(target, group, entry);
        return;
      }
      if (tag === "selectionEntryGroup") group = clean(el.getAttribute("name"));
      if (tag === "selectionEntry") entry = clean(el.getAttribute("name"));
      for (const c of children(el)) walk(c, group, entry);
    };
    for (const s of start) walk(s, "", "");
    // De-duplicate identical rules reached by several paths.
    const seen = new Set<string>();
    return out.filter((r) => {
      const k = `${r.group}|${r.entry}|${r.ability.name}|${r.ability.effect.slice(0, 80)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  const ruleRoots = (d: Doc) =>
    ["sharedSelectionEntries", "sharedSelectionEntryGroups", "selectionEntries", "sharedProfiles", "sharedRules", "rules"]
      .flatMap((t) => children(d.root, t));

  // ---- Factions ----
  const factions: Record<string, Faction> = {};
  for (const d of docs) {
    if (d.gst || d.library) continue;
    const pts = new Map<string, number>();
    for (const link of descendants(d.root, "entryLink")) {
      const target = link.getAttribute("targetId") ?? "";
      if (!units[target]) continue;
      const cost = descendants(link, "cost").find((c) => c.getAttribute("typeId") === "points");
      const value = cost ? Number(cost.getAttribute("value")) : 0;
      if (!pts.has(target) || (pts.get(target) === 0 && value > 0)) pts.set(target, value);
    }
    // Units defined directly in the catalogue count too.
    for (const u of Object.values(units)) if (u.faction === d.name && !pts.has(u.id)) pts.set(u.id, 0);
    const library = docs.find((x) => x.library && baseFaction(x.name) === d.name.split(" - ")[0]);
    const rules = collectRules([...ruleRoots(d), ...(library && d.name === baseFaction(library.name) ? ruleRoots(library) : [])]);
    factions[d.name] = {
      name: d.name,
      units: [...pts.entries()].map(([id, points]) => ({ id, points })).sort((a, b) => units[a.id].name.localeCompare(units[b.id].name)),
      rules,
    };
  }

  const gst = docs.find((d) => d.gst)!;
  const core = collectRules(ruleRoots(gst));

  const data: GameData = { source: REPO, commit, builtAt: new Date().toISOString(), units, factions, core };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(data));
  const size = (fs.statSync(outFile).size / 1e6).toFixed(1);
  console.log(
    `Wrote ${path.relative(root, outFile)} (${size} MB): ${Object.keys(units).length} units, ` +
      `${Object.keys(factions).length} factions, ${core.length} core rules (BSData ${commit}).`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

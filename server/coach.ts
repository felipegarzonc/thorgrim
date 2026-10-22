// The AI coach: Claude with tools over the army data, the user's rules
// library and the dice engine.
//
// History is append-only so prompt caching and preserved thinking keep
// working: the system prompt and tool list never change during a
// conversation, the game dossier goes into user turns, and when lists or the
// battleplan change an updated dossier is appended rather than edited in.

import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { castChance, chargeChance, damageBySave, expectedDamage, parseCrit, parseTarget, simulate, type AttackProfile } from "../engine/dice.ts";
import type { ArmyList, Game, GamePlan, TurnTips } from "../shared/types.ts";
import { battleplanText } from "../shared/battleplans.ts";
import { isBattleplanDoc, scoringFor } from "../shared/season.ts";
import { factionRulesText, findUnit, gameData, listDossier, matchedPlayRule, norm, warscrollText } from "./data.ts";
import { blobs } from "./blobs.ts";
import { docPath, getPages, libraryDocs, listDocuments, parsePageRange, searchLibrary } from "./library.ts";
import { checkBudget, HAIKU_PRICE, recordUsage } from "./accounts.ts";
import { anthropic } from "./anthropic.ts";
import { reportFacts, reportSides } from "../shared/report.ts";
import { cleanChanges, voiceOptions, type VoiceChange } from "../shared/voice.ts";
import { currentUser } from "./context.ts";
import { langNote } from "./lang.ts";
import { metaDescriptions, metaSchemas, omnissiahReady, runMetaTool, type MetaTool } from "./omnissiah.ts";
import { Collection } from "./store.ts";

type Msg = Anthropic.Beta.BetaMessageParam;

/** Only a game's own photos are read (see sharedGames.ts, isGamePhoto); the path comes from game data players edit. */
const gamePhotoPath = (gameId: string, path: string) => new RegExp(`^(users/[a-zA-Z0-9-]+/)?game-photos/${gameId}/\\d+\\.jpg$`).test(path);
type Block = Anthropic.Beta.BetaContentBlockParam;

export interface TranscriptEntry {
  role: "user" | "coach";
  text: string;
  tools?: string[];
  at: string;
}

export interface Conversation {
  id: string; // game id, or "general"
  messages: Msg[];
  transcript: TranscriptEntry[];
  dossierHash?: string;
  referencesHash?: string;
  photoHash?: string;
}

export const conversations = new Collection<Conversation>("conversations");

const MODEL = process.env.COACH_MODEL ?? "claude-opus-5-5";
/** Players' coach runs on the cheapest model; the admin keeps the full coach. */
const PLAYER_MODEL = process.env.PLAYER_MODEL ?? "claude-haiku-5-5";
const isHaiku = (model: string) => model.includes("haiku");

/** The model for the signed-in person, and what goes with it (Haiku has no refusal fallback; usage is priced per model). */
function coachModel() {
  const model = currentUser().isAdmin ? MODEL : PLAYER_MODEL;
  const haiku = isHaiku(model);
  return {
    model,
    extra: haiku ? {} : { betas: ["server-side-fallback-2026-07-01"] as Anthropic.AnthropicBeta[], fallbacks: "default" as const },
    price: haiku ? HAIKU_PRICE : undefined,
    haiku,
  };
}

// ---------- system prompt (frozen) ----------

/** Who Thorgrim is: shared by everything he writes. */
const THORGRIM = `You are Thorgrim, the coach in this app. Who he is:
- A dwarf general four centuries old, veteran of a thousand battles across the Mortal Realms. He keeps a Book of Grudges and threatens to write the opponent's lucky rolls in it.
- Gruff, blunt and dry-humoured, warm underneath. Short sentences. He calls the player "commander" (in Spanish "comandante") and swears by his beard ("by my beard", "¡por mis barbas!") now and then, never every time.
- He respects a turn well played and says so; he groans at a failed 3" charge and at command points left unspent. He teases, never mocks; he respects every army on the table, the opponent's too.
- He knows the rules cold and has no patience for guesses: when he isn't sure, he says so plainly.
Where it shows: a line of character to open or close an answer, a verdict, a headline. Where it never gets in the way: rules text, numbers, steps and instructions stay plain, exact and short.`;

const SYSTEM = `${THORGRIM}

You are also an expert Warhammer Age of Sigmar (4th edition) coach. Your player plays Ogor Mawtribes in competitive matched play, using the current General's Handbook season. Your job is to help them make better decisions before, during and after games, and to make them a better player over time, not to play for them.

How you work:
- Ground every rules statement in a source: the army data (warscrolls and faction rules from BSData), or the app's rules library (core rules, General's Handbook, battletomes, battleplans, maps) via search_rules / read_rules_pages. Cite briefly, e.g. [Warscroll: Tyrant] or [General's Handbook p.34]. If you cannot find a rule, say so plainly and give your best understanding marked as unverified. Never invent rules text.
- Use the calculator tools for every probability or damage number (damage_calc, charge_odds, cast_odds). Do not estimate odds in your head.
- The player's messages carry the current game state (round, priority, CP, VP, fury and rage dice, battle tactic progress, unit damage). Treat it as the truth for the board, and ask for what you need (distances, objective control, positions) when it matters for the decision.
- Think about the opponent too: what their army can do in response (reactive commands, Counter-charge, Covering Fire, All-out Defence, redeploys, spells, shooting), how many CP they hold, and what they will score.
- Scoring wins games. Tie advice back to victory points this round and next: objectives and battle tactics. Season facts (General's Handbook 2026-27): battles last 5 rounds; each player picks up to 2 battle tactic cards, each with Affray, Strike and Domination tactics that must be completed in that order, at most 1 per card at the end of each of your turns, 5 VP each. Seizing the initiative (going first after going second in the previous round, i.e. a double turn) means you cannot complete battle tactics in that turn, unless your opponent leads by 11+ VP; your opponent then counts as the underdog. Each player gains 4 CP at the start of each battle round (+1 for the underdog); unspent CP are lost. Verify details in the player's General's Handbook when it matters.

Answer style:
- During a game, be fast and scannable on a phone: lead with the recommendation in one line, then at most 2 options with odds and risks. Keep it under about 100 words unless asked for more.
- The first time you name an ability, spell or command, add what it does in a few words in brackets, e.g. "Counter-charge (2 CP: charge in their charge phase)". The player doesn't know every rule by name.
- For pre-game briefs and post-game reviews, be thorough but structured with short headings.
- Explain the why in one sentence so the player learns the principle.
- Use English.

Web research: you can search and fetch a small set of community sites. Wahapedia (wahapedia.ru/aos4/...) has the core rules, the General's Handbook and faction pages: use it to check a rule when the player's library and the army data don't cover it, and cite the page URL. Prefer the rules library when both have it. Listhammer has recent tournament lists, Woehammer faction win rates, Goonhammer and others tactics articles: use them for meta and matchup questions, and say how recent the data is.${
  omnissiahReady()
    ? "\n\nTournament data: for win rates, matchups and what lists are winning, use the aos_* tools first (daily data from Listhammer) and only search the web for what they don't cover. Say how many games a number rests on (few games is a hint, not a trend) and the date of the data."
    : ""
}`;

// ---------- tools ----------

const attackSchema = z.object({
  label: z.string().optional().describe("Weapon or unit name for the report"),
  attacks: z.string().describe('Attacks per model, e.g. "4", "D6", "2D6"'),
  hit: z.string().describe('To hit, e.g. "3+"'),
  wound: z.string().describe('To wound, e.g. "4+"'),
  rend: z.number().describe("Rend as a positive number (0 for -)"),
  damage: z.string().describe('Damage, e.g. "2", "D3"'),
  crit: z.string().describe('Weapon ability text or crit type: "Crit (2 Hits)", "Crit (Auto-wound)", "Crit (Mortal)" or "-"'),
  models: z.number().describe("Number of models attacking with this weapon"),
  hit_mod: z.number().optional(),
  wound_mod: z.number().optional(),
  reroll_hits: z.enum(["none", "ones", "failed"]).optional(),
  reroll_wounds: z.enum(["none", "ones", "failed"]).optional(),
});

const damageCalcSchema = z.object({
  attacks: z.array(attackSchema).min(1),
  target: z.object({
    save: z.string().describe('Save characteristic, e.g. "4+", or "-" for none'),
    ward: z.string().optional().describe('Ward, e.g. "5+"'),
    save_mod: z.number().optional().describe("Bonus to save rolls (cover, All-out Defence), max +1"),
    reroll_saves: z.enum(["none", "ones", "failed"]).optional(),
    health: z.number().optional().describe("Health per model, to get kill odds"),
    models: z.number().optional().describe("Models remaining in the target unit"),
    damage_taken: z.number().optional().describe("Damage already allocated to the unit"),
  }),
});

const toolSchemas = {
  search_rules: z.object({ query: z.string(), limit: z.number().optional() }),
  read_rules_pages: z.object({ doc_id: z.string(), pages: z.string().describe('e.g. "12" or "12-14"') }),
  lookup_warscroll: z.object({ name: z.string(), faction: z.string().optional() }),
  faction_rules: z.object({ faction: z.string(), query: z.string().optional() }),
  damage_calc: damageCalcSchema,
  charge_odds: z.object({ gap_inches: z.number(), bonus: z.number().optional(), reroll: z.boolean().optional() }),
  cast_odds: z.object({
    casting_value: z.number(),
    cast_mod: z.number().optional(),
    opponent_can_unbind: z.boolean().optional(),
    unbind_mod: z.number().optional(),
  }),
} as const;

type ToolName = keyof typeof toolSchemas;

const toolDescriptions: Record<ToolName, string> = {
  search_rules:
    "Search the rules library (core rules, General's Handbook, battletomes, battleplans). Returns matching passages with document id, title and page. Use it before answering any rules question that the army data does not cover.",
  read_rules_pages: "Read full text of specific pages of a library PDF (use after search_rules, or for battleplan pages listed in the dossier).",
  lookup_warscroll: "Get a full warscroll (stats, weapons, abilities with timing) for any unit in the game by name.",
  faction_rules:
    "Get a faction's battle traits, battle formations, enhancements (heroic traits, artefacts) and lores. Optional query filters by name/text.",
  damage_calc:
    "Exact expected damage plus a simulation (damage distribution, kill chance, models slain) for one or more weapon profiles against a target. Also returns expected damage against every save value.",
  charge_odds: "Probability of a successful charge across a gap in inches (edge to edge), with optional bonus and re-roll.",
  cast_odds: "Probability to cast a spell or chant a prayer, optionally against an unbind attempt.",
};

const customTools: Anthropic.Beta.BetaTool[] = (Object.keys(toolSchemas) as ToolName[]).map((name) => ({
  name,
  description: toolDescriptions[name],
  input_schema: z.toJSONSchema(toolSchemas[name]) as Anthropic.Beta.BetaTool.InputSchema,
}));

const RESEARCH_DOMAINS = ["wahapedia.ru", "listhammer.info", "woehammer.com", "goonhammer.com", "spruesandbrews.com", "warhammer-community.com", "frontlinegaming.org"];

const TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  ...customTools,
  { type: "web_search_20260209", name: "web_search", max_uses: 4, allowed_domains: RESEARCH_DOMAINS },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 4, allowed_domains: RESEARCH_DOMAINS },
];
// Tournament data from Omnissiah, when it's set up (server/omnissiah.ts).
const metaTools = (): Anthropic.Beta.BetaTool[] =>
  omnissiahReady()
    ? (Object.keys(metaSchemas) as MetaTool[]).map((name) => ({
        name,
        description: metaDescriptions[name],
        input_schema: z.toJSONSchema(metaSchemas[name]) as Anthropic.Beta.BetaTool.InputSchema,
      }))
    : [];
// Haiku takes the basic web search and fetch tools (the 2026 versions with filtering are for Opus and Sonnet).
const HAIKU_TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  ...customTools,
  { type: "web_search_20250305", name: "web_search", max_uses: 4, allowed_domains: RESEARCH_DOMAINS },
  { type: "web_fetch_20250910", name: "web_fetch", max_uses: 4, allowed_domains: RESEARCH_DOMAINS },
];

function toProfile(a: z.infer<typeof attackSchema>): AttackProfile {
  return {
    name: a.label,
    attacks: a.attacks,
    hit: parseTarget(a.hit) ?? 7,
    wound: parseTarget(a.wound) ?? 7,
    rend: Math.abs(a.rend),
    damage: a.damage,
    crit: parseCrit(a.crit),
    models: a.models,
    hitMod: a.hit_mod,
    woundMod: a.wound_mod,
    rerollHits: a.reroll_hits,
    rerollWounds: a.reroll_wounds,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (p: number) => `${Math.round(p * 1000) / 10}%`;

async function runTool(name: string, input: unknown): Promise<string> {
  if (name in metaSchemas) return runMetaTool(name as MetaTool, input);
  if (!(name in toolSchemas)) throw new Error(`Unknown tool ${name}`);
  const parsed = toolSchemas[name as ToolName].safeParse(input);
  if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.message}`);
  const args = parsed.data as never;
  switch (name as ToolName) {
    case "search_rules": {
      const { query, limit } = args as z.infer<typeof toolSchemas.search_rules>;
      const hits = await searchLibrary(query, Math.min(limit ?? 6, 10));
      if (!hits.length) return "No matches in the rules library. (That book may not be in the library yet.)";
      return hits.map((h) => `[${h.title} p.${h.page} | doc_id=${h.docId}]\n${h.text}`).join("\n\n---\n\n");
    }
    case "read_rules_pages": {
      const { doc_id, pages } = args as z.infer<typeof toolSchemas.read_rules_pages>;
      const doc = await libraryDocs.get(doc_id);
      if (!doc) return "No document with that id.";
      const text = await getPages(doc_id);
      const wanted = parsePageRange(pages, text.length).slice(0, 8);
      return wanted.map((p) => `[${doc.title} p.${p}]\n${text[p - 1] ?? ""}`).join("\n\n");
    }
    case "lookup_warscroll": {
      const { name: unitName, faction } = args as z.infer<typeof toolSchemas.lookup_warscroll>;
      const u = findUnit(unitName, faction);
      return u ? warscrollText(u) : `No warscroll found for "${unitName}".`;
    }
    case "faction_rules": {
      const { faction, query } = args as z.infer<typeof toolSchemas.faction_rules>;
      const d = gameData();
      const key = Object.keys(d.factions).find((f) => norm(f) === norm(faction)) ?? Object.keys(d.factions).find((f) => norm(f).includes(norm(faction)));
      if (!key) return `Unknown faction. Known: ${Object.keys(d.factions).join(", ")}`;
      const q = query ? norm(query) : "";
      const text = factionRulesText(
        d.factions[key].rules,
        (r) => matchedPlayRule(r) && (!q || norm(`${r.group} ${r.entry} ${r.ability.name} ${r.ability.effect}`).includes(q)),
      );
      return text.slice(0, 20000) || "No matching rules.";
    }
    case "damage_calc": {
      const { attacks, target } = args as z.infer<typeof damageCalcSchema>;
      const profiles = attacks.map(toProfile);
      const t = {
        save: parseTarget(target.save),
        ward: parseTarget(target.ward ?? null),
        saveMod: target.save_mod,
        rerollSaves: target.reroll_saves,
        health: target.health,
        models: target.models,
        damageTaken: target.damage_taken,
      };
      const per = profiles.map((p) => ({ weapon: p.name ?? p.attacks, ...expectedDamage(p, t) }));
      const sim = simulate(profiles, t, 20000);
      const dist = sim.atLeast
        .map((p, n) => ({ n, p }))
        .filter(({ n, p }) => n > 0 && p > 0.02)
        .filter((_, i, arr) => arr.length <= 12 || i % Math.ceil(arr.length / 12) === 0)
        .map(({ n, p }) => `${n}+: ${pct(p)}`);
      return JSON.stringify({
        expected_damage_total: round2(per.reduce((s, x) => s + x.expectedDamage, 0)),
        per_weapon: per.map((x) => ({ weapon: x.weapon, hits: round2(x.expectedHits), wounds: round2(x.expectedWounds), unsaved: round2(x.expectedUnsaved), mortals: round2(x.expectedMortals), damage: round2(x.expectedDamage) })),
        chance_at_least: dist,
        kill_chance: sim.killChance !== undefined ? pct(sim.killChance) : undefined,
        expected_models_slain: sim.expectedModelsSlain !== undefined ? round2(sim.expectedModelsSlain) : undefined,
        by_save: damageBySave(profiles, { ward: t.ward, saveMod: t.saveMod }).map((r) => `${r.save}: ${round2(r.damage)}`),
      });
    }
    case "charge_odds": {
      const { gap_inches, bonus, reroll } = args as z.infer<typeof toolSchemas.charge_odds>;
      const r = chargeChance(gap_inches, { bonus, reroll });
      return JSON.stringify({ roll_needed: r.needed, chance: pct(r.chance) });
    }
    case "cast_odds": {
      const a = args as z.infer<typeof toolSchemas.cast_odds>;
      const r = castChance(a.casting_value, { castMod: a.cast_mod, unbind: a.opponent_can_unbind, unbindMod: a.unbind_mod });
      return JSON.stringify({ cast: pct(r.cast), cast_and_not_unbound: a.opponent_can_unbind ? pct(r.castNotUnbound) : undefined, miscast: pct(r.miscast) });
    }
  }
}

// ---------- context building ----------

export interface CoachContext {
  game?: Game;
  myList?: ArmyList;
  opponentList?: ArmyList;
}

async function libraryCatalogue(): Promise<string> {
  const docs = await listDocuments();
  if (!docs.length) return "The rules library is empty: no books have been added yet. Say so when a rules question needs a book.";
  return docs.map((d) => `- ${d.title} [${d.category}, ${d.kind}${d.kind === "pdf" ? `, ${d.pages} pages` : ""}] doc_id=${d.id}`).join("\n");
}

function battleTacticsText(game?: Game): string {
  const cards = gameData().core.filter((r) => r.ability.kind === "Battle Tactic Card");
  const chosen = new Set([...(game?.state.tactics ?? []), ...(game?.state.opponentTactics ?? [])].map((t) => norm(t.card)));
  const lines = [`Battle tactic cards in the data: ${cards.map((c) => c.ability.name).join(", ")}.`];
  for (const c of cards.filter((c) => chosen.has(norm(c.ability.name)))) {
    lines.push(`\n### ${c.ability.name} (chosen)`);
    for (const [k, v] of Object.entries(c.ability.extra ?? {})) lines.push(`${k}: ${v.replace(/\*+/g, "")}`);
  }
  return lines.join("\n");
}

/**
 * The library files the coach gets for a game: the battleplan's card and map
 * (found by title, so nothing needs setting up per game) plus any attached by hand.
 */
async function gameReferences(game?: Game): Promise<{ docId: string; pages?: string }[]> {
  if (!game) return [];
  const auto = (await listDocuments()).filter((d) => isBattleplanDoc(d, game.battleplan)).map((d) => ({ docId: d.id }));
  const manual = game.references.filter((r) => !auto.some((a) => a.docId === r.docId));
  return [...auto, ...manual];
}

async function dossier(ctx: CoachContext): Promise<string> {
  const parts = ["<dossier>", "## Rules library (search with search_rules)", await libraryCatalogue(), ""];
  if (ctx.game) {
    const g = ctx.game;
    parts.push(`## Game: ${g.name}`, `Battleplan: ${g.battleplan || "(not set)"}`, g.battleplanNotes ? `Battleplan / map notes: ${g.battleplanNotes}` : "");
    const plan = battleplanText(g.battleplan);
    if (plan) {
      const scoring = (round: number) => (scoringFor(g.battleplan, round) ?? []).map((l) => `${l.label} (${l.vp} VP)`).join("; ");
      parts.push(plan, `Scoring at the end of each player's turn: round 1: ${scoring(1)}. From round 2: ${scoring(2)}.`);
    }
    parts.push(`Attacker: ${g.state.attacker === "me" ? "me (the player)" : "the opponent"}.`);
    // The battleplan's rules from the books (e.g. the General's Handbook page), found by name.
    if (g.battleplan) {
      const hits = await searchLibrary(g.battleplan, 3);
      for (const h of hits) parts.push(`### From ${h.title} p.${h.page} (search: "${g.battleplan}")`, h.text);
    }
    for (const ref of await gameReferences(g)) {
      const doc = await libraryDocs.get(ref.docId);
      if (!doc || doc.kind === "image") continue;
      const pages = await getPages(doc.id);
      for (const p of parsePageRange(ref.pages, pages.length).slice(0, 6)) parts.push(`### Reference: ${doc.title} p.${p}`, pages[p - 1] ?? "");
    }
    parts.push("", battleTacticsText(g), "");
  }
  if (ctx.myList) parts.push(listDossier(ctx.myList), "");
  if (ctx.opponentList) parts.push(listDossier(ctx.opponentList), "");
  parts.push("</dossier>");
  return parts.filter((p) => p !== undefined).join("\n");
}

async function referenceImages(game?: Game): Promise<Block[]> {
  const blocks: Block[] = [];
  for (const ref of await gameReferences(game)) {
    const doc = await libraryDocs.get(ref.docId);
    if (!doc || doc.kind !== "image") continue;
    const media = doc.mime as "image/png" | "image/jpeg" | "image/gif" | "image/webp";
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(media)) continue;
    blocks.push({ type: "text", text: `Map / battleplan image: ${doc.title}` });
    blocks.push({ type: "image", source: { type: "base64", media_type: media, data: ((await blobs().read(docPath(doc))) ?? Buffer.alloc(0)).toString("base64") } });
  }
  return blocks;
}

/** The latest photo of the table, so the coach sees real positions. */
async function tablePhoto(game?: Game): Promise<Block[]> {
  const photo = game?.state.tablePhoto;
  if (!photo || !gamePhotoPath(game!.id, photo.path)) return [];
  const data = await blobs().read(photo.path);
  if (!data) return [];
  return [
    { type: "text", text: `Photo of the table, taken in battle round ${photo.round}, ${photo.phase} phase. Use it for positions and distances; say when something is unclear in it.` },
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: data.toString("base64") } },
  ];
}

function stateText(ctx: CoachContext): string {
  const g = ctx.game;
  if (!g) return "";
  const s = g.state;
  const unitLines: string[] = [];
  for (const [owner, list] of [["me", ctx.myList], ["opponent", ctx.opponentList]] as const) {
    for (const lu of list?.units ?? []) {
      const st = s.units[`${owner}:${lu.key}`];
      if (!st || (!st.damage && !st.destroyed)) continue;
      unitLines.push(`${owner === "me" ? "My" : "Their"} ${lu.name} #${lu.key}: ${st.destroyed ? "DESTROYED" : `${st.damage} damage taken`}`);
    }
  }
  return [
    "<game_state>",
    `Round ${s.round}. Attacker: ${s.attacker}. First turn this round: ${s.firstThisRound}. Active player: ${s.activePlayer}. Phase: ${s.phase}.`,
    `Underdog: ${s.underdog ?? "none"}.${s.seizedInitiative ? ` ${s.seizedInitiative} seized the initiative this round (no battle tactics for them this turn).` : ""}`,
    `CP me ${s.cp.me} / opp ${s.cp.opponent}. VP me ${s.vp.me} / opp ${s.vp.opponent}. Fury me ${s.fury.me} / opp ${s.fury.opponent}. Rage dice me ${s.rage.me} / opp ${s.rage.opponent}.`,
    `My battle tactics: ${tacticsLine(s.tactics)}.`,
    `Opponent's battle tactics: ${tacticsLine(s.opponentTactics ?? [])}.`,
    unitLines.length ? `Unit status: ${unitLines.join("; ")}.` : "No damage recorded on units.",
    s.objectives ? `Objectives: ${s.objectives}` : "",
    s.notes ? `Notes: ${s.notes}` : "",
    g.log.length ? `Recent log: ${g.log.slice(-6).map((l) => l.text).join(" | ")}` : "",
    g.plan ? `Our game plan: ${g.plan.summary} This round: ${g.plan.rounds.find((r) => r.round === s.round)?.plan ?? "-"}` : "",
    "</game_state>",
  ]
    .filter(Boolean)
    .join("\n");
}

const tacticsLine = (ts: Game["state"]["tactics"]) =>
  ts.map((t) => `${t.card} [Affray ${t.affray ? "done" : "open"}, Strike ${t.strike ? "done" : "open"}, Domination ${t.domination ? "done" : "open"}]`).join("; ") ||
  "none chosen";

const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

// ---------- the loop ----------

export async function askCoach(
  convoId: string,
  ctx: CoachContext,
  question: string,
  opts: { effort?: "low" | "medium" | "high" } = {},
): Promise<TranscriptEntry> {
  await checkBudget();
  const convo = (await conversations.get(convoId)) ?? { id: convoId, messages: [], transcript: [] };

  // Build this turn's user content: dossier/images only when new or changed.
  const content: Block[] = [];
  const dos = await dossier(ctx);
  const dosHash = hash(dos);
  if (dosHash !== convo.dossierHash) {
    content.push({ type: "text", text: convo.dossierHash ? `Updated dossier (replaces the earlier one):\n${dos}` : dos });
    convo.dossierHash = dosHash;
  }
  const refHash = hash(JSON.stringify(await gameReferences(ctx.game)));
  if (refHash !== convo.referencesHash) {
    content.push(...(await referenceImages(ctx.game)));
    convo.referencesHash = refHash;
  }
  const photoHash = hash(ctx.game?.state.tablePhoto?.path ?? "");
  if (ctx.game?.state.tablePhoto && photoHash !== convo.photoHash) {
    content.push(...(await tablePhoto(ctx.game)));
    convo.photoHash = photoHash;
  }
  const state = stateText(ctx);
  if (state) content.push({ type: "text", text: state });
  content.push({ type: "text", text: question });

  const messages: Msg[] = [...convo.messages, { role: "user", content }];
  const toolsUsed: string[] = [];
  let finalText = "";

  const coach = coachModel();
  for (let iteration = 0; iteration < 12; iteration++) {
    const response = await anthropic().beta.messages.create({
      model: coach.model,
      max_tokens: 16000,
      system: SYSTEM + langNote(),
      tools: [...(coach.haiku ? HAIKU_TOOLS : TOOLS), ...metaTools()],
      messages,
      cache_control: { type: "ephemeral" },
      output_config: { effort: opts.effort ?? "medium" },
      ...coach.extra,
    });
    await recordUsage(response.usage, coach.price);
    messages.push({ role: "assistant", content: response.content as Block[] });

    for (const block of response.content) {
      if (block.type === "server_tool_use") toolsUsed.push(`${block.name}`);
    }
    if (response.stop_reason === "pause_turn") continue;
    if (response.stop_reason === "refusal") {
      finalText = "Thorgrim couldn't answer that request.";
      break;
    }

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      finalText = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (response.stop_reason === "max_tokens") finalText += "\n\n(Answer cut off: ask me to continue.)";
      break;
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      toolsUsed.push(tu.name);
      try {
        results.push({ type: "tool_result", tool_use_id: tu.id, content: await runTool(tu.name, tu.input) });
      } catch (err) {
        results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: (err as Error).message });
      }
    }
    messages.push({ role: "user", content: results });
  }

  if (!finalText) finalText = "(Thorgrim ran out of steps before answering. Try a narrower question.)";

  const now = new Date().toISOString();
  const answer: TranscriptEntry = { role: "coach", text: finalText, tools: [...new Set(toolsUsed)], at: now };
  convo.messages = messages;
  convo.transcript.push({ role: "user", text: question, at: now }, answer);
  await conversations.save(convo);
  return answer;
}

export async function resetConversation(convoId: string) {
  await conversations.delete(convoId);
}

export const PROMPTS = {
  pregame:
    "Give me a pre-game brief for this game. Cover: (1) the opponent's key threats and their most dangerous units/combos with ranges, (2) how my list should play this battleplan and map, with a deployment idea, (3) a round-by-round plan for my battle tactic objectives and what I expect to score, (4) priority roll guidance: when I should take or give a double turn, (5) the 3 mistakes most likely to lose me this game. Check recent tournament results for this matchup if useful.",
  review:
    "The game is over. Review it using the game state, log and our conversation: what decided the game, my 3 biggest mistakes (with what I should have done instead), 3 things I did well, and 3 short lessons I should remember for future games, phrased as rules of thumb.",
};

// ---------- per-turn tips ----------
// One short request per turn (not part of the chat conversation): a plan for
// the turn split by phase, from the player's side or, in the opponent's
// turn, what to expect and how to respond.

const TIP_PHASES = ["Start of Turn", "Hero", "Movement", "Shooting", "Charge", "Combat", "End of Turn"] as const;

const TIPS_SYSTEM = `${SYSTEM}

You are now writing the in-game turn plan, read on a phone at the table in a few seconds. Rules for it:
- Each phase gets 0-2 tips of at most 15 words each: an instruction, not an explanation. Leave a phase empty when nothing matters there; most turns need tips in 3-4 phases only.
- In the player's own turn: what to do with which unit (move, target, spell, command and its CP cost).
- In the opponent's turn: what they will likely do and the one response that matters (a reactive command, CP to keep, a unit to screen).
- Name abilities, spells and commands exactly as in the army data, and put every one you name in the glossary with what it does in at most 15 plain words (e.g. "Counter-charge: 2 CP, charge in the enemy's charge phase").
- No odds you have not calculated.
- headline: the aim of this turn in at most 12 words, said the way Thorgrim would say it (the tips themselves stay plain instructions).
- If the state includes our game plan, follow it, and say so when the board calls for changing it.`;

const tipsSchema = {
  type: "object",
  properties: {
    headline: { type: "string" },
    phases: {
      type: "object",
      properties: Object.fromEntries(TIP_PHASES.map((p) => [p, { type: "array", items: { type: "string" } }])),
      required: [...TIP_PHASES],
      additionalProperties: false,
    },
    glossary: { $ref: "#/$defs/glossary" },
  },
  required: ["headline", "phases", "glossary"],
  $defs: {
    glossary: {
      type: "array",
      items: { type: "object", properties: { name: { type: "string" }, effect: { type: "string" } }, required: ["name", "effect"], additionalProperties: false },
    },
  },
  additionalProperties: false,
};

/** Something that happened mid-turn: the plan for the rest of the turn is rewritten around it. */
export interface TurnEvent {
  text: string;
  phase: string;
  previous?: TurnTips;
}

export async function turnTips(ctx: CoachContext, round: number, side: "me" | "opponent", event?: TurnEvent): Promise<TurnTips> {
  await checkBudget();
  const started = Date.now();
  const content: Block[] = [{ type: "text", text: await dossier(ctx) }, ...(await referenceImages(ctx.game)), ...(await tablePhoto(ctx.game))];
  content.push({ type: "text", text: stateText(ctx) });
  const ask =
    side === "me"
      ? `Battle round ${round}, my turn. Write my plan for this turn.`
      : `Battle round ${round}, my opponent's turn. Write what to expect from them in each phase and how I should respond.`;
  content.push({
    type: "text",
    text: event
      ? `${ask}\n\nUpdate: we are in the ${event.phase} phase and this just happened: "${event.text}".${
          event.previous ? ` The plan so far was: ${JSON.stringify({ headline: event.previous.headline, phases: event.previous.phases })}.` : ""
        } Rewrite the plan for the rest of this turn (the ${event.phase} phase and the phases after it) around what happened; leave earlier phases empty. The headline says what changes.`
      : ask,
  });
  const coach = coachModel();
  const response = await anthropic().beta.messages.create({
    model: coach.model,
    max_tokens: 16000,
    system: TIPS_SYSTEM + langNote(),
    messages: [{ role: "user", content }],
    cache_control: { type: "ephemeral" },
    output_config: { effort: "low", format: { type: "json_schema", schema: tipsSchema } },
    ...coach.extra,
  });
  await recordUsage(response.usage, coach.price);
  console.log(`turn tips: ${Date.now() - started} ms, stop ${response.stop_reason}, ${response.usage?.output_tokens ?? "?"} output tokens`);
  if (response.stop_reason === "refusal") throw new Error("Thorgrim couldn't write tips for this turn.");
  if (response.stop_reason === "max_tokens") throw new Error("Thorgrim's answer was cut off. Try again.");
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = JSON.parse(text) as { headline: string; phases: Record<string, string[]>; glossary?: { name: string; effect: string }[] };
  return { headline: parsed.headline, phases: parsed.phases, glossary: parsed.glossary ?? [], generatedAt: new Date().toISOString() };
}

// ---------- the game plan ----------
// Written once both armies, the battleplan and the battle tactics are known:
// the overall strategy the turn tips then follow.

const PLAN_SYSTEM = `${SYSTEM}

You are now writing the player's game plan, read on a phone right before deployment. Study both army lists (warscrolls, points, abilities, faction rules), the battleplan and its scoring, the map if provided, and both players' battle tactic cards. Rules for it:
- summary: at most 2 short sentences: how this matchup is won and the overall approach.
- ourStrengths / theirThreats: 2-3 items each, naming the units and abilities that matter.
- deployment: 2-3 concrete points (what goes where, what to screen or hold back).
- rounds: one entry per battle round 1-5, at most 15 words each.
- tactics: when to complete each of the player's battle tactic cards, and which of the opponent's to deny (2-3 items).
- priority: 1-2 items: when to go first, when a double turn is worth it.
- avoid: the 3 mistakes most likely to lose this game.
- glossary: every ability, spell or command you name, with what it does in at most 15 plain words.
Each list item at most 18 words: an instruction a player can act on, not an explanation. Name units, abilities and commands exactly as in the army data. No odds you have not calculated.`;

const list = { type: "array", items: { type: "string" } };
const planSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    ourStrengths: list,
    theirThreats: list,
    deployment: list,
    rounds: {
      type: "array",
      items: { type: "object", properties: { round: { type: "integer" }, plan: { type: "string" } }, required: ["round", "plan"], additionalProperties: false },
    },
    tactics: list,
    priority: list,
    avoid: list,
    glossary: {
      type: "array",
      items: { type: "object", properties: { name: { type: "string" }, effect: { type: "string" } }, required: ["name", "effect"], additionalProperties: false },
    },
  },
  required: ["summary", "ourStrengths", "theirThreats", "deployment", "rounds", "tactics", "priority", "avoid", "glossary"],
  additionalProperties: false,
};

export async function gamePlan(ctx: CoachContext, opts: { replan?: boolean } = {}): Promise<Omit<GamePlan, "basis">> {
  await checkBudget();
  const started = Date.now();
  const content: Block[] = [{ type: "text", text: await dossier(ctx) }, ...(await referenceImages(ctx.game)), ...(await tablePhoto(ctx.game))];
  content.push({ type: "text", text: stateText(ctx) });
  const s = ctx.game?.state;
  content.push({
    type: "text",
    text:
      opts.replan && s
        ? `The game is under way: battle round ${s.round}, ${s.vp.me}-${s.vp.opponent} VP (me-opponent). Rewrite my game plan from here, using the game state, the log and the table photo if there is one: what has changed, the threats that are left, and a new plan for rounds ${s.round}-5. For rounds already played, one line on what happened.`
        : "Write my game plan for this game.",
  });
  const coach = coachModel();
  const response = await anthropic()
    .beta.messages.stream({
      model: coach.model,
      max_tokens: 32000,
      system: PLAN_SYSTEM + langNote(),
      messages: [{ role: "user", content }],
      cache_control: { type: "ephemeral" },
      output_config: { effort: "medium", format: { type: "json_schema", schema: planSchema } },
      ...coach.extra,
    })
    .finalMessage();
  await recordUsage(response.usage, coach.price);
  console.log(`game plan: ${Date.now() - started} ms, stop ${response.stop_reason}, ${response.usage?.output_tokens ?? "?"} output tokens`);
  if (response.stop_reason === "refusal") throw new Error("Thorgrim couldn't write a plan for this game.");
  if (response.stop_reason === "max_tokens") throw new Error("The plan came out too long. Try again.");
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { ...(JSON.parse(text) as Omit<GamePlan, "basis" | "generatedAt">), generatedAt: new Date().toISOString() };
}

// ---------- battle report ----------

const REPORT_SYSTEM = `You are Thorgrim, veteran dwarf general and war-chronicler of the Mortal Realms. You turn a Warhammer Age of Sigmar game into a legend for a gaming club's private feed: the story the players will retell for years, read on phones right after the battle.

The facts you are given are what really happened: who went first, the score round by round, battle tactics completed, double turns, units destroyed, the log and notes, both armies. Every event in the story is one of them. Around them, write like a saga of slaughter and glory:
- Make it visceral and grim: steel biting into flesh, bones splintering under charges, war-cries and death-screams, blood soaking the earth, banners trampled into the mud, smoke and fire over the battlefield. Choose strong, physical verbs (cleave, crush, rend, shatter, butcher, trample, hurl) and an archaic, mythic voice ("thus", "ere", "by nightfall"). No modern words, no game jargon (no "VP", "CP", "turn", "phase", "dice"); say "glory", "ground", "the second dawn of battle".
- Give each army its nature: Ogors a ravenous, gut-thundering tide; Lumineth cold, radiant and precise; Skaven a chittering, treacherous swarm; and so on for any faction. Name the units and heroes from the armies, and make the fallen die memorably: a destroyed unit gets its death scene, told with weight, never as a list.
- Build it like a legend: an omen or prelude, the first clash, the turning point (a double turn, a comeback, a lead that slips), and an aftermath with an epitaph for the vanquished and a toast to the victor. Rising tension, short punchy sentences at the climax.
- Truth: never invent a kill, a unit's death, a hero's survival, a score or an event that is not in the facts. Atmosphere, emotion, sounds, weather and the realm itself are yours to paint; outcomes are not. Photos are for colour (the table, terrain, paint schemes).
- Honour both players by name and both armies; the loser fought bravely. Do not quote rules, warscroll or battleplan text.
- title: at most 8 words, legendary (like a saga's name), no quotes around it.
- story: 250-450 words in short paragraphs separated by a blank line; plain text, no headings, lists or markdown.
- Write in the language of the game's log and notes when they are not in English; otherwise in English.`;

/** Reports are short creative writing from a fact sheet: the cheapest model does them well. */
const REPORT_MODEL = process.env.REPORT_MODEL ?? "claude-haiku-5-5";

const reportSchema = {
  type: "object",
  properties: { title: { type: "string" }, story: { type: "string" } },
  required: ["title", "story"],
  additionalProperties: false,
};

/** The story of a game, from its recorded facts and the battle photos. */
export async function battleReport(ctx: CoachContext, photoPaths: string[]): Promise<{ title: string; story: string }> {
  await checkBudget();
  const started = Date.now();
  const game = ctx.game!;
  const content: Block[] = [{ type: "text", text: `<facts>\n${reportFacts(game, reportSides(game, ctx.myList, ctx.opponentList))}\n</facts>` }];
  const paths = [...photoPaths, ...(game.state.tablePhoto ? [game.state.tablePhoto.path] : [])].filter((p) => gamePhotoPath(game.id, p)).slice(0, 8);
  for (const p of paths) {
    const data = await blobs().read(p);
    if (data) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: data.toString("base64") } });
  }
  if (paths.length) content.push({ type: "text", text: `${paths.length} photo(s) of the battle above.` });
  content.push({ type: "text", text: "Forge the legend of this battle." });
  const response = await anthropic()
    .beta.messages.stream({
      model: REPORT_MODEL,
      max_tokens: 8000,
      system: REPORT_SYSTEM + langNote(),
      messages: [{ role: "user", content }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: reportSchema } },
    })
    .finalMessage();
  await recordUsage(response.usage, HAIKU_PRICE);
  console.log(`battle report: ${Date.now() - started} ms, stop ${response.stop_reason}, ${response.usage?.output_tokens ?? "?"} output tokens`);
  if (response.stop_reason === "refusal") throw new Error("Thorgrim couldn't write a report for this game.");
  if (response.stop_reason === "max_tokens") throw new Error("The report came out too long. Try again.");
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const out = JSON.parse(text) as { title: string; story: string };
  return { title: out.title.trim(), story: out.story.trim() };
}

// ---------- scoring by voice ----------

const VOICE_SYSTEM = `You turn what a Warhammer Age of Sigmar player said at the table into score changes for the current battle round. The player may speak English or Spanish, casually, with numbers as words.
- "me" is the player holding the phone ("I", "me", "yo", "mi") and the side named first below; "opponent" is the other side. Players may also be named.
- objective: a scoring line the side achieved this round. Use the exact label from the list. "Scored both/all objectives" or "10 points from objectives" means every line whose points add up to it.
- tactic: a battle tactic card where the side completed its next step. Use the exact card name from that side's list.
- extraVp: victory points not covered by the lines above (a twist, a special rule), as a number.
- cpGained / cpSpent: command points gained or spent, as a number.
- fury / rage: the new fury level or number of rage dice.
Only what was clearly said. If nothing fits, return no changes and say why in "unclear": one short line in the player's language, as Thorgrim (a gruff dwarf general) would grumble it.`;

const voiceSchema = {
  type: "object",
  properties: {
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          side: { type: "string", enum: ["me", "opponent"] },
          kind: { type: "string", enum: ["objective", "tactic", "extraVp", "cpGained", "cpSpent", "fury", "rage"] },
          label: { type: "string" },
          amount: { type: "integer" },
        },
        required: ["side", "kind"],
        additionalProperties: false,
      },
    },
    unclear: { type: "string" },
  },
  required: ["changes"],
  additionalProperties: false,
};

/** What a player said about the score, as changes to battle round `round` (shared/voice.ts). */
export async function voiceScore(game: Game, round: number, said: string): Promise<{ changes: VoiceChange[]; unclear?: string }> {
  await checkBudget();
  const o = voiceOptions(game, round);
  const names = { me: game.myName || "Me", opponent: game.opponentName || "Opponent" };
  const facts = [
    `Battle round ${round}. Sides: me = ${names.me}, opponent = ${names.opponent}.`,
    `Scoring lines: ${o.objectives.length ? o.objectives.map((l) => `"${l}" (${scoringFor(game.battleplan, round)?.find((x) => x.label === l)?.vp ?? 0})`).join(", ") : "none (use extraVp for objective points)"}.`,
    `Battle tactic cards with a step left: me: ${o.tactics.me.join(", ") || "none"}; opponent: ${o.tactics.opponent.join(", ") || "none"}.`,
    `They said: """${said.slice(0, 600)}"""`,
  ].join("\n");
  const response = await anthropic()
    .beta.messages.stream({
      model: REPORT_MODEL,
      max_tokens: 2000,
      system: VOICE_SYSTEM + langNote(),
      messages: [{ role: "user", content: facts }],
      output_config: { effort: "low", format: { type: "json_schema", schema: voiceSchema } },
    })
    .finalMessage();
  await recordUsage(response.usage, HAIKU_PRICE);
  if (response.stop_reason !== "end_turn") throw new Error("Couldn't understand that. Try again.");
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const out = JSON.parse(text) as { changes: VoiceChange[]; unclear?: string };
  return { changes: cleanChanges(game, round, out.changes ?? []), unclear: out.unclear?.trim() || undefined };
}

// ---------- post-game review ----------

const REVIEW_SYSTEM = `${THORGRIM}

After a game, you give the player ("me" in the facts) a short review they read on their phone in a minute.
- verdict: one sentence on how the game was won or lost (the decisive round, a double turn, tactics, objectives), in Thorgrim's voice.
- lost: 2-3 short points (max 20 words each) on where "me" dropped points or gave them away: rounds where the opponent outscored them, battle tactic steps missed, objectives lost, units lost. Name rounds and numbers. In a win, where the margin slipped.
- tryNext: one concrete thing to try next game, specific to this matchup and these armies (max 30 words), as Thorgrim's advice.
Only use the facts given; don't invent events. Write in the language of the game's log and notes when they are not in English; otherwise in English. Plain text, no markdown.`;

const reviewSchema = {
  type: "object",
  properties: { verdict: { type: "string" }, lost: { type: "array", items: { type: "string" } }, tryNext: { type: "string" } },
  required: ["verdict", "lost", "tryNext"],
  additionalProperties: false,
};

/** The coach's short review of a finished game, for the signed-in player. */
export async function gameReview(ctx: CoachContext): Promise<{ verdict: string; lost: string[]; tryNext: string }> {
  await checkBudget();
  const game = ctx.game!;
  const sides = reportSides(game, ctx.myList, ctx.opponentList);
  const tactics = (game.state.tactics ?? []).map((t) => `${t.card}: ${[t.affray && "affray", t.strike && "strike", t.domination && "domination"].filter(Boolean).join(", ") || "no steps"}`);
  const content = `<facts>\n${reportFacts(game, sides)}\nMy battle tactic cards: ${tactics.join("; ") || "none recorded"}.\n</facts>\nReview this game for me.`;
  const response = await anthropic()
    .beta.messages.stream({
      model: REPORT_MODEL,
      max_tokens: 3000,
      system: REVIEW_SYSTEM + langNote(),
      messages: [{ role: "user", content }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: reviewSchema } },
    })
    .finalMessage();
  await recordUsage(response.usage, HAIKU_PRICE);
  if (response.stop_reason !== "end_turn") throw new Error("Thorgrim couldn't review this game. Try again.");
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const out = JSON.parse(text) as { verdict: string; lost: string[]; tryNext: string };
  return { verdict: out.verdict.trim(), lost: out.lost.map((l) => l.trim()).filter(Boolean).slice(0, 3), tryNext: out.tryNext.trim() };
}

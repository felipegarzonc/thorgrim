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
import type { ArmyList, Game, TurnTips } from "../shared/types.ts";
import { isBattleplanDoc } from "../shared/season.ts";
import { factionRulesText, findUnit, gameData, listDossier, matchedPlayRule, norm, warscrollText } from "./data.ts";
import { blobs } from "./blobs.ts";
import { docPath, getPages, libraryDocs, listDocuments, parsePageRange, searchLibrary } from "./library.ts";
import { anthropic } from "./anthropic.ts";
import { Collection } from "./store.ts";

type Msg = Anthropic.Beta.BetaMessageParam;
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
}

export const conversations = new Collection<Conversation>("conversations");

const MODEL = process.env.COACH_MODEL ?? "claude-opus-5-5";

// ---------- system prompt (frozen) ----------

const SYSTEM = `You are an expert Warhammer Age of Sigmar (4th edition) coach. Your player plays Ogor Mawtribes in competitive matched play, using the current General's Handbook season. Your job is to help them make better decisions before, during and after games, and to make them a better player over time, not to play for them.

How you work:
- Ground every rules statement in a source: the army data (warscrolls and faction rules from BSData), or the player's own rules library (core rules, General's Handbook, battletomes, battleplans, maps) via search_rules / read_rules_pages. Cite briefly, e.g. [Warscroll: Tyrant] or [General's Handbook p.34]. If you cannot find a rule, say so plainly and give your best understanding marked as unverified. Never invent rules text.
- Use the calculator tools for every probability or damage number (damage_calc, charge_odds, cast_odds). Do not estimate odds in your head.
- The player's messages carry the current game state (round, priority, CP, VP, fury and rage dice, battle tactic progress, unit damage). Treat it as the truth for the board, and ask for what you need (distances, objective control, positions) when it matters for the decision.
- Think about the opponent too: what their army can do in response (reactive commands, Counter-charge, Covering Fire, All-out Defence, redeploys, spells, shooting), how many CP they hold, and what they will score.
- Scoring wins games. Tie advice back to victory points this round and next: objectives and battle tactics. Season facts (General's Handbook 2026-27): battles last 5 rounds; each player picks up to 2 battle tactic cards, each with Affray, Strike and Domination tactics that must be completed in that order, at most 1 per card at the end of each of your turns, 5 VP each. Seizing the initiative (going first after going second in the previous round, i.e. a double turn) means you cannot complete battle tactics in that turn, unless your opponent leads by 11+ VP; your opponent then counts as the underdog. Each player gains 4 CP at the start of each battle round (+1 for the underdog); unspent CP are lost. Verify details in the player's General's Handbook when it matters.

Answer style:
- During a game, be fast and scannable on a phone: lead with the recommendation in one line, then at most 3 options with odds and risks, then "Don't forget:" for abilities with timing in the current phase. Keep it under about 180 words unless asked for more.
- For pre-game briefs and post-game reviews, be thorough but structured with short headings.
- Explain the why in one sentence so the player learns the principle.
- Use English.

Web research: you can search and fetch a small set of community sites. Wahapedia (wahapedia.ru/aos4/...) has the core rules, the General's Handbook and faction pages: use it to check a rule when the player's library and the army data don't cover it, and cite the page URL. Prefer the player's own uploaded books when both have it. Listhammer has recent tournament lists, Woehammer faction win rates, Goonhammer and others tactics articles: use them for meta and matchup questions, and say how recent the data is.`;

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
    "Search the player's uploaded rules library (core rules, General's Handbook, battletomes, battleplans). Returns matching passages with document id, title and page. Use it before answering any rules question that the army data does not cover.",
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
  if (!(name in toolSchemas)) throw new Error(`Unknown tool ${name}`);
  const parsed = toolSchemas[name as ToolName].safeParse(input);
  if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.message}`);
  const args = parsed.data as never;
  switch (name as ToolName) {
    case "search_rules": {
      const { query, limit } = args as z.infer<typeof toolSchemas.search_rules>;
      const hits = await searchLibrary(query, Math.min(limit ?? 6, 10));
      if (!hits.length) return "No matches in the rules library. (The player may not have uploaded that book yet.)";
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
  if (!docs.length) return "The rules library is empty: the player has not uploaded any rules yet. Say so when a rules question needs a book.";
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
  const state = stateText(ctx);
  if (state) content.push({ type: "text", text: state });
  content.push({ type: "text", text: question });

  const messages: Msg[] = [...convo.messages, { role: "user", content }];
  const toolsUsed: string[] = [];
  let finalText = "";

  for (let iteration = 0; iteration < 12; iteration++) {
    const response = await anthropic().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      tools: TOOLS,
      messages,
      cache_control: { type: "ephemeral" },
      output_config: { effort: opts.effort ?? "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    messages.push({ role: "assistant", content: response.content as Block[] });

    for (const block of response.content) {
      if (block.type === "server_tool_use") toolsUsed.push(`${block.name}`);
    }
    if (response.stop_reason === "pause_turn") continue;
    if (response.stop_reason === "refusal") {
      finalText = "The coach couldn't answer that request.";
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

  if (!finalText) finalText = "(The coach ran out of steps before answering. Try a narrower question.)";

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

You are now writing the in-game turn plan shown on the player's phone at the table, one card per phase. Rules for it:
- Each phase gets 0-3 tips of at most 25 words each. Leave a phase empty when nothing matters there.
- In the player's own turn: concrete actions with unit names (moves, targets, spells, commands with CP cost) that score VP or protect the lead, and what to hold back.
- In the opponent's turn: what they will most likely do in that phase, and how the player should respond (reactive commands, CP to keep, units to screen or protect).
- Name abilities and commands exactly as in the army data. No odds you have not calculated: qualitative is fine.
- headline: the one-sentence aim of this turn.`;

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
  },
  required: ["headline", "phases"],
  additionalProperties: false,
};

export async function turnTips(ctx: CoachContext, round: number, side: "me" | "opponent"): Promise<TurnTips> {
  const content: Block[] = [{ type: "text", text: await dossier(ctx) }, ...(await referenceImages(ctx.game))];
  content.push({ type: "text", text: stateText(ctx) });
  content.push({
    type: "text",
    text:
      side === "me"
        ? `Battle round ${round}, my turn. Write my plan for this turn.`
        : `Battle round ${round}, my opponent's turn. Write what to expect from them in each phase and how I should respond.`,
  });
  const response = await anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: TIPS_SYSTEM,
    messages: [{ role: "user", content }],
    cache_control: { type: "ephemeral" },
    output_config: { effort: "medium", format: { type: "json_schema", schema: tipsSchema } },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  if (response.stop_reason === "refusal") throw new Error("The coach couldn't write tips for this turn.");
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = JSON.parse(text) as { headline: string; phases: Record<string, string[]> };
  return { headline: parsed.headline, phases: parsed.phases, generatedAt: new Date().toISOString() };
}

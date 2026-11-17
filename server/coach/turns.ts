// The coach during a game: a plan for each turn, and the game plan before deployment.

import Anthropic from "@anthropic-ai/sdk";
import type { GamePlan, TurnTips } from "../../shared/types.ts";
import { checkBudget, recordUsage } from "../accounts.ts";
import { anthropic } from "../anthropic.ts";
import { langNote } from "../lang.ts";
import { baseFaction } from "../../shared/season.ts";
import { omnissiahGet } from "../omnissiah.ts";
import { UserError } from "../errors.ts";
import { type Block, coachModel, SYSTEM, type CoachContext, dossier, referenceImages, tablePhoto, stateText, cacheContext } from "./core.ts";

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
  const content: Block[] = cacheContext([{ type: "text", text: await dossier(ctx) }, ...(await referenceImages(ctx.game)), ...(await tablePhoto(ctx.game))]);
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
  if (response.stop_reason === "refusal") throw new UserError("Thorgrim couldn't write tips for this turn.", 502);
  if (response.stop_reason === "max_tokens") throw new UserError("Thorgrim's answer was cut off. Try again.", 502);
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = JSON.parse(text) as { headline: string; phases: Record<string, string[]>; glossary?: { name: string; effect: string }[] };
  return { headline: parsed.headline, phases: parsed.phases, glossary: Array.isArray(parsed.glossary) ? parsed.glossary : [], generatedAt: new Date().toISOString() };
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

/** Tournament scouting for the plan (Omnissiah): how the opponent's army wins at events, and this matchup's record. */
async function scoutingText(ctx: CoachContext): Promise<string | undefined> {
  const mine = ctx.myList?.faction || ctx.game?.myFaction;
  const theirs = ctx.opponentList?.faction || ctx.game?.opponentFaction;
  if (!mine || !theirs) return undefined;
  const sc = await omnissiahGet<Record<string, unknown>>("/scouting", { faction: baseFaction(mine), opponent: baseFaction(theirs) });
  if (!sc) return undefined;
  return `Tournament scouting (Omnissiah, from Listhammer's top lists and every tournament game; ${String(sc.window ?? "")}). Use it in theirThreats and the plan where it helps, with its numbers (say how many games a matchup record rests on, and its 95% range): ${JSON.stringify(sc)}`;
}

export async function gamePlan(ctx: CoachContext, opts: { replan?: boolean } = {}): Promise<Omit<GamePlan, "basis">> {
  await checkBudget();
  const started = Date.now();
  const content: Block[] = cacheContext([{ type: "text", text: await dossier(ctx) }, ...(await referenceImages(ctx.game)), ...(await tablePhoto(ctx.game))]);
  content.push({ type: "text", text: stateText(ctx) });
  const scouting = await scoutingText(ctx);
  if (scouting) content.push({ type: "text", text: scouting });
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
  if (response.stop_reason === "refusal") throw new UserError("Thorgrim couldn't write a plan for this game.", 502);
  if (response.stop_reason === "max_tokens") throw new UserError("The plan came out too long. Try again.", 502);
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { ...(JSON.parse(text) as Omit<GamePlan, "basis" | "generatedAt">), generatedAt: new Date().toISOString() };
}

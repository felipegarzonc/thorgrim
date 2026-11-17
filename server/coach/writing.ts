// What the coach writes: the battle report, the club's weekly chronicle, scores from what a player said, and the post-game review.

import Anthropic from "@anthropic-ai/sdk";
import type { Game } from "../../shared/types.ts";
import { scoringFor } from "../../shared/season.ts";
import { blobs } from "../blobs.ts";
import { checkBudget, HAIKU_PRICE, recordUsage } from "../accounts.ts";
import { anthropic } from "../anthropic.ts";
import { reportFacts, reportSides } from "../../shared/report.ts";
import { cleanChanges, voiceOptions, type VoiceChange } from "../../shared/voice.ts";
import { langNote } from "../lang.ts";
import type { Lang } from "../../shared/i18n/index.ts";
import { UserError } from "../errors.ts";
import { gamePhotoPath, type Block, THORGRIM, type CoachContext } from "./core.ts";

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
  if (response.stop_reason === "refusal") throw new UserError("Thorgrim couldn't write a report for this game.", 502);
  if (response.stop_reason === "max_tokens") throw new UserError("The report came out too long. Try again.", 502);
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const out = JSON.parse(text) as { title: string; story: string };
  return { title: out.title.trim(), story: out.story.trim() };
}

// ---------- the week's meta, for the club feed ----------

const CHRONICLE_SYSTEM = `${THORGRIM}

Each Monday you write the club a short chronicle of the Age of Sigmar tournament meta, from the data you are given (Omnissiah: Listhammer's tournament tables and lists, and AoS articles and news). It is read on phones in the club feed.
- What matters this week: armies rising or falling (with their numbers and how many games they rest on; a change on few games is a rumour, say so), what the top lists are doing, any rules change in the news, and one article worth reading, named with its site.
- rulesChangeEffects, when it has entries, is what the latest rules change did to those armies: the change in their win rate (points) and units that entered, left, rose or fell among their top lists, out of topListsSince lists. Worth a sentence when the change is recent; under 8 lists is a hint, say so.
- Facts only from the data. Never invent a number, a result, a list or an article. If the data is thin, say the week was quiet.
- Your voice, but brief: 120-220 words, short paragraphs separated by a blank line, plain text, no lists or markdown. End with one line for the club's own games.
- title: at most 8 words.`;

/** The week's meta chronicle (title and story) in one language, from Omnissiah's data. */
export async function metaChronicle(data: unknown, lang: Lang): Promise<{ title: string; story: string }> {
  const response = await anthropic()
    .beta.messages.stream({
      model: REPORT_MODEL,
      max_tokens: 4000,
      system: `${CHRONICLE_SYSTEM}\n\nWrite in ${lang === "es" ? "Spanish (Latin American)" : "English"}. Keep army, unit and article names as they are.`,
      messages: [{ role: "user", content: [{ type: "text", text: `<data>\n${JSON.stringify(data)}\n</data>\nWrite this week's chronicle.` }] }],
      output_config: { effort: "low", format: { type: "json_schema", schema: reportSchema } },
    })
    .finalMessage();
  await recordUsage(response.usage, HAIKU_PRICE);
  if (response.stop_reason !== "end_turn") throw new Error(`Meta chronicle: ${response.stop_reason}`);
  const out = JSON.parse(
    response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join(""),
  ) as { title: string; story: string };
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
  if (response.stop_reason !== "end_turn") throw new UserError("Couldn't understand that. Try again.", 502);
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
  if (response.stop_reason !== "end_turn") throw new UserError("Thorgrim couldn't review this game. Try again.", 502);
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const out = JSON.parse(text) as { verdict: string; lost: string[]; tryNext: string };
  return { verdict: out.verdict.trim(), lost: out.lost.map((l) => l.trim()).filter(Boolean).slice(0, 3), tryNext: out.tryNext.trim() };
}

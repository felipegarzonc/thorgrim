import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Isolated storage for this test run.
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aos-coach-test-"));

const calls: any[] = [];
const replies: any[] = [];
vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    beta = {
      messages: {
        create: async (params: any) => {
          calls.push(structuredClone(params));
          return replies.shift();
        },
        stream: (params: any) => {
          calls.push(structuredClone(params));
          return { finalMessage: async () => replies.shift() };
        },
      },
    };
  }
  return { default: Anthropic };
});

const hasData = fs.existsSync(path.resolve("data", "aos.json"));

describe.skipIf(!hasData)("askCoach loop", () => {
  let askCoach: typeof import("./coach.ts").askCoach;
  let conversations: typeof import("./coach.ts").conversations;

  beforeAll(async () => {
    ({ askCoach, conversations } = await import("./coach.ts"));
  });

  it("runs tools, returns the final answer and keeps history append-only", async () => {
    replies.push(
      {
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "Checking." },
          { type: "tool_use", id: "t1", name: "charge_odds", input: { gap_inches: 8 } },
          { type: "tool_use", id: "t2", name: "lookup_warscroll", input: { name: "Mournfang Pack" } },
        ],
      },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Go for it: 42% to make the charge." }] },
    );

    const answer = await askCoach("g1", {}, "Can I make an 8 inch charge?");
    expect(answer.text).toBe("Go for it: 42% to make the charge.");
    expect(answer.tools).toEqual(["charge_odds", "lookup_warscroll"]);

    // Second request carried the tool results.
    const toolResults = calls[1].messages.at(-1).content;
    expect(toolResults[0]).toMatchObject({ type: "tool_result", tool_use_id: "t1" });
    expect(JSON.parse(toolResults[0].content)).toEqual({ roll_needed: 8, chance: "41.7%" });
    expect(toolResults[1].content).toContain("Mournfang Pack");

    // Request shape: frozen system + tools, fallbacks, effort.
    expect(calls[0].model).toBe("claude-opus-5-5");
    expect(calls[0].fallbacks).toBe("default");
    expect(calls[0].output_config).toEqual({ effort: "medium" });
    expect(calls[0].tools.map((t: any) => t.name)).toContain("damage_calc");

    // The dossier (fixed context) is marked to be cached for an hour.
    const dossierBlock = calls[0].messages[0].content.find((b: any) => b.type === "text" && b.text.startsWith("<dossier>"));
    expect(dossierBlock.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });

    // A follow-up question sends the first question as it was (so the cached
    // dossier still matches) and its answer, but not the tool calls and
    // results in between; nor the unchanged dossier again.
    replies.push({ stop_reason: "end_turn", content: [{ type: "text", text: "Second answer." }] });
    await askCoach("g1", {}, "And now?");
    const next = calls[2];
    expect(next.system).toBe(calls[0].system);
    expect(JSON.stringify(next.tools)).toBe(JSON.stringify(calls[0].tools));
    expect(next.messages[0]).toEqual(calls[0].messages[0]);
    expect(next.messages[1]).toEqual({ role: "assistant", content: [{ type: "text", text: "Go for it: 42% to make the charge." }] });
    expect(next.messages).toHaveLength(3);
    expect(JSON.stringify(next.messages)).not.toContain("tool_result");
    const lastUser = next.messages.at(-1).content;
    expect(lastUser.some((b: any) => b.type === "text" && b.text.includes("<dossier>"))).toBe(false);

    expect((await conversations.get("g1"))?.transcript.map((t) => t.role)).toEqual(["user", "coach", "user", "coach"]);
  });

  it("returns a tool error instead of crashing on bad input", async () => {
    replies.push(
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "x", name: "damage_calc", input: { attacks: [] } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] },
    );
    await askCoach("g2", {}, "bad");
    const result = calls.at(-1).messages.at(-1).content[0];
    expect(result.is_error).toBe(true);
  });
});

describe.skipIf(!hasData)("turnTips", () => {
  it("asks for a JSON plan for the turn and returns it by phase", async () => {
    const { turnTips } = await import("./coach.ts");
    const plan = { headline: "Take the centre and hold it.", phases: { "Start of Turn": [], Hero: ["Cast first."], Movement: ["Stonehorn to B."], Shooting: [], Charge: [], Combat: [], "End of Turn": [] } };
    replies.push({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(plan) }] });
    const before = calls.length;
    const game = {
      id: "g2",
      name: "",
      myListId: "",
      opponentListId: "",
      battleplan: "Into the Fire",
      battleplanNotes: "",
      references: [],
      log: [],
      createdAt: "2026-10-20",
      state: {
        round: 2, attacker: "me", firstThisRound: "opponent", activePlayer: "opponent", phase: "Start of Turn",
        cp: { me: 4, opponent: 5 }, vp: { me: 10, opponent: 8 }, fury: { me: 1, opponent: 2 }, rage: { me: 0, opponent: 0 },
        tactics: [], opponentTactics: [], units: {}, objectives: "", notes: "",
      },
    } as any;
    const tips = await turnTips({ game }, 2, "opponent");
    expect(tips.headline).toBe(plan.headline);
    expect(tips.phases.Movement).toEqual(["Stonehorn to B."]);
    const req = calls[before];
    expect(req.output_config.format.type).toBe("json_schema");
    expect(req.output_config.format.schema.properties.phases.required).toContain("Combat");
    expect(req.fallbacks).toBe("default");
    expect(JSON.stringify(req.messages[0].content)).toContain("my opponent's turn");
  });
});

describe.skipIf(!hasData)("gamePlan", () => {
  it("streams a JSON plan and returns it", async () => {
    const { gamePlan } = await import("./coach.ts");
    const plan = {
      summary: "Win the objective game early, then hold.",
      ourStrengths: ["Stonehorn charges."],
      theirThreats: ["Warp Lightning Cannon."],
      deployment: ["Screen the Huskard."],
      rounds: [1, 2, 3, 4, 5].map((round) => ({ round, plan: `Round ${round} plan.` })),
      tactics: ["Affray in round 1."],
      priority: ["Give them the first turn in round 1."],
      avoid: ["Overextending the Mournfangs."],
    };
    replies.push({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(plan) }] });
    const before = calls.length;
    const game = {
      id: "g3", name: "", myListId: "", opponentListId: "", battleplan: "Into the Fire", battleplanNotes: "", references: [], log: [], createdAt: "2026-10-20",
      state: {
        round: 1, attacker: "me", firstThisRound: "me", activePlayer: "me", phase: "Deployment",
        cp: { me: 0, opponent: 0 }, vp: { me: 0, opponent: 0 }, fury: { me: 1, opponent: 2 }, rage: { me: 0, opponent: 0 },
        tactics: [], opponentTactics: [], units: {}, objectives: "", notes: "",
      },
    } as any;
    const out = await gamePlan({ game });
    expect(out.summary).toBe(plan.summary);
    expect(out.rounds).toHaveLength(5);
    const req = calls[before];
    expect(req.output_config).toMatchObject({ effort: "medium", format: { type: "json_schema" } });
    expect(req.system).toContain("game plan");
  });
});

describe.skipIf(!hasData)("re-planning", () => {
  const game = () =>
    ({
      id: "g4", name: "", myListId: "", opponentListId: "", battleplan: "Into the Fire", battleplanNotes: "", references: [], log: [], createdAt: "2026-10-20",
      state: {
        round: 3, attacker: "me", firstThisRound: "me", activePlayer: "me", phase: "Charge",
        cp: { me: 2, opponent: 3 }, vp: { me: 20, opponent: 31 }, fury: { me: 1, opponent: 2 }, rage: { me: 0, opponent: 0 },
        tactics: [], opponentTactics: [], units: {}, objectives: "", notes: "",
      },
    }) as any;

  it("rewrites the rest of the turn around what happened", async () => {
    const { turnTips } = await import("./coach.ts");
    replies.push({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ headline: "Fall back to B.", phases: { "Start of Turn": [], Hero: [], Movement: [], Shooting: [], Charge: ["Charge the Clanrats instead."], Combat: [], "End of Turn": [] } }) }] });
    const before = calls.length;
    await turnTips({ game: game() }, 3, "me", { text: "Failed the charge with the Stonehorn", phase: "Charge" });
    const prompt = JSON.stringify(calls[before].messages[0].content);
    expect(prompt).toContain("Failed the charge with the Stonehorn");
    expect(prompt).toContain("rest of this turn");
  });

  it("re-plans from the current round with the score", async () => {
    const { gamePlan } = await import("./coach.ts");
    const plan = { summary: "Catch up.", ourStrengths: [], theirThreats: [], deployment: [], rounds: [], tactics: [], priority: [], avoid: [] };
    replies.push({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(plan) }] });
    const before = calls.length;
    await gamePlan({ game: game() }, { replan: true });
    const prompt = JSON.stringify(calls[before].messages[0].content);
    expect(prompt).toContain("battle round 3, 20-31 VP");
  });
});

describe("conversation upkeep", () => {
  it("keeps at most ten exchanges, and says when the context went with the old ones", async () => {
    const { compactHistory, keepLastContextMark, cacheContext } = await import("./coach.ts");
    const turn = (i: number, withContext = false): any[] => [
      { role: "user", content: [...(withContext ? cacheContext([{ type: "text", text: "<dossier>lists</dossier>" }]) : []), { type: "text", text: `Q${i}` }] },
      { role: "assistant", content: [{ type: "tool_use", id: `t${i}`, name: "charge_odds", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "42%" }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "hm", signature: "x" }, { type: "text", text: `A${i}`, citations: [{ type: "web_search_result_location" }] }] },
    ];
    const all = [...turn(0, true), ...Array.from({ length: 11 }, (_, i) => turn(i + 1)).flat()];
    const { messages, contextDropped } = compactHistory(all);
    expect(messages).toHaveLength(20);
    expect(messages[0]).toMatchObject({ role: "user" });
    expect(messages[1]).toEqual({ role: "assistant", content: [{ type: "text", text: "A2" }] });
    expect(contextDropped).toBe(true);
    expect(compactHistory(all.slice(0, 8)).contextDropped).toBe(false);

    // Only the newest context mark is kept.
    const marked = keepLastContextMark([turn(0, true)[0], { role: "assistant", content: [{ type: "text", text: "A" }] }, turn(1, true)[0]] as any);
    expect(JSON.stringify(marked).match(/cache_control/g)).toHaveLength(1);
    expect((marked[2].content as any)[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });
});

describe.skipIf(!hasData)("lessons from earlier games", () => {
  it("brings the player's past reviews into the next game's plan, the same matchup first", async () => {
    const { gamePlan } = await import("./coach.ts");
    const { runAs } = await import("./context.ts");
    const { Collection } = await import("./store.ts");
    const player = { id: "lessons-player", name: "Ana", isAdmin: false, prefix: "users/lessons-player/" };
    const state = (vp: { me: number; opponent: number }) => ({
      round: 5, attacker: "me", firstThisRound: "me", activePlayer: "me", phase: "End of Turn",
      cp: { me: 0, opponent: 0 }, vp, fury: { me: 0, opponent: 0 }, rage: { me: 0, opponent: 0 },
      tactics: [], opponentTactics: [], units: {}, objectives: "", notes: "",
    });
    const base = { name: "", myListId: "", opponentListId: "", battleplan: "Into the Fire", battleplanNotes: "", references: [], log: [] };
    const review = (tryNext: string) => ({ verdict: "", lost: [], tryNext, writtenAt: "", basis: "" });
    await runAs(player, async () => {
      const games = new Collection<any>("games");
      await games.save({ ...base, id: "past1", createdAt: "2026-10-01", opponentFaction: "Seraphon", state: state({ me: 60, opponent: 70 }), review: review("Kill the Saurus screen first.") });
      await games.save({ ...base, id: "past2", createdAt: "2026-09-01", opponentFaction: "Skaven", state: state({ me: 40, opponent: 80 }), review: review("Keep the Stonehorn out of Warp Lightning range.") });
      replies.push({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ summary: "", ourStrengths: [], theirThreats: [], deployment: [], rounds: [], tactics: [], priority: [], avoid: [] }) }] });
      const before = calls.length;
      await gamePlan({ game: { ...base, id: "now", createdAt: "2026-10-20", opponentFaction: "Skaven", state: state({ me: 0, opponent: 0 }) } as any });
      const prompt = JSON.stringify(calls[before].messages[0].content);
      expect(prompt).toContain("Lessons from my earlier games");
      expect(prompt.indexOf("Warp Lightning range")).toBeLessThan(prompt.indexOf("Saurus screen"));
      expect(prompt).toContain("lost 40-80");
    });
  });
});

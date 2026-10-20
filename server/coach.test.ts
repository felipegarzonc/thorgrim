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

    // A follow-up question appends to the stored history without editing it,
    // and does not resend the unchanged dossier.
    replies.push({ stop_reason: "end_turn", content: [{ type: "text", text: "Second answer." }] });
    await askCoach("g1", {}, "And now?");
    const prevMessages = calls[1].messages;
    const next = calls[2];
    expect(next.system).toBe(calls[0].system);
    expect(JSON.stringify(next.tools)).toBe(JSON.stringify(calls[0].tools));
    expect(next.messages.slice(0, prevMessages.length)).toEqual(prevMessages);
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
  it("streams a high-effort JSON plan and returns it", async () => {
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
    expect(req.output_config).toMatchObject({ effort: "high", format: { type: "json_schema" } });
    expect(req.system).toContain("game plan");
  });
});

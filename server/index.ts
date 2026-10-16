import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";
import { damageBySave, expectedDamage, simulate, type AttackProfile, type TargetProfile, chargeChance, castChance } from "../engine/dice.ts";
import type { ArmyList, Game, GameState, LibraryDoc } from "../shared/types.ts";
import { hasCredentials, saveApiKey } from "./anthropic.ts";
import { askCoach, conversations, PROMPTS, resetConversation } from "./coach.ts";
import { gameData, warscrollText } from "./data.ts";
import { addDocument, deleteDocument, docFile, getPages, libraryDocs, searchLibrary } from "./library.ts";
import { parseList } from "./listParser.ts";
import { resumePendingTranscriptions, transcribeDocument } from "./transcribe.ts";
import { Collection, newId } from "./store.ts";

const lists = new Collection<ArmyList>("lists");
const games = new Collection<Game>("games");

const app = express();
app.use(express.json({ limit: "2mb" }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 150 * 1024 * 1024 } });

// Optional shared-secret protection for when the app is hosted online.
const accessKey = process.env.APP_ACCESS_KEY;
app.use("/api", (req, res, next) => {
  if (!accessKey || req.get("x-access-key") === accessKey || req.query.key === accessKey) return next();
  res.status(401).json({ error: "Access key required" });
});

const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res)).catch(next);

const param = (req: Request, name: string) => String(req.params[name]);

// ---------- army data ----------

app.get("/api/meta", (_req, res) => {
  const d = gameData();
  res.json({
    source: d.source,
    commit: d.commit,
    builtAt: d.builtAt,
    factions: Object.keys(d.factions).sort(),
    battleTactics: d.core.filter((r) => r.ability.kind === "Battle Tactic Card").map((r) => ({ name: r.ability.name, ...r.ability.extra })),
    coachReady: hasCredentials(),
  });
});

// Paste the Claude API key from the app instead of editing .env by hand.
// Only from this computer (or with the access key when hosted).
app.post("/api/settings/api-key", (req, res) => {
  const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "");
  if (!local && !(accessKey && req.get("x-access-key") === accessKey)) {
    return res.status(403).json({ error: "Set the API key from the computer running the app." });
  }
  const key = String(req.body.key ?? "").trim();
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return res.status(400).json({ error: "That doesn't look like a Claude API key (it starts with sk-ant-)." });
  saveApiKey(key);
  resumePendingTranscriptions();
  res.json({ ok: true });
});

app.get("/api/factions/:name", (req, res) => {
  const d = gameData();
  const f = d.factions[param(req, "name")];
  if (!f) return res.status(404).json({ error: "Unknown faction" });
  res.json({ ...f, units: f.units.map((u) => ({ ...u, unit: d.units[u.id] })) });
});

app.get("/api/units/:id", (req, res) => {
  const u = gameData().units[param(req, "id")];
  if (!u) return res.status(404).json({ error: "Unknown unit" });
  res.json({ ...u, text: warscrollText(u) });
});

// ---------- lists ----------

app.get("/api/lists", (_req, res) => res.json(lists.list().sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
app.get("/api/lists/:id", (req, res) => {
  const l = lists.get(param(req, "id"));
  return l ? res.json(l) : res.status(404).json({ error: "Not found" });
});
app.post("/api/lists/parse", (req, res) => res.json(parseList(String(req.body.text ?? ""), req.body.faction)));
app.post("/api/lists", (req, res) => {
  const body = req.body as Partial<ArmyList>;
  const parsed = body.units ? { faction: body.faction ?? "", units: body.units, unmatched: body.unmatched ?? [] } : parseList(body.rawText ?? "", body.faction);
  const list: ArmyList = {
    id: body.id ?? newId(),
    name: body.name || "Untitled list",
    owner: body.owner === "opponent" ? "opponent" : "me",
    rawText: body.rawText ?? "",
    createdAt: body.createdAt ?? new Date().toISOString(),
    ...parsed,
  };
  res.json(lists.save(list));
});
app.delete("/api/lists/:id", (req, res) => {
  lists.delete(param(req, "id"));
  res.json({ ok: true });
});

// ---------- library ----------

app.get("/api/library", (_req, res) => res.json(libraryDocs.list().sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
app.post(
  "/api/library",
  upload.single("file"),
  wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    const doc = await addDocument({
      title: String(req.body.title ?? ""),
      category: (req.body.category ?? "other") as LibraryDoc["category"],
      filename: req.file.originalname,
      mime: req.file.mimetype,
      buffer: req.file.buffer,
    });
    if (doc.transcription && hasCredentials()) void transcribeDocument(doc.id);
    res.json(doc);
  }),
);
app.post("/api/library/:id/transcribe", (req, res) => {
  const doc = libraryDocs.get(param(req, "id"));
  if (!doc?.transcription) return res.status(404).json({ error: "Nothing to transcribe" });
  if (!hasCredentials()) return res.status(503).json({ error: "Reading scanned pages needs ANTHROPIC_API_KEY in .env" });
  void transcribeDocument(doc.id);
  res.json({ ok: true });
});
app.post(
  "/api/library/text",
  wrap(async (req, res) => {
    const doc = await addDocument({
      title: String(req.body.title ?? "Notes"),
      category: (req.body.category ?? "other") as LibraryDoc["category"],
      filename: "notes.txt",
      mime: "text/plain",
      buffer: Buffer.from(String(req.body.text ?? ""), "utf8"),
    });
    res.json(doc);
  }),
);
app.get("/api/library/search", (req, res) => res.json(searchLibrary(String(req.query.q ?? ""), 10)));
app.get("/api/library/:id/pages", (req, res) => res.json(getPages(param(req, "id"))));
app.get("/api/library/:id/file", (req, res) => {
  const doc = libraryDocs.get(param(req, "id"));
  if (!doc) return res.status(404).end();
  res.type(doc.mime).sendFile(docFile(doc));
});
app.delete("/api/library/:id", (req, res) => {
  deleteDocument(param(req, "id"));
  res.json({ ok: true });
});

// ---------- games ----------

function newState(attacker: GameState["attacker"]): GameState {
  return {
    round: 1,
    attacker,
    firstThisRound: attacker,
    activePlayer: attacker,
    phase: "Deployment",
    cp: { me: 0, opponent: 0 },
    vp: { me: 0, opponent: 0 },
    fury: { me: attacker === "me" ? 1 : 2, opponent: attacker === "opponent" ? 1 : 2 },
    rage: { me: 0, opponent: 0 },
    tactics: [],
    underdog: null,
    seizedInitiative: null,
    units: {},
    objectives: "",
    notes: "",
  };
}

app.get("/api/games", (_req, res) => res.json(games.list().sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
app.get("/api/games/:id", (req, res) => {
  const g = games.get(param(req, "id"));
  return g ? res.json(g) : res.status(404).json({ error: "Not found" });
});
app.post("/api/games", (req, res) => {
  const b = req.body as Partial<Game> & { attacker?: GameState["attacker"] };
  const game: Game = {
    id: newId(),
    name: b.name || "New game",
    myListId: b.myListId ?? "",
    opponentListId: b.opponentListId ?? "",
    battleplan: b.battleplan ?? "",
    battleplanNotes: b.battleplanNotes ?? "",
    references: b.references ?? [],
    state: newState(b.attacker ?? "me"),
    log: [],
    createdAt: new Date().toISOString(),
  };
  res.json(games.save(game));
});
app.put("/api/games/:id", (req, res) => {
  const g = games.get(param(req, "id"));
  if (!g) return res.status(404).json({ error: "Not found" });
  const b = req.body as Partial<Game>;
  const updated: Game = { ...g, ...b, id: g.id, createdAt: g.createdAt };
  res.json(games.save(updated));
});
app.post("/api/games/:id/log", (req, res) => {
  const g = games.get(param(req, "id"));
  if (!g) return res.status(404).json({ error: "Not found" });
  g.log.push({ at: new Date().toISOString(), text: String(req.body.text ?? "") });
  res.json(games.save(g));
});
app.delete("/api/games/:id", (req, res) => {
  games.delete(param(req, "id"));
  resetConversation(param(req, "id"));
  res.json({ ok: true });
});

// ---------- coach ----------

app.get("/api/coach/:id", (req, res) => res.json(conversations.get(param(req, "id"))?.transcript ?? []));
app.delete("/api/coach/:id", (req, res) => {
  resetConversation(param(req, "id"));
  res.json({ ok: true });
});
app.post(
  "/api/coach/:id",
  wrap(async (req, res) => {
    const id = param(req, "id");
    const game = id === "general" ? undefined : games.get(id);
    if (id !== "general" && !game) return res.status(404).json({ error: "Game not found" });
    const preset = req.body.preset as keyof typeof PROMPTS | undefined;
    const question = preset ? PROMPTS[preset] : String(req.body.question ?? "").trim();
    if (!question) return res.status(400).json({ error: "Empty question" });
    const answer = await askCoach(
      id,
      {
        game,
        myList: game ? lists.get(game.myListId) : undefined,
        opponentList: game ? lists.get(game.opponentListId) : undefined,
      },
      question,
      { effort: preset ? "high" : (req.body.effort ?? "medium") },
    );
    res.json(answer);
  }),
);

// ---------- calculator (same engine the coach uses) ----------

app.post("/api/calc/damage", (req, res) => {
  const { profiles, target, runs } = req.body as { profiles: AttackProfile[]; target: TargetProfile; runs?: number };
  res.json({
    perProfile: profiles.map((p) => expectedDamage(p, target)),
    bySave: damageBySave(profiles, { ward: target.ward, saveMod: target.saveMod, rerollSaves: target.rerollSaves }),
    simulation: simulate(profiles, target, Math.min(runs ?? 20000, 100000)),
  });
});
app.post("/api/calc/charge", (req, res) => res.json(chargeChance(Number(req.body.gap), req.body)));
app.post("/api/calc/cast", (req, res) => res.json(castChance(Number(req.body.castingValue), req.body)));

// ---------- static web app in production ----------

const dist = path.resolve("dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (/authentication method/i.test(err.message)) {
    return res.status(503).json({ error: "The coach needs your Claude API key.", needsKey: true });
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return res.status(502).json({ error: "Claude rejected the API key. Paste a valid one below.", needsKey: true });
  }
  console.error(err);
  res.status(500).json({ error: err.message });
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`AoS Coach server on http://localhost:${port}`);
  resumePendingTranscriptions();
});

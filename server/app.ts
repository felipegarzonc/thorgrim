// The Thorgrim web server (API + built web app). Used three ways:
//   - on your computer and in Docker: server/index.ts starts it on a port;
//   - on Vercel: api/index.mjs hands each request to it.

import "./env.ts";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { castChance, chargeChance, damageBySave, expectedDamage, simulate, type AttackProfile, type TargetProfile } from "../engine/dice.ts";
import type { ArmyList, Game, GameState, LibraryDoc } from "../shared/types.ts";
import { hasCredentials, loadSavedApiKey, saveApiKey } from "./anthropic.ts";
import { blobs } from "./blobs.ts";
import { askCoach, conversations, gamePlan, PROMPTS, resetConversation, turnTips } from "./coach.ts";
import { gameData, listRules, warscrollText } from "./data.ts";
import { addDocument, deleteDocument, docPath, finishUpload, getPages, libraryDocs, listDocuments, searchLibrary, startUpload } from "./library.ts";
import { parseList } from "./listParser.ts";
import { Collection, newId } from "./store.ts";
import { backgroundJobs, resumePendingTranscriptions, transcribeDocument, transcribeStep } from "./transcribe.ts";

const lists = new Collection<ArmyList>("lists");
const games = new Collection<Game>("games");

const app = express();
export default app;

app.set("trust proxy", 1); // behind the host's HTTPS proxy when deployed
app.use(express.json({ limit: "4mb" }));

// Health check for the hosting platform (no data, no auth).
app.get(["/healthz", "/api/healthz"], (_req, res) => res.json({ ok: true }));

// ---------- password ----------
// Optional on your own computer; required when the app is online (Docker
// sets PUBLIC=1, Vercel sets VERCEL=1), so nobody else can use it or spend
// your Claude credit.

const accessKey = process.env.APP_ACCESS_KEY ?? "";
const isPublic = process.env.PUBLIC === "1" || Boolean(process.env.VERCEL);
const missingPassword = isPublic && accessKey.length < 8;
if (missingPassword) console.error("APP_ACCESS_KEY (8+ characters) is not set: the app stays locked until it is.");

const sameKey = (given: unknown) => {
  if (typeof given !== "string") return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(accessKey).digest();
  return crypto.timingSafeEqual(a, b);
};

// Slow down password guessing: 20 wrong tries per address per 15 minutes.
const failures = new Map<string, { count: number; since: number }>();
app.use("/api", (req, res, next) => {
  if (missingPassword) return res.status(503).json({ error: "Set APP_ACCESS_KEY (the app password, 8+ characters) in the hosting settings, then redeploy." });
  if (!accessKey) return next();
  const ip = req.ip ?? "?";
  const f = failures.get(ip);
  if (f && Date.now() - f.since > 15 * 60_000) failures.delete(ip);
  if ((failures.get(ip)?.count ?? 0) >= 20) return res.status(429).json({ error: "Too many wrong passwords. Try again in 15 minutes." });
  if (sameKey(req.get("x-access-key")) || sameKey(req.query.key)) return next();
  if (req.get("x-access-key") || req.query.key) {
    const cur = failures.get(ip) ?? { count: 0, since: Date.now() };
    failures.set(ip, { ...cur, count: cur.count + 1 });
  }
  res.status(401).json({ error: "Password required", needsLogin: true });
});

// A Claude key pasted in the app online is kept in storage; pick it up.
app.use("/api", async (_req, _res, next) => {
  await loadSavedApiKey().catch((e) => console.error("Could not read saved settings:", e));
  next();
});

const param = (req: Request, name: string) => String(req.params[name]);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 150 * 1024 * 1024 } });
const newestFirst = <T extends { createdAt: string }>(xs: T[]) => xs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

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
    backgroundJobs: backgroundJobs(),
    storage: blobs().kind,
  });
});

// Paste the Claude API key from the app instead of editing files by hand.
// Only from the computer running it, or with the password when online.
app.post("/api/settings/api-key", async (req, res) => {
  const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "") && !isPublic;
  if (!local && !(accessKey && sameKey(req.get("x-access-key")))) {
    return res.status(403).json({ error: "Set the API key from the computer running the app." });
  }
  const key = String(req.body.key ?? "").trim();
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return res.status(400).json({ error: "That doesn't look like a Claude API key (it starts with sk-ant-)." });
  await saveApiKey(key);
  await resumePendingTranscriptions();
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

app.get("/api/lists", async (_req, res) => res.json(newestFirst(await lists.list())));
app.get("/api/lists/:id", async (req, res) => {
  const l = await lists.get(param(req, "id"));
  return l ? res.json(l) : res.status(404).json({ error: "Not found" });
});
app.get("/api/lists/:id/rules", async (req, res) => {
  const l = await lists.get(param(req, "id"));
  return l ? res.json(listRules(l)) : res.status(404).json({ error: "Not found" });
});
app.post("/api/lists/parse", (req, res) => res.json(parseList(String(req.body.text ?? ""), req.body.faction)));
app.post("/api/lists", async (req, res) => {
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
  res.json(await lists.save(list));
});
app.delete("/api/lists/:id", async (req, res) => {
  await lists.delete(param(req, "id"));
  res.json({ ok: true });
});

// ---------- library ----------

const startReading = async (doc: LibraryDoc) => {
  if (doc.transcription && hasCredentials() && backgroundJobs()) void transcribeDocument(doc.id);
};

app.get("/api/library", async (_req, res) => res.json(newestFirst(await listDocuments())));

// Upload in one request (used for small files and by older clients).
app.post("/api/library", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  const doc = await addDocument({
    title: String(req.body.title ?? ""),
    category: (req.body.category ?? "other") as LibraryDoc["category"],
    filename: req.file.originalname,
    mime: req.file.mimetype,
    buffer: req.file.buffer,
  });
  await startReading(doc);
  res.json(doc);
});

// Direct upload in three steps, so big books work online:
// 1) reserve the document and get where to send the file,
// 2) the browser sends the file there (storage, or /raw below locally),
// 3) finish: the server reads the file and indexes it.
app.post("/api/library/uploads", async (req, res) => {
  const b = req.body as { title?: string; category?: LibraryDoc["category"]; filename?: string; mime?: string };
  if (!b.filename) return res.status(400).json({ error: "Missing file name" });
  const { doc, target } = await startUpload(
    { title: b.title ?? "", category: b.category ?? "other", filename: b.filename, mime: b.mime ?? "application/octet-stream" },
    (id) => `/api/library/${id}/raw`,
  );
  res.json({ doc, target });
});
app.put("/api/library/:id/raw", express.raw({ type: () => true, limit: "150mb" }), async (req, res) => {
  const doc = await libraryDocs.get(param(req, "id"));
  if (!doc?.uploading) return res.status(404).json({ error: "No upload in progress for this document" });
  if (blobs().kind !== "file") return res.status(400).json({ error: "Upload straight to storage instead" });
  await blobs().write(docPath(doc), req.body as Buffer, doc.mime);
  res.json({ ok: true });
});
app.post("/api/library/:id/finish", async (req, res) => {
  const doc = await finishUpload(param(req, "id"));
  await startReading(doc);
  res.json(doc);
});

// Read photographed/scanned pages: in the background on your computer; online
// one batch per call (the Rules page keeps calling while it's open).
app.post("/api/library/:id/transcribe", async (req, res) => {
  const doc = await libraryDocs.get(param(req, "id"));
  if (!doc?.transcription) return res.status(404).json({ error: "Nothing to transcribe" });
  if (!hasCredentials()) return res.status(503).json({ error: "Reading scanned pages needs your Claude API key (paste it on the Ask page)." });
  if (backgroundJobs()) {
    void transcribeDocument(doc.id);
    return res.json({ ok: true, transcription: doc.transcription });
  }
  res.json({ ok: true, transcription: await transcribeStep(doc.id) });
});
app.post("/api/library/text", async (req, res) => {
  const doc = await addDocument({
    title: String(req.body.title ?? "Notes"),
    category: (req.body.category ?? "other") as LibraryDoc["category"],
    filename: "notes.txt",
    mime: "text/plain",
    buffer: Buffer.from(String(req.body.text ?? ""), "utf8"),
  });
  res.json(doc);
});
app.get("/api/library/search", async (req, res) => res.json(await searchLibrary(String(req.query.q ?? ""), 10)));
app.get("/api/library/:id/pages", async (req, res) => res.json(await getPages(param(req, "id"))));
app.get("/api/library/:id/file", async (req, res) => {
  const doc = await libraryDocs.get(param(req, "id"));
  if (!doc) return res.status(404).end();
  const link = await blobs().downloadUrl(docPath(doc));
  if (link) return res.redirect(link);
  const data = await blobs().read(docPath(doc));
  if (!data) return res.status(404).end();
  res.type(doc.mime).send(data);
});
app.delete("/api/library/:id", async (req, res) => {
  await deleteDocument(param(req, "id"));
  res.json({ ok: true });
});

// ---------- games ----------

const tacticsFrom = (list?: ArmyList) =>
  (list?.tacticCards ?? []).slice(0, 2).map((card) => ({ card, affray: false, strike: false, domination: false }));

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
    opponentTactics: [],
    underdog: null,
    seizedInitiative: null,
    units: {},
    objectives: "",
    notes: "",
  };
}

app.get("/api/games", async (_req, res) => res.json(newestFirst(await games.list())));
app.get("/api/games/:id", async (req, res) => {
  const g = await games.get(param(req, "id"));
  return g ? res.json(g) : res.status(404).json({ error: "Not found" });
});
app.post("/api/games", async (req, res) => {
  const b = req.body as Partial<Game> & { attacker?: GameState["attacker"] };
  const [mine, theirs] = await Promise.all([lists.get(b.myListId ?? ""), lists.get(b.opponentListId ?? "")]);
  const last = newestFirst(await games.list())[0];
  const game: Game = {
    id: newId(),
    name: b.name || "",
    myName: b.myName ?? last?.myName ?? "",
    opponentName: b.opponentName ?? "",
    date: b.date ?? new Date().toISOString().slice(0, 10),
    points: b.points ?? 2000,
    myListId: b.myListId ?? "",
    opponentListId: b.opponentListId ?? "",
    battleplan: b.battleplan ?? "",
    battleplanNotes: b.battleplanNotes ?? "",
    references: b.references ?? [],
    state: { ...newState(b.attacker ?? "me"), tactics: tacticsFrom(mine), opponentTactics: tacticsFrom(theirs), rounds: [] },
    log: [],
    createdAt: new Date().toISOString(),
  };
  res.json(await games.save(game));
});
app.put("/api/games/:id", async (req, res) => {
  const g = await games.get(param(req, "id"));
  if (!g) return res.status(404).json({ error: "Not found" });
  const b = req.body as Partial<Game>;
  res.json(await games.save({ ...g, ...b, id: g.id, createdAt: g.createdAt }));
});
app.post("/api/games/:id/log", async (req, res) => {
  const g = await games.get(param(req, "id"));
  if (!g) return res.status(404).json({ error: "Not found" });
  g.log.push({ at: new Date().toISOString(), text: String(req.body.text ?? "") });
  res.json(await games.save(g));
});
app.delete("/api/games/:id", async (req, res) => {
  await games.delete(param(req, "id"));
  await resetConversation(param(req, "id"));
  res.json({ ok: true });
});

// ---------- coach ----------

app.get("/api/coach/:id", async (req, res) => res.json((await conversations.get(param(req, "id")))?.transcript ?? []));
app.delete("/api/coach/:id", async (req, res) => {
  await resetConversation(param(req, "id"));
  res.json({ ok: true });
});
// The coach's plan for one turn. The page stores it in the game state.
app.post("/api/games/:id/tips", async (req, res) => {
  const game = await games.get(param(req, "id"));
  if (!game) return res.status(404).json({ error: "Game not found" });
  const side = req.body.side === "opponent" ? "opponent" : "me";
  const round = Number(req.body.round) || game.state.round;
  const [myList, opponentList] = await Promise.all([lists.get(game.myListId), lists.get(game.opponentListId)]);
  res.json(await turnTips({ game, myList, opponentList }, round, side));
});
// The coach's strategy for the game. The page stores it with the game.
app.post("/api/games/:id/plan", async (req, res) => {
  const game = await games.get(param(req, "id"));
  if (!game) return res.status(404).json({ error: "Game not found" });
  const [myList, opponentList] = await Promise.all([lists.get(game.myListId), lists.get(game.opponentListId)]);
  res.json(await gamePlan({ game, myList, opponentList }));
});
app.post("/api/coach/:id", async (req, res) => {
  const id = param(req, "id");
  const game = id === "general" ? undefined : await games.get(id);
  if (id !== "general" && !game) return res.status(404).json({ error: "Game not found" });
  const preset = req.body.preset as keyof typeof PROMPTS | undefined;
  const question = preset ? PROMPTS[preset] : String(req.body.question ?? "").trim();
  if (!question) return res.status(400).json({ error: "Empty question" });
  const [myList, opponentList] = game ? await Promise.all([lists.get(game.myListId), lists.get(game.opponentListId)]) : [undefined, undefined];
  const answer = await askCoach(id, { game, myList, opponentList }, question, { effort: preset ? "high" : (req.body.effort ?? "medium") });
  res.json(answer);
});

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

// ---------- web app (on your computer / Docker; Vercel serves it itself) ----------

const dist = path.resolve("dist");
if (fs.existsSync(path.join(dist, "index.html"))) {
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

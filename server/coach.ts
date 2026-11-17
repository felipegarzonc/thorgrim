// The AI coach: Claude with tools over the army data, the user's rules
// library and the dice engine.
//
// History is append-only so prompt caching and preserved thinking keep
// working: the system prompt and tool list never change during a
// conversation, the game dossier goes into user turns, and when lists or the
// battleplan change an updated dossier is appended rather than edited in.
//
// The code lives in server/coach/: core.ts (asking the coach), turns.ts (the
// plan for a game and for each turn) and writing.ts (reports, the chronicle,
// scores by voice, reviews). This file is the door the rest of the server
// imports from.

export { conversations, cacheContext, keepLastContextMark, compactHistory, askCoach, resetConversation, PROMPTS } from "./coach/core.ts";
export type { TranscriptEntry, Conversation, CoachContext, CoachEvent } from "./coach/core.ts";
export { turnTips, gamePlan } from "./coach/turns.ts";
export type { TurnEvent } from "./coach/turns.ts";
export { battleReport, metaChronicle, voiceScore, gameReview } from "./coach/writing.ts";

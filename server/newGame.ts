// A new game, before anything is played.

import type { ArmyList, Game, GameState } from "../shared/types.ts";
import { newId } from "./store.ts";

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

export function blankGame(b: Partial<Game> & { attacker?: GameState["attacker"] }, mine?: ArmyList, theirs?: ArmyList): Game {
  return {
    id: newId(),
    name: b.name || "",
    myName: b.myName ?? "",
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
}

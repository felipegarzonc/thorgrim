// The battleplans of the General's Handbook 2026-27 (Pitched Battles), as
// short summaries in our own words from the player's battleplan cards: the
// twist, its abilities, and a schematic of the map. Scoring is in
// season.ts (BATTLEPLAN_SCORING). Check the card when the exact wording
// matters; positions are read off the card's 4×4 grid and rounded.
//
// The battlefield is 60" wide (west → east) and 44" deep (north → south).
// Each grid cell is 15" × 11". Cells are [column, row] from the north-west.

export type ObjectiveKind = "lions" | "soliphiles" | "heldenhain" | "comet";
export type TerrainKind = "obscuring" | "power" | "zone";

export const OBJECTIVE_NAMES: Record<ObjectiveKind, string> = {
  lions: "Golden Lions (red)",
  soliphiles: "Soliphiles (gold)",
  heldenhain: "Heldenhain (black)",
  comet: "Comet (blue)",
};
export const TERRAIN_NAMES: Record<TerrainKind, string> = {
  obscuring: "obscuring terrain",
  power: "Power Site",
  zone: "terrain or obstacle zone",
};

export interface BattleplanAbility {
  name: string;
  /** When and who, e.g. "Underdog · once per battle round, start of the battle round". */
  when: string;
  effect: string;
}

export interface BattleplanMap {
  attacker: [number, number][];
  defender: [number, number][];
  objectives: { kind: ObjectiveKind; x: number; y: number }[];
  terrain: { kind: TerrainKind; x: number; y: number; small?: boolean }[];
}

export interface BattleplanInfo {
  number: number;
  name: string;
  /** The title on the player's cards, when it differs. */
  cardName?: string;
  twist: string;
  abilities: BattleplanAbility[];
  map?: BattleplanMap;
}

const north: [number, number][] = [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1]];
const south: [number, number][] = [[0, 2], [1, 2], [2, 2], [3, 2], [0, 3], [1, 3], [2, 3], [3, 3]];

export const BATTLEPLAN_INFO: BattleplanInfo[] = [
  {
    number: 11,
    name: "Into the Fire",
    cardName: "In the Flames",
    twist: "Both armies get Secure the Gate. The underdog's army also gets Determined Defenders.",
    abilities: [
      {
        name: "Secure the Gate",
        when: "Both players · passive",
        effect: "While you control the Power Site wholly within your territory, your units' melee weapons have Anti-charge (+1 Rend) while they contest an objective you control.",
      },
      { name: "Determined Defenders", when: "Underdog · passive", effect: "Add 3 to the control scores of your units wholly outside enemy territory." },
    ],
    map: {
      attacker: [[0, 0], [0, 1], [1, 1], [0, 2], [1, 2]],
      defender: [[2, 1], [3, 1], [2, 2], [3, 2], [3, 3]],
      objectives: [
        { kind: "soliphiles", x: 30, y: 5.5 },
        { kind: "lions", x: 15, y: 22 },
        { kind: "comet", x: 30, y: 22 },
        { kind: "lions", x: 45, y: 22 },
        { kind: "heldenhain", x: 30, y: 38.5 },
      ],
      terrain: [
        { kind: "zone", x: 15, y: 5.5 },
        { kind: "zone", x: 37.5, y: 11 },
        { kind: "power", x: 52.5, y: 15 },
        { kind: "obscuring", x: 22.5, y: 16.5, small: true },
        { kind: "power", x: 7.5, y: 29 },
        { kind: "obscuring", x: 37.5, y: 27.5, small: true },
        { kind: "zone", x: 22.5, y: 33 },
        { kind: "zone", x: 44.5, y: 38.5 },
      ],
    },
  },
  {
    number: 12,
    name: "Bloodstained Coasts",
    cardName: "Bloody Ribs",
    twist: "From the 2nd battle round, both players can gain Emberstone shards and spend them in combat.",
    abilities: [
      {
        name: "Emberstones Cache",
        when: "Both players, from round 2 · once per turn, your hero phase",
        effect: "A friendly unit contesting an objective you control gets 1 Emberstone shard.",
      },
      {
        name: "Emberstones",
        when: "Both players, from round 2 · any combat phase",
        effect:
          "A friendly unit that charged this turn and has shards gets +1 to hit or +1 to wound with melee attacks for the rest of the turn. Then the underdog removes the shards from that unit only; otherwise remove all shards from all your units.",
      },
    ],
    map: {
      attacker: [[1, 0], [2, 0], [3, 0], [1, 1], [2, 1], [3, 1]],
      defender: [[1, 2], [2, 2], [3, 2], [1, 3], [2, 3], [3, 3]],
      objectives: [
        { kind: "lions", x: 45, y: 11 },
        { kind: "soliphiles", x: 30, y: 16.5 },
        { kind: "comet", x: 15, y: 22 },
        { kind: "heldenhain", x: 45, y: 22 },
        { kind: "soliphiles", x: 30, y: 27.5 },
        { kind: "lions", x: 45, y: 33 },
      ],
      terrain: [
        { kind: "zone", x: 30, y: 5.5 },
        { kind: "obscuring", x: 15, y: 11 },
        { kind: "power", x: 6.5, y: 22 },
        { kind: "power", x: 22.5, y: 22, small: true },
        { kind: "obscuring", x: 36.5, y: 22 },
        { kind: "obscuring", x: 52.5, y: 22, small: true },
        { kind: "obscuring", x: 15, y: 33 },
        { kind: "zone", x: 30, y: 38.5 },
      ],
    },
  },
  {
    number: 13,
    name: "Avalanche of Ash",
    cardName: "Ash Avalanche",
    twist: "The underdog must use Unstable Passage, which can remove objectives. Extra VP for terrain once objectives are gone.",
    abilities: [
      {
        name: "Unstable Passage",
        when: "Underdog (must) · once per battle round, start of the battle round",
        effect:
          "Pick one objective as the focus. Roll a dice for each objective, +1 for each unit (either side) contesting it; for the focus you may add or subtract 3. On 8+ that objective is removed from the battlefield.",
      },
    ],
    map: {
      attacker: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]],
      defender: [[2, 1], [3, 1], [2, 2], [3, 2], [2, 3], [3, 3]],
      objectives: [
        { kind: "lions", x: 15, y: 11 },
        { kind: "heldenhain", x: 30, y: 11 },
        { kind: "soliphiles", x: 45, y: 11 },
        { kind: "soliphiles", x: 15, y: 33 },
        { kind: "comet", x: 30, y: 33 },
        { kind: "lions", x: 45, y: 33 },
      ],
      terrain: [
        { kind: "zone", x: 22, y: 5.5 },
        { kind: "power", x: 37.5, y: 5.5, small: true },
        { kind: "obscuring", x: 7.5, y: 22, small: true },
        { kind: "obscuring", x: 22, y: 22 },
        { kind: "obscuring", x: 37.5, y: 22 },
        { kind: "obscuring", x: 52.5, y: 22, small: true },
        { kind: "power", x: 22, y: 39, small: true },
        { kind: "zone", x: 37.5, y: 39 },
      ],
    },
  },
  {
    number: 14,
    name: "Caverns of Slaughter",
    cardName: "The Caverns of Massacre",
    twist: "Hidden passages: both players can move units between terrain features with passage tokens; the underdog chooses where they are.",
    abilities: [
      {
        name: "Moving Passages",
        when: "Underdog · once per battle round, start of the battle round",
        effect: "Pick 2 terrain features (not faction terrain). Remove any hidden passage tokens, then give each of the 2 a hidden passage token.",
      },
      {
        name: "Negotiate Tunnels",
        when: "Both players · once per turn, your movement phase",
        effect:
          "A friendly unit wholly within 6\" of a feature with a hidden passage token is removed and set up wholly within 6\" of another feature with a token, more than 9\" from enemy units.",
      },
    ],
    map: {
      attacker: [[0, 1], [1, 1], [0, 2], [1, 2]],
      defender: [[2, 1], [3, 1], [2, 2], [3, 2]],
      objectives: [
        { kind: "lions", x: 15, y: 11 },
        { kind: "soliphiles", x: 30, y: 11 },
        { kind: "comet", x: 30, y: 22 },
        { kind: "lions", x: 30, y: 33 },
        { kind: "soliphiles", x: 45, y: 33 },
      ],
      terrain: [
        { kind: "obscuring", x: 7.5, y: 5.5, small: true },
        { kind: "power", x: 37, y: 5.5, small: true },
        { kind: "zone", x: 52, y: 11 },
        { kind: "obscuring", x: 20, y: 22 },
        { kind: "obscuring", x: 39, y: 22 },
        { kind: "zone", x: 7.5, y: 33 },
        { kind: "power", x: 22.5, y: 38.5, small: true },
        { kind: "obscuring", x: 52.5, y: 38.5, small: true },
      ],
    },
  },
  {
    number: 15,
    name: "What's Yours is Ours",
    cardName: "What's Yours Is Us",
    twist: "In odd rounds the Golden Lions (red) pair is the coveted pair, in even rounds the Soliphiles (gold) pair. The underdog can switch it.",
    abilities: [
      {
        name: "Unleash Your Fury",
        when: "Underdog · once per battle round, start of the battle round",
        effect: "Pick an objective pair: it is the coveted pair for the rest of the battle round (instead of the other one).",
      },
    ],
    map: {
      attacker: [[0, 0], [1, 0], [3, 0], [0, 1], [1, 1]],
      defender: [[0, 2], [1, 2], [0, 3], [1, 3], [3, 3]],
      objectives: [
        { kind: "soliphiles", x: 45, y: 12 },
        { kind: "lions", x: 15, y: 22.5 },
        { kind: "comet", x: 30, y: 22.5 },
        { kind: "lions", x: 45, y: 22.5 },
        { kind: "soliphiles", x: 45, y: 33.5 },
      ],
      terrain: [
        { kind: "zone", x: 37.5, y: 6 },
        { kind: "obscuring", x: 15, y: 12 },
        { kind: "obscuring", x: 7, y: 22.5 },
        { kind: "power", x: 22.5, y: 22.5, small: true },
        { kind: "obscuring", x: 37.5, y: 22.5, small: true },
        { kind: "power", x: 53.5, y: 22.5 },
        { kind: "obscuring", x: 15, y: 33.5 },
        { kind: "zone", x: 37, y: 39 },
      ],
    },
  },
  {
    number: 16,
    name: "Hidden Under Ash-clouds",
    twist: "Not on the cards provided yet: check your General's Handbook.",
    abilities: [],
  },
  {
    number: 21,
    name: "Warped Ruins",
    cardName: "Deformed Ruins",
    twist:
      "Set-up: every terrain feature (not faction terrain) must be within 12\" of another. The underdog must set terrain on fire, which damages units near burning terrain.",
    abilities: [
      {
        name: "The Curse Flame Spreads",
        when: "Underdog (must) · once per battle round, start of the battle round",
        effect:
          "If nothing is burning, pick any terrain feature (not faction terrain); otherwise pick one not burning within 12\" of a burning one. It burns for the rest of the battle. Then D3 mortal damage to each unit (both sides) within 6\" of any burning terrain.",
      },
    ],
    map: {
      attacker: north,
      defender: south,
      objectives: [
        { kind: "soliphiles", x: 22.5, y: 11 },
        { kind: "lions", x: 37.5, y: 11 },
        { kind: "heldenhain", x: 15, y: 22 },
        { kind: "comet", x: 45, y: 22 },
        { kind: "lions", x: 22.5, y: 33 },
        { kind: "soliphiles", x: 37.5, y: 33 },
      ],
      terrain: [
        { kind: "zone", x: 10.5, y: 11 },
        { kind: "obscuring", x: 49, y: 11.5 },
        { kind: "obscuring", x: 7.5, y: 22, small: true },
        { kind: "obscuring", x: 23, y: 22.5 },
        { kind: "power", x: 37, y: 22.5, small: true },
        { kind: "power", x: 53, y: 22.5 },
        { kind: "zone", x: 10.5, y: 33 },
        { kind: "obscuring", x: 48.5, y: 33.5 },
      ],
    },
  },
  {
    number: 22,
    name: "Curse of the Gnaw",
    cardName: "Curse of the B…",
    twist:
      "Instability starts at 1 and goes up by 1 (max 6) each time a player activates a Power Site. After the first turn is decided each round, the underdog can blast an objective with it.",
    abilities: [
      {
        name: "Town Echoes",
        when: "Underdog · once per battle round, start of the battle round",
        effect: "Pick an objective: each unit (both sides) contesting it suffers mortal damage equal to the instability level. Then instability goes back to 1.",
      },
    ],
    map: {
      attacker: [[0, 1], [0, 2], [1, 2], [0, 3], [1, 3], [2, 3]],
      defender: [[1, 0], [2, 0], [3, 0], [2, 1], [3, 1], [3, 2]],
      objectives: [
        { kind: "lions", x: 15, y: 11 },
        { kind: "heldenhain", x: 22.5, y: 22 },
        { kind: "comet", x: 37.5, y: 22 },
        { kind: "soliphiles", x: 45, y: 33.5 },
      ],
      terrain: [
        { kind: "power", x: 7.5, y: 16.5 },
        { kind: "obscuring", x: 22.5, y: 15.5, small: true },
        { kind: "zone", x: 31.5, y: 11.5 },
        { kind: "zone", x: 46.5, y: 11.5 },
        { kind: "obscuring", x: 37.5, y: 29.5, small: true },
        { kind: "power", x: 52.5, y: 28 },
        { kind: "zone", x: 13.5, y: 33 },
        { kind: "zone", x: 28.5, y: 33 },
      ],
    },
  },
  {
    number: 23,
    name: "Seize the Embers",
    twist: "Both players carry Emberstone nuggets from Soliphiles (gold) objectives back to Golden Lions (red) objectives; delivering one scores from round 2.",
    abilities: [
      {
        name: "Search the Rubble",
        when: "Both players · end of your turn",
        effect:
          "A friendly unit without a nugget contesting a Soliphiles (gold) objective gets an Emberstone nugget. If you are the underdog it can then move 6\" (not into combat). It can't use Return to Base Camp or Break In that turn.",
      },
      {
        name: "Return to Base Camp",
        when: "Both players · once per turn, end of your turn",
        effect: "A friendly unit with a nugget, not set up this turn, contesting a Golden Lions (red) objective hands it in: remove the nugget (3 VP from round 2).",
      },
    ],
    map: {
      attacker: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [0, 3], [1, 3], [2, 3]],
      defender: [[1, 0], [2, 0], [3, 0], [1, 1], [2, 1], [3, 1], [3, 2], [3, 3]],
      objectives: [
        { kind: "soliphiles", x: 15, y: 11.5 },
        { kind: "lions", x: 45, y: 11 },
        { kind: "heldenhain", x: 30, y: 22 },
        { kind: "soliphiles", x: 45, y: 33 },
        { kind: "lions", x: 15, y: 33.5 },
      ],
      terrain: [
        { kind: "obscuring", x: 7, y: 6, small: true },
        { kind: "obscuring", x: 36, y: 11 },
        { kind: "zone", x: 22.5, y: 17 },
        { kind: "power", x: 12, y: 22.5, small: true },
        { kind: "power", x: 48, y: 22, small: true },
        { kind: "zone", x: 38, y: 27.5 },
        { kind: "obscuring", x: 24, y: 33.5 },
        { kind: "obscuring", x: 52.5, y: 38.5, small: true },
      ],
    },
  },
  {
    number: 24,
    name: "Treacherous Ground",
    cardName: "Treacherous Terrain",
    twist: "All objectives start stable and only stable ones score. Each player makes one of theirs unstable in round 1; from round 2 the underdog can swap which of a pair is stable.",
    abilities: [
      {
        name: "Advance Cautiously",
        when: "Both players (must) · once per battle, start of the first battle round",
        effect: "Pick an objective in your territory: it is no longer stable.",
      },
      {
        name: "Violent Shake",
        when: "Underdog, from round 2 · once per battle round, start of the battle round",
        effect: "Pick a pair of objectives: the stable one becomes unstable and the other becomes stable.",
      },
    ],
    map: {
      attacker: [[0, 0], [1, 0], [2, 0], [3, 0], [1, 1], [2, 1]],
      defender: [[1, 2], [2, 2], [0, 3], [1, 3], [2, 3], [3, 3]],
      objectives: [
        { kind: "soliphiles", x: 15, y: 11.5 },
        { kind: "soliphiles", x: 45, y: 11.5 },
        { kind: "comet", x: 7.5, y: 22 },
        { kind: "heldenhain", x: 52.5, y: 22 },
        { kind: "lions", x: 15, y: 33 },
        { kind: "lions", x: 45, y: 33 },
      ],
      terrain: [
        { kind: "zone", x: 6, y: 11 },
        { kind: "obscuring", x: 25, y: 11 },
        { kind: "obscuring", x: 52, y: 5.5, small: true },
        { kind: "power", x: 22, y: 22, small: true },
        { kind: "power", x: 37, y: 22.5, small: true },
        { kind: "obscuring", x: 34.5, y: 33.5 },
        { kind: "zone", x: 54, y: 33.5 },
        { kind: "obscuring", x: 7.5, y: 38.5, small: true },
      ],
    },
  },
  {
    number: 25,
    name: "Escape From the Coast",
    cardName: "Flee the Coast",
    twist: "The underdog can remove a Heldenhain (black) or Soliphiles (gold) objective each round.",
    abilities: [
      {
        name: "To the Ships!",
        when: "Underdog · once per battle round, start of the battle round",
        effect: "Remove a Heldenhain (black) or a Soliphiles (gold) objective from the battlefield.",
      },
    ],
    map: {
      attacker: [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1]],
      defender: [[0, 2], [1, 2], [0, 3], [1, 3], [2, 3], [3, 3]],
      objectives: [
        { kind: "lions", x: 7.5, y: 11 },
        { kind: "soliphiles", x: 45, y: 11 },
        { kind: "comet", x: 22, y: 22 },
        { kind: "heldenhain", x: 45, y: 22 },
        { kind: "lions", x: 7.5, y: 33 },
        { kind: "soliphiles", x: 45, y: 33.5 },
      ],
      terrain: [
        { kind: "zone", x: 37.5, y: 6 },
        { kind: "obscuring", x: 22, y: 11.5 },
        { kind: "power", x: 5.5, y: 22, small: true },
        { kind: "obscuring", x: 15, y: 22, small: true },
        { kind: "obscuring", x: 36, y: 22.5 },
        { kind: "power", x: 54.5, y: 22.5 },
        { kind: "obscuring", x: 22, y: 33.5 },
        { kind: "zone", x: 37.5, y: 39 },
      ],
    },
  },
  {
    number: 26,
    name: "Power of the Realms",
    cardName: "The Might of Kingdoms",
    twist: "The Soliphiles (gold, centre) objective starts as the primary objective; the others are secondary. The underdog can move the primary with a Power Site.",
    abilities: [
      {
        name: "Mystic Charge",
        when: "Underdog · once per battle round, start of the battle round",
        effect:
          "Pick a Power Site you control and draw a straight line from the centre of the primary objective to it. The first secondary objective the line passes through becomes the primary; all the others are secondary.",
      },
    ],
    map: {
      attacker: north,
      defender: south,
      objectives: [
        { kind: "lions", x: 30, y: 11 },
        { kind: "comet", x: 15, y: 22 },
        { kind: "soliphiles", x: 30, y: 22 },
        { kind: "heldenhain", x: 45, y: 22 },
        { kind: "lions", x: 30, y: 33 },
      ],
      terrain: [
        { kind: "obscuring", x: 22, y: 5.5, small: true },
        { kind: "zone", x: 15, y: 11.5 },
        { kind: "zone", x: 45, y: 11 },
        { kind: "power", x: 5, y: 22.5 },
        { kind: "power", x: 55, y: 22 },
        { kind: "zone", x: 15, y: 33.5 },
        { kind: "zone", x: 45, y: 33.5 },
        { kind: "obscuring", x: 38, y: 38.5, small: true },
      ],
    },
  },
];

const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

export function battleplanInfo(name: string): BattleplanInfo | undefined {
  const n = squash(name);
  if (!n) return undefined;
  return BATTLEPLAN_INFO.find((b) => squash(b.name) === n || (b.cardName && squash(b.cardName) === n));
}

const compass = (x: number, y: number) => {
  const ns = y < 15 ? "north" : y > 29 ? "south" : "";
  const ew = x < 20 ? "west" : x > 40 ? "east" : "";
  return ns || ew ? `${ns}${ns && ew ? "-" : ""}${ew}` : "centre";
};
const cellsText = (cells: [number, number][]) => cells.map(([c, r]) => `${"ABCD"[c]}${r + 1}`).join(" ");

/** Plain-text summary for the coach: twist, abilities and the map with coordinates. */
export function battleplanText(name: string): string {
  const b = battleplanInfo(name);
  if (!b) return "";
  const lines = [`### Battleplan ${b.number}: ${b.name}${b.cardName ? ` (card title: ${b.cardName})` : ""}`, `Twist: ${b.twist}`];
  for (const a of b.abilities) lines.push(`- ${a.name} [${a.when}]: ${a.effect}`);
  if (b.map) {
    lines.push(
      'Map (60" wide west→east, 44" deep north→south; grid cells 15"×11", columns A-D from west, rows 1-4 from north; positions approximate):',
      `- Attacker's territory: cells ${cellsText(b.map.attacker)}. Defender's territory: cells ${cellsText(b.map.defender)}. Other cells are no-man's land.`,
      `- Objectives: ${b.map.objectives.map((o) => `${OBJECTIVE_NAMES[o.kind]} at (${o.x}", ${o.y}") ${compass(o.x, o.y)}`).join("; ")}.`,
      `- Terrain: ${b.map.terrain.map((t) => `${t.small ? "small " : ""}${TERRAIN_NAMES[t.kind]} at (${t.x}", ${t.y}")`).join("; ")}.`,
      "- Objective pairs are the two objectives with the same symbol.",
    );
  }
  return lines.join("\n");
}

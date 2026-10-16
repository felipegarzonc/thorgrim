# AoS Coach — Research & Plan

A personal coach for **Warhammer Age of Sigmar** that helps me make better decisions *during* a game (and get better *between* games).

_Research date: October 2026._

---

## 1. Research summary

### 1.1 The game as it is today

- **Edition:** Age of Sigmar **4th edition** (launched mid-2024). Rules are modular: Core Rules (move, shoot, charge, fight) plus Advanced Rules (commands, terrain, magic, battle tactics, army composition).
- **Current matched play season:** **General's Handbook 2026-27**, set in Aqshy. It replaced the 2025-26 Ghyran season. It adds:
  - 12 new battleplans: split deployments, centre deployment, hidden tunnels, objectives that can be destroyed.
  - A new set of **battle tactic cards**. Each card has three objectives, **Affray → Strike → Domination**, completed in order. You pick 2 cards when you build your army.
  - Season rule **Fury / Rage Dice**. Fury Level runs from 1 to 7, starting at 1 for the attacker and 2 for the defender. Each round you get Rage Dice equal to your Fury Level. You spend them on extra end-of-turn attacks (a 6 deals D3 mortals to the enemy and raises *their* Fury; a 1 deals D3 mortals to you) or on damage reduction (ignore 1 damage per 3+).
  - **Places of Power** can grant 2 Rage Dice and +2 Fury, but deal D3 mortals on a roll of 1.
- **Balance updates:** Points and errata arrive through periodic **Battlescrolls** (the most recent one I found was July 2026).

### 1.2 Where the real decisions are (what the coach should help with)

| Moment | Decision | Why it's hard |
|---|---|---|
| **List building** | Units, regiments, heroes, enhancements, the 2 battle tactic cards | Card choice has to match what the army can actually do |
| **Deployment** | Placement, screening, threat ranges, what to keep in reserve | The first double turn can punish bad deployment |
| **Priority roll** | Take or give the first turn, and whether to take a double turn | Taking a double turn **forfeits that round's battle tactic**. Max is roughly 10 VP/round, so that's a big trade-off. Ties go to the player who went first last round |
| **Battle tactic each turn** | Which card objective to attempt, and whether it's achievable | Objectives are sequential, so planning across rounds matters |
| **Hero phase** | Spells, prayers, manifestations, Rage Dice | Probabilities (cast/unbind) and opportunity cost |
| **Command points** | Spend now or hold for reactive commands (All-out Defence, Counter-charge, Covering Fire, Redeploy…) | The 4th edition is very reactive, and hoarding CP is a real tactic |
| **Movement** | Objective control (Control characteristic), screening, charge threat ranges, run vs. not | Mostly geometry and expected control scores |
| **Shooting / target priority** | Who shoots whom | Expected damage vs. rend/save/ward; kill vs. chip |
| **Charge** | Which charges to attempt, in what order | 2D6 odds, rerolls, and what happens if it fails |
| **Combat** | Activation order (alternating, strike-first/strike-last), pile-ins | Losing a unit before it fights is the classic mistake |
| **Every phase** | **"Did I forget an ability?"** | The most common way to lose value. Ability *timing* is in the data (see below) |
| **After the game** | What went wrong, what to change | Without a log nothing improves |

### 1.3 Data sources

| Source | What it gives | Use in the project |
|---|---|---|
| **BSData `age-of-sigmar-4th`** (GitHub, community-maintained, updated Oct 2026) | 137 `.cat`/`.gst` XML files for every faction: unit stats (Move/Health/Save/Control), weapons (Rng/Atk/Hit/Wnd/Rnd/Dmg/Ability), abilities with **Timing / Declare / Effect / Keywords**, spells, prayers, manifestations, **battle tactic cards (Affray/Strike/Domination)**, and points | ✅ **Primary data source.** Parse into JSON |
| GW **Warhammer Age of Sigmar: The App** (Storm Forge army builder) | Official rules, battletomes unlocked by code | Manual cross-check; no public API |
| My own **Core Rules, General's Handbook and battletome** | Battleplans, core and season rules text | Enter manually in my own words (copyright, see below) |
| Wahapedia, Goonhammer, Woehammer, Sprues & Brews, Frontline Gaming | Rules reference, tactics articles, meta win-rate stats | Learning and inspiration only. **No scraping, no copying rules text** |

> ⚠️ **IP note:** Rules text is Games Workshop's. The project stays **private and for personal use**. Rules data comes from BSData (which the community already maintains). Anything else is entered from books I own, summarised in my own words. Don't redistribute rules text.

### 1.4 Existing tools (and the gap)

The official app, BattleScribe/New Recruit and Tabletop Battles cover **list building, rules lookup and score tracking**. None of them **coach decisions during play**: odds, "what should I do now and why", reminders tied to the current phase, or post-game review. That's the gap this project fills.

---

## 2. Product vision

> **"A phone at the table that knows my army, the mission and the score, and tells me in under 30 seconds what my best options are this phase, with the odds."**

Design principles:
1. **Fast at the table.** Mobile-first, minimal typing, one tap per phase. If it slows the game down, I won't use it.
2. **Math is deterministic, judgement is AI.** Probabilities come from code, not from the LLM. The LLM explains, prioritises and spots plans.
3. **Explains the "why".** The goal is for *me* to get better, not to outsource the thinking.
4. **Learns from my games.** Logs → reviews → personal lessons that show up in future games.

---

## 3. Architecture

```
┌──────────────────────────── Mobile PWA (React + TS) ───────────────────────────┐
│  Army & list  │  Pre-game prep  │  Live game tracker  │  Coach chat  │  Review  │
└───────┬───────────────┬──────────────────┬──────────────────┬────────────┬─────┘
        │               │                  │                  │            │
        ▼               ▼                  ▼                  ▼            ▼
┌──────────────┐ ┌─────────────┐ ┌───────────────────┐ ┌──────────────────────────┐
│ Rules data   │ │ Math engine │ │ Game state        │ │ AI coach (Claude API,    │
│ (JSON from   │ │ (pure TS)   │ │ round, priority,  │ │ tool use)                │
│ BSData +     │ │ - damage    │ │ CP, VP, fury/rage,│ │ tools → data, math,      │
│ manual YAML) │ │ - charge    │ │ unit wounds, obj. │ │ state, my lessons        │
│              │ │ - cast/unbind│ │ control, tactic  │ │                          │
│              │ │ - VP project│ │ progress, log     │ │                          │
└──────────────┘ └─────────────┘ └───────────────────┘ └──────────────────────────┘
                                         │
                                         ▼
                              Local storage / SQLite (game logs, lessons)
```

### 3.1 Components

1. **Data pipeline (`/data`)**
   - Script that parses BSData XML into normalised JSON: `units`, `weapons`, `abilities` (with `phase`, `timing`, `owner: me|opponent`, `cost`), `battleTactics`, `points`.
   - Manual YAML for things BSData doesn't model well: battleplans (deployment, objectives, scoring) and core/season rules summaries.
   - Re-run when a Battlescroll drops, then diff to see what changed for my army.

2. **Math engine (`/engine`)**, pure and unit-tested
   - **Damage:** expected value **and distribution** for Atk → Hit → Wound → Save (with rend) → Ward → Damage. Supports Crit (2 hits / auto-wound / mortal), rerolls, ±1 modifiers, champion, and the Rage Dice extra-attack rule.
   - **Charge:** P(2D6 ≥ distance) with rerolls/bonuses.
   - **Magic/prayer:** P(cast), P(unbind), miscast risk.
   - **Kill probability:** P(destroy unit X with attackers A+B).
   - **VP projection:** expected VP this round under different choices (e.g. take vs. give double turn).

3. **Game state & tracker (`/app`)**
   - Setup: my list, opponent's list (pick from data), battleplan, attacker/defender, tactic cards.
   - Per round: priority result, who goes first, CP, Fury/Rage dice, VP, objective control, tactic progress (Affray/Strike/Domination ticks).
   - Unit cards with remaining wounds, a "has acted" flag per phase, and a destroyed flag.
   - **Phase checklist:** "abilities you can use NOW" for both sides, generated from the Timing field ("Your Hero Phase", "Any Combat Phase", "Reaction: …"). Includes **opponent threat reminders** ("they can Counter-charge if they hold 1 CP").

4. **AI coach (`/coach`)**, using the Claude API with tool use
   - Tools: `get_unit`, `get_abilities(phase)`, `calc_damage`, `calc_charge`, `calc_cast`, `get_game_state`, `get_battleplan`, `get_my_lessons`.
   - Prompt modes:
     - **Pre-game brief:** matchup plan, opponent's key threats, deployment idea, which tactic objectives to target each round.
     - **Priority advisor:** "Should I take the double turn?" Compares the VP and board swing of both options and explains it.
     - **Phase advisor:** top 3 options with odds and risks, in under 150 words.
     - **Rules Q&A:** answers grounded in the data, with the source shown.
     - **Post-game review:** reads the game log and gives 3 key mistakes, 3 things done well, and lessons to store.
   - Model choice: a fast model for in-game answers, the most capable model for pre-game and post-game analysis. Use prompt caching for the large army/rules context.

5. **Review & learning loop**
   - Every game is saved (state per phase + decisions + coach advice + outcome).
   - Lessons become tagged notes (e.g. `#priority #vs-Skaven`) that the coach reads in future games.
   - Simple stats over time: win rate per matchup, battle tactic completion rate, VP per round.

### 3.2 Tech stack (proposal)

- **TypeScript everywhere.** The repo already has a React `.jsx` app, so this keeps it consistent.
- **Vite + React + Tailwind, PWA** (installable on the phone, works offline for the tracker and math).
- **Node script** (`fast-xml-parser`) for the BSData parser.
- **Vitest** for the math engine.
- **Claude API** from a tiny backend or serverless function, so the API key never ships in the client.
- Storage: IndexedDB locally first; a cloud DB only if multi-device sync is needed.

---

## 4. Roadmap

Each milestone is useful on its own. Ship, play a game with it, adjust.

| # | Milestone | Deliverable | "Done" when… |
|---|---|---|---|
| **M0** | Scope | Pick my main army and the opponents I usually face | Decided |
| **M1** | Data | BSData → JSON parser; my army's warscrolls + all battle tactic cards loaded; manual YAML for the current battleplans | I can browse my army's abilities **grouped by phase** |
| **M2** | Math engine | Damage / charge / cast / kill calculators + tests; simple calculator UI | Numbers match hand-checked examples |
| **M3** | Cheat sheet + tracker | Printable/phone **phase-by-phase cheat sheet** for my army; live tracker for rounds, CP, VP, Fury, tactics and wounds | Used in a real game without slowing it down |
| **M4** | AI coach v1 | Priority advisor, phase advisor, rules Q&A over tools | Advice is grounded (cites data or odds) and fits in one phone screen |
| **M5** | Pre-game + post-game | Matchup brief; game log → review → lessons | After 3 games I have a list of personal lessons the coach uses |
| **M6** | Nice-to-haves | Voice input at the table; photo of the board → state (vision); opponent list import; meta stats; Spanish UI | — |

---

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| LLM hallucinates rules | Coach must answer from tools/data and show the source; the math engine computes all odds |
| Data goes stale after a Battlescroll | Re-run the parser, show a "data version" in the UI, diff my army's changes |
| Too slow to use mid-game | Tracker works offline; coach has a "short answer" mode; checklists need no AI at all |
| Copyright | Personal/private use, BSData as source, no scraped rules text, no public deployment of rules |
| Board geometry is hard to capture | v1 abstracts it: I enter distances/objective control by hand. Vision is an M6 experiment |
| API cost | Fast model in game, prompt caching, deterministic tools do the heavy lifting |

---

## 6. Open questions for me (Felipe)

1. **Which army** do I play (and which battletome/army of renown)? This decides what gets built first in M1.
2. Do I play mostly **tournaments/matched play** (GHB 2026-27) or casual/narrative?
3. **Where** do I want it: phone at the table (PWA), or also a desktop prep tool?
4. Language for the coach's answers: **English, Spanish, or both**?
5. OK to use the **Claude API** (needs an API key and a small backend), or should v1 stay fully offline (data + math + checklists only)?

---

## Sources

- [Goonhammer — AoS 4th edition: The Core Rules](https://goonhammer.com/age-of-sigmar-fourth-edition-the-core-rules)
- [Sprues & Brews — 4th edition core rules deep dive](https://spruesandbrews.com/2024/06/22/age-of-sigmar-4th-edition-core-rules-review-and-deep-dive-skaventide-core-book/)
- [Warhammer Community — Battle tactics in the new AoS](https://www.warhammer-community.com/en-gb/articles/mDgZvpSL/battle-tactics-are-the-key-to-winning-in-warhammer-age-of-sigmar-heres-how-they-work-in-newaos/)
- [Warhammer Community — What is the priority roll?](https://www.warhammer-community.com/en-gb/articles/7p8Y1I8r/warhammer-age-of-sigmar-what-is-the-priority-roll/)
- [Frontline Gaming — AoS 4.0: The priority roll and you](https://frontlinegaming.org/2024/03/29/aos-4-0-the-priority-roll-and-you/)
- [Sprues & Brews — General's Handbook 2026-27 review](https://spruesandbrews.com/2026/06/20/generals-handbook-2026-27-review-warhammer-age-of-sigmar/)
- [Frontline Gaming — GHB 2026-27 tactics preview](https://frontlinegaming.org/2026/06/19/age-of-sigmar-generals-handbook-2026-27-tactics-preview/)
- [Warhammer Community — Threshold tactics in the new General's Handbook](https://www.warhammer-community.com/en-gb/articles/ilauiwfp/threshold-tactics-on-the-new-generals-handbook/)
- [Woehammer — AoS 4th edition stats (July 2026 Battlescroll)](https://woehammer.com/2026/07/13/age-of-sigmar-4th-edition-stats-july-battlescroll-12th-july-2026/)
- [BSData on GitHub (age-of-sigmar-4th)](https://github.com/BSData)
- [Warhammer Community — The Warhammer Age of Sigmar app](https://www.warhammer-community.com/en-gb/articles/BJIpAlgV/the-new-warhammer-age-of-sigmar-app-is-coming-soon-heres-what-to-expect/)

# Thorgrim — AoS Coach

A personal Age of Sigmar (4th edition) coach for competitive Ogor Mawtribes play. It's a web app you can open on a computer to prepare and on your phone at the table.

- **Army data** for every faction (warscrolls, weapons, abilities with timing, points, battle tactic cards) comes from the community [BSData](https://github.com/BSData/age-of-sigmar-4th) files.
- **Your rules library**: upload the PDFs you own (core rules, General's Handbook, battletome, FAQs) and images (battleplan cards, maps, a photo of the table). PDFs are indexed page by page, so the coach can search them and cite pages.
- **Lists**: paste your list and your opponent's from the GW app, New Recruit or Listhammer. Units are matched to warscrolls automatically.
- **Games**: pick both lists, the battleplan, and the rule pages and maps for that game. The tracker covers round, priority/double turn, phase, CP, VP, Fury and Rage dice, battle tactic progress (Affray / Strike / Domination), unit damage and a log.
- **Phase checklist** ("don't forget"): the abilities you and your opponent can use in the current phase, taken from the warscrolls' timing.
- **Calculator** (in the style of Statshammer): pick an attacker and a target from the data, add modifiers and re-rolls, and get:
  - expected damage against every save
  - kill chance and damage distribution
  - damage per 100 pts
  - charge and casting odds
- **AI coach** (Claude): pre-game brief, in-game advice per phase, priority-roll decisions, rules questions and a post-game review. It sees both lists, the battleplan, map images and the live game state, uses the calculator for every number, and searches your books (then Wahapedia) for rules. It can also check Listhammer and Woehammer for meta and matchup data.

## Quick install on a Mac (one command)

Open **Terminal** (Cmd+Space, type "Terminal") and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/felipegarzonc/thorgrim/main/setup-mac.sh | bash
```

It installs everything into `~/aos-coach` (including its own copy of Node if needed, no admin password), asks for your Claude API key (optional), and opens the app at http://localhost:8787. Next time, double-click **`~/aos-coach/Start AoS Coach.command`**. Run the same command again to update.

## Put it online (Render)

The repository includes a Dockerfile and a Render blueprint (`render.yaml`), so the app can run on the internet and be opened from any phone or computer.

1. Create an account at [render.com](https://render.com) (sign in with GitHub) and add a payment card. A plan with a persistent disk is needed so your lists, games and books are kept: Starter (about $7/month) plus about $0.25 per GB of disk.
2. In Render: **New → Blueprint**, pick the `felipegarzonc/thorgrim` repository. Render reads `render.yaml`.
3. When asked, fill in:
   - `APP_ACCESS_KEY`: the password for the app (at least 8 characters). Required: without it the server refuses to start.
   - `ANTHROPIC_API_KEY`: your Claude API key (optional here; it can be pasted later on the Ask page).
4. Wait for the first build (a few minutes), then open the `https://thorgrim-….onrender.com` address Render shows and sign in with your password.

Each push to the deployed branch redeploys automatically. Data lives on the Render disk at `/data`; uploaded books from your Mac copy need to be uploaded again online.

## Manual setup (for development)

Requires Node 22+.

```bash
npm install
npm run data          # downloads BSData and builds data/aos.json (re-run after each Battlescroll)
cp .env.example .env  # then put your Claude API key in ANTHROPIC_API_KEY
npm run dev           # http://localhost:5173 (server on :8787)
```

The dev server listens on your network, so on the same Wi-Fi you can open `http://<your-computer-ip>:5173` on your phone.

For a single production process (serves the built web app and the API on one port):

```bash
npm run build
npm start             # http://localhost:8787
```

To use it away from home, host it on any small Node server with a persistent disk (uploads, lists and games are stored as files under `storage/`). Set `APP_ACCESS_KEY` so only you can use it.

## Tests

```bash
npm test         # dice engine + coach loop (Claude API mocked)
npm run typecheck
```

## Notes

- The coach uses `claude-opus-5-5` by default (`COACH_MODEL` overrides it). In-game questions run at medium effort, briefs and reviews at high effort. Server-side refusal fallback is on (`fallbacks: "default"`).
- Rules text belongs to Games Workshop. Keep this app private and for personal use, and only upload books you own.
- Photos of book pages, scanned PDFs and images are read by Claude once after upload: it transcribes the rules on pages that have no text layer, so they become searchable. This takes about a minute per 10 pages and needs the API key. Progress shows on the Rules page, and an interrupted read resumes when the server restarts.

# Thorgrim — AoS Coach

A personal Age of Sigmar (4th edition) coach for competitive Ogor Mawtribes play. It's a web app you can open on a computer to prepare and on your phone at the table.

- **Army data** for every faction (warscrolls, weapons, abilities with timing, points, battle tactic cards) comes from the community [BSData](https://github.com/BSData/age-of-sigmar-4th) files.
- **Rules library**: the core rules, General's Handbook, battletomes, FAQs and battleplan cards/maps the coach reads, managed by the developers (see *Managing the rules library*). PDFs are indexed page by page, so the coach can search them and cite pages; players can read and search them.
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

## Put it online (Vercel + Supabase)

The app runs on [Vercel](https://vercel.com) (free Hobby plan) and keeps your lists, games, books and settings in a private [Supabase](https://supabase.com) Storage bucket (free plan: 1 GB). Use a Supabase project of its own for Thorgrim, not one shared with another app.

1. **Supabase**: create a new project named `thorgrim` (any region close to you; the database password is not needed by the app). In **Project Settings → API**, copy the **Project URL** and the **`service_role`** secret key. The app creates its private bucket (`thorgrim`) on first use.
2. **Vercel**: **Add New → Project**, import the `felipegarzonc/thorgrim` repository. Leave the framework preset as "Other"; `vercel.json` sets the build. Before deploying, add these **Environment Variables**:
   - `APP_ACCESS_KEY`: the password for the app (at least 8 characters). Required: without it the app stays locked.
   - `SUPABASE_URL`: the Project URL from step 1.
   - `SUPABASE_SERVICE_ROLE_KEY`: the `service_role` key from step 1. Keep it secret: it only lives in Vercel, never in the browser.
   - `ANTHROPIC_API_KEY`: your Claude API key (optional here; it can be pasted later on the Ask page, and is then kept in your Supabase bucket).
3. Deploy, open the `https://thorgrim-….vercel.app` address and sign in with your password.

Each push to `main` redeploys automatically. Online, big files are uploaded from the browser straight to Supabase, and scanned pages are read while the Rules page is open (keep it open until it says "Searchable"). Books uploaded on your Mac need to be uploaded again online.

### Players (accounts)

Online with Supabase, the app has accounts so several people can track their own games:

- **First time:** open the app, sign in with the app password (`APP_ACCESS_KEY`), then go to your profile (the round badge on Home) and create your admin account. It keeps everything already in the app.
- **Inviting:** Profile → *Invite a player* creates a one-time link (valid 14 days) to send by WhatsApp or email. They pick their own email and password. Nobody can sign up without a link.
- **Each player** has their own lists, games and coach conversations. The rules library is shared and read-only for players.
- **Coach costs** use the admin's Claude key. Each player has a monthly limit (default $5, estimated from Claude's prices), set per player in the profile page; admins have none.
- **Forgotten password:** the admin gives a new one from the profile page (no email is sent).

Accounts use Supabase Auth in the same Supabase project; nothing else to configure. On your own computer (no Supabase) there are no accounts.

### Managing the rules library (developers)

Players can't upload or remove books. Developers manage the library from the command line with the app password:

```bash
export THORGRIM_URL=https://thorgrim.vercel.app APP_ACCESS_KEY=…   # the app password
npm run library -- list
npm run library -- upload ./ghb-2026-27.pdf --title "General's Handbook 2026-27" --category season
npm run library -- upload ./into-the-fire.jpg --title "Into the Fire" --category battleplan
npm run library -- read <id>      # finish reading scanned pages with Claude
npm run library -- delete <id>
```

Categories: `core`, `season`, `battletome`, `battleplan`, `map`, `other`. Battleplan cards and maps are matched to games by the battleplan's name in the title. Signing in to the app with the app password (instead of an account) also shows the upload form on the Rules page.

The battleplan and battle tactic cards of the season (the photographed cards PDF) go in with one command; each card is matched to its battleplan and read by Claude:

```bash
npm run library:battleplans -- ./GHB_26-27_ENG.pdf      # add --no-read to skip reading the cards now
```

The app also has each battleplan built in (`shared/battleplans.ts`): the twist and its abilities, the scoring, and a schematic map with territories, objectives and terrain, shown in the Battleplan step and the round screens and given to the coach. *Hidden Under Ash-clouds* is still missing (not on the cards).

Alternative: the repository also has a Dockerfile and a Render blueprint (`render.yaml`) for a server with a persistent disk (Render Starter, about $7/month plus disk). Set `APP_ACCESS_KEY` there too.

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

To use it away from home, use Vercel + Supabase as above, or any small Node server with a persistent disk (uploads, lists and games are stored as files under `storage/`, or `STORAGE_DIR`). Set `APP_ACCESS_KEY` so only you can use it.

## Tests

```bash
npm test         # dice engine + coach loop (Claude API mocked)
npm run typecheck
```

## Notes

- The coach uses `claude-opus-5-5` by default (`COACH_MODEL` overrides it). In-game questions run at medium effort, briefs and reviews at high effort. Server-side refusal fallback is on (`fallbacks: "default"`).
- Rules text belongs to Games Workshop. Keep this app private and for personal use, and only upload books you own.
- Photos of book pages, scanned PDFs and images are read by Claude once after upload: it transcribes the rules on pages that have no text layer, so they become searchable. This takes about a minute per 10 pages and needs the API key. Progress shows on the Rules page, and on your computer an interrupted read resumes when the server restarts (online it continues when you open the Rules page again).

# 🏸 ShuttleScore

A badminton tournament management web application built for a residential apartment community tournament. Handles the full lifecycle of a multi-event, multi-day tournament — from player registration and draw generation through live match scoring, real-time public updates, and results export.

Built as a single-page React app with a Supabase backend, deployed to GitHub Pages.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, plain CSS |
| Backend / DB | Supabase (PostgreSQL + Realtime) |
| Auth | Supabase Auth (admins), custom username/password table (referees) |
| Hosting | GitHub Pages |
| QR Code | `qrcode` npm package |

---

## Features

### Admin
- Tournament creation and management with court configuration and announcements
- Player registry with CSV import, folder organisation, shift-select bulk operations, and duplicate detection with player linking
- Event creation across age categories (U-8, U-13, U-18, Adult, Senior) and gender/type combinations
- Draw generation — group stage (circle method scheduling) and knockout brackets with byes
- Group and bracket management — swap/move players, add/remove groups
- Match management — referee assignment, court assignment, date scheduling, interleaved match ordering
- Live match scoring with per-game undo, game deletion, and auto-lock after 5 minutes
- Admin override with password protection and audit trail
- Default win / walkover support
- Event visibility toggle (hide/show events from public view for multi-weekend tournaments)
- Results export to PDF via browser print
- Action log showing match results, overrides, referee assignments chronologically

### Referee
- Custom username/password login with localStorage session persistence and DB re-validation
- Dual-start flow — referee marks ready, admin starts the match
- Mobile-optimised scoring interface (large tap targets)
- Per-game score graph visible during scoring
- Match confirmation and lock countdown

### Public / Spectator
- Live match updates via Supabase Realtime (no refresh needed)
- Overview tab — tournament summary cards, live/upcoming/results match sections
- Brackets tab — SVG bracket tree with connector lines per event
- Players tab — searchable player list with full match history and referee history
- Player profile popup with match history, medals, and score graphs
- Referee profile popup with match count and full profile link
- Announcement bar — admin can push live messages to all spectators
- QR code modal with PDF export for sharing the public URL
- Confetti on final and bronze match completion
- Loading skeletons, tab fade-in transitions
- Two-column group cards on wider screens

---

## Project Structure

```
shuttlescore/
├── public/                  # Static assets, favicon, manifest
├── src/
│   ├── components/
│   │   ├── admin/           # Admin-facing components
│   │   │   ├── ActionLog.js
│   │   │   ├── AdminMatchCard.js
│   │   │   ├── DrawManager.js
│   │   │   ├── EventManager.js
│   │   │   ├── MatchManager.js
│   │   │   ├── MatchScorer.js
│   │   │   ├── PlayerManager.js
│   │   │   ├── RefereeManager.js
│   │   │   ├── TournamentManager.js
│   │   │   ├── eventCategoryHelpers.js
│   │   │   ├── exportTournamentPDF.js
│   │   │   └── matchManagerHelpers.js
│   │   ├── public/          # Spectator-facing components
│   │   │   ├── BracketView.js
│   │   │   ├── FullHistory.js
│   │   │   ├── MatchCard.js
│   │   │   ├── MedalBadges.js
│   │   │   ├── PlayerProfile.js
│   │   │   ├── PublicView.js
│   │   │   ├── QRModal.js
│   │   │   ├── ScoreGraph.js
│   │   │   ├── TournamentSummary.js
│   │   │   └── helpers.js
│   │   ├── referee/         # Referee-facing components
│   │   │   └── RefereeView.js
│   │   └── RefBadge.js      # Shared referee R badge component
│   ├── context/
│   │   └── AuthContext.js   # Supabase Auth context for admins
│   ├── hooks/
│   │   └── useShiftSelect.js
│   ├── lib/
│   │   └── supabase.js      # Supabase client initialisation
│   ├── pages/
│   │   ├── Dashboard.js     # Admin dashboard shell and nav
│   │   └── Login.js         # Admin + referee login page
│   └── services/
│       ├── MatchService.js
│       ├── PlayerService.js
│       ├── RealtimeService.js
│       └── TournamentService.js
```

---

## Local Setup

### Prerequisites
- Node.js 18 or higher
- A Supabase project (free tier is sufficient)

### Install dependencies
```bash
cd shuttlescore
npm install
```

### Configure Supabase
The Supabase project URL and anon key are configured in `src/lib/supabase.js`.

### Run locally
```bash
npm start
```

---

## Database Setup

The database is managed directly in Supabase. The following migrations were run in order in the **Supabase SQL Editor**. Each is additive — safe to run on a live database.

| Migration | What it does |
|---|---|
| Base schema (v1.2) | All tables, types, RLS policies, triggers |
| v2 | Player registry — adds DOB, gender, age override; creates `tournament_players` table; drops `age_category` enum from players |
| v3 | Player folders + gender filter on events |
| v4 | Referee system — creates `referees` table, adds referee fields to matches, adds `display_name` to profiles |
| v5 | Tournament engine — creates `event_stages`, `stage_byes`; converts enums to TEXT; adds `default_win`, `games_per_match` |
| v5b | Fixes advancement trigger to fire on `finished` status and route losers to third-place matches |
| v6 | Admin identity — adds `profiles.player_id` and `matches.referee_admin_id` |
| v7 | Event visibility — adds `events.hidden` boolean |

After v6, also run:
```sql
CREATE POLICY "Config: anyone can read announcements"
  ON app_config FOR SELECT
  USING (key LIKE 'announcement_%');

ALTER PUBLICATION supabase_realtime ADD TABLE app_config;
```

To create the first admin:
1. Go to **Supabase Dashboard → Authentication → Users → Invite User**
2. Create the user with email/password
3. Run in SQL Editor (replace with actual UUID from step 2):
```sql
INSERT INTO profiles (id, name, role)
VALUES ('your-user-uuid', 'Admin Name', 'admin');
```

---

## Deployment

The app deploys to GitHub Pages via the `gh-pages` package.

```bash
cd shuttlescore
npm run deploy
```

This runs `npm run build` then pushes the `build/` folder to the `gh-pages` branch. The live URL is configured in `package.json` under `"homepage"`.

---

## Key Design Decisions

- **Custom referee auth** — referees are not Supabase Auth users. They authenticate via a username/password table with sessions stored in localStorage and re-validated against the DB on each load. This was intentional — referees are assigned on the day and the overhead of Supabase Auth invites wasn't appropriate for the use case.
- **Open matches RLS policy** — `matches: anyone can update` was applied to support the custom referee auth system. Acceptable for a closed club tournament with known participants.
- **DB enums converted to TEXT** — `event_type`, `event_format`, and `match_stage` were converted from Postgres enums to TEXT in v5 to allow flexibility without type migrations.
- **U-12 → U-13** — the DB stores the value `u12` for the U-13 bracket (historical from initial setup). All display labels correctly render it as U-13. No DB migration was needed or run for this change.

---

## License

Copyright (c) 2026 Shiladitya Patnaik. All rights reserved.
See [LICENSE](./LICENSE) for full terms.
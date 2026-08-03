# App Portfolio Command Center

A production-ready command center for a solo developer who builds multiple
implementations of the same app concept using different AI models and
app-building platforms (Gemini, DeepSeek, Lovable, Replit, Kimi K3, Claude,
Cursor, Anti-Gravity, Codex, ChatGPT, Google AI Studio, FreeBuff, …).

It organizes every **Project** (the business concept) separately from its
**ProjectVersion** builds (the model-generated implementations), plus
repositories, deployments, tasks, model evaluations, automated alerts, and
scheduled daily/weekly reports — in one desktop-first dashboard.

## Stack

- **Frontend:** Next.js 14 (App Router), React 18, TypeScript
- **Styling:** Tailwind CSS, Lucide icons, light/dark/system themes
- **Data:** Firebase Auth + Cloud Firestore (typed, user-isolated) with a fully
  functional **local demo fallback** (localStorage) when no Firebase project is
  configured — the app runs out of the box with seeded demo data
- **Automation:** 14-rule engine + priority queue + "Today's Top Three" (see
  `lib/engine.ts`), mirrored server-side in `functions/` (Cloud Scheduler)
- **Integrations:** GitHub REST, Vercel API, Google Calendar, Gemini AI summaries

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
```

Open http://localhost:3000 → redirected to `/command-center`. The app seeds 6
demo projects (Classic Chef Video Guide, Weeknight Meal Planner, Restaurant
Social Media Manager, Restaurant 86-to-0 Board, Menu Competitor Analyzer,
Takeout Voice 2) and persists changes to localStorage in demo mode.

### Opt into Firebase

Create a `.env.local` with Firestore-enabled project values:

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=…
NEXT_PUBLIC_FIREBASE_PROJECT_ID=…
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=…
NEXT_PUBLIC_FIREBASE_APP_ID=…
```

When these are present the app switches to the Firestore data service
(`lib/firestore.ts`), which scopes every read/write by `userId` (user
isolation). See `firestore.rules` guidance in the sibling meal-planner repo for
matching rules.

### Local Repository Scanner companion

```bash
node scripts/repo-scanner.mjs --path ~/dev/my-app --api http://localhost:3000/api/scanner
```

The CLI reads `git status --porcelain`, `git remote -v`, `git branch
--show-current`, `git log -1` and `git rev-list --left-right --count`, then
POSTs **metadata only** (never source code) to the Command Center API.

### Cloud Functions (optional)

```bash
cd functions
npm install
npm run serve   # emulator
npm run deploy
```

Scheduled functions: `runAutomation` (every 6h), `generateDailyReports` (daily
08:00 UTC), `generateWeeklyReports` (Monday 09:00 UTC). On-demand endpoints:
`/healthCheck`, `/runAutomationNow`, `/ingestScannerReport`.

## Modules

| Route | Purpose |
| --- | --- |
| `/command-center` | Metric cards, ranked priority queue, Today's Top Three, alerts, stale watch |
| `/projects` | Filterable portfolio (grid/table), project create/edit modal |
| `/projects/[id]` | Detail tabs: Overview, Versions, Tasks, Repos, Deployments, Evaluation, Activity |
| `/versions` | All builds across projects |
| `/today` | Top three, due today, overdue, reminders, recently completed |
| `/tasks` | Kanban board + list view |
| `/deployments` | Health + status of every environment |
| `/repositories` | Repo cards + scanner instructions |
| `/model-comparison` | Weighted score matrix + winner selection |
| `/reports` | Generate/save daily & weekly reports |
| `/activity` | Event feed with kind filters |
| `/integrations` | GitHub / Vercel / Calendar / Gemini connection UI |
| `/settings` | Profile, report schedule, stale threshold, demo reset |

## Model Evaluation scoring

Overall = 0.15·UI + 0.20·Features + 0.15·Code + 0.15·Stability + 0.10·Perf +
0.10·Maint + 0.05·Speed + 0.05·Cost + 0.03·Mobile + 0.02·A11y (1–10 scale).

## Project layout

```
app/            Next.js App Router pages + API route (scanner ingest)
components/     Layout shell, project/version/task/evaluation modals, UI kit
lib/            firebase.ts, firestore.ts (data service), seed.ts, engine.ts,
                store.tsx (React context), theme.tsx
types/          Full domain model + zod schemas + scoring
scripts/        repo-scanner.mjs (local CLI companion)
functions/      Firebase Cloud Functions (automation + scheduled reports)
```

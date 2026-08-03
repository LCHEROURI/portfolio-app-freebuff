<div align="center">

# 🍳 App Portfolio Command Center

**One dashboard to run every AI-built version of your app idea.**

[![Live demo](https://img.shields.io/badge/Live%20demo-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://portfolio-app-freebuff.vercel.app)
[![CI](https://img.shields.io/github/actions/workflow/status/LCHEROURI/portfolio-app-freebuff/ci.yml?style=for-the-badge&logo=githubactions&logoColor=white&label=CI)](https://github.com/LCHEROURI/portfolio-app-freebuff/actions/workflows/ci.yml)
[![Next.js](https://img.shields.io/badge/Next.js%2014-black?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)](https://firebase.google.com)
[![Tailwind](https://img.shields.io/badge/Tailwind%20CSS-38BDF8?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)

**[Live demo →](https://portfolio-app-freebuff.vercel.app)** · No sign-up needed — runs in demo mode with seeded data.

</div>

---

## What it is

A solo developer doesn't build one app — they build the **same idea many times**,
once per AI model and platform: Gemini, DeepSeek, Lovable, Replit, Kimi K3,
Claude, Cursor, Codex, ChatGPT, Google AI Studio, Anti-Gravity, FreeBuff…

**App Portfolio Command Center** turns that chaos into a single, ranked,
actionable dashboard. Each business concept is a **Project**; each AI build of
it is a **ProjectVersion**. Repositories, deployments, tasks, model
evaluations, automated alerts, and daily/weekly reports all live in one
desktop-first view.

## Screenshots

| Command Center | Command Center (dark) |
| :---: | :---: |
| ![Command Center dashboard](screenshots/command-center.png) | ![Command Center dark mode](screenshots/command-center-dark.png) |

| Project portfolio | Model comparison |
| :---: | :---: |
| ![Projects grid](screenshots/projects.png) | ![Model comparison matrix](screenshots/model-comparison.png) |

> Try the live demo in dark mode: `https://portfolio-app-freebuff.vercel.app/command-center?theme=dark`

## Why it's a portfolio piece

- **A real engine, not a mockup** — the 8-tier priority queue, all **14
  automation rules**, "Today's Top Three", and daily/weekly report builders are
  implemented and running (`lib/engine.ts`).
- **Data-backed model selection** — every version is scored across 10 weighted
  axes (UI, features, code quality, stability, performance, maintainability,
  speed, cost, mobile, accessibility) so "which build won?" has an answer.
- **Production-ready data layer** — typed, user-isolated Firestore with real
  Authentication (email/password + Google), a `firestore.rules` security model,
  and a one-click **migration path** from the localStorage demo mode into a
  real account.
- **Ships with a local companion** — `scripts/repo-scanner.mjs` reads your git
  state locally and POSTs metadata (never source) to the scanner API, so repos
  show up in the dashboard.
- **Runs out of the box** — seeded with 6 realistic demo projects; no Firebase
  config required to explore every screen.

## Stack

- **Frontend:** Next.js 14 (App Router), React 18, TypeScript
- **Styling:** Tailwind CSS, Lucide icons, light/dark/system themes (`?theme=` URL override)
- **Data:** Firebase Auth + Cloud Firestore (typed, user-isolated, `firestore.rules`) with a fully functional **local demo fallback** (localStorage) — local demo data can be **imported into a real account** on first sign-in
- **Automation:** 14-rule engine + priority queue + "Today's Top Three", mirrored server-side in `functions/` (Cloud Scheduler)
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

### Opt into Firebase (real Auth + Firestore)

Create a `.env.local` with your Firebase web-app config values:

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=…
NEXT_PUBLIC_FIREBASE_PROJECT_ID=…
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=…
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=…
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=…
NEXT_PUBLIC_FIREBASE_APP_ID=…
```

When these are present the app switches to real Authentication + Firestore:

- A **sign-in gate** appears (`components/auth/AuthGate.tsx`) — email/password
  or Google (popup). Authentication lives in `lib/auth.tsx`.
- Every read/write is scoped by `userId` via `lib/firestore.ts`, and
  `firestore.rules` enforces the same per-user isolation server-side.
- On first sign-in the app offers to **import your local demo data** into the
  account (`migrateLocalDemoToFirestore` in `lib/firestore.ts`) — projects,
  versions, repos, deployments, tasks, evaluations, and activity are re-keyed
  to your uid and written to Firestore.
- Sign out from the sidebar footer or Settings → Account.

Deploy the rules with:

```bash
npx firebase deploy --only firestore:rules
```

In **Demo Mode** (no env vars) everything still works: seeded data persists to
localStorage and the app never asks for credentials.

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
components/     Layout shell, auth gate, modals, UI kit
lib/            firebase.ts, auth.tsx, firestore.ts, seed.ts, engine.ts,
                store.tsx (React context), theme.tsx
types/          Full domain model + zod schemas + scoring
scripts/        repo-scanner.mjs (local CLI companion)
functions/      Firebase Cloud Functions (automation + scheduled reports)
firestore.rules Per-user Firestore security rules
screenshots/    Screenshots used in this README
```

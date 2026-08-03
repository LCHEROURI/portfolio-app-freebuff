# Goal

## The problem

A solo developer builds the **same app concept** multiple times using different
AI models and app-building platforms (Gemini, DeepSeek, Lovable, Replit, Kimi
K3, Claude, Cursor, Anti-Gravity, Codex, ChatGPT, Google AI Studio, FreeBuff…).
Each build lives in its own repo and deployment, with its own tasks, blockers,
and progress — and nothing tracks which version is ahead, what needs attention,
or which model won.

## The product

**App Portfolio Command Center** — a desktop-first dashboard that is the single
source of truth for every project, model-generated version, repository,
deployment, task, evaluation, and alert. It turns scattered builds into one
ranked, actionable queue.

## Target user

One solo developer managing 5–20 AI-built implementations across platforms.
Desk-bound, multi-repo, multi-deployment, wants a daily/weekly cadence, not a
project-management tool for teams.

## Core value proposition

1. **Separation of concept from implementation** — a Project (the business idea)
   owns its ProjectVersions (the model builds), so comparisons stay meaningful.
2. **Ranked attention** — the priority queue and "Today's Top Three" answer
   "what do I do next?" automatically (prod failures > unpushed work > overdue
   tasks > blockers > missing repo/deployment > stale).
3. **Data-driven winner selection** — weighted 10-axis model evaluation
   (formula in `types/index.ts`) replaces gut-feel version choices.
4. **Automation over vigilance** — 14 rules (stale, uncommitted, failed deploys,
   missing repo↔deployment pairing, overdue, no-winner, health checks…) catch
   what a busy solo dev would miss.
5. **Local companion, metadata only** — the repo-scanner CLI reads git state
   locally and sends metadata (never source code).

## Definition of done (phases)

- **Phase 1 — Foundation ✅** Next.js 14 + TS + Tailwind shell; full domain
  model + zod schemas; typed user-isolated Firestore data layer with demo
  fallback; seeded demo data (6 projects).
- **Phase 2 — Command Center engine ✅** Priority queue, 14 automation rules,
  Today's Top Three, daily/weekly report builders, all 12 modules, repo-scanner
  CLI + validated ingest API, Cloud Functions mirror.
- **Phase 3 — Production hardening ⏳ (next)**
  - Real Firebase Auth + Firestore live (currently localStorage demo mode)
  - GitHub / Vercel / Google Calendar OAuth integrations actually connected
  - Repo-scanner scheduled runs (cron / launchd) feeding the API
  - Deployment health-checker (uptime polling) live
  - PWA install + offline-first polish

## Success measures

- A scan + API round trip brings a repo's state into the dashboard (< 1 min).
- Priority queue surfaces the right "next action" with zero manual triage.
- A winner can be chosen per project from the comparison matrix with scores.
- Daily report requires zero setup beyond an email/timezone in settings.

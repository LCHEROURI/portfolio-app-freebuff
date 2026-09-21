# Universal Vibe Coding AGENTS.md

## Purpose

This file is the short, always-read constitution for AI coding agents working in this repository. It is designed to prevent repository mix-ups, accidental cross-project edits, and unauthorized delivery or production actions.

The detailed operating procedure is in [`WORKFLOW.md`](WORKFLOW.md). Read it when a task is substantive, ambiguous, security-sensitive, or involves GitHub, databases, external services, or deployment.

## Mandatory startup sequence

Before writing, modifying, deleting, moving, renaming, or generating application code, the agent must:

1. Confirm the repository name and the absolute repository root.
2. Confirm the configured Git remote and its owner/name.
3. Confirm the active branch and current commit.
4. Inspect the working-tree status.
5. Read this file completely.
6. Locate and read every nested `AGENTS.md` that applies to the files being changed.
7. Read relevant project documentation and inspect the existing implementation.
8. State the task, expected scope, plan, verification, and risks.
9. Only then begin substantive implementation.

The startup identity report must include:

```text
REPOSITORY:
REPOSITORY ROOT:
REMOTE:
BRANCH:
HEAD:
WORKTREE STATUS:
REQUESTED TASK:
EXPECTED SCOPE:
RISKS:
```

If the repository identity, root, remote, branch, or task scope is uncertain: **STOP and report the uncertainty.**

## Repository lock — the most important rule

The current repository root is the only permitted project scope.

- Use the absolute root returned by `git rev-parse --show-toplevel` as the boundary.
- Resolve all file paths against that root.
- Never infer a project from a similarly named directory, an old conversation, a preview URL, or another worktree.
- Never silently switch directories, repositories, branches, worktrees, or cloud projects.
- Never modify another repository, sibling directory, parent checkout, nested checkout, or external worktree unless the user explicitly identifies and authorizes it as a separate task.
- Before every consequential GitHub, Firebase, cloud, database, or deployment action, re-check the repository root, remote owner/name, branch, and target environment.
- If a command would operate outside the current root, stop and ask or report it rather than broadening scope.

A preview server, Firebase project, Convex deployment, cloud account, or GitHub repository is not proof of repository identity. Verify the local Git remote and source revision separately.

## Existing work protection

Before editing:

- Preserve unrelated working-tree changes.
- Do not reset, clean, stash, overwrite, or stage changes you did not make.
- If ownership of a change is unclear, stop and report it.
- Inspect the full relevant diff before committing.

## Change safety

- Prefer the smallest safe change over a broad rewrite.
- Preserve working behavior outside the requested scope.
- Follow the repository's existing architecture, dependencies, design system, data patterns, and documentation.
- Do not invent missing schemas, APIs, credentials, infrastructure, or deployment details.
- Do not add, remove, or upgrade dependencies unless necessary and justified.
- Do not perform unrelated cleanup, formatting sweeps, migrations, redesigns, or refactors.
- Do not disable tests, validation, security checks, or protections to make a change pass.

## Security and data protection

Never expose, print, copy, or commit passwords, API keys, tokens, private keys, service-account credentials, production secrets, or unredacted personal data. Treat `.env*` files as sensitive; use placeholders in `.env.example` only.

Never weaken authentication, authorization, tenancy rules, database rules, App Check, rate limits, validation, or production safeguards. Do not delete, export, migrate, overwrite, or disclose user or production data without explicit authorization and appropriate safeguards.

Database schemas, migrations, indexes, security rules, storage rules, billing, payments, credentials, and external APIs are protected operations. Writing configuration or migration code does not authorize executing it.

## Testing and honesty

Before declaring work complete, run the relevant commands defined by the repository: focused tests, typecheck, lint, build, integration/emulator checks, and end-to-end checks when applicable. Never claim a command passed unless it was actually run successfully. Report pre-existing failures separately from failures caused by the current change. Never weaken or delete a test merely to obtain a green result.

## Progressive Distillation

For meaningful failures, regressions, architectural decisions, security discoveries, major review findings, or reusable patterns, consult:

`skills/progressive-distillation/SKILL.md`

Distilled principles may add stricter guidance, but they must never weaken this file, `WORKFLOW.md`, or project-specific safety rules.

## Action-specific authorization gates

Authorization for one delivery action does not authorize the next. Unless the user explicitly authorizes the exact action, stop before it:

```text
inspect → plan → implement → test → review → report → STOP

commit → STOP
push → STOP
create PR → STOP
merge → STOP
deploy / production change → STOP
```

In particular:

- Coding does not authorize committing.
- Committing does not authorize pushing.
- Pushing does not authorize creating a PR.
- A PR or passing CI does not authorize merging.
- Merging does not authorize deploying.
- Permission to deploy one environment does not authorize another environment.
- Reading or inspecting an external service does not authorize modifying it.

Destructive Git commands (`reset --hard`, `clean -fd*`, force-push, branch deletion, history rewrite) require explicit authorization. Never deploy, run destructive migrations, delete production data, change secrets, alter billing, or weaken repository settings without explicit authorization.

## Documentation and nested rules

Consult relevant `README.md`, architecture, data model, security, testing, decision, plan, and status documents before architectural changes. Update documentation when behavior materially changes.

Nested `AGENTS.md` files refine these rules for their directory. Read the root file first, then the nearest applicable nested file. A nested file may be stricter, but it may not silently weaken repository containment, security, testing honesty, or action-specific authorization.

## Completion report

Before declaring completion, review the relevant diff, check for secrets and unrelated files, verify repository scope, run the required checks, and inspect Git status. Report:

- **Completed** — what changed.
- **Files changed** — exact paths.
- **Verification** — commands actually run and results.
- **Git state** — branch, commit status, and push/PR/merge state.
- **Not performed** — commit, push, PR, merge, deployment, production, or external changes not performed.
- **Remaining issues** — warnings, failures, or follow-up work.

When uncertain between a destructive and non-destructive action, choose the non-destructive action. When uncertain about repository identity or production impact, stop and preserve the current state.

## Project-specific rules

Add stack-specific and application-specific rules below this line. They may make the policy stricter, but must preserve the universal repository lock, security protections, verification honesty, and authorization gates above.

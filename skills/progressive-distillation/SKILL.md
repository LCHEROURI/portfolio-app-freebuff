# Progressive Distillation Thinking Skill

## Purpose
Turn meaningful development outcomes into reusable development principles.

Core loop:

**Experience → Reflection → Principle → Experiment → Save**

## When to run
Run this skill after:
- A bug is solved
- A build/test/deployment/CI failure
- A meaningful code-review finding
- A security discovery
- A database or architecture decision
- A material UX/workflow change
- An incorrect agent assumption
- A workaround
- A reusable pattern
- A regression
- A user-rejected solution
- A major decision under uncertainty

Do not run it for trivial mechanical edits.

## 1. Experience
Capture facts:
1. What task were we attempting?
2. What happened?
3. What succeeded?
4. What failed?
5. What files/components/services were involved?
6. What was the user trying to accomplish?
7. What was at stake?

Use evidence: logs, errors, tests, screenshots, database state, API responses, review findings, CI checks, and user feedback.

## 2. Reflect
Determine why:
1. Why did we choose this approach?
2. What assumptions were made?
3. Which assumptions were correct?
4. Which were wrong?
5. What information was missing?
6. What trade-offs were made?
7. Could the issue have been detected earlier?
8. Was there a safer or simpler approach?

## 3. Distill
Create one short, actionable, reusable rule.

Examples:
- Never assume a database field exists; verify the schema first.
- When requirements are ambiguous, prefer a small reversible experiment.
- Confirm repository and active branch before meaningful coding work.
- Separate provider outages from application defects before changing working code.

Output:

**Principle:** One sentence.

## 4. Experiment
Define how to test the principle:
- Automated test
- CI check
- Preflight
- Validation
- Logging
- Checklist
- `AGENTS.md` rule
- Monitoring
- Deployment gate

## 5. Save
Classify the principle:

### Project
Save to project docs or project-specific skill.

### Agent
Save to the relevant `AGENTS.md`.

### Universal
Save to this shared skill/template.

### Experimental
If observed only once, keep it experimental until validated.

## Confidence
- **Low** — observed once.
- **Medium** — repeated or strongly supported.
- **High** — repeatedly validated; suitable for automation.

## Decision mode under uncertainty
1. Identify knowns.
2. Identify unknowns.
3. Identify assumptions.
4. Estimate cost of being wrong.
5. Determine reversibility.

Reversible decision:
**small experiment → measure → adjust**

Hard-to-reverse decision:
gather more evidence first.

## Priority under pressure
Default order:
**Production/Security Risk → Blocking Failure → User-Critical Feature → Enhancement → Cosmetic Improvement**

## Communication
Explain decisions in this order:
1. What happened
2. Why it matters
3. What we should do
4. What happens next

## Automation
When a principle reaches High confidence, prefer enforcement in this order:
1. Automated tests
2. CI checks
3. Validation scripts
4. Git hooks
5. Agent instructions
6. Human checklist

## Required output
```md
## Progressive Distillation

**Experience:**
...

**Reflection:**
...

**Distilled Principle:**
...

**Next Experiment:**
...

**Confidence:**
Low / Medium / High

**Scope:**
Project / Agent / Universal

**Save To:**
...

**Automation Opportunity:**
Yes / No
```

If no meaningful lesson exists:

**Distillation Result: No reusable principle identified.**

Primary development loop:

**BUILD → TEST → OBSERVE → REFLECT → DISTILL → SAVE → IMPROVE → BUILD AGAIN**

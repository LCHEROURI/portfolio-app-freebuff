// ============================================================================
// scripts/launch-checklist-gates.mjs — pure gate cross-checks.
//
// The launch-checklist drift guard (verify-launch-checklist.mjs) proves every
// §4 gate command is runnable from package.json. That is one source of truth;
// scripts/verify-all.mjs's GATE_NAMES / GATES arrays are the other — the
// one-command runner that actually EXECUTES the checklist. If a gate is
// renamed, dropped, or added in verify-all.mjs without a matching §4 change,
// the doc and package.json can stay perfectly runnable while the runner and
// the checklist disagree about what exists.
//
// This module closes that gap with three pure cross-checks (no file I/O, no
// network, no secrets — they take the parsed inputs, the raw
// verify-all.mjs source, and package.json scripts as arguments and return an
// array of human-readable failure strings; empty = consistent):
//
//   crossCheckVerifyAllGates     — resolves each §4 command to the gate name
//     verify-all.mjs uses for it and asserts the two name sets are identical.
//   crossCheckVerifyAllSecrets   — asserts every §4 gate row also carries a
//     Requires cell (docs/launch.md's third table column) whose secret names
//     exactly match the `secrets` array on the matching GATES entry, so the
//     REQUIRES column the verify:all summary prints can never drift from the
//     doc: a secret added to the runner without a doc update fails, and a
//     blank Requires cell on any row fails even when the gate has no secrets
//     (the cell must say — instead).
//   crossCheckCiGates            — asserts the CI side (ci.yml's
//     verify-deployed / verify-auth-domains / verify-prod-signin jobs) gates
//     each verify step on secrets the runner actually declares for that gate:
//     a step gated on a secret the runner never declared fails, and a step
//     that runs UNGATED while its gate declares secrets fails too — so the
//     doc, the runner, and CI can never disagree about what a gate needs.
//
// All three share one GATES parser and one command→gate resolver, so the
// name, doc-secrets, and CI-gating checks can never disagree about what a
// gate is.
//
// Resolution rules (mirror the runner's own gate table):
//   - `npm run verify:X [args…]`  → gate name X (args after the script name,
//     e.g. the deployed-hash `-- --expect <sha>`, are stripped).
//   - `node scripts/Y.mjs`        → the gate whose GATES entry has
//     `file: 'scripts/Y.mjs'` (e.g. auth-domains-direct), else the gate whose
//     npm script targets that file (e.g. prod-signin's script runs
//     scripts/verify-prod-signin.mjs).
// ============================================================================

// The GATE_NAMES literal: `const GATE_NAMES = ['a', 'b', …];`.
const GATE_NAMES_RE = /const GATE_NAMES = \[([^\]]*)\]/;
// The GATES array literal, captured to its closing `];` (each entry is an
// object on its own line; no nested array ends with `];`).
const GATES_RE = /const GATES = \[([\s\S]*?)\n\];/;
const NAME_RE = /name:\s*'([^']+)'/g;
const SCRIPT_RE = /script:\s*'(verify:[^']+)'/;
const FILE_RE = /file:\s*'([^']+)'/;
const SECRETS_RE = /secrets:\s*\[([^\]]*)\]/;
// A script target: `node scripts/<file>.mjs` inside a package.json value.
const SCRIPT_TARGET_RE = /scripts\/[\w./-]+\.(mjs|ts|js|sh|cjs)\b/;
// §4 command forms (tolerate trailing args on npm gates).
const NPM_CMD_RE = /^npm run (verify:[^\s]+)/;
const NODE_CMD_RE = /^node (scripts\/[\w./-]+\.mjs)/;
// Backticked env-identifier names inside a Requires cell, e.g. `VERCEL_TOKEN`.
const SECRET_NAME_RE = /`([A-Z][A-Z0-9_]+)`/g;

/**
 * Parse verify-all.mjs's GATE_NAMES + GATES arrays into gate entries.
 * Returns `{ error }` when either array is missing/restructured.
 *
 * @param {string} verifyAllSrc
 */
function parseVerifyAllGates(verifyAllSrc) {
  const namesMatch = verifyAllSrc.match(GATE_NAMES_RE);
  if (!namesMatch) {
    return { error: 'verify-all.mjs has no GATE_NAMES array — a rename or restructure broke the runner.' };
  }
  const gatesMatch = verifyAllSrc.match(GATES_RE);
  if (!gatesMatch) {
    return { error: 'verify-all.mjs has no GATES array — a rename or restructure broke the runner.' };
  }
  const names = [...namesMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const gatesBody = gatesMatch[1];

  const entries = [];
  const nameSpans = [];
  let nameHit;
  while ((nameHit = NAME_RE.exec(gatesBody))) {
    nameSpans.push({ name: nameHit[1], start: nameHit.index });
  }
  for (let i = 0; i < nameSpans.length; i += 1) {
    const seg = gatesBody.slice(
      nameSpans[i].start,
      i + 1 < nameSpans.length ? nameSpans[i + 1].start : gatesBody.length,
    );
    const secretsMatch = seg.match(SECRETS_RE);
    entries.push({
      name: nameSpans[i].name,
      script: seg.match(SCRIPT_RE)?.[1] ?? null,
      file: seg.match(FILE_RE)?.[1] ?? null,
      secrets: secretsMatch ? [...secretsMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [],
    });
  }

  return { names, entries };
}

/**
 * Resolve §4 commands to gate names using the parsed GATES entries.
 * Returns `{ results, failures }` where `results` has ONE entry per command
 * (a per-row array, `gate: null` when the command does not resolve). Keeping
 * the array row-aligned matters for callers that iterate rows[i] against
 * results[i] — a compressed list would misalign every row after a failed
 * resolution and compare the wrong row against the wrong gate. Unresolved
 * commands are reported in `failures`.
 */
function resolveDocCommands(docCommands, entries, npmScripts) {
  const failures = [];
  const scriptToGate = new Map();
  const fileToGate = new Map();
  for (const e of entries) {
    if (e.script) scriptToGate.set(e.script, e.name);
    if (e.file) fileToGate.set(e.file, e.name);
  }
  // Resolve `node scripts/Y.mjs` commands that are aliased by an npm script
  // (the runner's GATES entry for those gates has `script:`, not `file:`).
  // fileToGate takes precedence so auth-domains-direct (a file-based gate)
  // wins over auth-domains (whose script targets the same file).
  const fileToGateViaScript = new Map();
  for (const [scriptName, gateName] of scriptToGate) {
    const target = String(npmScripts[scriptName] ?? '').match(SCRIPT_TARGET_RE)?.[0];
    if (target) fileToGateViaScript.set(target, gateName);
  }

  const results = [];
  for (const cmd of docCommands) {
    const npm = cmd.match(NPM_CMD_RE);
    if (npm) {
      results.push({ gate: npm[1].replace(/^verify:/, '') });
      continue;
    }
    const node = cmd.match(NODE_CMD_RE);
    if (node) {
      const file = node[1];
      const gate = fileToGate.get(file) ?? fileToGateViaScript.get(file);
      if (!gate) {
        failures.push(`"${cmd}" — file "${file}" maps to no gate in verify-all.mjs.`);
        results.push({ gate: null });
        continue;
      }
      results.push({ gate });
      continue;
    }
    // Unsupported command forms are already rejected by the runnable check in
    // verify-launch-checklist.mjs — nothing to resolve here.
    results.push({ gate: null });
  }

  return { results, failures };
}

/**
 * Cross-check the §4 gate commands against verify-all.mjs's gate names.
 * Returns an array of failure strings — empty means the doc's gates exactly
 * match the runner's gate names (same set, same count).
 *
 * @param {{ docCommands: string[], verifyAllSrc: string, npmScripts: Record<string, string>, expectedCount: number }} args
 */
export function crossCheckVerifyAllGates({ docCommands, verifyAllSrc, npmScripts, expectedCount }) {
  const failures = [];
  const parsed = parseVerifyAllGates(verifyAllSrc);
  if (parsed.error) return [parsed.error];
  const { names: verifyAllNames, entries } = parsed;

  const { results, failures: resolveFailures } = resolveDocCommands(docCommands, entries, npmScripts);
  failures.push(...resolveFailures);
  // Unresolved commands are reported above; the resolved name set is what the
  // count + exact-set assertions compare (a failed resolution lowers the
  // count, which is itself a failure — the same behavior as before).
  const docNames = results.map((r) => r.gate).filter((g) => Boolean(g));

  // Count and exact-set assertions.
  if (verifyAllNames.length !== expectedCount) {
    failures.push(`verify-all.mjs declares ${verifyAllNames.length} gate names but §4 promises ${expectedCount}.`);
  }
  if (docNames.length !== expectedCount) {
    failures.push(`§4 resolves to ${docNames.length} gate name(s) but promises ${expectedCount}.`);
  }
  const docSet = new Set(docNames);
  const verifySet = new Set(verifyAllNames);
  const missing = verifyAllNames.filter((n) => !docSet.has(n));
  const unexpected = [...docSet].filter((n) => !verifySet.has(n));
  if (missing.length > 0) {
    failures.push(`gate(s) in verify-all.mjs but NOT documented in §4: ${missing.join(', ')}`);
  }
  if (unexpected.length > 0) {
    failures.push(`gate(s) documented in §4 but NOT in verify-all.mjs: ${unexpected.join(', ')}`);
  }

  return failures;
}

/**
 * Parse docs/launch.md's §4 gate table into its header + rows, capturing the
 * Requires cell (third column) per row. Pure: reads nothing itself.
 *
 * @param {string} doc
 * @returns {{ header: string | null, rows: Array<{ command: string, requires: string }> }}
 */
export function parseLaunchChecklistTable(doc) {
  const lines = doc.split('\n');
  const startIdx = lines.findIndex((l) => /^## \d+\. The verification gates/.test(l.trim()));
  if (startIdx < 0) return { header: null, rows: [] };
  const nextSection = lines.slice(startIdx + 1).findIndex((l) => /^## /.test(l));
  const sectionLines = nextSection >= 0
    ? lines.slice(startIdx + 1, startIdx + 1 + nextSection)
    : lines.slice(startIdx + 1);
  const header = sectionLines.find((l) => /^\|\s*Gate\s*\|/.test(l)) ?? null;
  const rows = sectionLines
    .filter((l) => /^\|\s*`[^`]+`/.test(l))
    .map((row) => {
      const cells = row.split('|').map((c) => c.trim());
      return {
        command: (cells[1] ?? '').replace(/^`|`$/g, ''),
        requires: (cells[2] ?? '').trim(),
      };
    });
  return { header, rows };
}

/**
 * Cross-check the §4 gate rows' Requires cells against verify-all.mjs's
 * `secrets` arrays. Returns an array of failure strings — empty means every
 * row carries a Requires cell whose secret names exactly match the runner.
 *
 * @param {{ rows: Array<{ command: string, requires: string }>, header: string | null, verifyAllSrc: string, npmScripts: Record<string, string> }} args
 */
export function crossCheckVerifyAllSecrets({ rows, header, verifyAllSrc, npmScripts }) {
  const failures = [];
  if (!header) {
    failures.push('docs/launch.md §4 has no "| Gate | … |" table header — the Requires column cannot be verified.');
  }
  if (header && !/^\|\s*Gate\s*\|\s*Requires\s*\|/.test(header)) {
    failures.push('docs/launch.md §4 table header is missing the "Requires" column — add it so every gate row carries its secrets requirement.');
  }

  const parsed = parseVerifyAllGates(verifyAllSrc);
  if (parsed.error) {
    failures.push(parsed.error);
    return failures;
  }
  const { entries } = parsed;
  const secretsByGate = new Map(entries.map((e) => [e.name, e.secrets]));

  const { results, failures: resolveFailures } = resolveDocCommands(
    rows.map((r) => r.command),
    entries,
    npmScripts,
  );
  failures.push(...resolveFailures);

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    // Row-aligned: results[i] corresponds to rows[i] even when a row failed
    // to resolve (gate null), so a mid-table resolution failure can never
    // shift a later row onto the wrong gate's secrets.
    const gate = results[i]?.gate;
    if (!gate) continue; // resolution already reported above
    const runnerSecrets = secretsByGate.get(gate) ?? [];
    const docSecrets = [...String(row.requires).matchAll(SECRET_NAME_RE)].map((m) => m[1]);

    // Every gate row must carry a secrets requirement. A blank cell is a
    // silent drop even when the runner declares no secrets (the doc must say
    // — instead), so a future column-removal edit fails loudly here.
    if (!row.requires) {
      failures.push(`"${row.command}" (gate ${gate}) — §4 row has an EMPTY Requires cell; declare the secrets (or — if none are needed).`);
      continue;
    }

    const missing = runnerSecrets.filter((s) => !docSecrets.includes(s));
    const extra = docSecrets.filter((s) => !runnerSecrets.includes(s));
    if (missing.length > 0) {
      failures.push(`"${row.command}" (gate ${gate}) — Requires cell omits secret(s) the runner declares: ${missing.join(', ')}`);
    }
    if (extra.length > 0) {
      failures.push(`"${row.command}" (gate ${gate}) — Requires cell lists secret(s) the runner does not declare: ${extra.join(', ')}`);
    }
  }

  return failures;
}

// CI steps we cross-check: the post-deploy verify jobs that gate verify
// scripts on GitHub secrets. (The validate/verify-launch-checklist jobs run
// no gated verify scripts, so they are not part of this contract.)
const CI_VERIFY_JOBS = new Set(['verify-deployed', 'verify-auth-domains', 'verify-prod-signin']);
// A step's `if:` gating: `env.<SECRET> != ''` (multiple may be AND-ed).
const CI_GATING_RE = /env\.([A-Z][A-Z0-9_]*)\s*!=\s*''/g;
// A step that runs a gate script: `run: node scripts/verify-<name>.mjs`.
const CI_RUN_RE = /^        run:\s*node scripts\/(verify-[\w-]+\.mjs)\s*$/;

/**
 * Parse ci.yml's post-deploy verify jobs into their gated gate steps.
 * Returns `[{ job, name, run, gatingSecrets }]` — one entry per step whose
 * `run:` invokes a `node scripts/verify-*.mjs` gate script, with the secret
 * names extracted from its `if: ${{ env.X != '' }}` gating. Pure: reads
 * nothing itself.
 *
 * @param {string} ciSrc
 */
export function parseCiGateSteps(ciSrc) {
  const lines = ciSrc.split('\n');
  const steps = [];
  let job = null;
  let current = null;
  for (const line of lines) {
    const jobMatch = line.match(/^  ([\w-]+):\s*$/);
    if (jobMatch) {
      job = jobMatch[1];
      continue;
    }
    const stepMatch = line.match(/^      - name:\s*(.*)$/);
    if (stepMatch) {
      current = { job, name: stepMatch[1].trim(), ifCondition: '', run: '' };
      steps.push(current);
      continue;
    }
    if (!current) continue;
    const ifMatch = line.match(/^        if:\s*(.*)$/);
    if (ifMatch) current.ifCondition = ifMatch[1];
    const runMatch = line.match(CI_RUN_RE);
    if (runMatch) current.run = runMatch[1];
  }
  return steps
    .filter((s) => CI_VERIFY_JOBS.has(s.job) && /^verify-[\w-]+\.mjs$/.test(s.run))
    .map((s) => ({
      job: s.job,
      name: s.name,
      run: s.run,
      gatingSecrets: [...s.ifCondition.matchAll(CI_GATING_RE)].map((m) => m[1]),
    }));
}

/**
 * Cross-check ci.yml's gated verify steps against verify-all.mjs's `secrets`
 * arrays. Returns an array of failure strings — empty means every CI verify
 * step is gated on secrets the runner declares for its gate (and no gate with
 * declared secrets is run ungated).
 *
 * @param {{ ciSrc: string, verifyAllSrc: string, npmScripts: Record<string, string> }} args
 */
export function crossCheckCiGates({ ciSrc, verifyAllSrc, npmScripts }) {
  const failures = [];
  const parsed = parseVerifyAllGates(verifyAllSrc);
  if (parsed.error) return [parsed.error];
  const { entries } = parsed;
  const secretsByGate = new Map(entries.map((e) => [e.name, e.secrets]));

  const steps = parseCiGateSteps(ciSrc);
  const { results, failures: resolveFailures } = resolveDocCommands(
    steps.map((s) => `node scripts/${s.run}`),
    entries,
    npmScripts,
  );
  failures.push(...resolveFailures);

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    // Row-aligned: results[i] corresponds to steps[i] even when a step failed
    // to resolve (gate null) — a mid-list failure can never shift a later
    // step onto the wrong gate's secrets.
    const gate = results[i]?.gate;
    if (!gate) continue; // resolution already reported above
    const runnerSecrets = secretsByGate.get(gate) ?? [];
    const gated = step.gatingSecrets;

    if (runnerSecrets.length > 0 && gated.length === 0) {
      failures.push(
        `CI step "${step.name}" (${step.job}) runs ${step.run} with NO secret-gating if-condition, `
        + `but verify-all.mjs declares secrets [${runnerSecrets.join(', ')}] for gate ${gate}.`,
      );
      continue;
    }
    for (const s of gated) {
      if (!runnerSecrets.includes(s)) {
        failures.push(
          `CI step "${step.name}" (${step.job}) gates on ${s}, `
          + `but verify-all.mjs declares secrets [${runnerSecrets.join(', ')}] for gate ${gate}.`,
        );
      }
    }
  }

  return failures;
}

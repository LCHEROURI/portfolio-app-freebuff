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
// This module closes that gap with five pure cross-checks (no file I/O, no
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
//     a step gated on a secret the runner never declared fails, a step that
//     runs UNGATED while its gate declares secrets fails, and (the reverse
//     contract, mirroring the deployment-status workflows) a gate that
//     declares a secret no ci.yml step of that gate gates on fails too — so
//     the doc, the runner, and CI can never disagree about what a gate needs.
//   crossCheckDeploymentStatusGates — the same credential contract for the
//     deployment_status workflows (gallery / preview-gate / deployed-hash):
//     each workflow is mapped to the gate whose credentials it consumes, and
//     every secret its steps gate on must be declared by that gate (with
//     workflow-plumbing secrets like VERCEL_ORG_ID / VERCEL_PROTECTION_BYPASS
//     exempt), and every secret the mapped gate declares must actually be
//     gated somewhere in the workflow. crossCheckCiGates runs this when its
//     optional deploymentStatusWorkflows argument is supplied.
//   crossCheckPipelineDiagrams  — asserts BOTH onboarding docs (README.md's
//     handoff section and docs/launch.md §4) still carry the "When each gate
//     runs:" pipeline-diagram section — the marker line AND a non-empty
//     fenced diagram body after it that names every PIPELINE_DIAGRAM_KEY_NAMES
//     entry — so the picture itself is contract-locked in CI, not just in the
//     vitest suite that asserts its content.
//   crossCheckSystemInjectedVars — asserts verify-vercel-env.mjs's
//     SYSTEM_INJECTED_VARS exemption matches the canonical Vercel
//     system-injected build-var set EXACTLY (a var dropped, added, or typo'd
//     fails), never exempts a real project var (VERCEL_TOKEN, VERCEL_TEAM_ID
//     share the prefix but must stay value-compared), and that the §4
//     vercel-env row documents the exemption — so the gate's
//     secrets/expectations contract covers the pull-format handling, not just
//     the credentials.
//
// The gate checks share one GATES parser and one command→gate resolver, so
// the name, doc-secrets, CI-gating, and deployment-status checks can never
// disagree about what a gate is. The diagram-presence and system-injected
// checks are independent of both (they parse no gate source at all).
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
// The pipeline-diagram lead-in, matched line-anchored (mirrors
// scripts/readme-pipeline.test.ts's parser) so a future prose mention of the
// phrase can't be mistaken for the section.
const PIPELINE_DIAGRAM_MARKER_RE = /^When each gate runs/m;
// The key job/workflow display names that MUST appear in BOTH onboarding
// docs' "When each gate runs:" diagrams — the five ci.yml push jobs and the
// three deployment_status workflows. Exported as the source of truth: the
// diagram-content vitest and the runtime drift-guard check iterate this same
// list, so guard and test can never disagree about which names constitute
// the picture. (The diagram may render a name with extra context, e.g.
// "Verify deployed cron reports + rules (secret-gated)" — containment of the
// base name is what matters.)
export const PIPELINE_DIAGRAM_KEY_NAMES = [
  'Typecheck · Lint · Test · Build',
  'Verify launch checklist matches scripts',
  'Verify deployed cron reports + rules',
  'Verify authorized domains',
  'Verify production sign-in + Firestore sync',
  'Gallery',
];
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

// Secrets that are workflow PLUMBING, not gate requirements: the Vercel
// org/project scoping, the deployment protection-bypass header, and the
// Firebase service-account admin credential exist so a workflow can reach
// its platform at all. They are not per-gate credentials verify-all.mjs
// declares, so the deployment-status check exempts them from the
// declared-secret rule.
const INFRA_SECRETS = new Set([
  'VERCEL_ORG_ID',
  'VERCEL_PROJECT_ID',
  'VERCEL_PROTECTION_BYPASS',
  'VERCEL_TEAM_ID',
  'FIREBASE_SERVICE_ACCOUNT',
]);

// Scripts that are CI-ONLY ENFORCEMENT wrappers, not verify-all gates: they
// exist to machine-prove a gate's behavior on the runner (e.g. the
// gate-stale teeth wrapper, which re-runs the teeth proofs after each
// deploy) and deliberately have no launch-checklist row. Their secret
// contract falls back to the workflow's mapped gate — the same fallback
// steps that run no gate script get. The list is explicit ON PURPOSE: a new
// unmapped script that is NOT listed here still fails the
// "maps to no gate" check, so enforcement wrappers can never sneak in
// silently.
const CI_ENFORCEMENT_SCRIPTS = new Set(['verify-gate-stale-ci.mjs']);

/**
 * Parse a non-ci gated workflow (gallery.yml) into its gated steps. Unlike ci.yml's verify
 * jobs, these workflows invoke their gate scripts in block-scalar `run: |`
 * bodies (the script line is indented BELOW the `run:` key), so the parser
 * scans the block for `node scripts/verify-*.mjs` and captures every step's
 * `if:` env-gating. Returns `[{ name, run, gatingSecrets }]` — one entry per
 * step with a non-empty `if:` condition (`run` is '' for steps that run no
 * gate script, e.g. checkout / vercel CLI / capture). Pure: reads nothing
 * itself.
 *
 * @param {string} src
 */
export function parseDeploymentStatusSteps(src) {
  const lines = src.split('\n');
  const steps = [];
  let current = null;
  let inRunBlock = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const stepMatch = line.match(/^      - name:\s*(.*)$/);
    if (stepMatch) {
      current = { name: stepMatch[1].trim(), ifCondition: '', run: '' };
      steps.push(current);
      inRunBlock = false;
      continue;
    }
    if (!current) continue;
    const ifMatch = line.match(/^        if:\s*(.*)$/);
    if (ifMatch) {
      current.ifCondition = ifMatch[1];
      inRunBlock = false;
      continue;
    }
    const runMatch = line.match(/^        run:\s*(.*)$/);
    if (runMatch) {
      // A block scalar (`run: |`) means the command sits on the indented
      // lines below; an inline `run: node scripts/X.mjs` matches directly.
      inRunBlock = runMatch[1] === '|';
      if (!inRunBlock) {
        const m = runMatch[1].match(/node scripts\/(verify-[\w-]+\.mjs)/);
        if (m) current.run = m[1];
      }
      continue;
    }
    if (inRunBlock) {
      // Block-scalar content is indented ≥10 spaces (deeper than the 8-space
      // step keys); blank lines continue the block. Anything else ends it.
      if (/^\s{10,}/.test(line) || line.trim() === '') {
        const m = line.match(/node scripts\/(verify-[\w-]+\.mjs)/);
        if (m) current.run = m[1];
        continue;
      }
      inRunBlock = false;
    }
  }
  return steps
    .filter((s) => s.ifCondition.length > 0)
    .map((s) => ({
      name: s.name,
      run: s.run,
      gatingSecrets: [...s.ifCondition.matchAll(CI_GATING_RE)].map((m) => m[1]),
    }));
}

/**
 * Cross-check the deployment_status workflows (gallery / preview-gate /
 * deployed-hash) against verify-all.mjs's `secrets` arrays. Each workflow is
 * mapped to the gate whose credentials it exercises; every secret the mapped
 * gate declares must actually be gated somewhere in the workflow, and every
 * gated secret must be declared by the gate the step runs (resolved) or by
 * the workflow's mapped gate — workflow-plumbing secrets (Vercel org/project
 * scoping, protection bypass, service account) are exempt. Returns an array
 * of failure strings — empty means every deployment_status workflow gates on
 * secrets the runner declares for its gate.
 *
 * @param {{ workflows: Array<{ name: string, gate: string, src: string }>, verifyAllSrc: string, npmScripts: Record<string, string> }} args
 */
export function crossCheckDeploymentStatusGates({ workflows, verifyAllSrc, npmScripts }) {
  const failures = [];
  const parsed = parseVerifyAllGates(verifyAllSrc);
  if (parsed.error) return [parsed.error];
  const { entries } = parsed;
  const secretsByGate = new Map(entries.map((e) => [e.name, e.secrets]));

  for (const wf of workflows) {
    const { name: wfName, gate: mappedGate, src } = wf;
    const mappedSecrets = secretsByGate.get(mappedGate);
    if (!mappedSecrets) {
      failures.push(`deployment_status workflow "${wfName}" maps to gate "${mappedGate}" which verify-all.mjs does not declare.`);
      continue;
    }
    const steps = parseDeploymentStatusSteps(src);

    // Reverse contract: every secret the mapped gate declares must actually
    // be gated somewhere in the workflow — a workflow that stops gating the
    // credential its gate needs fails instead of silently running ungated.
    const gatedEverywhere = new Set();
    for (const s of steps) for (const g of s.gatingSecrets) gatedEverywhere.add(g);
    for (const s of mappedSecrets) {
      if (!gatedEverywhere.has(s)) {
        failures.push(
          `deployment_status workflow "${wfName}" (gate ${mappedGate}) never gates on ${s} — add it to a step's if-condition.`,
        );
      }
    }

    // Forward contract per step: every gated secret must be declared by the
    // gate the step's script resolves to (verify scripts), or by the
    // workflow's mapped gate (vercel/capture steps run no gate script).
    for (const step of steps) {
      let gate = mappedGate;
      if (step.run) {
        if (CI_ENFORCEMENT_SCRIPTS.has(step.run)) {
          // CI-enforcement wrapper: not a gate script — its secrets resolve
          // to the workflow's mapped gate (explicit allowlist above).
        } else {
          const resolved = resolveDocCommands([`node scripts/${step.run}`], entries, npmScripts);
          failures.push(...resolved.failures);
          if (resolved.results[0]?.gate) gate = resolved.results[0].gate;
        }
      }
      const runnerSecrets = secretsByGate.get(gate) ?? [];
      for (const s of step.gatingSecrets) {
        if (INFRA_SECRETS.has(s)) continue;
        if (!runnerSecrets.includes(s)) {
          failures.push(
            `deployment_status step "${step.name}" (${wfName}) gates on ${s}, `
            + `but the ${gate} gate declares [${runnerSecrets.join(', ')}].`,
          );
        }
      }
    }
  }

  return failures;
}

/**
 * Cross-check that both onboarding docs still carry the "When each gate
 * runs:" pipeline-diagram section. Returns an array of failure strings —
 * empty means every doc has the marker line AND a non-empty fenced diagram
 * body after it that names every PIPELINE_DIAGRAM_KEY_NAMES entry. A doc that
 * loses the marker, keeps the marker but drops the fence, leaves an
 * empty/unterminated fenced body, or omits a key job/workflow name fails, so
 * the picture itself is contract-locked in CI — not just asserted by the
 * readme-pipeline vitest that checks the diagram's content. Pure: reads
 * nothing itself.
 *
 * @param {{ readmeSrc: string, launchSrc: string }} args
 */
export function crossCheckPipelineDiagrams({ readmeSrc, launchSrc }) {
  const failures = [];
  const docs = [
    { label: 'README.md', src: readmeSrc },
    { label: 'docs/launch.md', src: launchSrc },
  ];
  for (const { label, src } of docs) {
    const marker = src.search(PIPELINE_DIAGRAM_MARKER_RE);
    if (marker === -1) {
      failures.push(
        `${label} lost the "When each gate runs:" pipeline-diagram section — restore it so the onboarding docs keep the verification-pipeline picture.`,
      );
      continue;
    }
    // The FIRST fence after the marker is treated as the diagram's opening
    // fence — the same first-fence convention scripts/readme-pipeline.test.ts
    // uses, so the presence guard and the content contract can never disagree
    // about which block is the picture. Fences before the marker are ignored
    // because the search starts at the marker index.
    const fenceStart = src.indexOf('```', marker);
    if (fenceStart === -1) {
      failures.push(
        `${label} has the "When each gate runs:" lead-in but no diagram code fence — restore the fenced picture.`,
      );
      continue;
    }
    // The body starts after the opening fence LINE (the fence may carry a
    // language tag, e.g. ```text, which must not count as diagram content).
    const lineEnd = src.indexOf('\n', fenceStart);
    const bodyStart = lineEnd === -1 ? fenceStart + 3 : lineEnd + 1;
    const fenceEnd = src.indexOf('```', bodyStart);
    if (fenceEnd === -1 || src.slice(bodyStart, fenceEnd).trim() === '') {
      failures.push(
        `${label} has an empty or unterminated diagram after "When each gate runs:" — restore the fenced picture.`,
      );
      continue;
    }
    // Every key job/workflow name must appear in the picture — the same
    // phrase contract the system-injected cross-check applies to the
    // vercel-env rows, so a diagram that loses or renames a gate fails the
    // drift guard before the unit suite even runs.
    const body = normalizeWhitespace(src.slice(bodyStart, fenceEnd));
    for (const name of PIPELINE_DIAGRAM_KEY_NAMES) {
      if (!body.includes(normalizeWhitespace(name))) {
        failures.push(
          `${label} "When each gate runs:" diagram omits the key name "${name}" — update the picture so the onboarding docs keep naming every gate.`,
        );
      }
    }
  }
  return failures;
}

/** Collapse every whitespace run (including newlines) to a single space. */
function normalizeWhitespace(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

// The canonical Vercel system-injected build-var set — the source of truth
// for verify-vercel-env.mjs's SYSTEM_INJECTED_VARS exemption. `vercel env
// pull` writes these alongside the project env (OIDC token, deploy URL, git
// metadata, env labels) with values that ROTATE every build/deploy/commit, so
// the gate exempts exactly this set from the drift diff and surfaces it
// informationally. Real project vars that merely share the prefix
// (VERCEL_TOKEN, VERCEL_TEAM_ID) are deliberately NOT exempt and must never
// appear here. Kept in lockstep with the Set literal in verify-vercel-env.mjs
// by crossCheckSystemInjectedVars below — a one-sided change fails the drift
// guard, not just the unit suite.
export const CANONICAL_SYSTEM_INJECTED_VARS = new Set([
  'VERCEL',
  'VERCEL_ENV',
  'VERCEL_GIT_COMMIT_AUTHOR_LOGIN',
  'VERCEL_GIT_COMMIT_AUTHOR_NAME',
  'VERCEL_GIT_COMMIT_MESSAGE',
  'VERCEL_GIT_COMMIT_REF',
  'VERCEL_GIT_COMMIT_SHA',
  'VERCEL_GIT_PREVIOUS_SHA',
  'VERCEL_GIT_PROVIDER',
  'VERCEL_GIT_PULL_REQUEST_ID',
  'VERCEL_GIT_REPO_ID',
  'VERCEL_GIT_REPO_OWNER',
  'VERCEL_GIT_REPO_SLUG',
  'VERCEL_OIDC_TOKEN',
  'VERCEL_TARGET_ENV',
  'VERCEL_URL',
]);

// The SYSTEM_INJECTED_VARS literal: `const SYSTEM_INJECTED_VARS = new Set([...]);`
const SYSTEM_INJECTED_VARS_RE = /const SYSTEM_INJECTED_VARS = new Set\(\[([^\]]*)\]\);/;
// Real project vars that share the VERCEL_ prefix and must never be exempted.
const REAL_VERCEL_PROJECT_VARS = ['VERCEL_TOKEN', 'VERCEL_TEAM_ID'];
// The vercel-env rows in BOTH onboarding docs must tell the same exemption
// story in plain words: every phrase below must appear in each row, so a doc
// that keeps the /system-injected/i marker while softening the rest of the
// contract fails. Exported as the source of truth — the wording-parity unit
// test iterates this same list, so guard and test can never drift.
export const SYSTEM_INJECTED_WORDING_PHRASES = [
  'system-injected',
  'VERCEL_OIDC_TOKEN',
  'real project vars',
  'stay value-compared',
];

/**
 * Find a §4 gate-table row by its backticked command, bounded to the
 * verification-gates section (a matching table added later in the doc can
 * never be misread as the gate row). Returns the full row text or null.
 * Pure: reads nothing itself.
 */
function findLaunchRow(doc, command) {
  const lines = String(doc ?? '').split('\n');
  const startIdx = lines.findIndex((l) => /^## \d+\. The verification gates/.test(l.trim()));
  if (startIdx < 0) return null;
  const nextSection = lines.slice(startIdx + 1).findIndex((l) => /^## /.test(l));
  const sectionLines = nextSection >= 0
    ? lines.slice(startIdx + 1, startIdx + 1 + nextSection)
    : lines.slice(startIdx + 1);
  return sectionLines.find((l) => l.includes(`\`${command}\``)) ?? null;
}

/**
 * Cross-check verify-vercel-env.mjs's SYSTEM_INJECTED_VARS exemption against
 * the canonical Vercel system-injected build-var list AND the §4 doc row.
 * Returns an array of failure strings — empty means the gate's
 * expectations contract holds:
 *   - the Set literal exists and matches the canonical set EXACTLY (a var
 *     dropped, added, or typo'd fails — the same bidirectional lock the unit
 *     suite applies to the exported set, enforced here from source);
 *   - no real project var (VERCEL_TOKEN, VERCEL_TEAM_ID) is exempted — they
 *     share the prefix but must stay value-compared;
 *   - docs/launch.md §4's vercel-env row AND the README handoff gate-table
 *     row both carry every SYSTEM_INJECTED_WORDING_PHRASES phrase, so neither
 *     onboarding surface can silently lose the note or soften the contract.
 * Pure: reads nothing itself.
 *
 * @param {{ vercelEnvSrc: string, launchDoc: string, readmeDoc: string }} args
 */
export function crossCheckSystemInjectedVars({ vercelEnvSrc, launchDoc, readmeDoc }) {
  const failures = [];
  const match = String(vercelEnvSrc ?? '').match(SYSTEM_INJECTED_VARS_RE);
  if (!match) {
    failures.push('verify-vercel-env.mjs has no SYSTEM_INJECTED_VARS Set literal — a rename or restructure broke the exemption.');
    return failures;
  }
  const declared = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const canonical = [...CANONICAL_SYSTEM_INJECTED_VARS];

  const missing = canonical.filter((k) => !declared.includes(k));
  const extra = declared.filter((k) => !canonical.includes(k));
  if (missing.length > 0) {
    failures.push(`verify-vercel-env.mjs SYSTEM_INJECTED_VARS omits canonical system-injected var(s): ${missing.join(', ')}`);
  }
  if (extra.length > 0) {
    failures.push(`verify-vercel-env.mjs SYSTEM_INJECTED_VARS declares non-canonical var(s): ${extra.join(', ')}`);
  }

  for (const real of REAL_VERCEL_PROJECT_VARS) {
    if (declared.includes(real)) {
      failures.push(
        `verify-vercel-env.mjs SYSTEM_INJECTED_VARS exempts ${real} — a real project var that must stay value-compared. Remove it from the set.`,
      );
    }
  }

  const row = findLaunchRow(launchDoc, 'npm run verify:vercel-env');
  if (!row) {
    failures.push('docs/launch.md §4 has no vercel-env gate row — the system-injected exemption cannot be documented.');
  } else {
    checkExemptionWording('docs/launch.md §4', row, failures);
  }

  // The README handoff gate table must document the same exemption, so both
  // onboarding surfaces stay in lockstep — a note added to one doc alone is
  // not enough.
  const readmeRow = findReadmeGateRow(readmeDoc, 'vercel-env');
  if (!readmeRow) {
    failures.push('README handoff gate table has no vercel-env row — the system-injected exemption cannot be documented.');
  } else {
    checkExemptionWording('README handoff', readmeRow, failures);
  }

  return failures;
}

/**
 * Assert a vercel-env row carries every SYSTEM_INJECTED_WORDING_PHRASES
 * phrase, pushing one failure per missing phrase (naming the doc and the
 * exact phrase, so the fix is self-explanatory). Pure: reads nothing itself.
 */
function checkExemptionWording(docLabel, row, failures) {
  for (const phrase of SYSTEM_INJECTED_WORDING_PHRASES) {
    if (!row.includes(phrase)) {
      failures.push(
        `${docLabel} vercel-env row omits the exemption phrase "${phrase}" — add the note so the doc and the gate agree.`,
      );
    }
  }
}

/**
 * Find a README handoff gate-table row by its leading gate name (the README
 * table keys rows by bare gate name, unlike launch.md's backticked commands),
 * bounded to the verification-gates section (a matching row in a later
 * section can never be misread as the gate row). Returns the full row text
 * or null. Pure: reads nothing itself.
 */
function findReadmeGateRow(readmeDoc, gateName) {
  const lines = String(readmeDoc ?? '').split('\n');
  const startIdx = lines.findIndex((l) => /^### The \d+ verification gates/.test(l.trim()));
  if (startIdx < 0) return null;
  const nextSection = lines.slice(startIdx + 1).findIndex((l) => /^#{1,6} /.test(l));
  const sectionLines = nextSection >= 0
    ? lines.slice(startIdx + 1, startIdx + 1 + nextSection)
    : lines.slice(startIdx + 1);
  return sectionLines.find((l) => l.startsWith(`| ${gateName} |`)) ?? null;
}

/**
 * Cross-check ci.yml's gated verify steps AND the deployment_status
 * workflows against verify-all.mjs's `secrets` arrays. Returns an array of
 * failure strings — empty means every CI verify step is gated on secrets the
 * runner declares for its gate (no gate with declared secrets runs ungated),
 * every secret a gate ci.yml exercises declares is gated by at least one
 * step of that gate (the reverse contract), and every deployment_status
 * workflow gates on the secrets its mapped gate declares.
 *
 * @param {{ ciSrc: string, verifyAllSrc: string, npmScripts: Record<string, string>, deploymentStatusWorkflows?: Array<{ name: string, gate: string, src: string }> }} args
 */
export function crossCheckCiGates({ ciSrc, verifyAllSrc, npmScripts, deploymentStatusWorkflows = [] }) {
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

  // Reverse contract (ci.yml): every secret a gate ci.yml EXERCISES declares
  // must actually be gated in at least one ci.yml step that resolves to that
  // gate. The forward loop above proves each step's gating is declared by its
  // own gate; this proves the other direction — a gate that declares secrets
  // must not run them ungated in CI, and a secret gated only by a DIFFERENT
  // gate's step counts as ungated for its own gate (mirroring
  // crossCheckDeploymentStatusGates's reverse contract). Public NEXT_PUBLIC_*
  // build vars are exempt: they are public constants set as literals in step
  // env (never GitHub secrets), so gating on them is meaningless. Note the
  // exemption asymmetry by design: ci.yml's reverse exempts NEXT_PUBLIC_*
  // (public build vars), while the deployment-status forward exempts
  // INFRA_SECRETS (workflow plumbing) — no gate declares an INFRA secret
  // today, so the two exemption sets never overlap. Gates ci.yml never
  // exercises (e.g. deployed-hash, which fires on deployment_status, or
  // local-only gates) are not checked — ci.yml has no step for them to gate.
  const gatedByGate = new Map();
  for (let i = 0; i < steps.length; i += 1) {
    const gate = results[i]?.gate;
    if (!gate) continue; // resolution already reported above
    const set = gatedByGate.get(gate) ?? new Set();
    for (const g of steps[i].gatingSecrets) set.add(g);
    gatedByGate.set(gate, set);
  }
  for (const [gate, gated] of gatedByGate) {
    for (const s of secretsByGate.get(gate) ?? []) {
      if (s.startsWith('NEXT_PUBLIC_')) continue; // public build var, not a secret
      if (!gated.has(s)) {
        failures.push(
          `gate ${gate} declares ${s} but NO ci.yml step of that gate gates on it — add it to a step's if-condition.`,
        );
      }
    }
  }

  // deployment_status workflows: the gallery / preview-gate / deployed-hash
  // workflows fire on Vercel's deployment_status event (NOT on push like the
  // ci.yml jobs), so they are invisible to the ci.yml step parser above. The
  // same credential contract applies — each workflow gates on the secrets the
  // gate it exercises declares.
  if (deploymentStatusWorkflows.length > 0) {
    failures.push(...crossCheckDeploymentStatusGates({ workflows: deploymentStatusWorkflows, verifyAllSrc, npmScripts }));
  }

  return failures;
}

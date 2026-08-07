// ============================================================================
// scripts/launch-checklist-gates.mjs — pure gate-name cross-check.
//
// The launch-checklist drift guard (verify-launch-checklist.mjs) proves every
// §4 gate command is runnable from package.json. That is one source of truth;
// scripts/verify-all.mjs's GATE_NAMES / GATES arrays are the other — the
// one-command runner that actually EXECUTES the checklist. If a gate is
// renamed, dropped, or added in verify-all.mjs without a matching §4 change,
// the doc and package.json can stay perfectly runnable while the runner and
// the checklist disagree about what exists.
//
// This module closes that gap: it resolves each §4 command to the gate name
// verify-all.mjs uses for it and asserts the two name sets are identical.
// Pure (no file I/O, no network, no secrets): it takes the parsed §4
// commands, the raw verify-all.mjs source, and package.json scripts as
// arguments and returns an array of human-readable failure strings (empty =
// consistent). Imported by the drift guard and unit-tested directly.
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
// A script target: `node scripts/<file>.mjs` inside a package.json value.
const SCRIPT_TARGET_RE = /scripts\/[\w./-]+\.(mjs|ts|js|sh|cjs)\b/;
// §4 command forms (tolerate trailing args on npm gates).
const NPM_CMD_RE = /^npm run (verify:[^\s]+)/;
const NODE_CMD_RE = /^node (scripts\/[\w./-]+\.mjs)/;

/**
 * Cross-check the §4 gate commands against verify-all.mjs's gate names.
 * Returns an array of failure strings — empty means the doc's gates exactly
 * match the runner's gate names (same set, same count).
 *
 * @param {{ docCommands: string[], verifyAllSrc: string, npmScripts: Record<string, string>, expectedCount: number }} args
 */
export function crossCheckVerifyAllGates({ docCommands, verifyAllSrc, npmScripts, expectedCount }) {
  const failures = [];

  // 1. Parse the runner's source of truth.
  const namesMatch = verifyAllSrc.match(GATE_NAMES_RE);
  if (!namesMatch) {
    return ['verify-all.mjs has no GATE_NAMES array — a rename or restructure broke the runner.'];
  }
  const verifyAllNames = [...namesMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

  const gatesMatch = verifyAllSrc.match(GATES_RE);
  if (!gatesMatch) {
    return ['verify-all.mjs has no GATES array — a rename or restructure broke the runner.'];
  }
  const gatesBody = gatesMatch[1];

  // 2. Build script-name → gate-name and file → gate-name maps from GATES.
  const scriptToGate = new Map();
  const fileToGate = new Map();
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
    const script = seg.match(SCRIPT_RE)?.[1];
    const file = seg.match(FILE_RE)?.[1];
    if (script) scriptToGate.set(script, nameSpans[i].name);
    if (file) fileToGate.set(file, nameSpans[i].name);
  }

  // 3. Resolve `node scripts/Y.mjs` commands that are aliased by an npm script
  //    (the runner's GATES entry for those gates has `script:`, not `file:`).
  //    fileToGate takes precedence so auth-domains-direct (a file-based gate)
  //    wins over auth-domains (whose script targets the same file).
  const fileToGateViaScript = new Map();
  for (const [scriptName, gateName] of scriptToGate) {
    const target = String(npmScripts[scriptName] ?? '').match(SCRIPT_TARGET_RE)?.[0];
    if (target) fileToGateViaScript.set(target, gateName);
  }

  // 4. Resolve every §4 command to a gate name.
  const docNames = [];
  for (const cmd of docCommands) {
    const npm = cmd.match(NPM_CMD_RE);
    if (npm) {
      docNames.push(npm[1].replace(/^verify:/, ''));
      continue;
    }
    const node = cmd.match(NODE_CMD_RE);
    if (node) {
      const file = node[1];
      const gate = fileToGate.get(file) ?? fileToGateViaScript.get(file);
      if (!gate) {
        failures.push(`"${cmd}" — file "${file}" maps to no gate in verify-all.mjs.`);
        continue;
      }
      docNames.push(gate);
      continue;
    }
    // Unsupported command forms are already rejected by the runnable check in
    // verify-launch-checklist.mjs — nothing to resolve here.
  }

  // 5. Count and exact-set assertions.
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

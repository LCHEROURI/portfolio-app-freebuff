#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$ROOT" ]; then
  echo "FAIL: not inside a Git repository" >&2
  exit 1
fi
cd "$ROOT"

required_files=(
  "AGENTS.md"
  "WORKFLOW.md"
  "skills/progressive-distillation/SKILL.md"
)
for path in "${required_files[@]}"; do
  if [ ! -f "$path" ]; then
    echo "FAIL: missing required bootstrap file: $ROOT/$path" >&2
    exit 1
  fi
done

# The check intentionally validates safety markers rather than byte-for-byte
# equality: project repositories may add stricter local rules to AGENTS.md.
# Identity-lock markers must be in AGENTS.md itself; otherwise a misleading
# project-specific AGENTS.md could pass by relying on a separate document.
agents_markers=(
  "git rev-parse --show-toplevel"
  "Repository lock"
  "WORKFLOW.md"
)
for marker in "${agents_markers[@]}"; do
  if ! grep -Fiq "$marker" AGENTS.md; then
    echo "FAIL: AGENTS.md is missing universal safety marker: $marker" >&2
    exit 1
  fi
done

workflow_markers=("commit" "push" "merge")
for marker in "${workflow_markers[@]}"; do
  if ! grep -Fiq "$marker" WORKFLOW.md; then
    echo "FAIL: WORKFLOW.md is missing authorization marker: $marker" >&2
    exit 1
  fi
done

if ! grep -Fq "Experience → Reflection → Principle → Experiment → Save" \
  skills/progressive-distillation/SKILL.md; then
  echo "FAIL: Progressive Distillation skill is not the expected bootstrap skill" >&2
  exit 1
fi

echo "PASS: universal bootstrap verified at $ROOT"

#!/usr/bin/env bash
# Remind the agent to refresh README/CHANGELOG before commit or push
# when there are user-facing code changes without matching doc updates.
set -euo pipefail

input=$(cat)
command=$(printf '%s' "$input" | jq -r '.command // empty')

allow() {
  echo '{ "permission": "allow" }'
  exit 0
}

# Only care about commit / push (matcher should already filter, but be safe).
if ! printf '%s' "$command" | grep -Eq '(^|[[:space:];|&])git[[:space:]]+(commit|push)([[:space:]]|$)'; then
  allow
fi

# If docs are already part of this commit's index, allow.
if git diff --cached --name-only 2>/dev/null | grep -Eq '^(README\.md|CHANGELOG\.md)$'; then
  allow
fi

# Working-tree doc edits that aren't staged yet still count as "in progress".
if git status --porcelain -- README.md CHANGELOG.md 2>/dev/null | grep -q .; then
  allow
fi

# Any non-doc code change in the index or working tree?
code_changes=$(
  git status --porcelain 2>/dev/null \
    | awk '{print $2}' \
    | grep -Ev '^(README\.md|CHANGELOG\.md|\.cursor/)' \
    | head -n 1 || true
)

if [[ -z "${code_changes}" ]]; then
  allow
fi

jq -n \
  --arg msg "About to commit or push without README/CHANGELOG updates. Always bump the minor (.x+1), e.g. 3.5.0 → 3.6.0; set README Version X.Y; move Unreleased notes into that section; stage both files; then retry. Major bumps are manual only." \
  '{permission: "ask", agent_message: $msg, user_message: "Bump .x+1 and update README/CHANGELOG before commit/push?"}'
exit 0

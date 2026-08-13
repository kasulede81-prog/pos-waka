#!/usr/bin/env bash
# Set DEEPSEEK_API_KEY on the WAKA POS staging project only.
# Usage:
#   export DEEPSEEK_API_KEY='...'
#   ./scripts/staging/set_staging_deepseek_secret.sh
set -euo pipefail
STAGING_REF="${STAGING_PROJECT_REF:-wdirxwvbgsfzbdurmkbf}"
PROD_REF="ljaedextsenbkxzzgxcg"

if [[ "$STAGING_REF" == "$PROD_REF" ]]; then
  echo "Refusing: staging ref equals production" >&2
  exit 1
fi
if [[ -z "${DEEPSEEK_API_KEY:-}" ]]; then
  echo "Set DEEPSEEK_API_KEY in the environment first (value will not be printed)." >&2
  exit 1
fi

supabase secrets set "DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}" --project-ref "$STAGING_REF"
echo "DEEPSEEK_API_KEY set on staging project ${STAGING_REF}"

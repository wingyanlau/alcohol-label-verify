#!/usr/bin/env bash
#
# Re-provision the STAGING record store.
#
# ---------------------------------------------------------------------------
# THIS IS NOT AN EDIT OF AN AUDIT TRAIL, AND THE DIFFERENCE IS THE WHOLE POINT
#
# `audit_event` and `policy_rule` are append-only by SQL trigger: within the
# life of an environment, a row cannot be updated or deleted, and this script
# does not try. It DROPS THE TABLES and lets the migrations rebuild them — which
# is re-provisioning an environment, not rewriting its history. An operator with
# database credentials can always destroy an environment; what the triggers
# guarantee is that nothing can quietly alter a record inside one, which is the
# property an auditor relies on and it is untouched here.
#
# Staging only, and the guard below is not decoration: production holds real
# verdicts and this script must never be the reason they are gone.
#
# After it runs:
#   npm run migrate:staging     rebuild the schema
#   deploy                      reconciles the policy archive from the reviewed
#                               file, so policy_rule comes back from config
#                               rather than from a backup
#
# R2 is NOT emptied. Staged PDFs and label crops become orphans — the retention
# sweep keys off submission rows, so with the rows gone nothing will ever
# collect them. Harmless for a demo bucket, and stated rather than discovered.

set -euo pipefail

DB="alcohol-label-verify-staging"
ENVIRONMENT="staging"

if [ "${1:-}" != "--yes-destroy-staging-history" ]; then
  cat <<EOF
Refusing to run without explicit confirmation.

This DROPS every table in the ${ENVIRONMENT} database (${DB}) and everything in
them — jobs, submissions, extractions, verdicts, findings, decisions and the
audit chain — and lets the migrations rebuild an empty schema.

It cannot be undone. There is no backup.

  scripts/reset-staging.sh --yes-destroy-staging-history
EOF
  exit 1
fi

# Guard against a mis-set environment pointing this at production. The name is
# checked rather than assumed, because "--env staging" is one typo from "--env
# production" and the two are one keystroke apart in a shell history.
case "$DB" in
  *-staging) ;;
  *) echo "refusing: '$DB' is not a staging database" >&2; exit 1 ;;
esac

echo "Dropping tables in ${DB}…"

# Children before parents: D1 enforces foreign keys, and a parent dropped first
# fails rather than cascading. `d1_migrations` goes too, or wrangler believes
# the schema is already applied and rebuilds nothing.
TABLES="warning_verdict field_verdict policy_finding decision extraction verdict submission job audit_event policy_rule schema_meta d1_migrations"

SQL=""
for t in $TABLES; do
  SQL="${SQL}DROP TABLE IF EXISTS ${t}; "
done

npx wrangler d1 execute "$DB" --env "$ENVIRONMENT" --remote --command "$SQL"

echo
echo "Dropped. Now rebuild:"
echo "  npm run migrate:staging"
echo "  npm run deploy:staging     # reconciles policy_rule from config/policy-set.json"

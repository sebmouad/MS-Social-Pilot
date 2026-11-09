#!/usr/bin/env bash
# Carries out the updates the app records (a signed GitHub push, or Root › Updates › Update now), one at a time.
# Run as root by social-pilot-updater.timer every 30 seconds; does nothing when no update is waiting.
# Each update runs the deploy script of the commit being installed (build apart, tests, migrations, switch,
# health check, automatic rollback) and writes the outcome and the end of its log back for Root › Updates.
set -uo pipefail
cd /tmp

DB_NAME="${DB_NAME:-social_pilot}"
REPO_URL="${REPO_URL:-https://github.com/sebmouad/MS-Social-Pilot.git}"
REPO_DIR="${REPO_DIR:-/srv/ms-social-pilot-repo}"
LOG_DIR="${LOG_DIR:-/var/lib/ms-social-pilot/updates}"
DEPLOY_SCRIPT="${DEPLOY_SCRIPT:-}"   # tests point this at a stand-in; empty = the commit's own deploy script
PSQL="${PSQL:-sudo -u postgres psql}"

sql() { $PSQL -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -Atq "$@"; }

# A run cut short by a reboot or a killed unit never finishes on its own.
sql <<'SQL'
UPDATE app_updates SET status = 'failed', "finishedAt" = NOW(), log = coalesce(log, '') || E'\nStopped before it finished (server restart or timeout); the running version was not changed by this update.'
  WHERE status = 'running' AND "startedAt" < NOW() - interval '90 minutes';
SQL

# Take the newest waiting update; older waiting ones are covered by it.
row="$(sql <<'SQL'
WITH next AS (SELECT id FROM app_updates WHERE status = 'requested' AND NOT EXISTS (SELECT 1 FROM app_updates WHERE status = 'running')
              ORDER BY "createdAt" DESC LIMIT 1 FOR UPDATE SKIP LOCKED)
UPDATE app_updates u SET status = 'running', "startedAt" = NOW() FROM next WHERE u.id = next.id
RETURNING u.id || '|' || coalesce(u."commit", '') || '|' || u.branch;
SQL
)"
[ -n "$row" ] || exit 0
IFS='|' read -r id commit branch <<<"$row"
sql -v id="$id" <<'SQL'
UPDATE app_updates SET status = 'superseded', "finishedAt" = NOW()
  WHERE status = 'requested' AND "createdAt" < (SELECT "createdAt" FROM app_updates WHERE id = :'id');
SQL

mkdir -p "$LOG_DIR"; chmod 700 "$LOG_DIR"
log="$LOG_DIR/$id.log"
finish() { # status, deployed commit, extra line
  local tail; tail="$( { [ -f "$log" ] && sed 's/\x1b\[[0-9;]*m//g' "$log" | tail -n 150; [ -n "${3:-}" ] && echo "$3"; } | head -c 60000)"
  sql -v id="$id" -v status="$1" -v deployed="${2:-}" -v log="$tail" <<'SQL'
UPDATE app_updates SET status = :'status', "deployedCommit" = nullif(:'deployed', ''), log = :'log', "finishedAt" = NOW() WHERE id = :'id';
SQL
}

{
  echo "Update $id: ${commit:-latest $branch} ($(date -u +'%Y-%m-%d %H:%M:%SZ'))"
  if [ ! -d "$REPO_DIR/.git" ]; then git clone "$REPO_URL" "$REPO_DIR"; else git -C "$REPO_DIR" fetch origin --prune; fi
} >"$log" 2>&1 || { finish failed "" "Could not reach the repository on GitHub."; exit 0; }

sha="$(git -C "$REPO_DIR" rev-parse --verify --quiet "${commit:-origin/$branch}^{commit}")" \
  || { finish failed "" "Commit ${commit:-origin/$branch} is not in the repository."; exit 0; }
# A commit that is not on the deployed branch is never installed, whatever asked for it.
git -C "$REPO_DIR" merge-base --is-ancestor "$sha" "origin/$branch" \
  || { finish failed "" "Commit $sha is not on $branch; not installed."; exit 0; }

script="$DEPLOY_SCRIPT"
if [ -z "$script" ]; then
  script="$(mktemp /run/social-pilot-deploy.XXXXXX)"
  git -C "$REPO_DIR" show "$sha:app/scripts/deploy-from-server.sh" >"$script" \
    || { finish failed "" "The commit has no deploy script."; rm -f "$script"; exit 0; }
fi
BRANCH="$branch" timeout 80m bash "$script" --commit "$sha" >>"$log" 2>&1
rc=$?
[ -z "$DEPLOY_SCRIPT" ] && rm -f "$script"
if [ $rc -eq 0 ]; then finish succeeded "$sha"; else finish failed "" "Exit code $rc: the previous version keeps running."; fi
exit 0

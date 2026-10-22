LANE: operator follow-ups (after lane 28 merged). implement the alert evaluation job and uptime_days writer, worker-side recordError, and switch prod-deploy.sh/rollback drill health probes to /api/health. Each: shared service + UI + REST + MCP + Root config, worker jobs via shared runner with leases/run history; read legacy root src/; mark LEGACY_SWEEP rows done; no CONFIG_SCHEMA_VERSION bump; full suite + tsc pass.


OWNERSHIP (authoritative, do not ask): you own every path needed under rebuild/src, rebuild/tests, rebuild/docs, rebuild/scripts and prisma/ for this lane. Edit central registries/aggregators only by adding entries. Implement fully, run targeted tests + npm run typecheck, leave changes uncommitted. Never ask questions.

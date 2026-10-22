LANE: AI follow-ups (after lane 27 merged). implement the caption-test evaluation job, AI video polling job, composer Open Graph link preview, structured data and translated posts. Each: shared service + UI + REST + MCP + Root config, worker jobs via shared runner with leases/run history; read legacy root src/; mark LEGACY_SWEEP rows done; no CONFIG_SCHEMA_VERSION bump; full suite + tsc pass.


OWNERSHIP (authoritative, do not ask): you own every path needed under rebuild/src, rebuild/tests, rebuild/docs, rebuild/scripts and prisma/ for this lane. Edit central registries/aggregators only by adding entries. Implement fully, run targeted tests + npm run typecheck, leave changes uncommitted. Never ask questions.

# Replacement background worker

Run the rebuild worker beside the web process with `npm run worker` from `app/rebuild`. Root controls it with `jobs.enabled`, the three five-field cron expressions for posts, analytics and inbox, `sync.maxConcurrentJobs`, and `sync.retryLimit`. Cron is evaluated in the worker host's local timezone. The worker reloads these values every five seconds.

The posts job only reads remote Facebook status and reconciles destinations already marked `scheduled_remote`; it never calls `publish`. Analytics stores daily Page snapshots and account-level Ads Insights for enabled connections. Inbox sync stores Facebook conversations, returned messages, and comments for enabled Page connections. Each read is scoped by the local workspace, enabled selection, active Facebook connection, unexpired credential and required inbox or ads read scopes. Database upserts make repeated runs safe.

Each job has a database lease so multiple worker processes cannot run the same scheduled job at once. Leases renew while work runs and are released by token, so an expired worker cannot release a successor's lease. Every attempt appends a row to `rebuild_sync_runs`; the shared worker heartbeat and latest-job summary tables support operational health. Root can inspect recent outcomes through the rebuild Root runtime configuration page once its job-health panel is enabled.

Transient provider reads retry up to Root's configured retry limit with exponential delays capped at one minute. Work is bounded per connection by `meta.pageSize * meta.maxPages` and runs serially within a job, while the number of concurrent jobs follows Root's limit. A crashed worker's lease expires after five minutes. The additive migration `20261023100000_rebuild_worker_jobs` must be applied before starting the worker. Never run migrations against production without the deployment review and backup process described in the rebuild README.

The job scheduler and cron matcher have local unit tests. These tests do not make live Graph API calls; verify provider permissions and stored writes against a non-production database before cutover.

# Production host inventory for rebuild cutover

Read-only observations on 2026-10-15; recheck immediately before a cutover. No secrets or customer rows were read for this inventory.

| Item | Observed production value |
|---|---|
| Public app | `https://social.newsgeet.com` |
| Web unit | `social-pilot.service`, active, working directory `/srv/ms-social-pilot`, user `socialpilot` |
| Worker unit | `social-pilot-worker.service`, active, same release directory and user |
| Proxy unit | `lsws.service`, active |
| Vhost | `/usr/local/lsws/conf/vhosts/socialpilot/vhconf.conf` |
| Current upstream | `127.0.0.1:3100` |
| Current release / previous | `/srv/ms-social-pilot` / `/srv/ms-social-pilot.prev` |
| PostgreSQL database | `social_pilot` (local host) |
| Server command | `/usr/local/sbin/socialpilot-deploy` |

The current command builds and swaps the **legacy** root app from GitHub and checks the public health endpoint plus other sites. It is not a rebuild deploy command. The web and worker units both load `/srv/ms-social-pilot/.env`; their values were not inspected. Their hardening permits writes under `/var/lib/ms-social-pilot`, the release build cache, and private `/tmp`. The rebuild needs its own reviewed service units, release path, writable paths, environment strategy, worker handoff, and proxy switch. Keep the existing services and upstream in place until those gates and rollback rehearsal pass.

The Root setting `auth.passkeyOrigin` must equal the final public origin before passkey sign-in can be tested. The production database contains at least one enrolled passkey; verifying a real assertion on isolated staging or a carefully controlled cutover rehearsal is required. Do not infer success from unit tests alone.

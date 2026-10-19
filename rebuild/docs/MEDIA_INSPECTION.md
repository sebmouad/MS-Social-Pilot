# Trusted media inspection prerequisite (batch95)

Status: internal foundation and private Root diagnostic. This batch does not enable native customer formats or replace the current publishing host. Production remains legacy.

Shared `modules/publishing/server/media/` owns byte snapshots and metadata inspection; no Facebook rules live here. `resolveRemoteMediaSnapshot` uses a bounded public-source fetch, probes the exact fetched bytes and returns frozen metadata with defensive byte copies. Callers must already authorize the workspace, resource and media source. This helper provides no public endpoint and grants no access to stored files.

The network guard validates URL shape, every DNS answer and every redirect, pins the connection address and verifies the connected peer. Private/special-use IP addresses remain refused even with an allowlist or HTTP enabled. DNS, fetch and body reads share a deadline; caller cancellation is linked, late responses are canceled, and pre-aborted operations retain rejection handlers. Cross-origin redirects preserve only declared safe request headers. Compressed responses are refused; byte limits apply while streaming. Empty allowlist explicitly permits public hosts. This is a public-source resolver, not a credential-bearing private-storage reader.

Inspection copies input before its first asynchronous operation. Image metadata and decoding use Sharp with pixel limits, timeout and abort-result refusal. Sharp work already running cannot be forcibly terminated; late results are ignored. A Root-configured per-process concurrency bound refuses excess inspections and retains each slot until the underlying image work settles. Video probing uses fixed arguments, a forced sniffed container, restricted protocols, no shell, ignored stdin, bounded stdout/stderr and a killed subprocess on expiry or cancellation. Temporary input is stored in a unique private directory with a mode0600 file and removed afterward. Dimensions account for EXIF/video rotation; duration, stream disposition, container and MIME evidence are validated. Unsupported or malformed media is refused. Metadata inspection is not proof of complete video decoding or provider acceptance.

Registry80 owns eleven settings under Publishing: input bytes, pixels, inspection time/output limits, trusted ffprobe path, temporary root, download time, redirects, image concurrency, HTTP policy and public-host allowlist. Root must trust the configured executable and its installation; fixed arguments do not sandbox a malicious replacement binary. Defaults come only from the typed registry. Production must install and verify its own executable and filesystem permissions; local installation is not production evidence.

Publishing diagnostics includes `media_probe` through the existing installation-owner UI/API/MCP service and audit/confirmation rules. It validates the temporary root and runs a fixed `ffprobe -version` availability check. It exposes no path, banner, stderr or supplied URL. A pass does not establish successful decoding, native delivery or live provider connectivity.

Next: authorize stored-media resolution, bind the inspected bytes to the actual native upload, and integrate the existing parent publication claim with native phase receipts, positive status, first comments and safe deletion. Do not pass the original mutable source URL to a provider and claim it is the inspected payload. Native formats remain unavailable until those services and live-provider cleanup evidence pass. Broader legacy parity, full Root coverage and production-shaped migration/media/service rollback remain open.


Final local evidence:3,270 tests across368 files passed with actual synthetic
PostgreSQL and zero skips, grouped as3,264 tests/367 files plus the6-test global
submitted-worker file run separately. An all-files concurrent rerun exposed that
worker test selecting another file's temporary submitted row; separating the
global scanner from concurrent fixture writers avoids this test isolation
collision. It is not a new media or live-provider success claim. Production
build and serial typecheck passed. The real configured inspector and availability
check accepted a locally generated16x16,1-second MP4 and matched its byte digest.
Both Claude accounts and independent lower-cost agents reviewed the batch;
conservative duration and retained image concurrency permits were added after
review. No new browser/API/MCP or live Meta run was made in this batch; existing
diagnostic authorization tests passed through the shared service coverage.

Fresh full backup/scratch restore preserved107 table counts and exact Root
settings after final cleanup. No migration was added or reapplied; scratch and
synthetic video were removed, backup retained. Backup SHA256:
`277764d3a486b3138f1bef5e017966fc0c9cc2c6e6d5a28c86b3ff9e6e67b143`.
The final built preview uses the original example database at localhost:3200;
/sign-in returned HTTP200. Production and its held photo canary are unchanged.

Reproduce grouped verification from `rebuild/` with the guarded synthetic
database environment already loaded:

```sh
npm test -- --exclude tests/facebook-submitted-worker.integration.test.ts
npm test -- tests/facebook-submitted-worker.integration.test.ts
npm run build
npm run typecheck
```

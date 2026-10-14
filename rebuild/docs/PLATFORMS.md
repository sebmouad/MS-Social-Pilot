# Platform adapters

`src/platforms/types.ts` defines the provider-neutral contracts for connection, discovery, publishing, remote status and deletion, inbox, analytics, and ads. An adapter declares each capability as supported or unsupported. Optional operations are omitted until an implementation exists; callers must not infer support from an empty result.

The first Facebook slice implements text and optional link publishing to a Page through an injected `FacebookConfig`, access token, and fetch implementation. Media upload, native scheduling, post URL construction, connection/OAuth, destination discovery, status, deletion, inbox, analytics, and ads are not implemented here. `DEFAULT_FACEBOOK_CONFIG` is a typed default, and Graph wire paths/fields live in `facebook/protocol.ts`.

Integration hooks: the connection service should provide a Page-scoped credential and target (`kind: "page"`); the publishing worker should call `createFacebookAdapter(config).publish(...)` and persist `remoteId`. The runtime config/auth layers must supply Graph configuration and credentials. This module does not read application storage or make calls until `publish` is invoked.

The legacy implementation remains in `app/src/lib/facebook`; this adapter does not import it because it depends on the old app's environment, persistence, budgets, and job context. This slice is typechecked without credentials and should only be wired into a scoped runtime integration after the matching auth and data contracts are available.

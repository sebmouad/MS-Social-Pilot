# Connection workflow status

Channel and advertising account selection is implemented as a workspace-scoped local enabled-state change. Owners and admins can add or remove discovered records; selection does not grant provider access.

Disconnect is intentionally omitted from the rebuild UI. The existing workflow may stop provider-hosted scheduled posts before credentials are removed, then either retain channel and history records or delete related records with cascading history removal. Rebuilding that action requires a verified provider cancellation flow, explicit handling of posts still scheduled remotely, and confirmation for the data-retention choice. No disconnect or deletion action is exposed until those behaviors are implemented.

# Core workflow parity — batch 63

## Publishing templates

`modules/publishing` owns template list/create/update/delete, Root limits, HTTP
and workspace MCP tools. `/publishing/templates` provides a paginated searchable
table, sidebar search/create controls, recoverable edit/delete dialogs and exact
confirmations. Composer reuse loads an authorized workspace template, copies
message, hashtags and first comment, and applies its label in the same post
creation transaction. Media and links are chosen separately. Deleting a template
does not change posts already created from it. Root limits reach the API, forms
and validation; a label directory above its configured ceiling is refused rather
than silently truncated. Concurrent external edits are not versioned.

## Inbox productivity

Current workspace, selected-channel and role rules protect thread assignment,
notes and saved replies. Assignees must be active eligible members. Note deletion
checks current ownership/management rights; thread existence and scoped mutation
receipts are checked inside transactions. Selecting a saved reply only fills
the reply draft. Provider sending continues through the existing Inbox action
service. Local notes and assignments do not imply a remote provider operation.
Root owns bounds and the service exposes them to its controls. Shared HTTP/MCP
entry points enforce the same application services and write confirmations.

## Workspace policy

Owners/admins manage the existing workspace time zone and review switch through
`/settings/workspace`, its API and MCP. Exclusive workspace locks protect policy
writes against concurrent purge; actor and membership rows are locked. Disabling
approval releases pending posts to draft or scheduled according to their stored
time, with audit records. Contributor scheduling waits for review while the
policy requires it; approved scheduled work resumes at its stored time. Any edit
of approved content clears review metadata. Managers retain the existing bypass.
This does not implement business hours, UTM defaults, link shortening, client
approval, queue policies or every legacy workspace control.

## Evidence and limits

Focused unit/service/API/component tests cover local behavior, security and
regressions. Exact-snapshot full-suite, typecheck/build and further runtime
evidence are recorded in PREVIEW_QA.md when completed. No fresh full browser
pass, real provider workflow, production data migration or cutover is established
by source implementation alone. Production remains legacy.

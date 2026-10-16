/** Stable confirmation protocol shared by the private UI, API and MCP. */
export function workspaceAccessConfirmation(workspaceId: string, suspended: boolean) {
  return `${suspended ? 'SUSPEND' : 'RESTORE'} WORKSPACE ${workspaceId}`;
}

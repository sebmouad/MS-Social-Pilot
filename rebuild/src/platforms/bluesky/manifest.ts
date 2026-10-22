/** No customer capability is advertised before shared-service and interface parity. */
export const manifest = { id: 'bluesky', name: 'Bluesky', staged: true,
  capabilities: { connection: 'unsupported', discovery: 'unsupported', publishing: 'unsupported', remoteStatus: 'unsupported', remoteDelete: 'unsupported', inbox: 'unsupported', analytics: 'unsupported', ads: 'unsupported' },
} as const;

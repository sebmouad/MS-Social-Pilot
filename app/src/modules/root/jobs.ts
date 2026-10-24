/** Private installation jobs, run by the same leased runner as product jobs. */
export const ROOT_JOBS = [
  { name: 'operatorMonitoring', label: 'Installation alerts and uptime', configKey: 'root.monitoring.schedule' },
] as const;

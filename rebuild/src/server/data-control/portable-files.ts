/** Stable machine-readable archive schema, independent of customer locale or provider. */
type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(row) : [];
const text = (value: unknown): string => value == null ? '' : value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** RFC 4180 quoting plus spreadsheet formula neutralization. JSON retains original text. */
function cell(value: unknown): string {
  const source = text(value);
  const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(source) || /^[\t\r\n]/.test(source) ? `'${source}` : source;
  return safe !== source || /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
const csv = (values: unknown[][]) => `${values.map(values => values.map(cell).join(',')).join('\r\n')}\r\n`;

/**
 * Derive portable files only from the already authorized, recursively scrubbed export.
 * No second data read, provider dispatch or independent permission policy. Filenames and
 * snake_case headers are versioned file-format identifiers, not operational settings.
 */
export function portableWorkspaceFiles(data: Row): Record<string, string> {
  const channels = rows(data.targets);
  const posts = rows(data.posts);
  const legacy = row(data.legacyTables);
  const indirect = row(data.indirectTables);
  const channelNames = new Map(channels.map(channel => [channel.id, channel.name]));
  const labels = new Map(rows(legacy.labels).map(label => [label.id, label.name]));
  const labelsByPost = new Map<unknown, unknown[]>();
  for (const link of rows(indirect.post_labels)) {
    const names = labelsByPost.get(link.postId) ?? [];
    if (labels.has(link.labelId)) names.push(labels.get(link.labelId));
    labelsByPost.set(link.postId, names);
  }
  const postRows: unknown[][] = [['post_id', 'status', 'format', 'scheduled_at', 'published_at', 'channel_id', 'channel', 'destination_status', 'url', 'message', 'link', 'first_comment', 'labels']];
  for (const post of posts) {
    const destinations = rows(post.targets);
    for (const destination of destinations.length ? destinations : [{}]) {
      postRows.push([post.id, post.status, post.format, post.scheduledAt, destination.publishedAt ?? post.publishedAt,
        destination.targetId, channelNames.get(destination.targetId), destination.status, destination.remoteUrl,
        post.message, post.link, post.firstComment, (labelsByPost.get(post.id) ?? []).map(text).join('; ')]);
    }
  }
  const insightRows: unknown[][] = [['channel_id', 'channel', 'metric', 'period', 'end_time', 'value']];
  const comments: Row[] = [];
  for (const channel of channels) {
    for (const insight of rows(channel.insights)) insightRows.push([channel.id, channel.name, insight.metric, insight.period, insight.endTime, insight.value]);
    for (const destination of rows(channel.postTargets)) {
      for (const comment of rows(destination.comments)) comments.push({ ...comment, postId: destination.postId, channelId: channel.id });
    }
  }
  return {
    'channels.json': json(channels.map(({ insights: _insights, conversations: _conversations, postTargets: _postTargets, ...channel }) => channel)),
    'posts.json': json(posts),
    'posts.csv': csv(postRows),
    'schedule.json': json(rows(legacy.queue_slots)),
    'analytics/channels.csv': csv(insightRows),
    'comments.json': json(comments),
  };
}

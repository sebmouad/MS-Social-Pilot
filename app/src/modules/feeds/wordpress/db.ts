import type { Mapping } from './recipe';
import { decodeWordpressText, normalizeWordpressCaption } from './text';

/**
 * Standard WordPress REST API connector (`/wp-json/wp/v2/`).
 * Reads posts, custom meta fields, embedded featured media, and Schema.org / WPRM recipe data over HTTPS
 * without requiring direct MariaDB/MySQL access.
 */
export type DbSettings = {
  siteUrl: string;
  apiToken?: string | null;
  connectTimeoutMs: number;
  queryTimeoutMs: number;
  uploadsPath?: string;
};
export type WpCandidateRow = {
  id: string;
  title: string;
  slug: string;
  publishedAt: Date | null;
  caption: string;
  imageId: string;
  recipe: string;
};
export type CandidateQuery = {
  mapping: Mapping;
  order: 'newest' | 'oldest';
  skipShared: boolean;
  maxAgeDays: number;
  afterId: string | null;
  afterDate?: Date | null;
  limit: number;
  now: Date;
};
export type WpDb = {
  candidates(query: CandidateQuery): Promise<WpCandidateRow[]>;
  /** attachment ID -> relative file path under the uploads folder */
  attachments(ids: readonly string[], attachedFileMetaKey: string): Promise<Map<string, string>>;
  ping(): Promise<void>;
  close(): Promise<void>;
};

const restEndpointForType = (postType: string): string => {
  if (postType === 'post') return 'posts';
  if (postType === 'page') return 'pages';
  return encodeURIComponent(postType);
};

const renderedOf = (field: unknown): string => {
  if (typeof field === 'string') return field;
  if (field && typeof field === 'object' && 'rendered' in field && typeof (field as { rendered: unknown }).rendered === 'string') {
    return (field as { rendered: string }).rendered;
  }
  return '';
};

const stripHtml = (html: string): string =>
  decodeWordpressText(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const metaValue = (item: Record<string, unknown>, key: string): string => {
  if (!key) return '';
  const meta = item['meta'];
  if (meta && typeof meta === 'object' && !Array.isArray(meta) && key in (meta as Record<string, unknown>)) {
    const val = (meta as Record<string, unknown>)[key];
    if (typeof val === 'string') return val;
    if (typeof val === 'number' && Number.isFinite(val)) return String(val);
    if (val && typeof val === 'object') return JSON.stringify(val);
  }
  if (key in item) {
    const val = item[key];
    if (typeof val === 'string') return val;
    if (typeof val === 'number' && Number.isFinite(val)) return String(val);
    if (val && typeof val === 'object') return JSON.stringify(val);
  }
  return '';
};

const extractRelativeUploadPath = (urlOrPath: string, uploadsPath = '/wp-content/uploads'): string | null => {
  const trimmed = urlOrPath.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://') && !trimmed.startsWith('/')) {
    return trimmed;
  }
  const cleanUploads = uploadsPath.replace(/\/+$/, '') + '/';
  try {
    const pathname = trimmed.startsWith('http') ? new URL(trimmed).pathname : trimmed;
    const idx = pathname.indexOf(cleanUploads);
    if (idx !== -1) {
      const rel = pathname.slice(idx + cleanUploads.length).replace(/^\/+/, '');
      return rel || null;
    }
  } catch {
    return null;
  }
  return null;
};

const parseIsoDurationMinutes = (iso: unknown): number | undefined => {
  if (typeof iso === 'number' && Number.isFinite(iso) && iso > 0) return Math.round(iso);
  if (typeof iso !== 'string') return undefined;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/i.exec(iso.trim());
  if (!match) {
    const numeric = Number(iso);
    return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : undefined;
  }
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const total = days * 1440 + hours * 60 + minutes;
  return total > 0 ? total : undefined;
};

function extractRecipeFromSchemaGraph(nodes: unknown[]): string | null {
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const rec = node as Record<string, unknown>;
    const type = rec['@type'];
    const isRecipe = type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'));
    if (!isRecipe) continue;
    const ingredients = Array.isArray(rec['recipeIngredient'])
      ? rec['recipeIngredient'].map(x => stripHtml(String(x ?? ''))).filter(Boolean)
      : [];
    const rawSteps = Array.isArray(rec['recipeInstructions']) ? rec['recipeInstructions'] : [];
    const steps: string[] = [];
    for (const step of rawSteps) {
      if (typeof step === 'string') {
        const clean = stripHtml(step);
        if (clean) steps.push(clean);
      } else if (step && typeof step === 'object') {
        const s = step as Record<string, unknown>;
        if (Array.isArray(s['itemListElement'])) {
          for (const sub of s['itemListElement']) {
            if (typeof sub === 'string') steps.push(stripHtml(sub));
            else if (sub && typeof sub === 'object' && typeof (sub as Record<string, unknown>)['text'] === 'string') {
              steps.push(stripHtml(String((sub as Record<string, unknown>)['text'])));
            }
          }
        } else if (typeof s['text'] === 'string') {
          steps.push(stripHtml(s['text']));
        }
      }
    }
    if (!ingredients.length && !steps.length) continue;
    return JSON.stringify({
      title: stripHtml(String(rec['name'] ?? '')),
      description: stripHtml(String(rec['description'] ?? '')),
      servings: Array.isArray(rec['recipeYield']) ? String(rec['recipeYield'][0] ?? '') : String(rec['recipeYield'] ?? ''),
      prep_minutes: parseIsoDurationMinutes(rec['prepTime']),
      cook_minutes: parseIsoDurationMinutes(rec['cookTime']),
      total_minutes: parseIsoDurationMinutes(rec['totalTime']),
      ingredients,
      steps: steps.filter(Boolean),
    });
  }
  return null;
}

function extractRecipeJson(item: Record<string, unknown>, recipeMetaKey: string, fallbackTitle: string): string {
  const fromMeta = metaValue(item, recipeMetaKey);
  if (fromMeta) return fromMeta;

  // Check Yoast / RankMath schema graph if exposed in REST response
  const yoast = item['yoast_head_json'];
  if (yoast && typeof yoast === 'object') {
    const schema = (yoast as Record<string, unknown>)['schema'];
    if (schema && typeof schema === 'object' && Array.isArray((schema as Record<string, unknown>)['@graph'])) {
      const found = extractRecipeFromSchemaGraph((schema as Record<string, unknown>)['@graph'] as unknown[]);
      if (found) return found;
    }
  }

  const contentHtml = renderedOf(item['content']);
  const excerptText = stripHtml(renderedOf(item['excerpt']));

  // Check embedded <script type="application/ld+json"> inside post content
  const ldMatches = contentHtml.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of ldMatches) {
    try {
      const parsed = JSON.parse(m[1] ?? '');
      const nodes = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>)['@graph'])
          ? ((parsed as Record<string, unknown>)['@graph'] as unknown[])
          : [parsed];
      const found = extractRecipeFromSchemaGraph(nodes);
      if (found) return found;
    } catch {
      // continue scanning
    }
  }

  // Check WP Recipe Maker HTML classes (.wprm-recipe-ingredient, .wprm-recipe-instruction-text) or HTML lists
  const listItems = [...contentHtml.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
    .map(m => stripHtml(m[1] ?? ''))
    .filter(Boolean);
  const paragraphs = [...contentHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(m => stripHtml(m[1] ?? ''))
    .filter(p => p.length > 20);

  if (listItems.length > 0 || paragraphs.length > 0) {
    return JSON.stringify({
      title: fallbackTitle,
      description: excerptText || (paragraphs[0] ?? ''),
      servings: '',
      ingredients: listItems.slice(0, 20),
      steps: paragraphs.slice(0, 12),
    });
  }

  return '';
}

function authHeaders(apiToken?: string | null): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = apiToken?.trim();
  // A legacy direct-database address saved before the REST connector is not a REST credential.
  if (!token || /^[a-z][a-z0-9+.-]*:\/\//i.test(token)) return headers;
  if (token.includes(':')) {
    headers['Authorization'] = `Basic ${Buffer.from(token, 'utf8').toString('base64')}`;
  } else {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function fetchJson(url: string, settings: DbSettings): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(settings.connectTimeoutMs, settings.queryTimeoutMs));
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: authHeaders(settings.apiToken),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`wp_rest_status_${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function openWordpressDb(settings: DbSettings): Promise<WpDb> {
  const base = settings.siteUrl.trim().replace(/\/+$/, '');
  if (!base.startsWith('https://') && !base.startsWith('http://')) {
    throw new Error('unsupported_site_address');
  }
  const uploadsPath = settings.uploadsPath ?? '/wp-content/uploads';
  const mediaCache = new Map<string, string>();

  return {
    async candidates(q) {
      const endpoint = restEndpointForType(q.mapping.postType || 'post');
      const params = new URLSearchParams({
        per_page: String(Math.min(100, Math.max(1, q.limit))),
        orderby: 'date',
        order: q.order === 'newest' ? 'desc' : 'asc',
        _embed: 'wp:featuredmedia',
      });
      if (q.mapping.postStatus && q.mapping.postStatus !== 'publish' && settings.apiToken) {
        params.set('status', q.mapping.postStatus);
      }
      if (q.afterDate) {
        params.set(q.order === 'newest' ? 'before' : 'after', q.afterDate.toISOString());
      }
      if (q.maxAgeDays > 0) {
        const minDate = new Date(q.now.getTime() - q.maxAgeDays * 86_400_000);
        const existingAfter = params.get('after');
        if (!existingAfter || new Date(existingAfter) < minDate) {
          params.set('after', minDate.toISOString());
        }
      }

      const raw = await fetchJson(`${base}/wp-json/wp/v2/${endpoint}?${params.toString()}`, settings);
      if (!Array.isArray(raw)) return [];

      const rows: WpCandidateRow[] = [];
      for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const item = entry as Record<string, unknown>;
        const id = String(item['id'] ?? '').trim();
        if (!id || (q.afterId !== null && id === q.afterId)) continue;

        if (q.skipShared && q.mapping.skipMetaKey && metaValue(item, q.mapping.skipMetaKey)) {
          continue;
        }

        const slug = String(item['slug'] ?? '').trim();
        const title = stripHtml(renderedOf(item['title']));
        const dateGmt = typeof item['date_gmt'] === 'string' && item['date_gmt']
          ? new Date(`${item['date_gmt'].replace(/Z$/i, '')}Z`)
          : typeof item['date'] === 'string' && item['date']
            ? new Date(item['date'])
            : null;
        const publishedAt = dateGmt && Number.isFinite(dateGmt.getTime()) && dateGmt.getUTCFullYear() > 1971 ? dateGmt : null;

        // A configured meta key is authoritative (same contract as the former direct-database join): when it is
        // set but empty or not exposed over REST, the post is not a candidate. Fallbacks apply only to empty keys.
        const rawCaption = q.mapping.captionMetaKey
          ? metaValue(item, q.mapping.captionMetaKey)
          : stripHtml(renderedOf(item['excerpt'])) || title;
        const caption = normalizeWordpressCaption(rawCaption);

        let imageId = q.mapping.imageMetaKey ? metaValue(item, q.mapping.imageMetaKey).trim() : '';
        if (!q.mapping.imageMetaKey && typeof item['featured_media'] === 'number' && item['featured_media'] > 0) {
          imageId = String(item['featured_media']);
        }

        // Cache the embedded featured media path; used directly only when it is the chosen image.
        const embedded = item['_embedded'];
        if (embedded && typeof embedded === 'object') {
          const mediaList = (embedded as Record<string, unknown>)['wp:featuredmedia'];
          if (Array.isArray(mediaList) && mediaList[0] && typeof mediaList[0] === 'object') {
            const mediaObj = mediaList[0] as Record<string, unknown>;
            const mediaId = String(mediaObj['id'] ?? '');
            const details = mediaObj['media_details'];
            const detailsFile = details && typeof details === 'object' && typeof (details as Record<string, unknown>)['file'] === 'string'
              ? String((details as Record<string, unknown>)['file'])
              : null;
            const sourceUrl = typeof mediaObj['source_url'] === 'string' ? mediaObj['source_url'] : '';
            const relPath = detailsFile || extractRelativeUploadPath(sourceUrl, uploadsPath);
            if (mediaId && relPath) mediaCache.set(mediaId, relPath);
          }
        }
        if (imageId && !/^\d{1,20}$/.test(imageId) && !mediaCache.has(imageId)) {
          const directRel = extractRelativeUploadPath(imageId, uploadsPath);
          if (directRel) mediaCache.set(imageId, directRel);
        }

        const recipe = q.mapping.recipeMetaKey ? metaValue(item, q.mapping.recipeMetaKey) : extractRecipeJson(item, '', title);
        rows.push({ id, title, slug, publishedAt, caption, imageId, recipe });
      }
      return rows;
    },

    async attachments(ids, attachedFileMetaKey) {
      const unique = [...new Set(ids.map(id => id.trim()).filter(Boolean))];
      const result = new Map<string, string>();
      const missingNumeric: string[] = [];

      for (const id of unique) {
        const cached = mediaCache.get(id);
        if (cached) {
          result.set(id, cached);
        } else if (/^\d{1,20}$/.test(id)) {
          missingNumeric.push(id);
        } else {
          const rel = extractRelativeUploadPath(id, uploadsPath);
          if (rel) result.set(id, rel);
        }
      }

      if (missingNumeric.length > 0) {
        const raw = await fetchJson(
          `${base}/wp-json/wp/v2/media?include=${missingNumeric.join(',')}&per_page=100`,
          settings,
        ).catch(() => null);
        if (Array.isArray(raw)) {
          for (const entry of raw) {
            if (!entry || typeof entry !== 'object') continue;
            const m = entry as Record<string, unknown>;
            const mediaId = String(m['id'] ?? '').trim();
            if (!mediaId) continue;
            const fromMeta = metaValue(m, attachedFileMetaKey).trim();
            const details = m['media_details'];
            const detailsFile = details && typeof details === 'object' && typeof (details as Record<string, unknown>)['file'] === 'string'
              ? String((details as Record<string, unknown>)['file']).trim()
              : '';
            const sourceUrl = typeof m['source_url'] === 'string' ? m['source_url'] : '';
            const rel = fromMeta || detailsFile || extractRelativeUploadPath(sourceUrl, uploadsPath);
            if (rel) {
              mediaCache.set(mediaId, rel);
              result.set(mediaId, rel);
            }
          }
        }
      }
      return result;
    },

    async ping() {
      await fetchJson(`${base}/wp-json/wp/v2/types`, settings);
    },

    async close() {
      mediaCache.clear();
    },
  };
}

/** Exact authoritative caption for maintenance via the WordPress REST API. */
export async function readWordpressCaption(settings: DbSettings, mapping: Mapping, wpPostId: string): Promise<string | null> {
  if (!/^\d{1,20}$/.test(wpPostId)) throw new Error('invalid_wordpress_identity');
  const base = settings.siteUrl.trim().replace(/\/+$/, '');
  const endpoint = restEndpointForType(mapping.postType || 'post');
  const raw = await fetchJson(`${base}/wp-json/wp/v2/${endpoint}/${encodeURIComponent(wpPostId)}`, settings).catch(() => null);
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const fromMeta = metaValue(item, mapping.captionMetaKey);
  if (fromMeta) return fromMeta;
  const excerpt = stripHtml(renderedOf(item['excerpt']));
  return excerpt || stripHtml(renderedOf(item['title'])) || null;
}

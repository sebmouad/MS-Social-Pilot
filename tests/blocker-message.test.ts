import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { OWN_TARGET_ERRORS, TARGET_BLOCK_REASONS } from '../src/lib/constants';
import { blockerMessage } from '../src/components/blockerMessage';
import en from '../messages/en.json';
import fr from '../messages/fr.json';

/**
 * Why a destination will not publish, in the reader's language.
 *
 * The reason is decided by a background job that has no idea who will read it,
 * and half this product's audience reads French. Storing the sentence meant a
 * French agency was told in English why a client's Page had stopped working —
 * which is the moment they are least able to guess.
 */
describe('blockerMessage', () => {
  const dictionary = en.connections.blocked as Record<string, string>;
  const translate = (key: string) => dictionary[key.replace('blocked.', '')] ?? key;
  const has = (key: string) => key.replace('blocked.', '') in dictionary;

  it('prefers the translated reason over the stored sentence', () => {
    expect(blockerMessage('role', 'Some English sentence', translate, has)).toBe(dictionary.role);
  });

  it('falls back to the stored sentence for a row written before codes existed', () => {
    // Every destination synced before this column existed has text and no
    // code. Showing nothing would be worse than showing the wrong language.
    expect(blockerMessage(null, 'Stored explanation', translate, has)).toBe('Stored explanation');
  });

  it('falls back when a writer invents a code nobody wrote copy for', () => {
    expect(blockerMessage('not_a_reason', 'Stored explanation', translate, has)).toBe(
      'Stored explanation',
    );
  });

  it('says nothing when there is nothing to say', () => {
    expect(blockerMessage(null, null, translate, has)).toBeNull();
  });
});

describe('the block reasons', () => {
  it('each have words in both languages', () => {
    for (const [language, messages] of [['en', en], ['fr', fr]] as const) {
      const blocked = (messages.connections as { blocked: Record<string, string> }).blocked;
      for (const reason of TARGET_BLOCK_REASONS) {
        expect(blocked[reason], `${language} is missing ${reason}`).toBeTruthy();
      }
    }
  });

  it('are the only codes the writers use', () => {
    // A code written into the database with no matching reason would fall back
    // to English for ever, silently.
    const sources = ['src/lib/accounts.ts', 'src/lib/instagram.ts']
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');

    const used = [...sources.matchAll(/publishBlockerCode:[^,\n]*'([a-z_]+)'/g)].map(
      (match) => match[1]!,
    );
    expect(used.length, 'no codes are being written at all').toBeGreaterThan(0);
    for (const code of used) {
      expect(TARGET_BLOCK_REASONS as readonly string[]).toContain(code);
    }
  });

  it('are set wherever a blocking sentence is stored', () => {
    // A writer that sets the sentence without a code puts a French user back
    // where they started, and nothing would look wrong.
    for (const path of ['src/lib/accounts.ts', 'src/lib/instagram.ts']) {
      const source = readFileSync(path, 'utf8');
      const sentences = (source.match(/^\s*publishBlocker:/gm) ?? []).length;
      const codes = (source.match(/^\s*publishBlockerCode:/gm) ?? []).length;
      expect(codes, `${path} stores a reason it cannot translate`).toBe(sentences);
    }
  });
});

/**
 * Why a destination failed, in the reader's language where we wrote the words.
 *
 * `PostTarget.errorCode` carries Facebook's codes alongside ours. Facebook's
 * stay in Facebook's wording — it wrote the useful part, and a translated
 * paraphrase of "Unsupported get request" helps nobody. The four this app
 * composed itself can be said in French to a French reader.
 */
describe('the failures this app writes itself', () => {
  it('each have words in both languages', () => {
    for (const [language, messages] of [['en', en], ['fr', fr]] as const) {
      const failure = (messages.posts as { failure: Record<string, string> }).failure;
      for (const code of OWN_TARGET_ERRORS) {
        expect(failure[code], `${language} is missing ${code}`).toBeTruthy();
      }
    }
  });

  it('are all set as a code, not only as a sentence', () => {
    // `accounts.ts` wrote the sentence without a code while its three siblings
    // wrote both, so that one failure was stuck in English on its own.
    const sources = [
      'src/lib/accounts.ts',
      'src/lib/scheduler/runner.ts',
      'src/lib/scheduler/jobs.ts',
    ]
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');

    const written = new Set(
      [...sources.matchAll(/errorCode: '([a-z_]+)'/g)].map((match) => match[1]!),
    );
    for (const code of OWN_TARGET_ERRORS) {
      expect(written, `nothing writes ${code}`).toContain(code);
    }
  });

  it('are set at every site that writes the sentence, not just one of them', () => {
    // Two places cancel work when an account is disconnected. Giving a code to
    // one of them leaves the other stuck in English, and the union test above
    // still passes because the code exists somewhere.
    const accounts = readFileSync('src/lib/accounts.ts', 'utf8');
    const sentences = (
      accounts.match(/errorMessage: 'Cancelled because the Facebook account was disconnected\.'/g) ??
      []
    ).length;
    const codes = (accounts.match(/errorCode: 'account_disconnected'/g) ?? []).length;

    expect(sentences, 'the disconnect cancellation moved or was reworded').toBeGreaterThan(0);
    expect(codes, 'a cancellation writes a sentence it cannot translate').toBe(sentences);
  });

  it('leaves Facebook to explain its own refusals', () => {
    const list = readFileSync('src/components/PostList.tsx', 'utf8');
    const helper = list.slice(list.indexOf('function failureText'), list.indexOf('return (', list.indexOf('function failureText')));

    // A Graph code has no copy here, so the stored message — Facebook's own
    // words — has to come through unchanged.
    expect(helper).toContain('t.has(key)');
    expect(helper).toContain('return target.error;');
  });

  it('does not paraphrase a code nobody wrote copy for', () => {
    const failure = (en.posts as { failure: Record<string, string> }).failure;
    // Graph codes are numbers, and kinds like `auth` or `rate_limit`. None of
    // them should have been given copy here by accident.
    for (const key of Object.keys(failure)) {
      expect(OWN_TARGET_ERRORS as readonly string[], `${key} is not ours`).toContain(key);
    }
  });
});

/**
 * The approvals screen, where the decision is actually made.
 *
 * A post whose scheduled moment has passed publishes as soon as it is
 * approved. The email says so now; the screen is where a reviewer works
 * through a queue of them, and it showed "scheduled for Tuesday 9am" with
 * nothing to mark it apart from one due next week. Approving a batch after a
 * week away sends every overdue one out at once.
 */
describe('the approvals screen', () => {
  const page = readFileSync('src/app/(app)/approvals/page.tsx', 'utf8');
  const client = readFileSync('src/components/ApprovalsClient.tsx', 'utf8');

  it('works out whether the moment has passed', () => {
    // Server-side, against the same clock the scheduler uses.
    expect(page).toMatch(/overdue:/);
  });

  it('marks it apart from a post that is merely upcoming', () => {
    expect(client).toContain('post.overdue');
    expect(client).toMatch(/t\('overdue'\)|tPosts\('overdue'\)/);
  });

  it('has words for it in both languages', () => {
    for (const [language, messages] of [['en', en], ['fr', fr]] as const) {
      const approvals = messages.approvals as Record<string, string>;
      expect(approvals.overdue, `${language} is missing the overdue note`).toBeTruthy();
    }
  });
});

/**
 * Turning review off, reported to the person who did it.
 *
 * The breakdown is worked out in the service layer; a route that drops it or a
 * screen that ignores it puts the silence one layer further out, which is the
 * shape this has taken every previous time.
 */
describe('the release report', () => {
  const route = readFileSync('src/app/api/workspace/route.ts', 'utf8');
  const client = readFileSync('src/components/SettingsClient.tsx', 'utf8');

  it('is in what the route actually answers with', () => {
    // Computing it into a local and returning without it is the version of
    // this mistake that reads as done from a distance.
    const start = route.indexOf('return ok({');
    const payload = route.slice(start, route.indexOf('});', start));

    expect(start, 'the route no longer answers with an object').toBeGreaterThan(-1);
    expect(payload).toContain('released');
  });

  it('is shown when something is actually going out', () => {
    expect(client).toContain('publishingNow');
    expect(client).toContain("t('savedReleased'");
  });

  it('still says the ordinary thing when nothing was waiting', () => {
    const handler = client.slice(client.indexOf('async function saveWorkspace'), client.indexOf('async function saveSlots'));
    expect(handler).toContain("t('saved')");
    expect(handler).toMatch(/publishingNow > 0/);
  });

  it('counts properly in both languages', () => {
    for (const [language, messages] of [['en', en], ['fr', fr]] as const) {
      const settings = messages.settings as unknown as Record<string, string>;
      expect(settings.savedReleased, language).toContain('{count, plural,');
    }
  });
});

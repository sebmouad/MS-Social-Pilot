import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// These completed boundaries must stay reusable when a new provider is installed.
// Other legacy-shaped boundaries remain documented work; this test does not certify them.
const sharedFiles = [
  'src/modules/inbox/ui/InboxScreen.tsx', 'src/modules/inbox/server/threads.ts', 'src/modules/inbox/server/providers.ts',
  'src/modules/analytics/server/catalog.ts', 'src/modules/analytics/server/data.ts',
  'src/modules/analytics/server/aggregate.ts', 'src/modules/analytics/server/reports.ts',
  'src/server/platforms/host.ts', 'src/modules/ads/server/actions.ts', 'src/server/jobs/retry.ts', 'src/modules/analytics/ui/AnalyticsScreen.tsx',
  'src/modules/ads/ui/CampaignCreateForm.tsx', 'src/modules/ads/ui/AdSetCreateForm.tsx',
  'src/app/api/ads/actions/route.ts', 'src/app/api/ads/campaigns/route.ts', 'src/app/api/ads/adsets/route.ts', 'src/app/api/ads/object/route.ts', 'src/modules/ads/server/errors.ts',
];

describe('completed platform boundaries', () => {
  it('uses typed Ads errors without matching provider or configuration messages', () => {
    for (const file of ['actions', 'campaigns', 'adsets', 'object']) {
      const content = readFileSync(resolve(`src/app/api/ads/${file}/route.ts`), 'utf8');
      expect(content).not.toMatch(/Facebook|Root has not configured|\.message\.includes/);
      expect(content).toContain('adsErrorResponse');
    }
  });
  it.each(sharedFiles)('%s imports neutral contracts or dispatch rather than a provider implementation', file => {
    const source = ts.createSourceFile(file, readFileSync(resolve(file), 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const violations: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const path = node.moduleSpecifier.text;
        if (/platforms\/[^/]+\//.test(path) || /server\/platforms\/(?!registry$|index$|host$|resource-visibility$)[^/]+$/.test(path)) violations.push(path);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(violations).toEqual([]);
  });
  it('keeps Facebook runtime and connection code inside its module', () => {
    const legacy = ['src/server/platforms/facebook.ts', 'src/server/platforms/facebook-connect.ts', 'src/server/platforms/facebook-discovery.ts', 'src/server/connection-oauth-state.ts'];
    expect(legacy.filter(file => existsSync(resolve(file)))).toEqual([]);
  });

  it('keeps provider objective names and types out of shared adapter contracts', () => {
    const content = readFileSync(resolve('src/platforms/types.ts'), 'utf8');
    expect(content).not.toMatch(/Facebook|Instagram|OUTCOME_/);
  });

  it('registers module-owned server hosts without composing provider workflows in the registry', () => {
    const path = 'src/server/platforms/index.ts';
    const source = ts.createSourceFile(path, readFileSync(resolve(path), 'utf8'), ts.ScriptTarget.Latest, true);
    const registrations: ts.ObjectLiteralExpression[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'PLATFORM_HOSTS' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) registrations.push(node.initializer);
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(registrations).toHaveLength(1);
    expect(registrations[0]!.properties.every(property => ts.isPropertyAssignment(property) && ts.isIdentifier(property.initializer))).toBe(true);
  });

  it('keeps Messenger reply-window policy out of shared Inbox code', () => {
    for (const file of ['src/modules/inbox/ui/InboxScreen.tsx', 'src/modules/inbox/server/threads.ts']) {
      expect(readFileSync(resolve(file), 'utf8')).not.toMatch(/messengerReplyWindow|MessengerReplyWindow|inbox\.messengerReplyWindowHours/);
    }
    expect(existsSync(resolve('src/modules/inbox/server/reply-window.ts'))).toBe(false);
  });

});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// These completed boundaries must stay reusable when a new provider is installed.
// Other legacy-shaped boundaries remain documented work; this test does not certify them.
const sharedFiles = [
  'src/server/analytics/catalog.ts', 'src/server/analytics/data.ts',
  'src/server/analytics/aggregate.ts', 'src/server/analytics/reports.ts',
  'src/server/ads/actions.ts', 'src/app/analytics/page.tsx',
  'src/app/ads/CampaignCreateForm.tsx', 'src/app/ads/AdSetCreateForm.tsx',
];

describe('completed platform boundaries', () => {
  it.each(sharedFiles)('%s imports neutral contracts or dispatch rather than a provider implementation', file => {
    const source = ts.createSourceFile(file, readFileSync(resolve(file), 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const violations: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const path = node.moduleSpecifier.text;
        if (/platforms\/[^/]+\//.test(path) || /server\/platforms\/(?!registry$|index$)[^/]+$/.test(path)) violations.push(path);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(violations).toEqual([]);
  });
});

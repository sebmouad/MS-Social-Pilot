import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { inboxCopy } from '../src/modules/inbox/ui/copy';
import { inboxSyncCopy, inboxSyncSummary } from '../src/modules/inbox/sync-copy';

const directory = decodeURIComponent(new URL('../src/modules/', import.meta.url).pathname);
function catalogs(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? catalogs(join(path, entry.name)) : /copy[^/]*\.ts$/.test(entry.name) ? [join(path, entry.name)] : []);
}

/** Inspect values only: English message keys and interpolation expressions are not French prose. */
function frenchLiterals(file: string) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const values: Array<{ text: string; line: number }> = [];
  function visit(node: ts.Node, french = false) {
    if (ts.isPropertyAssignment(node)) {
      const name = node.name.getText(source).replace(/['"]/g, '');
      if (name === 'fr') french = true;
      if (name === 'en') french = false;
    }
    if (ts.isVariableDeclaration(node) && ['fr', 'french'].includes(node.name.getText(source))) french = true;
    if (node.parent && ts.isCallExpression(node.parent) && node.parent.expression.getText(source) === 'row' && node.parent.arguments[1] === node) french = true;
    if (french && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)
      && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))) {
      values.push({ text: node.text, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
    }
    ts.forEachChild(node, child => visit(child, french));
  }
  visit(source);
  return values;
}

describe('French module catalogs', () => {
  it('uses narrow nonbreaking spaces before high punctuation in French prose', () => {
    const failures: string[] = [];
    for (const file of catalogs(directory)) for (const { text, line } of frenchLiterals(file)) {
      // Colons inside URLs and clock times are protocol/data syntax rather than punctuation.
      if (/(?<=.)(?<!\u202f)[;!?]|(?<!\u202f):(?=\s|$)/u.test(text)) failures.push(`${file}:${line}: ${text}`);
      expect(text, `${file}:${line}`).not.toMatch(/(?<!\p{L})(?:tu|toi|tes)(?!\p{L})/iu);
    }
    expect(failures).toEqual([]);
  });

  it('names Inbox actions as actions and uses the plural reconnect pronoun', () => {
    expect(inboxCopy.fr.openConversation).toBe('Ouvrir la conversation');
    expect(inboxCopy.fr.openComment).toBe('Ouvrir le commentaire');
    const summary = inboxSyncSummary({ targets: 2, conversations: 0, messages: 0, comments: 0, reviews: null, failed: 2 }, 'fr', inboxSyncCopy);
    expect(summary).toContain('2 canaux vérifiés\u202f:');
    expect(summary).toContain('Reconnectez-les');
  });
});

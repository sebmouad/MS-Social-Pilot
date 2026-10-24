import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { customerCopy as agencyCopy } from '../src/modules/agency/ui/copy';
import { customerCopy as tasksCopy } from '../src/modules/tasks/ui/copy';
import { reportCopyDefaults } from '../src/modules/analytics/ui/reports/copy';
import { ownerCopy, ownerCopySchema, ownerText, resolveOwnerCopy } from '../src/modules/sharing/ui/owner-copy';
import { publicCopy, publicCopyDefaults, publicCopySchema } from '../src/modules/sharing/ui/copy';
import { mediaCopy } from '../src/modules/media/copy';
import { feedsCopy } from '../src/modules/feeds/copy';
import { recipeCopy } from '../src/modules/feeds/copy-recipes';
import { publishingErrorCopy, publishingErrorText } from '../src/modules/publishing/error-catalog';
import { parsePostOrigin } from '../src/modules/publishing/server/origin-source';
import { MEDIA_CONFIG } from '../src/modules/media/config';
import { FEEDS_CONFIG } from '../src/modules/feeds/config';
import { SHARING_CONFIG } from '../src/modules/sharing/config';

const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

/** Literal first arguments of the module's `t("...")` helper; a key missing from its catalog silently stays English. */
function literalKeys(dir: string, files: RegExp): string[] {
  const keys = new Set<string>();
  for (const file of walk(dir).filter(path => files.test(path))) {
    for (const match of readFileSync(file, 'utf8').matchAll(/\bt\(\s*(["'])((?:(?!\1)[^\\\n]|\\.)+)\1/g)) keys.add(match[2]!.replace(/\\n/g, '\n').replace(/\\(["'])/g, '$1'));
  }
  return [...keys].sort();
}

describe('customer copy catalogs cover every literal used by their screens', () => {
  it.each([
    ['agency', 'src/modules/agency/ui', /\.tsx$/, agencyCopy],
    ['tasks', 'src/modules/tasks/ui', /\.tsx$/, tasksCopy],
    ['analytics reports', 'src/modules/analytics/ui/reports', /\.tsx$/, reportCopyDefaults],
  ] as const)('%s', (_name, dir, files, catalog) => {
    const entries = catalog as Record<string, { en: string; fr: string }>;
    expect(literalKeys(dir, files).filter(key => !entries[key])).toEqual([]);
    for (const [key, value] of Object.entries(entries)) {
      expect(value.en.trim(), key).not.toBe('');
      expect(value.fr.trim(), key).not.toBe('');
    }
  });
});

const placeholders = (text: string) => [...text.matchAll(/\{\d+\}/g)].map(match => match[0]).sort();

describe('sharing screens read their text from Root-editable catalogs', () => {
  it('every phrase used by the owner screens has English and French text with the same placeholders', () => {
    expect(literalKeys('src/modules/sharing/ui', /\.tsx$/).filter(key => !(key in ownerCopy))).toEqual([]);
    for (const [key, value] of Object.entries(ownerCopy)) {
      expect(value.en.trim(), key).not.toBe('');
      expect(value.fr.trim(), key).not.toBe('');
      expect(placeholders(value.fr), key).toEqual(placeholders(value.en));
    }
  });

  it('keeps the shipped defaults valid for Root and resolves one language at a time', () => {
    expect(ownerCopySchema.safeParse(ownerCopy).success).toBe(true);
    expect(publicCopySchema.safeParse(publicCopyDefaults).success).toBe(true);
    const fr = ownerText(resolveOwnerCopy('fr'));
    expect(fr('Select all')).toBe('Tout sélectionner');
    expect(fr('{0} of {1} selected', 2, 5)).toBe('2 sur 5 sélectionné(s)');
    expect(ownerText(resolveOwnerCopy('en'))('Unlisted phrase {0}', 1)).toBe('Unlisted phrase 1');
  });

  it('serves an edited visitor catalog and rejects one with a missing line', () => {
    const edited = structuredClone(publicCopyDefaults);
    edited.fr.share.truncated = 'Seules {0} publications.';
    expect(publicCopy('fr', edited).share.truncated(3)).toBe('Seules 3 publications.');
    expect(publicCopy('en').share.moreFiles(1)).toBe('1 more uploaded file attached (no preview)');
    const broken = structuredClone(publicCopyDefaults) as { en: { rateLimited?: string } };
    delete broken.en.rateLimited;
    expect(publicCopySchema.safeParse(broken).success).toBe(false);
  });

  it('declares the catalogs as active Root settings', () => {
    const keys = new Map([...MEDIA_CONFIG, ...FEEDS_CONFIG, ...SHARING_CONFIG].map(item => [item.key, item]));
    for (const key of ['media.copy', 'feeds.copy', 'feeds.recipeCopy', 'sharing.ownerCopy', 'sharing.publicCopy']) {
      expect(keys.get(key)?.consumption, key).toBe('active');
      expect(keys.get(key)!.schema.safeParse(keys.get(key)!.defaultValue).success, key).toBe(true);
    }
  });
});

describe('media and feeds keyed catalogs cover every key their screens use', () => {
  it.each([
    ['media', 'src/modules/media/ui', mediaCopy],
    ['feeds', 'src/modules/feeds/ui/FeedManager.tsx', feedsCopy],
    ['feeds screen', 'src/modules/feeds/ui/FeedsScreen.tsx', feedsCopy],
    ['recipes', 'src/modules/feeds/ui/RecipeSource.tsx', recipeCopy],
  ] as const)('%s', (_name, path, catalog) => {
    const files = statSync(path).isDirectory() ? walk(path).filter(file => /\.tsx$/.test(file)) : [path];
    const keys = new Set<string>();
    for (const file of files) for (const match of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'(\w+)'/g)) keys.add(match[1]!);
    expect([...keys].filter(key => !(key in catalog.en) || !(key in catalog.fr))).toEqual([]);
    expect(Object.keys(catalog.fr).sort()).toEqual(Object.keys(catalog.en).sort());
  });
});

const USER_VISIBLE_ATTRS = new Set(['aria-label', 'title', 'placeholder', 'alt', 'label', 'aria-description', 'aria-placeholder']);

/** Attributes whose multi-word string values are code, not copy. */
const TECHNICAL_ATTRS = new Set(['className', 'style', 'href', 'src', 'id', 'name', 'htmlFor', 'role', 'pattern', 'accept', 'autoComplete', 'rel', 'target', 'sizes', 'srcSet', 'viewBox', 'd', 'sandbox']);

/** String literals a JSX expression can render directly: plain, conditional and logical branches. */
function collectLiterals(expr: ts.Node | undefined, emit: (text: string) => void): void {
  if (!expr) return;
  if (ts.isStringLiteralLike(expr)) { if (/\p{L}{2}/u.test(expr.text)) emit(expr.text); }
  else if (ts.isConditionalExpression(expr)) { collectLiterals(expr.whenTrue, emit); collectLiterals(expr.whenFalse, emit); }
  else if (ts.isBinaryExpression(expr) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(expr.operatorToken.kind)) { collectLiterals(expr.left, emit); collectLiterals(expr.right, emit); }
  else if (ts.isParenthesizedExpression(expr)) collectLiterals(expr.expression, emit);
}

/** Reviewed non-copy literals that may appear in customer UI source; every entry needs a reason. */
const LITERAL_ALLOWLIST: Array<{ file: RegExp; text: string; reason: string }> = [
  { file: /analytics\/ui\/demographics\/DemographicsScreen\.tsx$/, text: 'UTC', reason: 'Time-standard abbreviation after a stored UTC period; identical in English and French.' },
  { file: /root\/ui\/RootDiagnosticsClient\.tsx$/, text: 'ms', reason: 'SI unit suffix after a measured duration; identical in English and French.' },
  { file: /feeds\/ui\/FeedManager\.tsx$/, text: 'https://example.com/feed', reason: 'Input-format example for a URL field (the reserved example.com domain); not translatable copy.' },
  { file: /feeds\/ui\/RecipeSource\.tsx$/, text: 'https://', reason: 'URL scheme prefix used as an input-format hint; not translatable copy.' },
  { file: /media\/ui\/MediaLibrary\.tsx$/, text: 'https://example.com/photo.jpg', reason: 'Input-format example for an image URL field (the reserved example.com domain); not translatable copy.' },
  { file: /sharing\/ui\/bio-settings\/BioManager\.tsx$/, text: '/bio/', reason: 'Public URL path prefix shown in front of the editable address; a route, not translatable copy.' },
  { file: /publishing\/ui\/posts\/PostActions\.tsx$/, text: 'message,firstComment,channels', reason: 'CSV column names are the import file contract, not display text; shown in a code element.' },
  { file: /publishing\/ui\/posts\/PostActions\.tsx$/, text: 'firstCommentDelayMinutes', reason: 'Optional CSV column name from the import file contract; shown in a code element.' },
  { file: /publishing\/ui\/compose\/PostVariantsEditor\.tsx$/, text: 'fr', reason: 'BCP 47 locale example in a language-tag input placeholder; identical in English and French.' },
];

/** User-visible string literals in a screen: JSX text and text-bearing attributes. Copy must come from the module catalog. */
function uiLiterals(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Array<{ text: string; entry: string }> = [];
  const add = (node: ts.Node, text: string) => found.push({ text, entry: `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${JSON.stringify(text)}` });
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = node.getText().replace(/\s+/g, ' ').trim();
      if (/\p{L}{2}/u.test(text)) add(node, text);
    } else if (ts.isJsxExpression(node) && ts.isJsxElement(node.parent)) {
      collectLiterals(node.expression, text => { if (/^\p{Lu}|\s/u.test(text)) add(node, text); });
    } else if (ts.isJsxAttribute(node) && node.initializer) {
      const attr = node.name.getText();
      const visible = USER_VISIBLE_ATTRS.has(attr);
      if (visible || !(TECHNICAL_ATTRS.has(attr) || attr.startsWith('data-'))) {
        collectLiterals(ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer, text => { if (visible || /\s/.test(text)) add(node, text); });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found.filter(item => !LITERAL_ALLOWLIST.some(rule => rule.file.test(file) && rule.text === item.text)).map(item => item.entry);
}

describe('publishing origin filter error', () => {
  it('comes from the publishing error catalog in both languages', () => {
    expect(() => parsePostOrigin('unknown', [])).toThrow('Choose a valid post origin.');
    expect(() => parsePostOrigin('unknown', [], publishingErrorText(publishingErrorCopy, 'fr'))).toThrow('Choisissez une origine de publication valide.');
  });
});

describe('every module screen takes its visible text from the module catalog', () => {
  const modules = readdirSync('src/modules').filter(name => statSync(join('src/modules', name)).isDirectory());
  const screens = (name: string) => ['ui', 'components'].map(dir => join('src/modules', name, dir))
    .filter(dir => { try { return statSync(dir).isDirectory(); } catch { return false; } })
    .flatMap(walk).filter(file => /\.tsx$/.test(file) && !/\.test\./.test(file));

  it.each(modules)('%s has no hardcoded JSX text or accessible-name literals', name => {
    expect(screens(name).flatMap(uiLiterals)).toEqual([]);
  });

  it('keeps every allowlist entry reasoned', () => {
    for (const rule of LITERAL_ALLOWLIST) expect(rule.reason.trim(), rule.text).not.toBe('');
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Locale } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * AI alt text for photos: only this workspace's own uploads
 * are read, shrunk before they are sent, and the answer is plain alt text.
 */

type Block = { type: string; text?: string; source?: { media_type: string; data: string } };
let sent: Array<{ system: string; content: string | Block[] }> = [];
let reply = '"A red bicycle leaning on a blue door."';

vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    models = {
      list: async function* () {
        yield { id: 'test-model-newest', display_name: 'Test newest', created_at: '2026-01-01T00:00:00Z' };
      },
    };
    messages = {
      create: async (request: { system: string; messages: Array<{ content: string | Block[] }> }) => {
        sent.push({ system: request.system, content: request.messages[0]!.content });
        return { content: [{ type: 'text', text: reply }], usage: { input_tokens: 900, output_tokens: 20 } };
      },
    };
  }
  return { default: Anthropic };
});

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let ai: typeof import('../src/lib/ai');
let altText: typeof import('../src/lib/alt-text');
const mediaDir = mkdtempSync(path.join(tmpdir(), 'msp-alt-'));

beforeAll(async () => {
  setTestEnv({ ANTHROPIC_API_KEY: 'test-key', MEDIA_DIR: mediaDir });
  database = setupTestDatabase('alt_text');
  ({ prisma } = await import('../src/lib/prisma'));
  ai = await import('../src/lib/ai');
  altText = await import('../src/lib/alt-text');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
  rmSync(mediaDir, { recursive: true, force: true });
});

beforeEach(async () => {
  sent = [];
  reply = '"A red bicycle leaning on a blue door."';
  await prisma.aiGeneration.deleteMany();
  await prisma.media.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
});

async function seed(name = 'Client A') {
  const workspace = await prisma.workspace.create({ data: { name, slug: `ws-${Math.random().toString(36).slice(2)}` } });
  const user = await prisma.user.create({ data: { email: `${workspace.slug}@example.com`, name: 'Sam', passwordHash: 'x' } });
  const storageKey = path.join(workspace.id, 'big.png');
  mkdirSync(path.join(mediaDir, workspace.id), { recursive: true });
  writeFileSync(
    path.join(mediaDir, storageKey),
    await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#cc2222' } }).png().toBuffer(),
  );
  const photo = await prisma.media.create({
    data: { workspaceId: workspace.id, filename: 'big.png', mimeType: 'image/png', size: 1, kind: 'image', storageKey, url: '/media/big.png' },
  });
  return { workspace, user, photo };
}

describe('the photo sent to the AI', () => {
  it('is a small JPEG of the stored upload', async () => {
    const { workspace, photo } = await seed();
    const image = await altText.altTextImage(workspace.id, photo.id);
    expect(image.mimeType).toBe('image/jpeg');
    const meta = await sharp(Buffer.from(image.data, 'base64')).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width!, meta.height!)).toBe(1024);
  });

  it('is never another workspace\'s, a video, or an outside link', async () => {
    const { photo } = await seed('Client A');
    const other = await seed('Client B');
    await expect(altText.altTextImage(other.workspace.id, photo.id)).rejects.toMatchObject({ status: 404 });

    const video = await prisma.media.create({
      data: { workspaceId: other.workspace.id, filename: 'v.mp4', mimeType: 'video/mp4', size: 1, kind: 'video', storageKey: other.photo.storageKey, url: '/v.mp4' },
    });
    await expect(altText.altTextImage(other.workspace.id, video.id)).rejects.toMatchObject({ status: 404 });

    const external = await prisma.media.create({
      data: { workspaceId: other.workspace.id, filename: 'x.jpg', mimeType: 'image/jpeg', size: 1, kind: 'image', url: 'https://example.com/x.jpg' },
    });
    await expect(altText.altTextImage(other.workspace.id, external.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe('the description', () => {
  it('sends the picture with the post, in the audience\'s language, and records it', async () => {
    const { workspace, user, photo } = await seed();
    const image = await altText.altTextImage(workspace.id, photo.id);
    const result = await ai.describeImage({
      workspaceId: workspace.id,
      userId: user.id,
      locale: Locale.en,
      audience: { languages: ['fr'], countries: [] },
      context: 'Our new city bike is here.',
      image,
    });

    expect(result.text).toBe('A red bicycle leaning on a blue door.');
    const content = sent[0]!.content as Block[];
    expect(content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/jpeg', data: image.data } });
    expect(content[1]!.text).toContain('Our new city bike is here.');
    expect(sent[0]!.system).toContain('Write in French.');

    const row = await prisma.aiGeneration.findFirstOrThrow({ where: { workspaceId: workspace.id } });
    expect(row.kind).toBe('altText');
    // The picture itself is never stored in the audit row.
    expect(row.prompt).not.toContain(image.data.slice(0, 40));
  });

  it('is cleaned into one plain paragraph', () => {
    expect(ai.cleanAltText('  “A cat\n on a  mat.”  ')).toBe('A cat on a mat.');
    expect(ai.cleanAltText('x'.repeat(1200))).toHaveLength(1000);
  });
});

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/client';
import { sharingChannels } from '../src/modules/sharing/server/channels';

const url = process.env.REBUILD_PREVIEW_DATABASE_URL;
describe.skipIf(!url)('Sharing current connection visibility on isolated PostgreSQL', () => {
  const suffix = randomUUID().replaceAll('-', '');
  const main = `preview_sharing81_${suffix}`, foreign = `${main}_foreign`;
  const id = (name: string) => `${main}_${name}`;
  let db: PrismaClient;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (process.env.NODE_ENV === 'production' || !['postgres:', 'postgresql:'].includes(parsed.protocol)
      || !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || !decodeURIComponent(parsed.pathname).endsWith('_preview')
      || ['host', 'hostaddr', 'socket'].some(key => parsed.searchParams.has(key))) throw new Error('Only isolated loopback preview database permitted.');
    db = new PrismaClient({datasources:{db:{url:parsed.toString()}}});
    for (const workspaceId of [main, foreign]) await db.workspace.create({data:{id:workspaceId,name:'Disposable Sharing visibility',slug:workspaceId,timezone:'UTC'}});
    for (const [name,workspaceId,invalidatedAt,tokenExpiresAt] of [
      ['live',main,null,null], ['expired',main,null,new Date(0)], ['invalid',main,new Date(),null], ['foreign',foreign,null,null],
    ] as const) await db.socialAccount.create({data:{id:id(`connection_${name}`),workspaceId,provider:'facebook',providerUserId:id(name),name:'Synthetic connection',accessToken:'synthetic-never-used',scopes:'',invalidatedAt,tokenExpiresAt}});
    for (const [name,connection,workspaceId,enabled] of [
      ['live','live',main,true], ['expired','expired',main,true], ['invalid','invalid',main,true], ['orphan',null,main,true],
      ['cross','foreign',main,true], ['disabled','live',main,false], ['foreign','foreign',foreign,true],
    ] as const) await db.target.create({data:{id:id(name),workspaceId,socialAccountId:connection?id(`connection_${connection}`):null,type:'page',providerId:id(`provider_${name}`),name,enabled,canPublish:true,createdAt:new Date()}});
  });
  afterAll(async () => {
    if (!db) return;
    try {
      await db.target.deleteMany({where:{workspaceId:{in:[main,foreign]}}});
      await db.socialAccount.deleteMany({where:{workspaceId:{in:[main,foreign]}}});
      await db.workspace.deleteMany({where:{id:{in:[main,foreign]}}});
      expect(await db.workspace.count({where:{id:{in:[main,foreign]}}})).toBe(0);
      expect(await db.target.count({where:{workspaceId:{in:[main,foreign]}}})).toBe(0);
      expect(await db.socialAccount.count({where:{workspaceId:{in:[main,foreign]}}})).toBe(0);
    } finally { await db.$disconnect(); }
  });
  it('retains expired-token history and excludes orphan, invalidated, disabled, foreign and cross-tenant connections', async () => {
    expect((await sharingChannels(db,main,['facebook'])).map(row=>row.id).sort()).toEqual([id('live'),id('expired')].sort());
  });
  it('never turns an empty provider or target ceiling into all resources', async () => {
    expect(await sharingChannels(db,main,[])).toEqual([]);
    expect(await sharingChannels(db,main,['facebook'],[])).toEqual([]);
    expect(await sharingChannels(db,main,['uninstalled-provider'])).toEqual([]);
  });
  it('filters before applying the picker bound', async () => {
    expect((await sharingChannels(db,main,['facebook'],[id('live')],1)).map(row=>row.id)).toEqual([id('live')]);
  });
  it('does not block a public read behind connection or target bookkeeping updates', async () => {
    await db.$transaction(async holder => {
      await holder.$executeRaw`UPDATE targets SET name='Concurrent bookkeeping' WHERE id=${id('live')}`;
      await expect(db.$transaction(async reader => {
        await reader.$executeRawUnsafe("SET LOCAL statement_timeout = '300ms'");
        return sharingChannels(reader,main,['facebook'],[id('live')]);
      })).resolves.toHaveLength(1);
    });
  });
  it('holds connection and selection row locks until the enclosing feedback transaction finishes', async () => {
    await db.$transaction(async tx => {
      expect((await sharingChannels(tx,main,['facebook'],[id('live')],undefined,true)).length).toBe(1);
      for (const kind of ['connection','target']) {
        await expect(db.$transaction(async contender => {
          await contender.$executeRawUnsafe("SET LOCAL lock_timeout = '100ms'");
          if (kind==='connection') await contender.$executeRaw`UPDATE social_accounts SET "invalidatedAt"=NOW() WHERE id=${id('connection_live')}`;
          else await contender.$executeRaw`UPDATE targets SET enabled=false WHERE id=${id('live')}`;
        })).rejects.toMatchObject({code:'P2010',meta:{code:'55P03'}});
      }
    },{timeout:10000});
    expect((await sharingChannels(db,main,['facebook'],[id('live')])).length).toBe(1);
  });
});

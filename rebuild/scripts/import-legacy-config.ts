/** Dry-run-first migration from legacy Facebook settings into Root configuration. */
import { prisma } from '../src/server/data';
import { decryptSecret } from '../src/server/secret-crypto';
import { CONFIG_BY_KEY } from '../src/lib/config/registry';
import { legacyConfigCandidates, legacyFacebookSettingKeys } from '../src/server/config/legacy-import';
import { saveConfig } from '../src/server/config/store';

const args = process.argv.slice(2);
if (args.length > 1 || (args[0] !== undefined && args[0] !== '--apply')) throw new Error('Usage: import-legacy-config.ts [--apply]');
const apply = args[0] === '--apply';

async function main() {
try {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: [...legacyFacebookSettingKeys] } }, select: { key: true, value: true, encrypted: true } });
  const candidates = legacyConfigCandidates(rows, { appUrl: process.env.APP_URL, decrypt: decryptSecret });
  const planned = [];
  for (const candidate of candidates) {
    const definition = CONFIG_BY_KEY.get(candidate.key);
    if (!definition || !definition.schema.safeParse(candidate.value).success) throw new Error(`Legacy value for ${candidate.source} does not satisfy Root setting ${candidate.key}.`);
    if (await prisma.appSetting.findUnique({ where: { key: candidate.key }, select: { key: true } })) continue;
    planned.push(candidate);
  }
  console.log(`${apply ? 'Applying' : 'Dry run:'} ${planned.length} validated Root settings`);
  for (const candidate of planned) console.log(`  ${candidate.source} -> ${candidate.key}${candidate.secret ? ' (secret)' : ''}`);
  if (apply && planned.length) {
    const owner = await prisma.user.findFirst({ where: { isInstanceOwner: true, disabledAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!owner) throw new Error('An active installation owner is required to audit the configuration import.');
    for (const candidate of planned) await saveConfig({ key: candidate.key, value: candidate.value }, owner.id);
    console.log(`Applied ${planned.length} settings with value-free audit records.`);
  }
} finally {
  await prisma.$disconnect();
}
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Legacy configuration import failed.');
  process.exitCode = 1;
});

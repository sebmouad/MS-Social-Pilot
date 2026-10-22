import sharp from 'sharp';
import { publicWebApp } from '@/modules/settings/web-app/service';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ size: string }> }) {
  const { size } = await context.params;
  // Web app manifest icon dimensions are browser protocol targets, not processing limits.
  if (size !== '192' && size !== '512') return new Response(null, { status: 404 });
  const policy = await publicWebApp();
  const text = policy.iconText.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="${policy.themeColor}"/><text x="256" y="278" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-weight="700" font-size="156" fill="${policy.iconTextColor}">${text}</text></svg>`;
  const png = await sharp(Buffer.from(svg)).resize(Number(size), Number(size)).png().toBuffer();
  return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

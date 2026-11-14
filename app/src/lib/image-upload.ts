'use client';

/** A file the upload accepts: kept as is when allowed and small enough; otherwise redrawn as a JPEG (or PNG), at most 2048 px on its longest side. */
export async function uploadable(file: File, allowed: readonly string[], maxBytes: number): Promise<File> {
  if (allowed.includes(file.type) && file.size > 0 && file.size <= maxBytes) return file;
  if (!file.type.startsWith('image/') && !/\.(heic|heif|webp|avif)$/i.test(file.name)) return file;
  const target = allowed.includes('image/jpeg') ? 'image/jpeg' : allowed.includes('image/png') ? 'image/png' : null;
  if (!target || typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return file;
    if (target === 'image/jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, target, 0.9));
    if (!blob) return file;
    const name = file.name.replace(/\.[a-z0-9]+$/i, '') + (target === 'image/jpeg' ? '.jpg' : '.png');
    return new File([blob], name, { type: target, lastModified: file.lastModified });
  } catch { return file; }
}

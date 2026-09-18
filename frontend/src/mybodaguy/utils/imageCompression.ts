// Resizes + re-encodes an image client-side before it's uploaded to Supabase
// Storage. A raw phone-camera photo is often 3-8MB; Supabase's Free Plan
// bills "Cached Egress" per byte served, so shrinking what gets stored cuts
// the cost of every future view of that image, not just repeat ones.
export async function compressImageFile(file: File, maxDimension = 1600, quality = 0.8): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 150 * 1024) {
    return file; // already small, or animated — canvas re-encoding would break/not help it
  }

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  let { width, height } = bitmap;
  if (width > maxDimension || height > maxDimension) {
    const ratio = Math.min(maxDimension / width, maxDimension / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, width, height);

  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob || blob.size >= file.size) return file; // re-encode didn't actually help — keep the original

  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
}

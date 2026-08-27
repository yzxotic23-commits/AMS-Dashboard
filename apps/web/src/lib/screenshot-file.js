const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 4 * 1024 * 1024;

export const SCREENSHOT_ACCEPT = ACCEPT.join(',');

function looksLikeImageFile(file) {
  if (!file) return false;
  if (ACCEPT.includes(file.type)) return true;
  if (file.type && file.type.startsWith('image/')) return true;
  const name = String(file.name || '').toLowerCase();
  return /\.(jpe?g|png|webp)$/.test(name);
}

export function readScreenshotFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('Choose a screenshot image'));
      return;
    }
    if (!looksLikeImageFile(file)) {
      reject(new Error('Use a JPEG, PNG, or WebP image'));
      return;
    }
    if (file.size > MAX_BYTES) {
      reject(new Error('Screenshot must be under 4 MB'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read screenshot file'));
    reader.readAsDataURL(file);
  });
}

/** First image file from a drag/drop or file-input FileList. */
export function imageFileFromList(list) {
  const files = Array.from(list || []);
  return files.find((f) => looksLikeImageFile(f)) || null;
}

/** First image from a paste / clipboard event. */
export function imageFileFromClipboard(clipboardData) {
  if (!clipboardData) return null;
  const items = Array.from(clipboardData.items || []);
  for (const item of items) {
    if (item.kind === 'file' && (item.type?.startsWith('image/') || !item.type)) {
      const file = item.getAsFile();
      if (file && looksLikeImageFile(file)) return file;
    }
  }
  return imageFileFromList(clipboardData.files);
}

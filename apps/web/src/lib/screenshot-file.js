const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 4 * 1024 * 1024;

export const SCREENSHOT_ACCEPT = ACCEPT.join(',');

export function readScreenshotFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('Choose a screenshot image'));
      return;
    }
    if (!ACCEPT.includes(file.type)) {
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

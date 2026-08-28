/** Turn axios / API errors into a readable string for UI toasts and forms. */
export function formatApiError(err, fallback = 'Request failed') {
  if (!err) return fallback;
  if (typeof err === 'string') return err;

  const data = err.response?.data;
  if (data) {
    if (typeof data.error === 'string') return data.error;
    if (typeof data.message === 'string') return data.message;
    if (data.error && typeof data.error === 'object') {
      if (typeof data.error.message === 'string') return data.error.message;
      if (typeof data.error.error_description === 'string') return data.error.error_description;
    }
  }

  if (typeof err.message === 'string' && err.message && err.message !== '[object Object]') {
    return err.message;
  }

  return fallback;
}

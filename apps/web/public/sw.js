/* AMS desktop alerts — notifications only, no asset caching. */
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/tickets';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (!client.url.startsWith(self.location.origin)) continue;
      if ('focus' in client) await client.focus();
      if ('navigate' in client) {
        try {
          await client.navigate(target);
        } catch {
          /* keep focused client */
        }
      }
      return;
    }
    await self.clients.openWindow(target);
  })());
});

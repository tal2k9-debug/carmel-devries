// Service worker לאתר של קרן — מאפשר "הוסף למסך הבית" ונותן גיבוי כשאין רשת.
// עיקרון: תמיד רשת קודם. הקאש הוא רק רשת-ביטחון, כך שלעולם לא מוצג תוכן ישן כשיש אינטרנט.
const CACHE = 'carmel-v1';
const SHELL = ['./', './index.html', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // גוגל/רווחית/ה-API — ישירות לרשת
  if (url.pathname.includes('/admin/')) return;          // הדשבורד של קרן — בלי קאש בכלל

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});

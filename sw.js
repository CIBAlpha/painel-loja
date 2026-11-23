// Faz o painel funcionar como aplicativo instalável.
// Guarda só a "casca" do app; os números sempre vêm da internet.
const CACHE = 'painel-v1';
const CASCA = ['./', './index.html', './manifest.webmanifest', './icones/icone-192.png', './icones/icone-512.png', './icones/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Supabase e afins: sempre direto da internet
  // Primeiro tenta a internet (para pegar sempre a versão nova); sem internet, usa a cópia guardada
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); return r; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});

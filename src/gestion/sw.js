// Service worker de Gestion : il reçoit les rappels (Web Push) et les affiche, et garde la petite page hors connexion (voir plus bas).
// L'outil se charge toujours depuis le réseau, jamais depuis une ancienne copie.
// Hors connexion : le service worker garde UNIQUEMENT la petite page « hors-ligne » (quatre fichiers) pour afficher la copie de la feuille du jour gardée sur le téléphone quand le
// réseau manque. L'application elle-même n'est jamais mise en cache : elle se charge toujours depuis le réseau, jamais depuis une ancienne copie, donc les mises à jour
// arrivent comme avant. Une navigation vers /gestion/ qui échoue faute de réseau (et seulement elle) reçoit cette page.
const CACHE = "gestion-hors-ligne-v2";
const FICHIERS = ["hors-ligne.html", "hors-ligne.css", "hors-ligne.mjs", "js/feuille-hors-ligne-lecture.mjs"].map((f) => new URL(f, self.registration.scope).href);

self.addEventListener("install", (event) => {
  event.waitUntil(
    // Un fichier à la fois : un 404 passager sur l'un n'empêche pas de garder les autres. Les fichiers sont aussi remis à jour à chaque lecture réussie (ci-dessous).
    caches.open(CACHE).then((c) => Promise.all(FICHIERS.map((f) => c.add(f).catch(() => {})))).then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches.keys().then((noms) => Promise.all(noms.filter((n) => n.startsWith("gestion-hors-ligne-") && n !== CACHE).map((n) => caches.delete(n)))).then(() => self.clients.claim())
  )
);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (req.mode === "navigate") {
    // Réseau d'abord, toujours ; la page hors connexion seulement si la requête échoue.
    event.respondWith(fetch(req).catch(async () => (await caches.match(FICHIERS[0])) || Response.error()));
    return;
  }
  if (FICHIERS.includes(req.url)) {
    // Seuls ces quatre fichiers sont remis à jour dans le cache, quand le réseau répond : la page hors connexion suit les changements sans réinstaller le service worker.
    event.respondWith(fetch(req).then((rep) => { if (rep.ok) { const copie = rep.clone(); caches.open(CACHE).then((c) => c.put(req, copie)).catch(() => {}); } return rep; }).catch(() => caches.match(req)));
  }
});

self.addEventListener("push", (event) => {
  let rappel = {};
  try {
    rappel = event.data ? event.data.json() : {};
  } catch {
    rappel = { corps: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(rappel.titre || "Gestion", {
      body: rappel.corps || "",
      tag: rappel.tag || "gestion",
      icon: "/gestion/assets/zwald-192.png",
      badge: "/gestion/assets/zwald-192.png",
      data: { url: rappel.url || "/gestion/" },
    })
  );
});

// Un appui ouvre l'outil : la fenêtre déjà ouverte est remise devant, sinon une nouvelle s'ouvre.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const racine = `${self.location.origin}/gestion/`;
  const url = new URL((event.notification.data && event.notification.data.url) || "/gestion/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((fenetres) => {
      const ouverte = fenetres.find((f) => f.url.startsWith(racine));
      if (!ouverte) return self.clients.openWindow(url);
      return ouverte.focus().then((f) => (f && "navigate" in f ? f.navigate(url) : f));
    })
  );
});

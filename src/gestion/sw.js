// Service worker de Gestion : il reçoit les rappels (Web Push) et les affiche, et garde la petite page hors connexion (voir plus bas).
// La page de l'outil se charge toujours depuis le réseau, jamais depuis une ancienne copie : c'est elle qui désigne les fichiers de la version en ligne.
// Hors connexion : le service worker garde la petite page « hors-ligne » (quatre fichiers) pour afficher la copie de la feuille du jour gardée sur le
// téléphone quand le réseau manque. Une navigation vers /gestion/ qui échoue faute de réseau (et seulement elle) reçoit cette page.
// Depuis le 19.11.2026, il garde aussi les fichiers regroupés aux noms empreintés (voir PRECHARGE) : une ancienne version ne peut pas
// revenir, puisqu'un autre contenu porte toujours un autre nom.
const CACHE = "gestion-hors-ligne-v2";
const FICHIERS = ["hors-ligne.html", "hors-ligne.css", "hors-ligne.mjs", "js/feuille-hors-ligne-lecture.mjs"].map((f) => new URL(f, self.registration.scope).href);
// Ouverture rapide (19.11.2026) : les fichiers regroupés au build (dossier b/, scripts/regrouper-gestion.cjs) portent l'empreinte de leur contenu
// dans leur nom. Un même nom ne change donc jamais de contenu : ils sont gardés ici dès l'installation et servis sans réseau à l'ouverture suivante.
// index.html, version.json et sw.js ne sont jamais gardés : chaque ouverture lit la page du réseau, qui désigne les fichiers de la version en ligne.
// La liste et la version sont écrites par le build ; dans les sources (prévisualisation sans build) elles sont vides et rien n'est gardé.
const PRECHARGE = [];
const VERSION_APP = "source";
const CACHE_APP = `gestion-app-${VERSION_APP}`;
const RACINE_APP = new URL("b/", self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    // Un fichier à la fois : un 404 passager sur l'un n'empêche pas de garder les autres. Les fichiers sont aussi remis à jour à chaque lecture réussie (ci-dessous).
    Promise.all([
      caches.open(CACHE).then((c) => Promise.all(FICHIERS.map((f) => c.add(f).catch(() => {})))),
      PRECHARGE.length ? caches.open(CACHE_APP).then((c) => Promise.all(PRECHARGE.map((f) => c.add(new URL(f, self.registration.scope).href).catch(() => {})))) : null,
    ]).then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", (event) =>
  event.waitUntil(
    // Les caches d'une version précédente (page hors connexion ou fichiers regroupés) sont effacés.
    caches.keys().then((noms) => Promise.all(noms.filter((n) => (n.startsWith("gestion-hors-ligne-") && n !== CACHE) || (n.startsWith("gestion-app-") && n !== CACHE_APP)).map((n) => caches.delete(n)))).then(() => self.clients.claim())
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
  // Fichier regroupé (nom empreinté) : le cache d'abord, le réseau sinon (et il est gardé pour la fois suivante).
  if (req.url.startsWith(RACINE_APP)) {
    event.respondWith(
      caches.open(CACHE_APP).then((c) =>
        c.match(req).then((garde) => garde || fetch(req).then((rep) => { if (rep.ok) c.put(req, rep.clone()).catch(() => {}); return rep; }))
      )
    );
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
  // Notifications du partenaire chauffeur (tags « p- », migration 123) : la même course garde son tag (la dernière remplace la précédente),
  // renotify la fait sonner de nouveau (une annulation n'arrive pas en silence), et l'icône de VIP Taxi Lanta, une adresse de ce site seulement.
  const partenaire = typeof rappel.tag === "string" && rappel.tag.startsWith("p-");
  const icone = partenaire && typeof rappel.icone === "string" && /^\/gestion\/assets\/[\w.-]+\.png$/.test(rappel.icone) ? rappel.icone : "/gestion/assets/zwald-192.png";
  event.waitUntil(
    self.registration.showNotification(rappel.titre || "Gestion", {
      body: rappel.corps || "",
      tag: rappel.tag || "gestion",
      icon: icone,
      badge: "/gestion/assets/zwald-192.png",
      data: { url: rappel.url || "/gestion/" },
      ...(partenaire ? { renotify: true } : {}),
    })
  );
});

// Un appui ouvre l'outil : la fenêtre déjà ouverte est remise devant, sinon une nouvelle s'ouvre.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const racine = `${self.location.origin}/gestion/`;
  let url = new URL((event.notification.data && event.notification.data.url) || "/gestion/", self.location.origin).href;
  // Le lien d'une PR (demande d'amélioration) s'ouvre à part, sans quitter l'outil ; aucune autre adresse extérieure n'est suivie.
  const externe = !url.startsWith(`${self.location.origin}/`);
  if (externe && !url.startsWith("https://github.com/")) url = racine;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((fenetres) => {
      const ouverte = fenetres.find((f) => f.url.startsWith(racine));
      if (!ouverte || url.startsWith("https://github.com/")) return self.clients.openWindow(url);
      return ouverte.focus().then((f) => (f && "navigate" in f ? f.navigate(url) : f));
    })
  );
});

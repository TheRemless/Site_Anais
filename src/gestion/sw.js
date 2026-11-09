// Service worker de Gestion : il ne sert qu'à recevoir les rappels (Web Push) et à les afficher.
// Il ne met rien en cache et n'intercepte aucune requête : l'outil se charge toujours depuis le réseau, jamais depuis une ancienne copie.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
      icon: "/gestion/assets/icone-192.png",
      badge: "/gestion/assets/icone-192.png",
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

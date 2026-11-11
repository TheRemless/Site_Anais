// Rappels sur téléphone (Web Push) : états possibles, activation, désactivation. L'envoi se fait côté serveur (fonction Supabase « rappels »).
import { CONFIG } from "./config.mjs";
import { tr } from "./i18n.mjs";

// Clé publique VAPID (base64url) en octets, comme l'attend pushManager.subscribe.
export function cleVapid(base64url) {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const binaire = atob(base64);
  return Uint8Array.from(binaire, (c) => c.charCodeAt(0));
}

const iphone = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const installee = () => (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
const prise = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const enregistrement = async () => (await navigator.serviceWorker.getRegistration("./")) || null;

// « installer » : sur iPhone, les rappels n'existent que pour l'app ajoutée à l'écran d'accueil.
export async function situation(store) {
  if (!prise()) return iphone() && !installee() ? "installer" : "indisponible";
  if (Notification.permission === "denied") return "refuse";
  if (Notification.permission !== "granted") return "inactif";
  const reg = await enregistrement();
  const abo = reg ? await reg.pushManager.getSubscription() : null;
  return abo && (await store.rappelsEnregistres(abo.endpoint)) ? "actif" : "inactif";
}

// À appeler depuis un appui : iOS refuse la demande d'autorisation sinon.
export async function activer(store) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(tr("L'autorisation n'a pas été donnée."));
  const reg = await navigator.serviceWorker.register("sw.js", { scope: "./" });
  await navigator.serviceWorker.ready;
  const abo = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleVapid(CONFIG.VAPID_PUBLIC_KEY) }));
  const { endpoint, keys } = abo.toJSON();
  await store.abonnerRappels({ endpoint, p256dh: keys.p256dh, auth: keys.auth });
  return reg;
}

export async function desactiver(store) {
  const reg = await enregistrement();
  const abo = reg ? await reg.pushManager.getSubscription() : null;
  if (!abo) return;
  await store.retirerRappels(abo.endpoint);
  await abo.unsubscribe();
}

// Notification d'essai affichée par le téléphone lui-même : elle prouve que l'affichage fonctionne, pas que le serveur écrit.
export async function essai() {
  const reg = await enregistrement();
  if (!reg) return;
  await reg.showNotification(tr("Rappels activés"), { body: tr("Vous recevrez ici les services de demain et les clients à recontacter."), icon: "/gestion/assets/zwald-192.png", tag: "essai" });
}

// Retire l'appareil à la déconnexion : un téléphone déconnecté ne doit plus recevoir les chiffres du compte.
export async function retirerALaDeconnexion(store) {
  if (!store.retirerRappels || !prise()) return;
  try {
    await desactiver(store);
  } catch {
    /* hors ligne ou déjà retiré : la déconnexion continue */
  }
}

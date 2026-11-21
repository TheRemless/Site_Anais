// Démonstration : l'Assistant donne les vouchers (21.11.2026). Rien ne part chez Anthropic. Le vrai outil (agent-vouchers.mjs, le même
// fichier que la fonction « agent ») tourne sur les données de la démo, avec les droits de la démo (store-local.mjs) ; un agent simulé lit la
// demande en quelques mots (client, jour, heure, dossier). Il émet les mêmes événements que la fonction : l'étape, les cartes, le texte.
import { NOM_OUTIL_VOUCHERS, sansAccentsV, trouverVouchers } from "./agent-vouchers.mjs";

// « le voucher de Leonie Ahmadi », « les vouchers de demain », « la Booking confirmation de la course de 14 h ».
export const questionVouchers = (texte) => /\bvouchers?\b|booking confirmation|confirmation de (?:la )?course/i.test(String(texte || ""));

// Les mots qui ne sont pas un nom de client.
const OUTILS_DE_PHRASE = new Set(
  "le la les l de du des d un une au aux a et ou pour of the for to my me moi mes son sa ses ce cette ces voucher vouchers booking confirmation confirmations course courses transfert transfer taxi excursion service services envoie envoyer envoie-moi donne donne-moi donnez montre montrer trouve trouver prepare preparer peux tu vous stp svp please send show give find get with avec sur est sont il y quel quels quelle quelles aujourd hui aujourdhui today demain tomorrow apres hier yesterday matin soir pickup h heure heures client cliente dossier"
    .split(" ")
);

// Ce que la démo lit d'une demande : l'entrée de trouver_vouchers (client, date, heure, dossier).
export function entreeVouchersDemo(texte) {
  const t = String(texte || "");
  const s = sansAccentsV(t);
  const iso = (/\b(\d{4}-\d{2}-\d{2})\b/.exec(t) || [])[1] || "";
  const date = /apres[- ]?demain/.test(s) ? "apres-demain" : /\bdemain\b|\btomorrow\b/.test(s) ? "demain" : /aujourd ?'?hui|\btoday\b/.test(s) ? "aujourdhui" : /\bhier\b|\byesterday\b/.test(s) ? "hier" : iso;
  const hm = /(?:^|[^\d-])(\d{1,2})\s*(?:h(?![a-zà-ÿ])|:)\s*(\d{2})?(?![\d-])/i.exec(t);
  const heure = hm && Number(hm[1]) <= 23 ? `${hm[1].padStart(2, "0")}:${hm[2] || "00"}` : "";
  const dossier = (/\b(D-[0-9a-f]{8})\b/i.exec(t) || /\b([A-Z]{2,4}-\d{2,6}(?:-\d+)?|\d{4}-\d{4})\b/.exec(t) || [])[1] || "";
  const reste = sansAccentsV(t.replace(dossier, " ").replace(iso, " "))
    .replace(/[^a-z\s'-]+/g, " ")
    .split(/[\s'-]+/)
    .filter((m) => m.length >= 2 && !OUTILS_DE_PHRASE.has(m));
  return { client: reste.join(" "), date, heure, dossier };
}

const jourTexte = (iso, aujourdhui) => {
  if (!iso) return "";
  const ecart = Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${aujourdhui}T12:00:00Z`)) / 86400000);
  if (ecart === 0) return "aujourd'hui";
  if (ecart === 1) return "demain";
  return `le ${new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}`;
};
const MANQUES = { date: "la date", heure_pickup: "l'heure de pickup", lieu_pickup: "le lieu de pickup" };

// Un tour simulé : rend l'appel d'outil (à garder dans le fil comme la fonction), son résultat et la phrase de l'agent.
// `source` : { reservations, dossiers, clients, permises, marque, noms } lus avec les droits de la démo ; `aujourdhui` : AAAA-MM-JJ.
export function repondreVouchersDemo(texte, source, aujourdhui) {
  const entree = entreeVouchersDemo(texte);
  const { resultat } = trouverVouchers(entree, { ...source, aujourdhui });
  let phrase;
  if (resultat.erreur) phrase = "Pour quel client, quel jour ou quelle heure ? Par exemple « le voucher de Paul Martin » ou « les vouchers de demain ».";
  else if (!resultat.reservations.length) {
    const quoi = [entree.client && `pour « ${entree.client} »`, resultat.date && jourTexte(resultat.date, aujourdhui), resultat.heure && `à ${resultat.heure}`].filter(Boolean).join(" ");
    phrase = `Je ne trouve aucune réservation ${quoi || "qui corresponde"}. Les services annulés n'ont pas de voucher : vérifiez le nom, le jour ou l'heure.`;
  } else {
    const n = resultat.reservations.length;
    const cartes = resultat.cartes_affichees;
    const quand = resultat.date ? ` ${jourTexte(resultat.date, aujourdhui)}` : "";
    const plusieurs = new Set(resultat.reservations.map((l) => l.client)).size > 1;
    const manques = resultat.reservations.filter((l) => l.a_completer && l.a_completer.length).map((l) => `${l.service}${plusieurs && l.client ? ` (${l.client})` : ""} : ${l.a_completer.map((m) => MANQUES[m]).join(", ")}`);
    phrase = [
      `${n} ${n > 1 ? "services" : "service"}${quand}, ${cartes > 1 ? `${cartes} cartes, une par dossier` : "une carte"}, avec l'aperçu et le bouton d'envoi.${resultat.tronque ? " J'en montre 20 : précisez le client ou l'heure pour les autres." : ""}`,
      manques.length ? `À compléter avant l'envoi : ${manques.join(" ; ")}.` : "",
      "Rien ne part sans votre clic.",
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  return { appel: { type: "tool_use", id: `toolu_demo_${Math.random().toString(36).slice(2, 10)}`, name: NOM_OUTIL_VOUCHERS, input: entree }, resultat, phrase };
}

// Démonstration : quelques demandes du site et un bandeau, pour essayer la boîte « Demandes du site » et l'écran « Bandeau du site »
// sans base. Les messages ont le format exact que le site envoie à WhatsApp (tests/fixtures/messages-site.json).
// Numéros WhatsApp (migration 41) pris dans des plages réservées à la fiction : +44 7700 900…, +33 6 39 98…, +1 202 555 01…. Tom Lee a tapé un
// numéro sans indicatif (« à vérifier »), Marie Dubois et Eva Rossi viennent d'une page sans le champ.
import { dateDuSite } from "./demandes-site-calc.mjs";

const SECRET = ["excursions", "secret"];
const TAXI = ["taxi"];

export function demandesDemo({ entites, ajd, ajouterJours, uid, maintenant = Date.now() }) {
  const secret = entites.find((e) => SECRET.includes(e.slug));
  const taxi = entites.find((e) => TAXI.includes(e.slug));
  const il_y_a = (minutes) => new Date(maintenant - minutes * 60000).toISOString();
  const j = (n) => ajouterJours(ajd, n);
  const out = [];
  const ajoute = (entite, marque, o) =>
    entite &&
    out.push({
      id: uid(),
      entite_id: entite.id,
      marque,
      statut: "nouvelle",
      ref: null,
      option_id: null,
      option_titre: null,
      heure: null,
      enfants: 0,
      pickup: null,
      total_estime: null,
      devise: "THB",
      traitee_le: null,
      traitee_par: null,
      dossier_id: null,
      decision: {},
      telephone: null,
      telephone_saisi: null,
      ...o,
      updated_at: o.created_at,
    });
  const tour = (produit, option, date, gens, pickup, nom, total) => [`Booking request: ${produit}${option ? ` – ${option}` : ""}`, `Date: ${dateDuSite(date)}`, `Guests: ${gens}`, pickup ? `Pickup: ${pickup}` : "", `Name: ${nom}`, total ? `Estimated total: ${total}` : ""].filter(Boolean).join("\n");

  ajoute(secret, "secret", { created_at: il_y_a(12), ref: "FOUR-7K3Q", produit_id: "4-islands", produit: "4 Islands", option_id: "join-in-longtail", option_titre: "Join-in longtail", date_service: j(2), adultes: 2, enfants: 1, pickup: "Lanta Sand Resort (Klong Dao)", nom: "Anna Keller", telephone: "+447700900123", total_estime: 3000, page_url: "https://secrettravelandtour.com/tours/4-islands/", message: tour("4 Islands", "Join-in longtail", j(2), "2 adults, 1 child (age 7)", "Lanta Sand Resort (Klong Dao)", "Anna Keller", "3,000 THB") });
  ajoute(secret, "secret", { created_at: il_y_a(95), ref: "ROK-M2PX", produit_id: "koh-rok-koh-haa", produit: "Koh Rok & Koh Haa", option_id: "private-longtail", option_titre: "Private longtail", date_service: j(4), adultes: 4, pickup: "Hotel Sunset, Klong Dao", nom: "Tom Lee", telephone_saisi: "081 234 5678", total_estime: 6500, page_url: "https://secrettravelandtour.com/tours/koh-rok-koh-haa/", message: tour("Koh Rok & Koh Haa", "Private longtail", j(4), "4 adults", "Hotel Sunset, Klong Dao", "Tom Lee", "6,500 THB") });
  ajoute(secret, "secret", { created_at: il_y_a(60 * 20), ref: "DIVE-4HTQ", produit_id: "scuba-diving", produit: "Scuba diving", option_id: "fun-dives", option_titre: "Fun dives", date_service: j(6), adultes: 2, pickup: "Pimalai Resort", nom: "Marie Dubois", page_url: "https://secrettravelandtour.com/tours/scuba-diving/", message: tour("Scuba diving", "Fun dives", j(6), "2 adults", "Pimalai Resort", "Marie Dubois", "") });
  ajoute(secret, "secret", { created_at: il_y_a(60 * 50), statut: "confirmee", traitee_le: il_y_a(60 * 48), ref: "FOUR-Q8ZA", produit_id: "4-islands", produit: "4 Islands", option_id: "join-in-longtail", option_titre: "Join-in longtail", date_service: j(-1), adultes: 2, nom: "Lena Braun", telephone: "+33639980001", total_estime: 2400, page_url: "https://secrettravelandtour.com/tours/4-islands/", message: tour("4 Islands", "Join-in longtail", j(-1), "2 adults", "", "Lena Braun", "2,400 THB") });
  ajoute(secret, "secret", { created_at: il_y_a(60 * 75), statut: "refusee", traitee_le: il_y_a(60 * 74), decision: { motif: "mer", alternative: { date: j(-2) } }, ref: "PP-3D7W", produit_id: "koh-phi-phi", produit: "Koh Phi Phi", option_id: "join-in-speedboat", option_titre: "Join-in speedboat", date_service: j(-3), adultes: 3, nom: "Sam Carter", telephone: "+12025550143", total_estime: 5400, page_url: "https://secrettravelandtour.com/tours/koh-phi-phi/", message: tour("Koh Phi Phi", "Join-in speedboat", j(-3), "3 adults", "", "Sam Carter", "5,400 THB") });
  ajoute(taxi, "taxi", { created_at: il_y_a(30), ref: "KBV-9F2L", produit_id: "krabi-airport-koh-lanta", produit: "Krabi Airport to Koh Lanta", date_service: j(1), heure: "14:30", adultes: 2, enfants: 1, pickup: "Krabi Airport (KBV)", nom: "Paul Martin", telephone: "+33639980002", page_url: "https://secrettravelandtour.com/taxi/krabi-airport-koh-lanta/", message: ["Transfer request: Krabi Airport → Koh Lanta", `Date: ${dateDuSite(j(1))}`, "Pickup time: 14:30 (landing)", "Flight or ferry: FD3xxx", "Guests: 2 adults, 1 child (age 5)", "Child seats: 1", "Pickup: Krabi Airport (KBV)", "Drop-off: Lanta Sand Resort", "Name: Paul Martin"].join("\n") });
  ajoute(taxi, "taxi", { created_at: il_y_a(60 * 30), statut: "confirmee", traitee_le: il_y_a(60 * 29), ref: "HKT-2B8C", produit_id: "phuket-airport-koh-lanta", produit: "Phuket Airport to Koh Lanta", date_service: j(-1), heure: "11:00", adultes: 4, pickup: "Phuket Airport (HKT)", nom: "Eva Rossi", page_url: "https://secrettravelandtour.com/taxi/phuket-airport-koh-lanta/", message: "" });
  return out;
}

export function bandeauxDemo({ entites, ajd, uid }) {
  const secret = entites.find((e) => SECRET.includes(e.slug));
  if (!secret) return [];
  const debut = `${ajd}T06:00:00+07:00`;
  return [
    { id: uid(), created_at: debut, updated_at: debut, entite_id: secret.id, cree_par: null, marques: ["secret"], type: "season", modele: "season-until", valeurs: { trip: "sunset-dinner-raft", date: `${String(Number(ajd.slice(0, 4)) + 1)}-01-15`, etiquette: "From 15 Jan" }, texte: `Sunset dinner raft does not run until 15 January ${Number(ajd.slice(0, 4)) + 1}.`, lien: "page", lien_page: "/tours/sunset-dinner-raft/", cible: "produits", sections: [], produits: ["sunset-dinner-raft"], debut, fin: `${Number(ajd.slice(0, 4)) + 1}-01-15T00:00:00+07:00`, fermable: true, priorite: 2, actif: true },
  ].map((b) => ({ ...b, valeurs: { ...b.valeurs, lien_libelle: "See Sunset dinner raft" } }));
}

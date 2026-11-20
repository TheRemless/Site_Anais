// Démonstration de la boîte WhatsApp : quatre conversations inventées, pour essayer l'écran sans Telnyx ni base.
// Numéros pris dans des plages réservées à la fiction (+44 7700 900…, +1 202 555 01…). Aucun nom, prix ni horaire ne vient d'un vrai client.
//   1. un client connu de Taxi avec son dossier, réponse prête (avec deux avertissements) ;
//   2. un inconnu à trier qui demande une excursion, réponse prête et entreprise proposée par l'agent (Secret) ;
//   3. une conversation déjà répondue depuis l'app, fenêtre de 24 h fermée, une photo expirée ;
//   4. un client rangé par l'agent dans Taxi, réponse en préparation.
const SECRET = ["excursions", "secret"];
const TAXI = ["taxi"];

export function whatsappDemo({ entites, clients = [], dossiers = [], uid, organisation, maintenant = Date.now() }) {
  const secret = entites.find((e) => SECRET.includes(e.slug));
  const taxi = entites.find((e) => TAXI.includes(e.slug));
  const out = { whatsapp_conversations: [], whatsapp_messages: [], whatsapp_propositions: [], whatsapp_reglages: [] };
  if (!secret && !taxi) return out;
  const il_y_a = (minutes) => new Date(maintenant - minutes * 60000).toISOString();
  out.whatsapp_reglages.push({ organisation_id: organisation, reception_active: true, numero: "+447700900100", etat_compte: "CONNECTED", etat_le: il_y_a(60 * 24 * 3), dernier_evenement_le: il_y_a(4), updated_at: il_y_a(60 * 24 * 3) });

  const conversation = (o) => {
    const c = { id: uid(), created_at: il_y_a(60 * 24 * 2), updated_at: il_y_a(5), organisation_id: organisation, nom: null, entite_id: null, entite_source: "auto", client_id: null, dossier_id: null, dernier_message_le: null, dernier_sens: null, non_lus: 0, ...o };
    out.whatsapp_conversations.push(c);
    return c;
  };
  const message = (c, minutes, sens, texte, o = {}) => {
    const m = { id: uid(), conversation_id: c.id, sens, origine: sens === "entrant" ? "client" : "app", type: "text", texte, medias: [], envoye_le: il_y_a(minutes), recu_le: il_y_a(minutes), modifie_le: null, supprime_le: null, ...o };
    out.whatsapp_messages.push(m);
    if (!c.dernier_message_le || Date.parse(m.envoye_le) > Date.parse(c.dernier_message_le)) Object.assign(c, { dernier_message_le: m.envoye_le, dernier_sens: sens });
    return m;
  };
  const proposition = (c, m, o) => out.whatsapp_propositions.push({ id: uid(), cree_le: m ? m.envoye_le : il_y_a(1), conversation_id: c.id, message_id: m ? m.id : null, entite_id: c.entite_id, statut: "a_faire", texte: "", langue: "en", avertissements: [], entreprise_proposee: null, erreur: null, traitee_le: null, traitee_par: null, traitee_par_quoi: null, ...o });

  // 1. Client connu de Taxi, avec son dossier : il demande l'heure de prise en charge.
  if (taxi) {
    const client = clients.find((x) => x.entite_id === taxi.id && dossiers.some((d) => d.client_id === x.id && !d.annule)) || null;
    const dossier = client ? dossiers.find((d) => d.client_id === client.id && !d.annule) : null;
    const prenom = (client && client.prenom) || "Tom";
    const c = conversation({ telephone: "+447700900311", nom: prenom, entite_id: taxi.id, entite_source: "client", client_id: client ? client.id : null, dossier_id: dossier ? dossier.id : null, non_lus: 2 });
    message(c, 60 * 20, "entrant", "Hello, we booked the taxi to Krabi airport with you.");
    message(c, 60 * 20 - 6, "sortant", `Hi ${prenom}, yes all good, see you on the day.`, { origine: "app" });
    message(c, 14, "entrant", "Hi again! Our flight is at 13:40, what time will the driver pick us up?");
    const m = message(c, 13, "entrant", "And can we bring 3 big suitcases?");
    proposition(c, m, { texte: `Hi ${prenom},\n\nThe driver will pick you up at your hotel at 08:30, which leaves plenty of time for your 13:40 flight.\n3 big suitcases are fine in the van.\n\nSee you tomorrow!`, avertissements: ["heure_non_source:08:30", "signature_retiree"] });
  }

  // 2. Numéro inconnu, à trier : il demande une excursion. L'agent propose Secret.
  if (secret) {
    const c = conversation({ telephone: "+12025550147", nom: "Lucia", non_lus: 1 });
    message(c, 9, "entrant", "Hi! Do you still have places for the 4 Islands tour on Saturday? We are 2 adults and 1 child (6 years).");
    const photo = message(c, 8, "entrant", "This is our hotel", { type: "image", texte: null, medias: [{ type: "image", mime: "image/jpeg", legende: "This is our hotel", nom: "photo.jpg", chemin: "demo/hotel.jpg", statut: "copie", taille: 182000 }] });
    proposition(c, photo, { entreprise_proposee: "secret", texte: "Hi Lucia,\n\nYes, there are still places on the 4 Islands tour this Saturday. For 2 adults and 1 child the price is 3,000 THB, pickup from your hotel included.\nShall I book it for you? I just need the name of your hotel and a first name for the booking.", avertissements: ["montant_non_source:3000"] });
  }

  // 3. Déjà répondue depuis l'app par Nani, il y a plus de 24 h : la fenêtre est fermée, la photo a expiré.
  if (secret) {
    const c = conversation({ telephone: "+447700900522", nom: "Mark & Jo", entite_id: secret.id, entite_source: "manuel" });
    message(c, 60 * 31, "entrant", null, { type: "image", medias: [{ type: "image", mime: "image/jpeg", legende: null, nom: "", chemin: null, statut: "efface", taille: null }] });
    const m = message(c, 60 * 30, "entrant", "Thanks for the snorkelling day, the kids loved it!");
    message(c, 60 * 30 - 1, "entrant", "Ok see you", { modifie_le: il_y_a(60 * 30 - 2), texte: "Ok see you next year" });
    message(c, 60 * 29, "sortant", "Thank you both, it was a pleasure. Have a safe trip home!", { origine: "app" });
    proposition(c, m, { statut: "traitee", texte: "Thank you so much, we are happy the kids enjoyed it. Have a safe trip home!", traitee_le: il_y_a(60 * 29), traitee_par_quoi: "app" });
  }

  // 4. Rangée par l'agent dans Taxi, la réponse se prépare.
  if (taxi) {
    const c = conversation({ telephone: "+447700900733", nom: "Sven", entite_id: taxi.id, entite_source: "agent", non_lus: 1 });
    message(c, 60 * 3, "entrant", "Hello, how much is a taxi from Saladan pier to Long Beach?");
    message(c, 60 * 2 + 50, "sortant", "Hi Sven, it is a short ride, I will send you the price in a minute.", { origine: "gestion" });
    const m = message(c, 1, "entrant", "Great, and can you also do Old Town tomorrow morning?");
    message(c, 0.5, "entrant", "Sorry wrong photo", { supprime_le: il_y_a(0.2) });
    proposition(c, m, { statut: "en_cours" });
  }
  return out;
}

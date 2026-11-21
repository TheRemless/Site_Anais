// Démonstration de la boîte WhatsApp : cinq conversations inventées, pour essayer l'écran sans Telnyx ni base.
// Numéros pris dans des plages réservées à la fiction (+44 7700 900…, +1 202 555 01…). Aucun nom, prix ni horaire ne vient d'un vrai client.
//   1. un client connu de Taxi avec son dossier, réponse prête (avec deux avertissements) ;
//   2. un inconnu à trier qui demande une excursion, réponse prête préparée pour Secret, l'entreprise que l'agent propose ;
//   3. une conversation déjà répondue depuis l'app, fenêtre de 24 h fermée, une photo expirée ;
//   4. un client rangé par Nani dans Taxi, réponse en préparation ;
//   5. un chauffeur réglé sur « Jamais » (migration 60) : son message n'a pas de réponse préparée, « Préparer une réponse » en fait une ;
//   6. Jade, travel planner et amie de Nani, qui envoie deux clients dans un même message (conversationJade). Elle sert aux PR suivantes
//      (contacts typés : apporteur ; deux dossiers depuis un message).
// Suivi (migrations 61 et 62) : résumé en trois lignes, signal de paiement et promesse en tâche, sur la conversation 3 reliée à un
// dossier de Secret non soldé (`suivi` : { dossier, client, ajd, ajouterJours }). Rend aussi `taches` à ajouter à la démo.
import { apercuDepuisMessages } from "./whatsapp-calc.mjs";

const SECRET = ["excursions", "secret"];
const TAXI = ["taxi"];

export function whatsappDemo({ entites, clients = [], dossiers = [], uid, organisation, maintenant = Date.now(), suivi = null }) {
  const secret = entites.find((e) => SECRET.includes(e.slug));
  const taxi = entites.find((e) => TAXI.includes(e.slug));
  const out = { whatsapp_conversations: [], whatsapp_messages: [], whatsapp_propositions: [], whatsapp_reglages: [], taches: [] };
  if (!secret && !taxi) return out;
  const il_y_a = (minutes) => new Date(maintenant - minutes * 60000).toISOString();
  out.whatsapp_reglages.push({ organisation_id: organisation, reception_active: true, numero: "+447700900100", etat_compte: "CONNECTED", etat_le: il_y_a(60 * 24 * 3), dernier_evenement_le: il_y_a(4), updated_at: il_y_a(60 * 24 * 3) });

  const conversation = (o) => {
    const c = { id: uid(), created_at: il_y_a(60 * 24 * 2), updated_at: il_y_a(5), organisation_id: organisation, nom: null, entite_id: null, entite_source: "auto", client_id: null, dossier_id: null, dernier_message_le: null, dernier_sens: null, non_lus: 0, reponses: "auto", tri: {}, ...o };
    out.whatsapp_conversations.push(c);
    return c;
  };
  const message = (c, minutes, sens, texte, o = {}) => {
    const m = { id: uid(), conversation_id: c.id, sens, origine: sens === "entrant" ? "client" : "app", type: "text", texte, medias: [], envoye_le: il_y_a(minutes), recu_le: il_y_a(minutes), modifie_le: null, supprime_le: null, ...o };
    out.whatsapp_messages.push(m);
    if (!c.dernier_message_le || Date.parse(m.envoye_le) > Date.parse(c.dernier_message_le)) Object.assign(c, { dernier_message_le: m.envoye_le, dernier_sens: sens });
    // Aperçu de la liste (migration 65) : le même calcul que le déclencheur de la base.
    Object.assign(c, apercuDepuisMessages(out.whatsapp_messages.filter((x) => x.conversation_id === c.id)));
    return m;
  };
  const proposition = (c, m, o) => out.whatsapp_propositions.push({ id: uid(), cree_le: m ? m.envoye_le : il_y_a(1), conversation_id: c.id, message_id: m ? m.id : null, entite_id: c.entite_id, statut: "a_faire", texte: "", langue: "en", avertissements: [], entreprise_proposee: null, erreur: null, traitee_le: null, traitee_par: null, traitee_par_quoi: null, ...o });

  // 1. Client connu de Taxi, avec son dossier : il demande l'heure de prise en charge. Réponses sur demande (défaut du 20.11.2026) : le tri
  // a vu une demande de client, rien n'est rédigé tant que Nani ne touche pas « Préparer une réponse ».
  if (taxi) {
    const client = clients.find((x) => x.entite_id === taxi.id && dossiers.some((d) => d.client_id === x.id && !d.annule)) || null;
    const dossier = client ? dossiers.find((d) => d.client_id === client.id && !d.annule) : null;
    const prenom = (client && client.prenom) || "Tom";
    const c = conversation({ telephone: "+447700900311", nom: prenom, entite_id: taxi.id, entite_source: "client", client_id: client ? client.id : null, dossier_id: dossier ? dossier.id : null, non_lus: 2 });
    message(c, 60 * 20, "entrant", "Hello, we booked the taxi to Krabi airport with you.");
    message(c, 60 * 20 - 6, "sortant", `Hi ${prenom}, yes all good, see you on the day.`, { origine: "app" });
    message(c, 14, "entrant", "Hi again! Our flight is at 13:40, what time will the driver pick us up?");
    message(c, 13, "entrant", "And can we bring 3 big suitcases?");
    c.tri = { preparer: true, motif: "demande_client", entreprise: "taxi", le: il_y_a(12) };
  }

  // 2. Numéro inconnu, à trier : il demande une excursion. L'agent propose Secret.
  if (secret) {
    const c = conversation({ telephone: "+12025550147", nom: "Lucia", non_lus: 1 });
    message(c, 9, "entrant", "Hi! Do you still have places for the 4 Islands tour on Saturday? We are 2 adults and 1 child (6 years).");
    const photo = message(c, 8, "entrant", "This is our hotel", { type: "image", texte: null, medias: [{ type: "image", mime: "image/jpeg", legende: "This is our hotel", nom: "photo.jpg", chemin: "demo/hotel.jpg", statut: "copie", taille: 182000 }] });
    // L'agent ne range pas la conversation : il propose Secret et prépare la réponse avec les données de Secret.
    c.tri = { preparer: true, motif: "demande_client", entreprise: "secret", le: il_y_a(8) };
    proposition(c, photo, { entite_id: secret.id, entreprise_proposee: "secret", texte: "Hi Lucia,\n\nYes, there are still places on the 4 Islands tour this Saturday. For 2 adults and 1 child the price is 3,000 THB, pickup from your hotel included.\nShall I book it for you? I just need the name of your hotel and a first name for the booking.", avertissements: ["montant_non_source:3000"] });
  }

  // 3. Déjà répondue depuis l'app par Nani, il y a plus de 24 h : la fenêtre est fermée, la photo a expiré.
  if (secret) {
    const c = conversation({ telephone: "+447700900522", nom: "Mark & Jo", entite_id: secret.id, entite_source: "manuel" });
    message(c, 60 * 31, "entrant", null, { type: "image", medias: [{ type: "image", mime: "image/jpeg", legende: null, nom: "", chemin: null, statut: "efface", taille: null }] });
    const m = message(c, 60 * 30, "entrant", "Thanks for the snorkelling day, the kids loved it!");
    message(c, 60 * 30 - 1, "entrant", "Ok see you", { modifie_le: il_y_a(60 * 30 - 2), texte: "Ok see you next year" });
    message(c, 60 * 29, "sortant", "Thank you both, it was a pleasure. Have a safe trip home!", { origine: "app" });
    proposition(c, m, { statut: "traitee", texte: "Thank you so much, we are happy the kids enjoyed it. Have a safe trip home!", traitee_le: il_y_a(60 * 29), traitee_par_quoi: "app" });
    // Suivi : reliée à un dossier de Secret non soldé, avec une preuve de paiement et une promesse de Nani.
    if (suivi && suivi.dossier) {
      const { dossier, client, ajd, ajouterJours } = suivi;
      Object.assign(c, { client_id: dossier.client_id, dossier_id: dossier.id, nom: (client && client.prenom) || c.nom });
      message(c, 60 * 2, "entrant", "Hi again! We would like to take the ferry to Koh Phi Phi on Saturday, the 2 of us.");
      message(c, 60 * 2 - 5, "sortant", "Perfect, I booked it for you. I will confirm the pickup time tomorrow.", { origine: "app" });
      const preuve = message(c, 25, "entrant", "Here is the transfer receipt", { type: "image", texte: null, medias: [{ type: "image", mime: "image/jpeg", legende: "Here is the transfer receipt", nom: "receipt.jpg", chemin: "demo/receipt.jpg", statut: "copie", taille: 96000 }] });
      message(c, 20, "sortant", "Thank you, I will check and confirm.", { origine: "app" });
      Object.assign(c, {
        non_lus: 0,
        resume: "Couple déjà venu au snorkelling, revient pour Koh Phi Phi.\nFerry Koh Lanta – Koh Phi Phi samedi pour 2 personnes, réservé par Nani.\nPaiement à confirmer, heure de pickup promise pour demain.",
        resume_le: il_y_a(20),
        paiement_signale: { message_id: preuve.id, le: il_y_a(25), motif: "piece" },
        promesse_le: ajd,
        tri: { preparer: false, motif: "suivi_reservation", entreprise: "secret", le: il_y_a(24) },
      });
      out.taches.push({ id: uid(), created_at: ajd, entite_id: dossier.entite_id, dossier_id: dossier.id, partenaire_id: null, titre: `WhatsApp, ${(client && client.prenom) || c.nom} : confirmer l'heure de pickup du ferry`, description: "Promesse faite dans WhatsApp (tâche créée par Gestion).", echeance: ajouterJours(ajd, 1), assignee_id: null, fait: false, fait_le: null, fait_par: null, cree_par: null });
    }
  }

  // 4. Rangée par Nani dans Taxi, la réponse se prépare.
  if (taxi) {
    const c = conversation({ telephone: "+447700900733", nom: "Sven", entite_id: taxi.id, entite_source: "manuel", non_lus: 1 });
    message(c, 60 * 3, "entrant", "Hello, how much is a taxi from Saladan pier to Long Beach?");
    message(c, 60 * 2 + 50, "sortant", "Hi Sven, it is a short ride, I will send you the price in a minute.", { origine: "gestion" });
    const m = message(c, 1, "entrant", "Great, and can you also do Old Town tomorrow morning?");
    message(c, 0.5, "entrant", "Sorry wrong photo", { supprime_le: il_y_a(0.2) });
    c.tri = { preparer: true, motif: "demande_client", entreprise: "taxi", le: il_y_a(1) };
    c.resume = "Demande le prix d'un taxi de Saladan pier à Long Beach.\nNani a promis le prix depuis Gestion.\nVeut aussi aller à Old Town demain matin.";
    c.resume_le = il_y_a(1);
    proposition(c, m, { statut: "en_cours" });
  }

  // 6. Jade, travel planner, envoie deux clients d'un coup.
  if (secret) {
    const j = conversationJade({ secret, uid, organisation, maintenant });
    out.whatsapp_conversations.push(...j.whatsapp_conversations);
    out.whatsapp_messages.push(...j.whatsapp_messages);
  }

  // 5. Un chauffeur, contact réglé sur « Jamais » : le tri n'a rien préparé, le message reste non lu.
  if (taxi) {
    const c = conversation({ telephone: "+447700900844", nom: "Driver Somchai", entite_id: taxi.id, entite_source: "manuel", reponses: "jamais", non_lus: 1 });
    message(c, 60 * 5, "sortant", "Pickup Lanta Sand 14:00 tomorrow, 2 pax, airport.", { origine: "app" });
    message(c, 42, "entrant", "Ok, I am at the pier in 5 min");
    c.tri = { preparer: false, motif: "contact_jamais", entreprise: "taxi", le: il_y_a(42) };
  }
  return out;
}

// Jade, travel planner et amie de Nani : elle envoie deux clients dans un même message (un couple pour une excursion, une famille pour un
// taxi depuis l'aéroport). Rangée chez Secret par Nani, réponses « automatiques » (ce n'est pas un contact personnel : l'Assistant la lit).
// Ajoutée aussi aux démos déjà enregistrées (store-local.mjs). Numéros de fiction (+44 7700 900…), aucun vrai client.
export function conversationJade({ secret, uid, organisation, maintenant = Date.now() }) {
  const il_y_a = (minutes) => new Date(maintenant - minutes * 60000).toISOString();
  const c = { id: uid(), created_at: il_y_a(60 * 24 * 30), updated_at: il_y_a(35), organisation_id: organisation, telephone: "+447700900955", nom: "Jade, travel planner", entite_id: secret ? secret.id : null, entite_source: "manuel", client_id: null, dossier_id: null, dernier_message_le: null, dernier_sens: null, non_lus: 1, reponses: "auto", tri: { preparer: true, motif: "demande_client", entreprise: "secret", le: il_y_a(34) } };
  const messages = [
    { minutes: 60 * 24 * 6, sens: "entrant", texte: "Hi Nani! Hope the season started well 😊" },
    { minutes: 60 * 24 * 6 - 20, sens: "sortant", texte: "Hi Jade! Yes, busy already. Send me your people anytime." },
    {
      minutes: 35,
      sens: "entrant",
      texte:
        "Two bookings for you!\n1) Emma and Paul, 2 adults, staying at Long Beach from Tuesday. They would love a snorkelling day, Koh Rok if possible. Emma's WhatsApp: +44 7700 900412\n2) My client Marco, family of 4 (2 kids, 5 and 8), lands at Krabi airport on Friday at 14:00 and needs a taxi to Klong Nin.\nCan you take care of both? Thank you so much!",
    },
  ].map((x) => ({ id: uid(), conversation_id: c.id, sens: x.sens, origine: x.sens === "entrant" ? "client" : "app", type: "text", texte: x.texte, medias: [], envoye_le: il_y_a(x.minutes), recu_le: il_y_a(x.minutes), modifie_le: null, supprime_le: null }));
  const dernier = messages[messages.length - 1];
  Object.assign(c, { dernier_message_le: dernier.envoye_le, dernier_sens: dernier.sens }, apercuDepuisMessages(messages));
  return { whatsapp_conversations: [c], whatsapp_messages: messages };
}

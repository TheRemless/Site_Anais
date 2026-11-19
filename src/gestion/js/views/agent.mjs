// Onglet « Assistant » (19.11.2026) : on discute avec l'agent comme dans une messagerie, une conversation par client ou par demande,
// plusieurs ouvertes en parallèle. L'agent cherche, calcule et propose ; chaque proposition est une carte que la personne valide.
// « Valider » ouvre l'écran habituel de l'outil déjà rempli (Coller une demande, formulaire de réservation) : c'est lui qui enregistre.
// Téléphone d'abord : la liste, puis le fil en plein écran avec la zone de saisie en bas. Ordinateur : la liste à gauche, le fil à droite.
import { etat, reglages, peut, naviguer, exemple, nomPartenaire, modeTaxi } from "../etat.mjs";
import { h, toast, confirmer, modal, icone, vider, ajouter } from "../ui.mjs";
import { tr, N_, pluriel, langueActive } from "../i18n.mjs";
import { agentActif, filDepuis, listeConversations, quand, propositionDepuisCarte, reservationDepuisCarte, reservationModifiee, lignesFrise } from "../agent-calc.mjs";
import { texteDuree } from "../agent-planifier.mjs";
import { propositionVersDemande } from "../assistant-calc.mjs";

const ERREURS = {
  assistant_eteint: N_("L'assistant est éteint pour cette entreprise (Réglages)."),
  agent_eteint: N_("L'onglet Assistant est éteint pour cette entreprise (Réglages)."),
  droit_manquant: N_("Votre rôle ne permet pas d'utiliser l'assistant ici."),
  limite_du_jour: N_("Limite d'échanges du jour atteinte : l'assistant reprend demain."),
  plafond_du_mois: N_("Le budget du mois de l'assistant est atteint : demandez à l'administration de le relever."),
  non_configure: N_("L'assistant n'est pas encore activé sur le serveur."),
  occupe: N_("L'assistant est très demandé : réessayez dans une minute."),
  refus: N_("L'assistant n'a pas traité ce message."),
  coupe: N_("La réponse était trop longue : demandez la suite."),
  trop_long: N_("L'assistant a pris trop de temps : demandez-lui de continuer."),
  hors_ligne: N_("Pas de connexion : le message n'est pas parti."),
  coupure: N_("La connexion a coupé pendant la réponse : rouvrez la conversation."),
  migration_manquante: N_("Les conversations ne sont pas encore installées dans la base."),
  conversation_introuvable: N_("Cette conversation n'existe plus."),
  message_invalide: N_("Le message est vide ou trop long."),
};
const erreurTexte = (code) => tr(ERREURS[code] || N_("L'assistant ne répond pas."));

const AVERTISSEMENTS = {
  signature_retiree: N_("La signature en bas a été retirée : la réponse ne signe pas."),
  nom_prestataire: N_("Le message cite un prestataire : à retirer avant d'envoyer."),
  prenom_equipe: N_("Le message nomme quelqu'un de l'équipe : à retirer, la réponse ne signe pas."),
  prix_non_tape: N_("Un prix proposé ne venait ni du catalogue ni de vous : il a été laissé vide."),
  reference_inconnue: N_("Un service proposé n'existe pas au catalogue : choisissez-le à la main."),
  date_illisible: N_("Une date n'a pas pu être lue."),
};
function texteAvertissement(a) {
  const [code, valeur] = String(a).split(/:(.*)/s);
  if (code === "montant_non_source") return tr("Montant sans source dans la conversation : {v}. À vérifier.", { v: valeur });
  if (code === "heure_non_source") return tr("Heure sans source dans la conversation : {v}. À vérifier.", { v: valeur });
  if (code === "mot_interne") return tr("Mot interne dans la réponse : « {v} ». À retirer.", { v: valeur });
  return tr(AVERTISSEMENTS[code] || N_("À vérifier."));
}

// Ce que l'agent est en train de faire, par outil (la fonction envoie le nom de l'outil).
const ETAPES = {
  chercher_catalogue: N_("Je cherche dans le catalogue"),
  horaires_trajet: N_("Je regarde les horaires"),
  situer_hotels: N_("Je situe les hôtels"),
  temps_de_route: N_("Je calcule le temps de route"),
  planifier_course: N_("Je calcule les horaires de la course"),
  chercher_clients: N_("Je cherche le client"),
  lire_dossier: N_("Je lis le dossier"),
  proposer_dossier: N_("Je prépare le dossier"),
  proposer_reservation: N_("Je prépare le service"),
  proposer_modification: N_("Je prépare la modification"),
  proposer_reponse: N_("Je prépare la réponse"),
};

const disponible = () => agentActif(reglages()) && peut("partenaires.lire") && peut("dossiers.ecrire");

// ---- Écran -----------------------------------------------------------------------------------------------------------------------

export async function vueAgent(idOuvert = "") {
  if (!disponible()) {
    const racine = h("div", { "data-titre": tr("Assistant") });
    racine.append(
      h("h1", null, tr("Assistant")),
      h("div", { class: "vide" }, h("p", null, peut("dossiers.ecrire") ? tr("L'assistant n'est pas allumé pour cette entreprise.") : tr("Votre rôle ne permet pas d'utiliser l'assistant ici.")), peut("reglages.ecrire") ? h("a", { href: "#/reglages" }, tr("Ouvrir les réglages")) : null)
    );
    return racine;
  }

  const racine = h("div", { class: "agent", "data-titre": tr("Assistant") });
  let conversations = (await etat.store.agentConversations(etat.entiteId)) ?? null;
  let attente = new Map();
  let archives = false;
  const rafraichirAttente = async () => {
    const lignes = await etat.store.agentAttente(etat.entiteId);
    attente = new Map();
    for (const l of lignes) attente.set(l.conversation_id, (attente.get(l.conversation_id) || 0) + 1);
  };
  await rafraichirAttente();

  const colonneListe = h("section", { class: "agent-liste", "aria-label": tr("Conversations") });
  const colonneFil = h("section", { class: "agent-fil", "aria-live": "off" });
  racine.append(colonneListe, colonneFil);
  racine.classList.toggle("avec-fil", !!idOuvert);

  // ---- Liste ----------------------------------------------------------------------------------------------------------------------
  function dessinerListe() {
    const liste = conversations ? listeConversations(conversations, { enAttente: attente, archives }) : [];
    vider(colonneListe);
    ajouter(colonneListe, [
      h("div", { class: "agent-liste-tete" }, h("h1", null, tr("Assistant")), h("button", { class: "principal", type: "button", onclick: () => ouvrir("") }, icone("ajouter", 18), tr("Nouvelle"))),
      conversations === null
        ? h("p", { class: "aide" }, erreurTexte("migration_manquante"))
        : liste.length
          ? h(
              "ul",
              { class: "agent-conversations" },
              liste.map((c) =>
                h(
                  "li",
                  null,
                  h(
                    "a",
                    { href: `#/agent/${c.id}`, class: "agent-conv", "aria-current": c.id === idOuvert ? "page" : null },
                    h("span", { class: "agent-conv-ligne" }, h("strong", null, c.titre || tr("Nouvelle conversation")), h("time", { datetime: c.maj_le }, quand(c.maj_le, { langue: langueActive() }))),
                    h("span", { class: "agent-conv-ligne" }, h("span", { class: "agent-conv-apercu" }, c.apercu || ""), c.attente ? h("span", { class: "agent-pastille", "aria-label": pluriel(c.attente, N_("{n} proposition à valider"), N_("{n} propositions à valider")) }, c.attente) : null)
                  )
                )
              )
            )
          : h("p", { class: "aide agent-liste-vide" }, archives ? tr("Aucune conversation archivée.") : tr("Aucune conversation. Commencez par une demande de client : une conversation par client garde tout en ordre.")),
      conversations && conversations.some((c) => c.statut === "archivee") ? h("button", { class: "lien agent-archives", type: "button", onclick: () => ((archives = !archives), dessinerListe()) }, archives ? tr("Conversations ouvertes") : tr("Conversations archivées")) : null,
    ]);
  }

  // ---- Fil ------------------------------------------------------------------------------------------------------------------------
  let enCours = false;
  let conv = null; // la conversation ouverte (null : nouvelle)
  let fil = { messages: [], cartes: [] };
  const zoneFil = h("div", { class: "agent-messages" });
  const champ = h("textarea", { id: "agent-message", rows: 1, maxlength: 8000, "aria-label": tr("Message à l'assistant"), placeholder: tr("Écrire à l'assistant") });
  const envoyerBouton = h("button", { class: "principal agent-envoyer", type: "submit", "aria-label": tr("Envoyer") }, icone("fleche", 20));
  const formulaire = h("form", { class: "agent-saisie", onsubmit: (e) => (e.preventDefault(), envoyer()) }, champ, envoyerBouton);
  const ajuster = () => {
    champ.style.height = "auto";
    champ.style.height = `${Math.min(champ.scrollHeight, 220)}px`;
  };
  champ.addEventListener("input", ajuster);
  // Ordinateur : Entrée envoie, Maj+Entrée va à la ligne. Téléphone : Entrée va à la ligne, le bouton envoie.
  champ.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(hover: hover) and (pointer: fine)").matches) {
      e.preventDefault();
      envoyer();
    }
  });

  async function ouvrir(id) {
    if (id !== idOuvert) {
      idOuvert = id;
      history.replaceState(null, "", id ? `#/agent/${id}` : "#/agent/nouvelle");
    }
    racine.classList.add("avec-fil");
    conv = id && conversations ? conversations.find((c) => c.id === id) || null : null;
    fil = { messages: [], cartes: [] };
    if (id && !conv) {
      dessinerFil();
      zoneFil.replaceChildren(h("p", { class: "aide" }, erreurTexte("conversation_introuvable")));
      return;
    }
    if (conv) fil = (await etat.store.agentFil(conv.id)) || fil;
    dessinerListe();
    dessinerFil();
    champ.focus({ preventScroll: true });
  }

  function fermer() {
    idOuvert = "";
    racine.classList.remove("avec-fil");
    history.replaceState(null, "", "#/agent");
    dessinerListe();
  }

  function enTete() {
    const dossier = conv && conv.dossier_id ? etat.db.dossiers.find((d) => d.id === conv.dossier_id) : null;
    return h(
      "header",
      { class: "agent-fil-tete" },
      h("button", { class: "bouton-icone agent-retour", type: "button", onclick: fermer, "aria-label": tr("Retour aux conversations") }, icone("retour", 22)),
      h("div", { class: "agent-fil-titre" }, h("h2", null, conv ? conv.titre : tr("Nouvelle conversation")), dossier ? h("a", { class: "agent-dossier", href: `#/dossier/${dossier.id}` }, tr("Dossier {ref}", { ref: dossier.ref })) : null),
      conv ? h("button", { class: "bouton-icone secondaire", type: "button", onclick: menuConversation, "aria-label": tr("Options de la conversation") }, icone("ellipsis", 20)) : null
    );
  }

  function menuConversation() {
    const ferme = modal(
      tr("Conversation"),
      h(
        "div",
        { class: "agent-menu" },
        h("button", { class: "secondaire", type: "button", onclick: () => (ferme(), renommer()) }, tr("Renommer")),
        h("button", { class: "secondaire", type: "button", onclick: () => (ferme(), relier()) }, conv.dossier_id ? tr("Changer le dossier relié") : tr("Relier à un dossier")),
        h("button", { class: "secondaire", type: "button", onclick: () => (ferme(), archiver()) }, conv.statut === "archivee" ? tr("Rouvrir") : tr("Archiver")),
        h("button", { class: "danger", type: "button", onclick: () => (ferme(), supprimer()) }, tr("Supprimer"))
      ),
      { feuille: true, protege: false }
    );
  }
  async function majConv(patch) {
    const c = await etat.store.agentMajConversation(conv.id, patch);
    conversations = conversations.map((x) => (x.id === c.id ? { ...x, ...c } : x));
    conv = conversations.find((x) => x.id === c.id);
    dessinerListe();
    dessinerFil();
  }
  function renommer() {
    const champTitre = h("input", { id: "agent-titre", value: conv.titre, maxlength: 120 });
    const ferme = modal(tr("Renommer"), h("form", { onsubmit: async (e) => (e.preventDefault(), await majConv({ titre: champTitre.value.trim().slice(0, 120) || conv.titre }), ferme()) }, h("label", { for: "agent-titre" }, tr("Titre")), champTitre, h("div", { class: "actions" }, h("button", { class: "principal", type: "submit" }, tr("Enregistrer")))), { protege: false });
  }
  function relier() {
    const recherche = h("input", { id: "agent-dossier-q", type: "search", placeholder: tr("Référence ou nom du client"), autocomplete: "off" });
    const liste = h("ul", { class: "agent-choix-dossier" });
    const nomClient = (d) => {
      const c = etat.db.clients.find((x) => x.id === d.client_id);
      return c ? [c.prenom, c.nom].filter(Boolean).join(" ") : "";
    };
    const dessiner = () => {
      const q = recherche.value.trim().toLowerCase();
      const trouves = etat.db.dossiers.filter((d) => !q || `${d.ref} ${nomClient(d)}`.toLowerCase().includes(q)).sort((a, b) => String(b.date_depart || "").localeCompare(String(a.date_depart || ""))).slice(0, 12);
      liste.replaceChildren(...trouves.map((d) => h("li", null, h("button", { class: "secondaire", type: "button", onclick: async () => (ferme(), await majConv({ dossier_id: d.id })) }, `${d.ref} ${nomClient(d)}`))));
    };
    recherche.addEventListener("input", dessiner);
    const ferme = modal(tr("Relier à un dossier"), h("div", null, h("label", { for: "agent-dossier-q" }, tr("Dossier")), recherche, liste, conv.dossier_id ? h("button", { class: "lien", type: "button", onclick: async () => (ferme(), await majConv({ dossier_id: null })) }, tr("Retirer le lien")) : null), { protege: false });
    dessiner();
  }
  const archiver = () => majConv({ statut: conv.statut === "archivee" ? "ouverte" : "archivee" });
  async function supprimer() {
    if (!(await confirmer(tr("Supprimer cette conversation et ses propositions ? Les dossiers déjà créés restent."), tr("Supprimer"), true))) return;
    await etat.store.agentSupprimerConversation(conv.id);
    conversations = conversations.filter((c) => c.id !== conv.id);
    fermer();
  }

  // Suggestions d'une conversation vide : des exemples de l'agence (exemple(), jamais un lieu écrit en dur).
  function suggestions() {
    const s = [
      tr("Course samedi : pickup à {hotel}, rendez-vous à 16:00, une heure d'attente, puis {aeroport}.", { hotel: exemple("hotel"), aeroport: exemple("aeroport") }),
      tr("Le client demande les horaires et les prix de ses trajets entre ses hôtels : je colle son message."),
      tr("Retrouve le dossier de ce client et propose de décaler son pickup."),
    ];
    return h("div", { class: "agent-vide" }, h("p", null, tr("Une conversation par client. Écrivez la demande comme à une collègue, ou collez le message du client.")), h("ul", { class: "agent-suggestions" }, s.map((x) => h("li", null, h("button", { class: "secondaire", type: "button", onclick: () => ((champ.value = x), ajuster(), champ.focus()) }, x)))));
  }

  function dessinerFil() {
    const items = filDepuis(fil.messages, fil.cartes);
    zoneFil.replaceChildren(...(items.length ? items.map(element) : [suggestions()]));
    colonneFil.replaceChildren(enTete(), zoneFil, formulaire);
    descendre();
  }
  const descendre = () => requestAnimationFrame(() => {
    zoneFil.scrollTop = zoneFil.scrollHeight;
    if (!matchMedia("(min-width: 900px)").matches) window.scrollTo({ top: document.documentElement.scrollHeight });
  });

  function element(it) {
    if (it.genre === "personne") return h("div", { class: "agent-bulle de-personne" }, paragraphes(it.texte));
    if (it.genre === "agent") return h("div", { class: "agent-bulle de-agent" }, paragraphes(it.texte));
    if (it.genre === "planning") return frise(it.planning);
    return carte(it.carte);
  }
  const paragraphes = (t) => String(t).split(/\n{2,}/).map((p) => h("p", null, ...p.split("\n").flatMap((l, i) => (i ? [h("br"), l] : [l]))));

  // ---- Envoi ------------------------------------------------------------------------------------------------------------------
  async function envoyer() {
    const texte = champ.value.trim();
    if (!texte || enCours) return;
    enCours = true;
    envoyerBouton.disabled = true;
    envoyerBouton.setAttribute("aria-busy", "true");
    champ.value = "";
    ajuster();
    if (!zoneFil.querySelector(".agent-bulle, .agent-frise, .agent-carte")) zoneFil.replaceChildren();
    zoneFil.append(h("div", { class: "agent-bulle de-personne" }, paragraphes(texte)));
    const etape = h("p", { class: "agent-etape", role: "status" }, h("span", { class: "agent-point", "aria-hidden": "true" }), tr("L'assistant réfléchit"));
    let bulle = null;
    let texteRecu = "";
    zoneFil.append(etape);
    descendre();
    const r = await etat.store.agentEnvoyer({ entite_id: etat.entiteId, conversation_id: conv ? conv.id : null, texte }, (ev) => {
      if (ev.t === "conversation" && !conv) {
        conv = { id: ev.id, entite_id: etat.entiteId, titre: ev.titre, apercu: "", dossier_id: ev.dossier_id || null, statut: "ouverte", maj_le: new Date().toISOString() };
        conversations = [conv, ...(conversations || [])];
        idOuvert = ev.id;
        history.replaceState(null, "", `#/agent/${ev.id}`);
        colonneFil.querySelector(".agent-fil-tete").replaceWith(enTete());
      } else if (ev.t === "etape") {
        etape.lastChild.textContent = `${tr(ETAPES[ev.outil] || N_("L'assistant réfléchit"))}…`;
        bulle = null;
        texteRecu = "";
      } else if (ev.t === "texte") {
        if (!bulle) {
          bulle = h("div", { class: "agent-bulle de-agent" });
          etape.before(bulle);
        }
        texteRecu += ev.delta;
        bulle.replaceChildren(...paragraphes(texteRecu));
      } else if (ev.t === "planning") {
        etape.before(frise(ev.planning));
        bulle = null;
        texteRecu = "";
      } else if (ev.t === "carte") {
        fil.cartes.push(ev.carte);
        etape.before(carte(ev.carte));
        bulle = null;
        texteRecu = "";
      } else if (ev.t === "erreur") {
        etape.before(h("p", { class: "agent-erreur", role: "alert" }, erreurTexte(ev.erreur)));
      }
      descendre();
    });
    etape.remove();
    if (r && r.erreur) {
      zoneFil.append(h("p", { class: "agent-erreur", role: "alert" }, erreurTexte(r.erreur)));
      if (!conv) champ.value = texte;
    }
    enCours = false;
    envoyerBouton.disabled = false;
    envoyerBouton.removeAttribute("aria-busy");
    if (conv) {
      // Relecture depuis la base : le fil affiché est exactement celui qui repartira chez l'assistant.
      fil = (await etat.store.agentFil(conv.id)) || fil;
      conversations = (await etat.store.agentConversations(etat.entiteId)) || conversations;
      conv = conversations.find((c) => c.id === conv.id) || conv;
      await rafraichirAttente();
      dessinerListe();
      dessinerFil();
    }
  }

  // ---- Frise d'une course -------------------------------------------------------------------------------------------------------
  function frise(plan) {
    const points = lignesFrise(plan);
    const sousTrajet = (t) =>
      [
        tr("{d} de route", { d: texteDuree(t.route_min) }),
        t.ferry ? tr("ferry, {m} min d'attente comptées", { m: t.ferry_attente_min }) : "",
        tr("{m} min de marge", { m: t.marge_min }),
      ]
        .filter(Boolean)
        .join(", ");
    const v = plan.vol;
    const verdict = v
      ? h(
          "p",
          { class: `agent-vol ${v.verdict}` },
          icone(v.verdict === "tenable" ? "coche" : "alerte", 18),
          v.verdict === "tenable"
            ? tr("Vol de {h} tenable : arrivée limite {l}, {m} min de marge.", { h: v.heure, l: v.arrivee_limite.heure, m: v.marge_restante_min })
            : v.verdict === "juste"
              ? tr("Vol de {h} juste : arrivée limite {l}, toutes les marges y passent.", { h: v.heure, l: v.arrivee_limite.heure })
              : tr("Vol de {h} pas tenable : arrivée limite {l}.", { h: v.heure, l: v.arrivee_limite.heure })
        )
      : null;
    const date = new Date(`${plan.date}T12:00:00Z`).toLocaleDateString(langueActive() === "en" ? "en-GB" : "fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
    return h(
      "figure",
      { class: "agent-frise" },
      h("figcaption", null, tr("Course du {date}", { date }), plan.alertes.includes("temps_simules") ? h("span", { class: "agent-simule" }, tr("Temps simulés")) : null),
      h(
        "ol",
        null,
        points.map((p, i) =>
          h(
            "li",
            { class: ["agent-point-course", i === 0 ? "depart" : "", p.rendezVous ? "rdv" : ""].filter(Boolean).join(" ") },
            h("span", { class: "agent-heure" }, p.heure),
            h(
              "div",
              { class: "agent-lieu" },
              h("strong", null, p.lieu),
              i === 0 ? h("span", null, tr("Pickup")) : null,
              p.rendezVous ? h("span", null, p.fourchette ? tr("Rendez-vous, arrivée prévue vers {h}", { h: p.fourchette[0] }) : tr("Rendez-vous")) : p.fourchette ? h("span", null, tr("Arrivée entre {a} et {b}", { a: p.fourchette[0], b: p.fourchette[1] })) : null,
              p.attente ? h("span", null, tr("{m} min sur place, départ à {h}", { m: p.attente, h: p.depart })) : null,
              p.trajet ? h("span", { class: "agent-trajet" }, sousTrajet(p.trajet)) : null
            )
          )
        )
      ),
      verdict,
      h("details", { class: "agent-hypotheses" }, h("summary", null, tr("Hypothèses du calcul")), h("ul", null, plan.hypotheses.map((x) => h("li", null, x))))
    );
  }

  // ---- Cartes ---------------------------------------------------------------------------------------------------------------------
  const devise = () => reglages().devise || "THB";
  const jourCourt = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString(langueActive() === "en" ? "en-GB" : "fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "");
  const prixTexte = (s) => (s.prix === null || s.prix === undefined ? h("span", { class: "agent-prix vide" }, tr("Prix à fixer")) : h("span", { class: "agent-prix" }, `${Number(s.prix).toLocaleString("en-US")} ${devise()}`, h("small", null, s.origine_prix === "saisi" ? tr("donné par vous") : tr("catalogue"))));

  function carte(c) {
    const d = c.donnees || {};
    const corps = [];
    let action = null;
    if (c.genre === "dossier") {
      corps.push(h("p", { class: "agent-carte-client" }, [d.client && d.client.nom, d.client && d.client.hotel, pluriel(d.adultes || 0, N_("{n} adulte"), N_("{n} adultes")), d.enfants ? pluriel(d.enfants, N_("{n} enfant"), N_("{n} enfants")) : ""].filter(Boolean).join(", ")));
      corps.push(h("ul", { class: "agent-services" }, (d.services || []).map((s) => h("li", null, h("span", null, h("strong", null, s.libelle || s.texte), h("small", null, [jourCourt(s.date), s.heure_pickup && tr("pickup {h}", { h: s.heure_pickup }), s.remarque].filter(Boolean).join(", "))), prixTexte(s)))));
      action = { libelle: tr("Préparer le dossier"), faire: () => ouvrirDossier(c) };
    } else if (c.genre === "reservation") {
      const s = d.service || {};
      corps.push(h("p", null, tr("Dossier {ref}", { ref: d.dossier_ref || "" })), h("ul", { class: "agent-services" }, h("li", null, h("span", null, h("strong", null, s.libelle || s.texte), h("small", null, [jourCourt(s.date), s.heure_pickup && tr("pickup {h}", { h: s.heure_pickup })].filter(Boolean).join(", "))), prixTexte(s))));
      action = { libelle: tr("Ajouter au dossier"), faire: () => ouvrirReservation(c) };
    } else if (c.genre === "modification") {
      corps.push(h("p", null, h("strong", null, d.libelle)), h("p", { class: "agent-modif" }, h("del", null, d.avant || tr("vide")), " ", icone("fleche", 16), " ", h("ins", null, d.valeur)), d.raison ? h("p", { class: "aide" }, d.raison) : null);
      action = { libelle: tr("Ouvrir la modification"), faire: () => ouvrirModification(c) };
    } else if (c.genre === "reponse") {
      const zone = h("textarea", { class: "agent-reponse", rows: 8, "aria-label": tr("Réponse au client"), lang: d.langue === "en" ? "en" : "fr" });
      zone.value = d.message || "";
      corps.push(zone);
      action = { libelle: tr("Copier la réponse"), faire: () => copier(c, zone.value) };
    }
    const avert = (c.avertissements || []).length ? h("ul", { class: "assistant-avertissements" }, c.avertissements.map((a) => h("li", null, texteAvertissement(a)))) : null;
    const libelles = { dossier: N_("Nouveau dossier"), reservation: N_("Service à ajouter"), modification: N_("Modification"), reponse: N_("Réponse au client") };
    const decidee = c.statut !== "proposee";
    return h(
      "article",
      { class: `agent-carte ${c.statut}`, "data-carte": c.id },
      h("header", null, h("span", { class: "agent-carte-genre" }, tr(libelles[c.genre] || N_("Proposition"))), c.titre && c.titre !== tr(libelles[c.genre] || "") ? h("h3", null, c.titre) : null),
      ...corps,
      avert,
      decidee
        ? h("p", { class: "agent-carte-sort" }, icone(c.statut === "validee" ? "coche" : "fermer", 16), c.statut === "validee" ? tr("Validée") : tr("Écartée"))
        : h("div", { class: "actions gauche" }, h("button", { class: "principal", type: "button", onclick: () => action.faire() }, action.libelle), h("button", { class: "secondaire", type: "button", onclick: () => decider(c, "ecartee") }, tr("Écarter")))
    );
  }

  async function decider(c, statut) {
    const maj = await etat.store.agentCarte(c.id, statut);
    fil.cartes = fil.cartes.map((x) => (x.id === maj.id ? maj : x));
    await rafraichirAttente();
    dessinerListe();
    const ancien = zoneFil.querySelector(`[data-carte="${c.id}"]`);
    if (ancien) ancien.replaceWith(carte(maj));
  }

  async function ouvrirDossier(c) {
    const contexte = { prestations: etat.db.prestations, trajets: etat.db.trajets, partenaires: etat.db.partenaires, nomPartenaire, taxi: modeTaxi() };
    const prep = propositionVersDemande(propositionDepuisCarte(c.donnees), contexte);
    (await import("./demande.mjs")).ouvrirDemande(null, { texte: "", ...prep });
    await decider(c, "validee");
  }
  async function ouvrirReservation(c) {
    const { formulaireReservation } = await import("./reservations.mjs");
    const ferme = modal(tr("Nouvelle réservation"), formulaireReservation(reservationDepuisCarte(c.donnees), async () => (ferme(), toast(tr("Service ajouté au dossier.")), await decider(c, "validee"))));
  }
  async function ouvrirModification(c) {
    const r = etat.db.reservations.find((x) => x.id === c.donnees.reservation_id);
    if (!r) return toast(tr("Ce service n'existe plus."), true);
    const { formulaireReservation } = await import("./reservations.mjs");
    const ferme = modal(tr("Modifier la réservation"), formulaireReservation(reservationModifiee(r, c.donnees), async () => (ferme(), toast(tr("Service modifié.")), await decider(c, "validee"))));
  }
  async function copier(c, texte) {
    try {
      await navigator.clipboard.writeText(texte);
      toast(tr("Réponse copiée : collez-la dans WhatsApp."));
      await decider(c, "validee");
    } catch {
      toast(tr("Copie impossible : sélectionnez le texte et copiez-le."), true);
    }
  }

  dessinerListe();
  if (idOuvert) await ouvrir(idOuvert === "nouvelle" ? "" : idOuvert);
  else if (matchMedia("(min-width: 900px)").matches) {
    // Ordinateur : le fil d'une nouvelle conversation est prêt à droite.
    colonneFil.replaceChildren(enTete(), zoneFil, formulaire);
    zoneFil.replaceChildren(suggestions());
  }
  return racine;
}

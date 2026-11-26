import { etat, inserer, modifier, modifierProtege, supprimer, nomClient, naviguer, resumeDossier, reglages, reglagesDe, peut, corbeilleDossiers, modeExcursions, modeTaxi, recharger, clientParId, clientEtranger, etiquetteClient, clientsPartages, partageClientsPermis, nomEntreprise, sigleDe, entiteActive } from "../etat.mjs";
import { h, champ, modal, confirmer, toast, icone, erreurChamp } from "../ui.mjs";
import { formatMontant, formatDate } from "../calc.mjs";
import { pastille, vide, listeAdaptative, barreFiltres } from "./commun.mjs";
import { demanderArbitrage } from "./conflit.mjs";
import { correspond } from "../mobile-calc.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";
import { clientsProches } from "../demande-calc.mjs";
import { verifierTelephoneClient, numerosClient, chambreDeLAdresse, adresseAvecChambre, peutFusionnerClients, messageTelephone } from "../client-calc.mjs";
import { servicesSuivantAdresse, fusionClients } from "../dossier-gestes-calc.mjs";
import { aujourdhui } from "../calc.mjs";
import { selecteurClient } from "./selecteur-client.mjs";
import { dossiersAilleurs } from "../partage-clients-calc.mjs";

// Fiche partagée par une autre entreprise (migration 46) : le sigle de son entreprise à côté du nom.
const etiquette = (c) => {
  const s = etiquetteClient(c);
  return s ? h("span", { class: "etiquette-partage", title: tr("Fiche de {entreprise}, partagée : un changement se voit des deux côtés.", { entreprise: nomEntreprise(c.entite_id) }) }, s) : null;
};

function formulaireClient(client, apres) {
  // Secret et Taxi n'ont pas de civilité : le champ n'apparaît pas et la valeur déjà enregistrée reste telle quelle (rien n'est imposé).
  // En voyages sur mesure (ZTP), la civilité garde sa liste et sa première valeur par défaut.
  // Une fiche partagée par une autre entreprise (ZTP ouverte dans Secret) garde la forme de son entreprise : civilité, adresse postale.
  const etrangere = clientEtranger(client);
  const reglagesFiche = etrangere ? reglagesDe(client.entite_id) : reglages();
  const sansCivilite = etrangere ? ["excursions", "taxi"].includes(reglagesFiche.fonctionnement) : modeExcursions();
  const civilites = [...reglagesFiche.listes.civilites];
  if (client.civilite && !civilites.includes(client.civilite)) civilites.push(client.civilite);
  const civ = h("select", { id: "c-civ" }, sansCivilite ? [h("option", { value: client.civilite || "" }, client.civilite || "")] : civilites.map((x) => h("option", { value: x }, tr(x))));
  civ.value = sansCivilite ? client.civilite || "" : client.civilite || civilites[0] || "";
  const prenom = h("input", { id: "c-prenom", value: client.prenom || "" });
  const nom = h("input", { id: "c-nom", value: client.nom || "", required: true });
  const tel = h("input", { id: "c-tel", type: "tel", value: client.telephone || "" });
  const email = h("input", { id: "c-email", type: "email", value: client.email || "" });
  // Secret : l'hôtel et la chambre, que les vouchers impriment. La chambre reste rangée dans l'adresse (« Baiyok Hotel, Room 6 »).
  const avecChambre = !etrangere && modeExcursions() && !modeTaxi();
  const lu = avecChambre ? chambreDeLAdresse(client.adresse) : { adresse: client.adresse || "", chambre: "" };
  const adresse = h("textarea", { id: "c-adr", rows: avecChambre ? 2 : 3 });
  adresse.value = lu.adresse;
  const chambre = h("input", { id: "c-chambre", value: lu.chambre, autocomplete: "off", placeholder: "12" });
  const notes = h("textarea", { id: "c-notes", rows: 2 });
  notes.value = client.notes || "";
  return h(
    "form",
    {
      class: "formulaire",
      onsubmit: async (e) => {
        e.preventDefault();
        // Un numéro saisi ou modifié doit avoir son indicatif (+41, +33, +66…) : il sert à appeler et à écrire sur WhatsApp, l'indicatif n'est jamais deviné.
        const verif = verifierTelephoneClient(tel.value, client.telephone);
        erreurChamp(tel, "");
        if (!verif.ok) {
          erreurChamp(tel, messageTelephone(verif.raison));
          return tel.focus();
        }
        const valeurs = { civilite: civ.value, prenom: prenom.value.trim(), nom: nom.value.trim(), telephone: verif.valeur, email: email.value.trim(), adresse: avecChambre ? adresseAvecChambre(adresse.value, chambre.value) : adresse.value.trim(), notes: notes.value.trim() };
        // Seuls les champs changés partent : un autre champ modifié entre-temps par quelqu'un d'autre n'est pas écrasé.
        const changes = client.id ? Object.fromEntries(Object.entries(valeurs).filter(([k, v]) => (client[k] || "") !== v)) : valeurs;
        let c;
        try {
          c = client.id ? (Object.keys(changes).length ? await modifierProtege("clients", client.id, changes, { base: client, arbitrer: arbitrerClient(client) }) : client) : await inserer("clients", valeurs);
        } catch (err) {
          if (err.annule) return toast(err.message, true);
          throw err;
        }
        toast(tr("Client enregistré."));
        // Hôtel ou chambre changés : les services à venir copiés de l'ancien hôtel sont proposés à la mise à jour (vouchers, feuille du jour).
        // Une fiche partagée (ZTP) a une adresse postale : elle ne donne pas le lieu de pickup des services d'ici.
        if (client.id && "adresse" in changes && !etrangere) await suivreAdresse(client, changes.adresse);
        apres(c);
      },
    },
    h("div", { class: "grille-form" }, sansCivilite ? null : champ(tr("Civilité"), civ), champ(tr("Prénom"), prenom), champ(tr("Nom"), nom), champ(tr("Téléphone"), tel), champ("E-mail", email, tr("Pour votre usage, il n'apparaît pas sur les documents."))),
    avecChambre
      ? h("div", { class: "grille-form" }, champ(tr("Hôtel ou adresse"), adresse), champ(tr("Numéro de chambre"), chambre, tr("Imprimé sur les vouchers quand le pickup est à cet hôtel.")))
      : champ(etrangere ? tr("Adresse (fiche {sigle})", { sigle: sigleDe(client.entite_id) }) : modeExcursions() ? tr("Adresse") : tr("Adresse, telle qu'elle doit apparaître sur le devis"), adresse, etrangere ? tr("L'adresse de la fiche {sigle}. Le lieu de pickup se note sur chaque service.", { sigle: sigleDe(client.entite_id) }) : null),
    champ(tr("Notes"), notes),
    (etrangere ? partageClientsPermis(client.entite_id) : peut("clients.ecrire")) ? h("div", { class: "actions" }, h("button", { class: "principal", type: "submit" }, tr("Enregistrer le client"))) : h("p", { class: "aide" }, tr("Lecture seule : votre rôle ne permet pas de modifier les clients."))
  );
}

// Peut-on corriger cette fiche ? Mêmes droits que la fiche client : « clients.ecrire » ; une fiche partagée par une autre entreprise (ZTP),
// seulement l'administration qui l'utilise ici. Jamais un client dont on ne voit que le nom (l'assistante).
export const peutModifierFiche = (c) => !!c && !c.nom_seul && (clientEtranger(c) ? partageClientsPermis(c.entite_id) : peut("clients.ecrire"));

// « Modifier la fiche client » depuis un autre écran (Modifier le dossier, 18.11.2026) : la fiche dans une fenêtre par-dessus, l'écran
// d'en dessous et sa saisie restent. Une fiche ZTP ouverte dans Secret ou Taxi est la fiche unique de ZTP. `apres(client)` après l'enregistrement.
export function ouvrirFicheClientModal(client, apres = () => {}) {
  if (!peutModifierFiche(client)) return;
  const sigle = etiquetteClient(client);
  const fermer = modal(
    sigle ? tr("Fiche client ({sigle})", { sigle }) : tr("Fiche client"),
    h(
      "div",
      { class: "modal-corps" },
      sigle ? h("p", { class: "bandeau-partage", role: "note" }, tr("Fiche de {source} : la modifier ici la modifie aussi dans {source}.", { source: nomEntreprise(client.entite_id) })) : null,
      formulaireClient(client, (c) => {
        fermer();
        apres(c);
      })
    )
  );
}

// Le lieu de pickup est copié de la fiche client à la création du service : un hôtel ou une chambre changés après coup n'y arrivaient pas.
async function suivreAdresse(client, adresse) {
  if (!peut("dossiers.ecrire")) return;
  const dossiers = new Set(etat.db.dossiers.filter((d) => d.client_id === client.id && !d.annule).map((d) => d.id));
  const aSuivre = servicesSuivantAdresse({ avant: client.adresse, apres: adresse, reservations: etat.db.reservations.filter((r) => dossiers.has(r.dossier_id)), aujourdhui: aujourdhui() });
  if (!aSuivre.length) return;
  const noms = aSuivre.slice(0, 3).map((x) => x.reservation.libelle).join(", ") + (aSuivre.length > 3 ? "…" : "");
  const nouveau = String(adresse || "").split("\n")[0].trim();
  const question = pluriel(aSuivre.length, N_("{n} service à venir part encore de l'ancien hôtel ({noms}). Mettre son lieu de pickup à « {nouveau} » ? Le voucher et la feuille du jour suivront."), N_("{n} services à venir partent encore de l'ancien hôtel ({noms}). Mettre leur lieu de pickup à « {nouveau} » ? Les vouchers et la feuille du jour suivront."), { noms, nouveau });
  if (!(await confirmer(question, tr("Mettre à jour les services"), false, tr("Garder l'ancien lieu")))) return;
  try {
    for (const { reservation, champs } of aSuivre) await modifier("reservations", reservation.id, champs);
    toast(pluriel(aSuivre.length, N_("{n} service mis à jour."), N_("{n} services mis à jour.")));
  } catch (err) {
    toast(tr("Un service n'a pas pu être mis à jour : {message}", { message: err.message }), true);
  }
}

// Fusionner une autre fiche dans celle-ci : ses dossiers passent ici, les champs vides d'ici prennent les siens, puis elle disparaît.
// On garde la fiche ouverte ; pour garder l'autre, on ouvre l'autre fiche.
// Une fiche partagée par une autre entreprise (ZTP) choisie ici : c'est elle qui est gardée, cette fiche-ci y est rattachée (doublon d'avant le partage).
function ouvrirFusion(client, propose = null) {
  const sel = selecteurClient({ id: "fusion-client", libelle: tr("Fiche à fusionner dans celle-ci"), valeur: propose || "", surChangement: () => majResume() });
  // `autre` : la fiche choisie. `garde` : celle qui reste (cette fiche, ou la fiche partagée choisie).
  const choisie = () => (sel.valeur && sel.valeur !== client.id ? clientParId(sel.valeur) : null);
  const sens = (autre) => (clientEtranger(autre) ? { garde: autre, absorbe: client } : { garde: client, absorbe: autre });
  const resume = h("div", { class: "fusion-resume", "aria-live": "polite" });
  const bouton = h("button", { type: "button", class: "danger", disabled: true }, tr("Fusionner"));
  const majResume = () => {
    const autre = choisie();
    bouton.disabled = !autre;
    if (!autre) return resume.replaceChildren(sel.valeur === client.id ? h("p", { class: "erreur-form" }, tr("Choisissez une autre fiche que celle-ci.")) : null);
    const { garde, absorbe } = sens(autre);
    const n = etat.db.dossiers.filter((d) => d.client_id === absorbe.id).length;
    const repris = Object.keys(fusionClients(garde, absorbe)).filter((k) => k !== "notes").map((k) => tr(ETIQUETTES_CLIENT[k]).toLowerCase());
    resume.replaceChildren(
      h("ul", null,
        clientEtranger(garde) ? h("li", null, tr("Cette fiche est rattachée à la fiche {sigle} de {garde} : une seule fiche pour les deux entreprises.", { sigle: sigleDe(garde.entite_id), garde: nomClient(garde) })) : null,
        h("li", null, pluriel(n, N_("{n} dossier de {autre} passe sur {garde}."), N_("{n} dossiers de {autre} passent sur {garde}."), { autre: nomClient(absorbe), garde: nomClient(garde) })),
        repris.length ? h("li", null, tr("Champs vides repris de l'autre fiche : {champs}.", { champs: repris.join(", ") })) : h("li", null, tr("Les coordonnées de cette fiche restent telles quelles.")),
        absorbe.notes ? h("li", null, tr("Ses notes s'ajoutent à celles de cette fiche.")) : null,
        h("li", null, tr("La fiche de {autre} est ensuite supprimée.", { autre: nomClient(absorbe) }))
      )
    );
  };
  bouton.addEventListener("click", async () => {
    const autre = choisie();
    if (!autre) return;
    const { garde, absorbe } = sens(autre);
    bouton.disabled = true;
    try {
      // Un dossier de l'autre fiche dans la corbeille ne pourrait plus être restauré sans elle (même garde-fou que la suppression).
      const enCorbeille = (await corbeilleDossiers().catch(() => [])).filter((x) => x.ligne && x.ligne.client_id === absorbe.id);
      if (enCorbeille.length) {
        bouton.disabled = false;
        return toast(tr("L'autre fiche a un dossier dans la corbeille ({refs}) : restaurez-le (Réglages, corbeille) avant la fusion.", { refs: enCorbeille.map((x) => x.ligne.ref).join(", ") }), true);
      }
      await etat.store.fusionnerClients({ garder: garde.id, absorbe: absorbe.id, patch: fusionClients(garde, absorbe) });
      await recharger();
      fermer();
      toast(tr("Fiches fusionnées : {nom} garde tous les dossiers.", { nom: nomClient(garde) }));
      naviguer(`#/client/${garde.id}`);
    } catch (err) {
      bouton.disabled = false;
      toast(/fusionner_clients|function .* does not exist|PGRST202/i.test(err.message) ? tr("La base n'a pas encore la fusion des clients : la migration de fusion doit d'abord être appliquée.") : tr("Fusion impossible : {message}", { message: err.message }), true);
    }
  });
  const fermer = modal(
    tr("Fusionner avec une autre fiche"),
    h("div", { class: "modal-corps" },
      h("p", { class: "aide" }, tr("Pour un client saisi deux fois. Cette fiche-ci est gardée ; ouvrez l'autre fiche si c'est elle que vous voulez garder.")),
      sel.noeud,
      resume,
      h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, tr("Annuler")), bouton)
    ),
    { protege: false }
  );
  majResume();
}

// Deux personnes sur la même fiche client : un champ changé des deux côtés est soumis au choix, le reste se garde.
const ETIQUETTES_CLIENT = { civilite: N_("Civilité"), prenom: N_("Prénom"), nom: N_("Nom"), telephone: N_("Téléphone"), email: N_("E-mail"), adresse: N_("Adresse"), notes: N_("Notes") };
const arbitrerClient = (client) => ({ conflits, par }) => demanderArbitrage({ conflits, par, titreFiche: tr("La fiche de {nom}", { nom: nomClient(client) }), etiquettes: Object.fromEntries(Object.entries(ETIQUETTES_CLIENT).map(([k, v]) => [k, tr(v)])) });

export function listeClients() {
  const nbDossiers = (c) => etat.db.dossiers.filter((d) => d.client_id === c.id).length;
  const ligne = (c) => ({ c, nom: nomClient(c), n: nbDossiers(c), ville: (c.adresse || "").split("\n").filter(Boolean).pop() || "" });
  // Les fiches d'ici, et les fiches partagées (ZTP) que des dossiers d'ici utilisent, étiquetées. Jamais un client dont on ne voit que le nom.
  const lignes = () => etat.db.clients.filter((c) => !c.nom_seul).map(ligne).sort((a, b) => a.nom.localeCompare(b.nom));
  const filtrer = (tout, requete) => tout.filter((x) => correspond(`${x.nom} ${x.c.telephone} ${x.c.adresse}`, requete));
  const liste = listeAdaptative({
    items: lignes(),
    colonnes: [
      { cle: "nom", titre: tr("Client"), rendu: (x) => [x.nom, etiquette(x.c)], tri: (x) => x.nom, mobile: "titre" },
      { cle: "tel", titre: tr("Téléphone"), rendu: (x) => x.c.telephone || null, mobile: "sous" },
      { cle: "adresse", titre: tr("Adresse"), rendu: (x) => (x.c.adresse || "").split("\n").join(", ") || null, rendu_mobile: (x) => x.ville || null, mobile: "sous" },
      { cle: "n", titre: tr("Dossiers"), num: true, tri: (x) => x.n, mobile: "droite", rendu: (x) => pluriel(x.n, N_("dossier"), N_("dossiers")) },
    ],
    lien: (x) => `#/client/${x.c.id}`,
    tri: { cle: "nom" },
    vide: vide(etat.db.clients.length ? tr("Aucun client ne correspond") : tr("Aucun client"), etat.db.clients.length ? tr("Essayez une autre recherche.") : tr("Les clients se créent avec leur premier dossier, ou avec le bouton ci-dessus.")),
  });
  const filtres = barreFiltres({ recherche: { placeholder: tr("Nom, téléphone, ville"), libelle: tr("Rechercher") }, onchange: (v) => liste.mettre(filtrer(lignes(), v.recherche)) });
  const corps = liste.noeud;
  return h(
    "div",
    { "data-titre": tr("Clients") },
    h(
      "div",
      { class: "entete" },
      h("h1", null, tr("Clients")),
      !peut("clients.ecrire") ? null : h(
        "button",
        {
          class: "principal",
          type: "button",
          onclick: () => {
            const fermer = modal(tr("Nouveau client"), h("div", { class: "modal-corps" }, formulaireClient({}, (c) => (fermer(), naviguer(`#/client/${c.id}`)))));
          },
        },
        tr("Nouveau client")
      )
    ),
    filtres.noeud,
    corps
  );
}

export function ficheClient(id) {
  const client = clientParId(id);
  if (!client) return vide(tr("Client introuvable"), tr("Il a peut-être été supprimé."), h("a", { class: "bouton secondaire", href: "#/clients" }, tr("Retour aux clients")));
  // Client d'une autre entreprise dont la personne ne voit que le nom (sur un dossier d'ici) : sa fiche n'est pas ouverte ici.
  if (client.nom_seul) return vide(nomClient(client), tr("Ce client a sa fiche dans une autre entreprise. Son nom figure sur vos dossiers et vos vouchers ; ses coordonnées sont réservées à l'administration."), h("a", { class: "bouton secondaire", href: "#/clients" }, tr("Retour aux clients")));
  const etrangere = clientEtranger(client);
  const dossiers = etat.db.dossiers.filter((d) => d.client_id === id).map((d) => resumeDossier(d.id)).sort((a, b) => (b.dossier.date_depart || b.dossier.created_at || "").localeCompare(a.dossier.date_depart || a.dossier.created_at || ""));
  // Numéro d'un client : l'indicatif du pays n'est jamais deviné (un 079 suisse n'est pas un +66). L'appel marche avec le numéro local tel quel, WhatsApp demande l'international.
  const { appel: tel, whatsapp: waNumero } = numerosClient(client.telephone);
  // Un autre client avec le même numéro ou le même nom : probablement la même personne saisie deux fois.
  // Une fiche d'ici peut aussi avoir son double dans une entreprise qui partage ses fiches (ZTP) : on l'y rattache. Une fiche partagée
  // ouverte ici ne se compare qu'avec sa propre entreprise, là-bas.
  const doublons = etrangere ? [] : clientsProches({ telephone: client.telephone, nom: `${client.prenom || ""} ${client.nom || ""}` }, [...etat.db.clients, ...clientsPartages()].filter((c, i, t) => c.id !== id && !c.nom_seul && t.findIndex((x) => x.id === c.id) === i));
  const fusion = !etrangere && peutFusionnerClients(peut);
  // Les dossiers de ce client dans les entreprises avec qui sa fiche est partagée : en lecture, sans aucun montant.
  const ailleurs = etrangere ? [] : dossiersAilleurs({ clientId: id, entiteId: etat.entiteId, dossiers: etat.brut.dossiers, reservations: etat.brut.reservations, entites: etat.brut.entites });
  return h(
    "div",
    { "data-titre": nomClient(client) },
    h("a", { class: "retour", href: "#/clients" }, tr("Clients")),
    h("div", { class: "entete" }, h("h1", null, nomClient(client), etiquette(client)), peut("dossiers.ecrire") ? h("a", { class: "bouton principal", href: `#/dossiers/nouveau?client=${id}` }, tr("Nouveau dossier pour ce client")) : null),
    // Joindre le client en un tap : appel et WhatsApp (le numéro est nettoyé comme sur l'accueil).
    tel ? h("div", { class: "actions gauche client-joindre" }, h("a", { class: "bouton secondaire", href: `tel:${tel}`, "aria-label": tr("Appeler {nom}", { nom: nomClient(client) }) }, icone("telephone", 18), tr("Appeler")), waNumero ? h("a", { class: "bouton secondaire", href: `https://wa.me/${waNumero}`, target: "_blank", rel: "noopener", "aria-label": tr("WhatsApp à {nom}", { nom: nomClient(client) }) }, icone("whatsapp", 18), tr("WhatsApp")) : null) : null,
    doublons.length ? h("div", { class: "ecart-facture doublons-client", role: "status" }, h("p", null, h("strong", null, pluriel(doublons.length, N_("Doublon possible"), N_("Doublons possibles")))), h("ul", null, doublons.map(({ client: c, raison }) => h("li", null, h("a", { href: `#/client/${c.id}` }, nomClient(c)), ` · ${raison === "telephone" ? tr("même numéro de téléphone") : tr("même nom")}`, fusion ? [" ", h("button", { class: "lien", type: "button", onclick: () => ouvrirFusion(client, c.id) }, tr("Fusionner ici"))] : null))), h("p", { class: "aide" }, fusion ? tr("Rien n'est fusionné tout seul. « Fusionner ici » montre ce qui change avant de le faire.") : tr("Rien n'est fusionné tout seul : ouvrez l'autre fiche pour comparer. La fusion demande le droit « Fusionner deux fiches du même client »."))) : null,
    etrangere ? h("p", { class: "bandeau-partage", role: "note" }, tr("Fiche de {source}, partagée avec {ici}. Un changement fait ici se voit aussi dans {source}. Seuls les dossiers de {ici} apparaissent ici.", { source: nomEntreprise(client.entite_id), ici: (entiteActive() || {}).nom || "" })) : null,
    h("section", null, h("h2", null, tr("Coordonnées")), formulaireClient(client, () => naviguer(location.hash))),
    h(
      "section",
      null,
      h("h2", null, tr("Dossiers")),
      dossiers.length
        ? listeAdaptative({
            items: dossiers,
            colonnes: [
              { cle: "ref", titre: tr("Référence"), rendu: (r) => r.dossier.ref, tri: (r) => r.dossier.ref, mobile: "titre" },
              { cle: "depart", titre: tr("Départ"), rendu: (r) => (r.dossier.date_depart ? formatDate(r.dossier.date_depart) : "—"), rendu_mobile: (r) => (r.dossier.date_depart ? tr("départ le {date}", { date: formatDate(r.dossier.date_depart) }) : null), tri: (r) => r.dossier.date_depart || "", mobile: "sous" },
              { cle: "statut", titre: tr("Statut"), rendu: (r) => pastille(r.statut), mobile: "pied" },
              { cle: "total", titre: tr("Total"), num: true, rendu: (r) => formatMontant(r.total, r.devise), tri: (r) => r.total, mobile: "droite" },
              { cle: "reste", titre: tr("Reste"), num: true, rendu: (r) => formatMontant(r.reste, r.devise), tri: (r) => r.reste, mobile: false },
            ],
            lien: (r) => `#/dossier/${r.dossier.id}`,
          }).noeud
        : h("p", { class: "vide-court" }, tr("Aucun dossier pour ce client."))
    ),
    ailleurs.length ? sectionAilleurs(ailleurs) : null,
    fusion ? h("section", null, h("h2", null, tr("Fusionner avec une autre fiche")), h("p", { class: "aide" }, tr("Le même client saisi deux fois : ses dossiers passent sur cette fiche, puis l'autre fiche disparaît.")), h("div", { class: "actions gauche" }, h("button", { class: "secondaire", type: "button", onclick: () => ouvrirFusion(client) }, tr("Fusionner avec…")))) : null,
    etrangere || !peut("clients.supprimer") ? null : h(
      "section",
      { class: "zone-danger" },
      h("h2", null, tr("Supprimer ce client")),
      // Une fiche ZTP utilisée par un dossier de Secret ou de Taxi ne se supprime pas non plus.
      dossiers.length || etat.brut.dossiers.some((d) => d.client_id === id)
        ? h("p", { class: "aide" }, tr("Impossible tant que le client a des dossiers."))
        : h(
            "button",
            {
              class: "danger",
              type: "button",
              onclick: async () => {
                // Un dossier supprimé reste 90 jours dans la corbeille : sans son client, il ne pourrait plus être restauré.
                try {
                  const enCorbeille = (await corbeilleDossiers()).filter((x) => x.ligne && x.ligne.client_id === id);
                  if (enCorbeille.length) return toast(tr("Ce client a un dossier dans la corbeille ({refs}) : restaurez-le (Réglages, corbeille) avant de supprimer le client.", { refs: enCorbeille.map((x) => x.ligne.ref).join(", ") }), true);
                } catch {}
                if (await confirmer(tr("Supprimer définitivement {nomClient} ?", { nomClient: nomClient(client) }), tr("Supprimer"), true)) {
                  try {
                    await supprimer("clients", id);
                    naviguer("#/clients");
                  } catch (err) {
                    toast(tr("Suppression impossible : {message}", { message: err.message }), true);
                  }
                }
              },
            },
            tr("Supprimer le client")
          )
    )
  );
}

// Dossiers du client dans une autre entreprise (fiche ZTP utilisée par Secret ou Taxi) : référence, entreprise, dates et services. Aucun montant.
// Un clic ouvre le dossier dans son entreprise, avec les droits qu'on y a.
function sectionAilleurs(ailleurs) {
  const dates = (x) => {
    const d = x.date_depart || (x.services[0] && x.services[0].date);
    const f = x.date_retour || (x.services.length > 1 && x.services[x.services.length - 1].date);
    return d ? (f && f !== d ? `${formatDate(d)} → ${formatDate(f)}` : formatDate(d)) : "—";
  };
  return h(
    "section",
    { class: "dossiers-ailleurs" },
    h("h2", null, tr("Dans les autres entreprises")),
    h("p", { class: "aide" }, tr("La même fiche sert dans ces dossiers. Lecture seule ici : ouvrez le dossier pour le modifier dans son entreprise.")),
    h(
      "ul",
      { class: "liste-ailleurs" },
      ailleurs.map((x) =>
        h(
          "li",
          null,
          h("a", { href: `#/dossier/${x.id}?entite=${x.entite_id}` }, h("strong", null, x.ref || tr("(sans réf.)")), " ", h("span", { class: "etiquette-partage" }, sigleDe(x.entite_id))),
          h("span", { class: "sous-ligne" }, [x.entreprise, dates(x), x.annule ? tr("annulé") : ""].filter(Boolean).join(" · ")),
          x.services.length ? h("span", { class: "sous-ligne" }, x.services.map((sv) => [sv.date ? formatDate(sv.date) : "", sv.libelle].filter(Boolean).join(" ")).join(" · ")) : null
        )
      )
    )
  );
}

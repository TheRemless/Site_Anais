import { etat, inserer, modifier, supprimer, nomClient, naviguer, resumeDossier, reglages, peut, corbeilleDossiers } from "../etat.mjs";
import { h, champ, modal, confirmer, toast, icone, erreurChamp } from "../ui.mjs";
import { formatMontant, formatDate } from "../calc.mjs";
import { pastille, vide, listeAdaptative, barreFiltres } from "./commun.mjs";
import { correspond } from "../mobile-calc.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";
import { clientsProches } from "../demande-calc.mjs";
import { verifierTelephoneClient, numerosClient } from "../client-calc.mjs";

function formulaireClient(client, apres) {
  const civilites = [...reglages().listes.civilites];
  if (client.civilite && !civilites.includes(client.civilite)) civilites.push(client.civilite);
  const civ = h("select", { id: "c-civ" }, civilites.map((x) => h("option", { value: x }, tr(x))));
  civ.value = client.civilite || civilites[0] || "";
  const prenom = h("input", { id: "c-prenom", value: client.prenom || "" });
  const nom = h("input", { id: "c-nom", value: client.nom || "", required: true });
  const tel = h("input", { id: "c-tel", type: "tel", value: client.telephone || "" });
  const email = h("input", { id: "c-email", type: "email", value: client.email || "" });
  const adresse = h("textarea", { id: "c-adr", rows: 3 });
  adresse.value = client.adresse || "";
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
          erreurChamp(tel, verif.raison === "sans_indicatif" ? tr("Ajoutez l'indicatif du pays, par exemple +41, +33 ou +66, à la place du 0 du début.") : tr("Numéro illisible : écrivez-le avec son indicatif, par exemple +41 79 123 45 67."));
          return tel.focus();
        }
        const valeurs = { civilite: civ.value, prenom: prenom.value.trim(), nom: nom.value.trim(), telephone: verif.valeur, email: email.value.trim(), adresse: adresse.value.trim(), notes: notes.value.trim() };
        // Seuls les champs changés partent : un autre champ modifié entre-temps par quelqu'un d'autre n'est pas écrasé.
        const changes = client.id ? Object.fromEntries(Object.entries(valeurs).filter(([k, v]) => (client[k] || "") !== v)) : valeurs;
        const c = client.id ? (Object.keys(changes).length ? await modifier("clients", client.id, changes) : client) : await inserer("clients", valeurs);
        toast(tr("Client enregistré."));
        apres(c);
      },
    },
    h("div", { class: "grille-form" }, champ(tr("Civilité"), civ), champ(tr("Prénom"), prenom), champ(tr("Nom"), nom), champ(tr("Téléphone"), tel), champ("E-mail", email, tr("Pour votre usage, il n'apparaît pas sur les documents."))),
    champ(tr("Adresse, telle qu'elle doit apparaître sur le devis"), adresse),
    champ(tr("Notes"), notes),
    peut("clients.ecrire") ? h("div", { class: "actions" }, h("button", { class: "principal", type: "submit" }, tr("Enregistrer le client"))) : h("p", { class: "aide" }, tr("Lecture seule : votre rôle ne permet pas de modifier les clients."))
  );
}

export function listeClients() {
  const nbDossiers = (c) => etat.db.dossiers.filter((d) => d.client_id === c.id).length;
  const ligne = (c) => ({ c, nom: nomClient(c), n: nbDossiers(c), ville: (c.adresse || "").split("\n").filter(Boolean).pop() || "" });
  const lignes = () => etat.db.clients.map(ligne).sort((a, b) => a.nom.localeCompare(b.nom));
  const filtrer = (tout, requete) => tout.filter((x) => correspond(`${x.nom} ${x.c.telephone} ${x.c.adresse}`, requete));
  const liste = listeAdaptative({
    items: lignes(),
    colonnes: [
      { cle: "nom", titre: tr("Client"), tri: (x) => x.nom, mobile: "titre" },
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
  const client = etat.db.clients.find((c) => c.id === id);
  if (!client) return vide(tr("Client introuvable"), tr("Il a peut-être été supprimé."), h("a", { class: "bouton secondaire", href: "#/clients" }, tr("Retour aux clients")));
  const dossiers = etat.db.dossiers.filter((d) => d.client_id === id).map((d) => resumeDossier(d.id)).sort((a, b) => (b.dossier.date_depart || b.dossier.created_at || "").localeCompare(a.dossier.date_depart || a.dossier.created_at || ""));
  // Numéro d'un client : l'indicatif du pays n'est jamais deviné (un 079 suisse n'est pas un +66). L'appel marche avec le numéro local tel quel, WhatsApp demande l'international.
  const { appel: tel, whatsapp: waNumero } = numerosClient(client.telephone);
  // Un autre client avec le même numéro ou le même nom : probablement la même personne saisie deux fois.
  const doublons = clientsProches({ telephone: client.telephone, nom: `${client.prenom || ""} ${client.nom || ""}` }, etat.db.clients.filter((c) => c.id !== id));
  return h(
    "div",
    { "data-titre": nomClient(client) },
    h("a", { class: "retour", href: "#/clients" }, tr("Clients")),
    h("div", { class: "entete" }, h("h1", null, nomClient(client)), peut("dossiers.ecrire") ? h("a", { class: "bouton principal", href: `#/dossiers/nouveau?client=${id}` }, tr("Nouveau dossier pour ce client")) : null),
    // Joindre le client en un tap : appel et WhatsApp (le numéro est nettoyé comme sur l'accueil).
    tel ? h("div", { class: "actions gauche client-joindre" }, h("a", { class: "bouton secondaire", href: `tel:${tel}`, "aria-label": tr("Appeler {nom}", { nom: nomClient(client) }) }, icone("telephone", 18), tr("Appeler")), waNumero ? h("a", { class: "bouton secondaire", href: `https://wa.me/${waNumero}`, target: "_blank", rel: "noopener", "aria-label": tr("WhatsApp à {nom}", { nom: nomClient(client) }) }, icone("whatsapp", 18), tr("WhatsApp")) : null) : null,
    doublons.length ? h("div", { class: "ecart-facture doublons-client", role: "status" }, h("p", null, h("strong", null, pluriel(doublons.length, N_("Doublon possible"), N_("Doublons possibles")))), h("ul", null, doublons.map(({ client: c, raison }) => h("li", null, h("a", { href: `#/client/${c.id}` }, nomClient(c)), ` · ${raison === "telephone" ? tr("même numéro de téléphone") : tr("même nom")}`))), h("p", { class: "aide" }, tr("Rien n'est fusionné tout seul : ouvrez l'autre fiche pour comparer, puis déplacez ou supprimez ce qui est en trop."))) : null,
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
    !peut("clients.supprimer") ? null : h(
      "section",
      { class: "zone-danger" },
      h("h2", null, tr("Supprimer ce client")),
      dossiers.length
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

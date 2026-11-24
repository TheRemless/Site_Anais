// Fiche d'une réservation et son bloc « Rappel » (migration 31). La notification « Dans 1 h » ouvre cette fiche.
// Client : le rappel prêt à copier (heure, lieu, personnes, ce qu'il faut prévoir quand la base le dit) et la case « Rappel envoyé ».
// Partenaire : aucun message rédigé (Jérémy, 14.11.2026 : Anaïs écrit elle-même au prestataire), seulement son nom, son téléphone et ce qu'il
// faut lui dire, avec la case « Rappel fait ». Rien ne part tout seul, ni au client ni au partenaire.
import { etat, modifier, peut, reglages, entiteActive, nomClient, partenaireDe, dossiersAnnules, organisation } from "../etat.mjs";
import { h, icone } from "../ui.mjs";
import { formatDate } from "../calc.mjs";
import { tr, localeActive, langueActive } from "../i18n.mjs";
import { carteReservation } from "./reservations.mjs";
import { copierTexte } from "./partage.mjs";
import { vide, lienDossier } from "./commun.mjs";
import { chiffres } from "../partenaires-calc.mjs";
import { personnesTexte, langueClient, hotelEtChambre } from "../operations-calc.mjs";
import { heureService, etatRappel, texteRappelClient, aPrevoir, detailsPartenaire, prochainsServices } from "../rappel-h1-calc.mjs";

const rafraichir = () => window.dispatchEvent(new HashChangeEvent("hashchange"));
const quand = (iso) => new Date(iso).toLocaleString(localeActive(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// Coche ou décoche « rappel envoyé » : la date de l'appui est gardée dans la réservation, rien d'autre ne change.
async function noter(r, cle, fait) {
  const details = { ...(r.details || {}) };
  if (fait) details[cle] = new Date().toISOString();
  else delete details[cle];
  await modifier("reservations", r.id, { details });
  rafraichir();
}

function caseFait(r, cle, libelle) {
  const fait = (r.details || {})[cle];
  return h(
    "label",
    { class: "case rappel-case" },
    h("input", { type: "checkbox", checked: !!fait, disabled: !peut("dossiers.ecrire"), onchange: (e) => noter(r, cle, e.target.checked) }),
    h("span", null, libelle, fait ? h("span", { class: "rappel-quand" }, tr("le {quand}", { quand: quand(fait) })) : null)
  );
}

export function blocRappel(r) {
  const d = etat.db.dossiers.find((x) => x.id === r.dossier_id) || {};
  const c = etat.db.clients.find((x) => x.id === d.client_id) || null;
  const partenaire = partenaireDe(r.partenaire_id);
  const prestation = r.prestation_id ? etat.db.prestations.find((p) => p.id === r.prestation_id) : null;
  const trajet = r.trajet_id ? etat.db.trajets.find((t) => t.id === r.trajet_id) : null;
  const regl = reglages();
  const langue = langueClient(regl);
  const lieu = (r.lieu_pickup || "").trim() || (c ? hotelEtChambre(c, r).hotel : "");
  const texte = texteRappelClient(r, { prenom: c ? c.prenom || nomClient(c) : "", lieu, entreprise: (regl.emetteur && regl.emetteur.nom) || entiteActive().nom, langue, prevoir: langue === "en" ? aPrevoir(r, { prestation, partenaire, trajet, destinations: regl.destinations_passeport }) : [] });
  const zone = h("textarea", { id: `rappel-${r.id}`, rows: 9, lang: langue });
  zone.value = texte;
  const tel = c ? chiffres(c.telephone).replace(/\D/g, "") : "";
  const p = detailsPartenaire(r, partenaire);
  const ligne = (libelle, valeur) => (valeur ? h("div", { class: "rappel-ligne" }, h("dt", null, libelle), h("dd", null, valeur)) : null);
  return h(
    "section",
    { class: "rappel-bloc", "aria-labelledby": `rappel-titre-${r.id}` },
    h("h2", { id: `rappel-titre-${r.id}` }, tr("Rappel")),
    heureService(r) ? null : h("p", { class: "bandeau-info", role: "status" }, tr("Pas d'heure de pickup : pas de notification une heure avant. Le service reste dans le rappel de 18h la veille.")),
    h(
      "div",
      { class: "rappel-partie" },
      h("h3", null, tr("Client")),
      c
        ? [
            h("label", { for: zone.id, class: "rappel-libelle" }, langue === "en" ? tr("Rappel en anglais, à copier dans sa conversation") : tr("Rappel à copier dans sa conversation")),
            zone,
            h("div", { class: "actions gauche" }, h("button", { class: "principal", type: "button", onclick: () => copierTexte(zone.value) }, icone("copier", 18), tr("Copier")), tel ? h("a", { class: "bouton secondaire", href: `https://wa.me/${tel}`, target: "_blank", rel: "noopener" }, icone("whatsapp", 18), tr("Ouvrir sa conversation")) : null),
            caseFait(r, "rappel_client_le", tr("Rappel envoyé au client")),
          ]
        : h("p", { class: "aide" }, tr("Pas de client sur ce dossier."))
    ),
    p
      ? h(
          "div",
          { class: "rappel-partie" },
          h("h3", null, tr("Partenaire")),
          h("p", { class: "aide" }, tr("Rien n'est envoyé au partenaire depuis l'outil : vous lui écrivez vous-même. Voici ce qu'il faut lui confirmer.")),
          h(
            "dl",
            { class: "rappel-details" },
            ligne(tr("Partenaire"), [p.nom, p.personne].filter(Boolean).join(" · ")),
            p.telephones.length
              ? h("div", { class: "rappel-ligne" }, h("dt", null, tr("Téléphone")), h("dd", null, p.telephones.map((t) => h("a", { class: "rappel-tel", href: `tel:${String(t.numero).replace(/[^\d+]/g, "")}` }, t.numero))))
              : ligne(tr("Téléphone"), tr("non renseigné")),
            ligne(tr("Service"), p.service),
            ligne(tr("Quand"), [p.date ? formatDate(p.date) : "", p.heure ? tr("pickup {heure}", { heure: p.heure }) : ""].filter(Boolean).join(", ")),
            ligne(tr("Personnes"), personnesTexte(p.personnes, langueActive())),
            ligne(tr("Prise en charge"), p.lieu)
          ),
          caseFait(r, "rappel_partenaire_le", tr("Rappel fait au partenaire"))
        )
      : null
  );
}

// Écran #/reservation/<id> : la carte de la réservation et son rappel. Une notification ouvre la bonne entreprise (« ?entite=… »).
export async function vueReservation(id) {
  const r = etat.db.reservations.find((x) => x.id === id);
  if (!r) return vide(tr("Réservation introuvable"), tr("Elle a été supprimée, ou elle appartient à une autre entreprise."), h("a", { class: "bouton secondaire", href: "#/" }, tr("Retour à l'accueil")));
  const heure = heureService(r);
  return h(
    "div",
    { "data-titre": r.libelle, class: "fiche-reservation" },
    h("div", { class: "entete" }, h("div", null, h("h1", null, r.libelle), h("p", { class: "sous" }, [r.date_service ? formatDate(r.date_service) : tr("Date à fixer"), heure ? tr("pickup {heure}", { heure }) : ""].filter(Boolean).join(" · "), " · ", lienDossier((etat.db.dossiers.find((x) => x.id === r.dossier_id) || {}).ref || tr("Dossier"), r.dossier_id)))),
    h("ul", { class: "cartes" }, h("li", { class: "carte" }, carteReservation(r, { avecDossier: true, apres: rafraichir }))),
    blocRappel(r)
  );
}

// Accueil « Aujourd'hui » : les services des deux prochaines heures et où en est leur rappel.
export function sectionProchainsServices() {
  const liste = prochainsServices(etat.db.reservations, Date.now(), { heures: 2, ecartes: dossiersAnnules(), prestationDe: (id) => etat.db.prestations.find((p) => p.id === id) || null, fuseau: (organisation() || {}).fuseau });
  if (!liste.length) return null;
  const pastille = (fait, libelle) => h("span", { class: `tag rappel-etat ${fait ? "fait" : "a-faire"}` }, fait ? tr("{qui} : fait", { qui: libelle }) : tr("{qui} : à faire", { qui: libelle }));
  return h(
    "section",
    { class: "section-jour rappels-prochains" },
    h("h2", null, tr("Dans les 2 prochaines heures"), h("span", { class: "tag" }, liste.length)),
    h(
      "ul",
      { class: "cartes" },
      liste.map(({ reservation: r, minutes }) => {
        const e = etatRappel(r);
        return h(
          "li",
          { class: "carte" },
          h(
            "a",
            { class: "carte-lien", href: `#/reservation/${r.id}` },
            h("span", { class: "carte-titre" }, r.libelle),
            h("span", { class: "carte-droite" }, h("strong", null, heureService(r)), h("span", null, minutes > 0 ? tr("dans {n} min", { n: minutes }) : tr("commencé"))),
            h("span", { class: "carte-sous" }, [personnesTexte(r.personnes, langueActive()), r.lieu_pickup].filter(Boolean).join(" · ")),
            h("span", { class: "carte-pied" }, h("span", null, pastille(e.client, tr("Client")), r.partenaire_id ? pastille(e.partenaire, tr("Partenaire")) : null), h("span", { class: "rappel-ouvrir" }, tr("Rappel"), icone("chevron", 16)))
          )
        );
      })
    )
  );
}

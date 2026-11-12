// « À vérifier » : les cas qui se règlent mieux au calme que devant un client. Calcul pur (aucune écriture, rien n'est corrigé automatiquement), testé avec node --test.
// `db` : la copie en mémoire de l'entreprise active. `droits` : { partenaires, dossiers, clients, nets } (booleens). `aujourdhui` : AAAA-MM-JJ.
// Renvoie les contrôles qui ont au moins un cas : { cle, droit, aRelire, elements: [{ id, lien, texte, detail }] }. `aRelire` : un doute, pas une erreur certaine.

import { dateFinService } from "./operations-calc.mjs";

const sansAccents = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const vide = (v) => v === null || v === undefined || v === "" || Number(v) <= 0;

// Heure « 10:30 », « 10h30 », « 10.30 », « 2:30 PM » → minutes depuis minuit, ou null.
export function minutesDepuisHeure(texte) {
  const t = String(texte || "");
  const m = /(\d{1,2})\s*[:h.]\s*(\d{2})?/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2] || 0);
  if (/pm/i.test(t) && h < 12) h += 12;
  if (/am/i.test(t) && h === 12) h = 0;
  return h > 23 || mi > 59 ? null : h * 60 + mi;
}

// Durée écrite à la main → minutes, ou null quand on ne la comprend pas ou qu'elle est ambiguë :
// « 3 h », « 1h30 », « 1,5 h », « Environ 3h00 », « 45 min », « 2 heures (1h+1h) » (le total d'abord), « 1h+1h » (somme), mais pas « 1h-1h30 » ni « 3 à 4 heures » (fourchettes).
export function minutesDepuisDuree(texte) {
  const brut = String(texte || "").toLowerCase();
  if (/\d\s*(?:h|min|mn)?\s*(?:-|–|à|to)\s*\d/.test(brut.replace(/\(.*?\)/g, ""))) return null;
  const un = (t) => {
    let m = /(\d+)\s*h(?:eures?|ours?)?\s*(\d{1,2})(?!\d)/.exec(t);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    m = /(\d+(?:[.,]\d+)?)\s*(?:h|heures?|hours?)(?![a-z])/.exec(t);
    if (m) return Math.round(Number(m[1].replace(",", ".")) * 60);
    m = /(\d+)\s*(?:min|mn)/.exec(t);
    return m ? Number(m[1]) : null;
  };
  const sansParentheses = brut.replace(/\(.*?\)/g, " ");
  const somme = (t) => {
    const parties = t.split("+").map(un);
    return parties.length && parties.every((x) => x !== null) ? parties.reduce((s, x) => s + x, 0) : null;
  };
  return somme(sansParentheses) ?? somme((/\((.*?)\)/.exec(brut) || [])[1] || "");
}

// Écart entre la durée affichée et « arrivée moins départ » (passage de minuit compris), en minutes ; null si une des trois données manque.
export function ecartDuree(trajet) {
  const d = minutesDepuisHeure(trajet.depart);
  const a = minutesDepuisHeure(trajet.arrivee);
  const duree = minutesDepuisDuree(trajet.duree);
  if (d === null || a === null || duree === null) return null;
  const calculee = (a - d + 1440) % 1440;
  return Math.abs(calculee - duree);
}

// Un prix écrit dans le texte d'une prestation (« 1 200 THB », « 1,200 baht ») alors que son prix de vente est vide.
const PRIX_EN_TEXTE = /\d[\d' ,.]*\s*(?:฿|thb|baht|chf|eur|€)/i;
const prixDansTexte = (details) => Object.values(details || {}).some((v) => typeof v === "string" && PRIX_EN_TEXTE.test(v));

const telephonesDe = (p) => ((p && p.contact && p.contact.telephones) || []).filter((t) => String(t.numero || "").replace(/\D/g, "").length >= 6);

// `tr` : la traduction de l'interface (par défaut, le texte tel quel) pour les petites phrases composées ici.
const traduireParDefaut = (texte, vars = {}) => String(texte).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));

export function aVerifier(db, { droits = {}, aujourdhui = "", tr = traduireParDefaut } = {}) {
  const sorties = [];
  const ajouter = (cle, droit, aRelire, elements) => elements.length && sorties.push({ cle, droit, aRelire, elements });
  const partenaires = db.partenaires || [];
  const nomPartenaire = (id) => (partenaires.find((p) => p.id === id) || {}).nom || "";
  const prestations = (db.prestations || []).filter((x) => x.actif !== false);
  const trajets = (db.trajets || []).filter((x) => x.actif !== false);
  const prest = (x, detail) => ({ id: x.id, lien: `#/tarifs?famille=${x.famille || ""}&q=${encodeURIComponent(x.libelle || "")}`, texte: x.libelle, detail: [nomPartenaire(x.partenaire_id), detail].filter(Boolean).join(" · ") });

  // Catalogue
  ajouter("trajets_sans_prix", "partenaires", false, trajets.filter((t) => vide(t.prix_adulte)).map((t) => ({ id: t.id, lien: `#/trajets?de=${encodeURIComponent(t.de)}&vers=${encodeURIComponent(t.vers)}`, texte: `${t.de} → ${t.vers}${t.depart ? `, ${t.depart}` : ""}`, detail: [nomPartenaire(t.partenaire_id), t.mode].filter(Boolean).join(" · ") })));
  ajouter("prestations_prix_en_texte", "partenaires", true, prestations.filter((x) => !x.sur_place && (x.prix_vente === null || x.prix_vente === undefined) && prixDansTexte(x.details)).map((x) => prest(x, "")));
  ajouter("prestations_a_zero", "partenaires", false, prestations.filter((x) => !x.sur_place && x.prix_vente !== null && x.prix_vente !== undefined && Number(x.prix_vente) === 0).map((x) => prest(x, "")));
  if (droits.nets) {
    const nets = new Map((db.prestations_nets || []).map((n) => [n.prestation_id, n]));
    ajouter("prestations_sans_net", "partenaires", false, prestations.filter((x) => !x.sur_place && Number(x.prix_vente) > 0 && (!nets.has(x.id) || nets.get(x.id).net === null || nets.get(x.id).net === undefined)).map((x) => prest(x, "")));
  }
  // Groupes écrits de deux façons chez le même partenaire (majuscules, accents, espaces) : « à relire », ils se fondent peut-être en un seul.
  const groupes = new Map();
  for (const x of prestations) {
    if (!x.groupe) continue;
    const cle = `${x.partenaire_id || ""}|${x.famille}|${sansAccents(x.groupe).replace(/[^a-z0-9]+/g, " ").trim()}`;
    groupes.set(cle, [...(groupes.get(cle) || []), x]);
  }
  const doubles = [...groupes.values()].filter((l) => new Set(l.map((x) => x.groupe)).size > 1);
  ajouter("groupes_en_double", "partenaires", true, doubles.map((l) => ({ id: l[0].id, lien: `#/tarifs?famille=${l[0].famille || ""}&q=${encodeURIComponent(l[0].groupe)}`, texte: [...new Set(l.map((x) => x.groupe))].join(" / "), detail: nomPartenaire(l[0].partenaire_id) })));
  const actifs = partenaires.filter((p) => p.actif !== false);
  const lienP = (p) => ({ id: p.id, lien: `#/partenaire/${p.id}`, texte: p.nom, detail: p.role || p.categorie || "" });
  ajouter("partenaires_sans_telephone", "partenaires", false, actifs.filter((p) => !telephonesDe(p).length).map(lienP));
  ajouter("partenaires_sans_whatsapp", "partenaires", false, actifs.filter((p) => telephonesDe(p).length && !telephonesDe(p).some((t) => t.whatsapp)).map(lienP));
  ajouter("trajets_duree", "partenaires", true, trajets.map((t) => ({ t, e: ecartDuree(t) })).filter((x) => x.e !== null && x.e > 20).map(({ t, e }) => ({ id: t.id, lien: `#/trajets?de=${encodeURIComponent(t.de)}&vers=${encodeURIComponent(t.vers)}`, texte: `${t.de} → ${t.vers}`, detail: `${t.depart || "?"} → ${t.arrivee || "?"}, ${tr("durée écrite « {duree} » (écart {ecart} min)", { duree: t.duree, ecart: e })}` })));

  // Réservations, clients, dossiers
  const annules = new Set((db.dossiers || []).filter((d) => d.annule).map((d) => d.id));
  const clientDuDossier = new Map((db.dossiers || []).map((d) => [d.id, (db.clients || []).find((c) => c.id === d.client_id)]));
  const nomClient = (c) => (c ? [c.prenom, c.nom].filter(Boolean).join(" ") : "");
  ajouter("reservations_passees", "dossiers", false, (db.reservations || []).filter((r) => aujourdhui && r.date_service && dateFinService(r) < aujourdhui && (r.statut === "a_demander" || r.statut === "demande") && !annules.has(r.dossier_id)).map((r) => ({ id: r.id, lien: `#/dossier/${r.dossier_id}`, texte: r.libelle, detail: [nomClient(clientDuDossier.get(r.dossier_id)), r.date_service, r.statut === "demande" ? tr("demandée") : tr("à demander")].filter(Boolean).join(" · ") })));
  ajouter("clients_sans_contact", "clients", false, (db.clients || []).filter((c) => !String(c.telephone || "").replace(/\D/g, "") && !String(c.email || "").trim()).map((c) => ({ id: c.id, lien: `#/client/${c.id}`, texte: nomClient(c) || tr("(sans nom)"), detail: "" })));
  ajouter("dossiers_sans_responsable", "dossiers", false, (db.dossiers || []).filter((d) => !d.responsable_id && !d.annule).map((d) => ({ id: d.id, lien: `#/dossier/${d.id}`, texte: d.ref || tr("(sans référence)"), detail: nomClient((db.clients || []).find((c) => c.id === d.client_id)) })));

  const droitsOk = { partenaires: !!droits.partenaires, dossiers: !!droits.dossiers, clients: !!droits.clients };
  return sorties.filter((s) => droitsOk[s.droit]);
}

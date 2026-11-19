// Démonstration de l'onglet « Assistant » : rien ne part chez Anthropic ni chez Google. Un agent simulé répond au cas type d'une course
// avec rendez-vous (pickup à un hôtel, arrivée à une heure donnée, attente, puis aéroport), avec le vrai calcul des heures
// (agent-planifier.mjs) : les durées de la table de temps de l'entreprise d'abord, sinon des temps simulés, toujours signalés comme tels. Il émet les mêmes événements que la fonction « agent ».
import { planifierCourse, tempsSimule, decalerDate, texteDuree } from "./agent-planifier.mjs";
import { dureeAvecFerry, detailMorceaux } from "./agent-temps.mjs";

const JOURS = { dimanche: 0, sunday: 0, lundi: 1, monday: 1, mardi: 2, tuesday: 2, mercredi: 3, wednesday: 3, jeudi: 4, thursday: 4, vendredi: 5, friday: 5, samedi: 6, saturday: 6 };
const sans = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const heure = (h, m) => `${String(h).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}`;

// Ce que la démo sait lire d'une demande de course : le point de pickup, le rendez-vous et son heure, l'attente, l'aéroport, le jour.
export function lireCourse(texte, aujourdhui) {
  const t = String(texte || "");
  const s = sans(t);
  const pickup = (/(?:pick ?up|prise en charge|depuis|from)\s*(?:a|à|at|au|:)?\s*([^,\n.;]+?(?:,\s*(?:Koh|Ko)\s+\w+)?)(?=\s*(?:,|\n|\.|;| samedi| dimanche| lundi| mardi| mercredi| jeudi| vendredi| saturday| sunday| monday| tuesday| wednesday| thursday| friday| pour | to |$))/i.exec(t) || [])[1] || "";
  const rdv = (/((?:[A-Z][\w'-]*\s+){0,4}(?:International\s+)?(?:Hospital|Hôpital|Clinic|Clinique)(?:\s+[A-Z][\w'-]*){0,3}|(?:hôpital|hopital|clinique)\s+[^,\n.;]+)/.exec(t) || [])[1] || "";
  const hRdv = /(?:vers|à|a|at|around|arriv\w*\s+(?:vers|à|a|at)?)\s*(\d{1,2})\s*(?:h|:)\s*(\d{2})?/i.exec(t);
  const attente = /attente\s+(?:d['’]?\s*environ\s+|de\s+|d['’]\s*)?(?:environ\s+)?(\d+(?:[.,]\d+)?)\s*(h|heure|min)/i.exec(t) || /wait(?:ing)?\s+(?:about\s+|around\s+)?(\d+(?:[.,]\d+)?)\s*(h|hour|min)/i.exec(t);
  const aeroport = /a[ée]roport|airport/i.test(t) ? (/krabi/i.test(t) ? "Krabi International Airport" : /phuket/i.test(t) ? "Phuket International Airport" : "") : "";
  let date = "";
  for (const [mot, n] of Object.entries(JOURS)) {
    if (new RegExp(`\\b${mot}\\b`).test(s)) {
      const d = new Date(`${aujourdhui}T12:00:00Z`);
      const ecart = (n - d.getUTCDay() + 7) % 7 || 7;
      date = decalerDate(aujourdhui, ecart);
      break;
    }
  }
  if (!date && /demain|tomorrow/.test(s)) date = decalerDate(aujourdhui, 1);
  const minutesAttente = attente ? Math.round(Number(attente[1].replace(",", ".")) * (/^h/i.test(attente[2]) ? 60 : 1)) : 0;
  return { pickup: pickup.trim(), rdv: rdv.trim(), heureRdv: hRdv ? heure(hRdv[1], hRdv[2]) : "", attente: minutesAttente, aeroport, date };
}

// Heure du vol, personnes et bagages tapés dans une réponse (« vol à 19h30, 2 personnes, 3 valises »).
export function lireComplements(texte) {
  const t = String(texte || "");
  const vol = /(?:vol|flight|d[ée]collage)[^\d]{0,12}(\d{1,2})\s*(?:h|:)\s*(\d{2})?/i.exec(t);
  const pax = /(\d+)\s*(?:personnes?|pers\b|adultes?|people|pax|adults?)/i.exec(t);
  const bag = /(\d+)\s*(?:valises?|bagages?|bags?|luggage|suitcases?)/i.exec(t);
  return { heureVol: vol ? heure(vol[1], vol[2]) : "", international: /vol international|international flight|vol hors de thaïlande/i.test(t), personnes: pax ? Number(pax[1]) : 0, bagages: bag ? Number(bag[1]) : null };
}

const dateLongue = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const dateAnglaise = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

// Un tour de conversation simulé. `etat` : ce que la démo a retenu de la conversation (course lue, compléments). Rend les événements et le
// nouvel état. Les cartes rendues n'ont pas encore d'identifiant : le magasin de démo les enregistre.
export async function repondreDemo(texte, { aujourdhui, etat = {}, entreprise = "", signer = false, lignes = [], liaisons = [], hotels = [] } = {}) {
  const ev = [];
  let course = etat.course || null;
  const nouvelle = lireCourse(texte, aujourdhui);
  if (nouvelle.heureRdv && nouvelle.rdv) course = { ...nouvelle, date: nouvelle.date || decalerDate(aujourdhui, 1) };
  const comp = { ...(etat.complements || {}), ...Object.fromEntries(Object.entries(lireComplements(texte)).filter(([, v]) => v !== "" && v !== 0 && v !== null && v !== false)) };

  if (!course) {
    ev.push({
      t: "texte",
      delta:
        "En démonstration, je sais planifier une course avec un rendez-vous. Écrivez par exemple le point de prise en charge, le rendez-vous avec son heure, l'attente et la destination finale.\n\nAvec le vrai assistant, je cherche aussi dans le catalogue, les horaires des bateaux, les hôtels et les dossiers.",
    });
    return { evenements: ev, etat: { ...etat, complements: comp } };
  }

  ev.push({ t: "etape", outil: "planifier_course", texte: "Je calcule les horaires de la course" });
  const points = [{ lieu: course.pickup || "Point de prise en charge" }, { lieu: course.rdv, arrivee_voulue: course.heureRdv, attente_min: course.attente }];
  if (course.aeroport) points.push({ lieu: course.aeroport });
  const trajets = await Promise.all(points.slice(1).map((p, i) => dureeAvecFerry(points[i].lieu, p.lieu, { lignes, liaisons, hotels, simule: tempsSimule })));
  if (trajets.some((x) => !x || x.manque)) {
    const i = trajets.findIndex((x) => !x || x.manque);
    ev.push({ t: "texte", delta: `Je n'ai aucune durée pour ${(trajets[i] && trajets[i].manque) || `${points[i].lieu} → ${points[i + 1].lieu}`} : ni dans la table des temps de trajet, ni en démonstration. Combien de temps comptez-vous ? Je pourrai l'ajouter à la table.` });
    return { evenements: ev, etat: { ...etat, course, complements: comp } };
  }
  const plan = planifierCourse({ date: course.date, points, trajets, vol: comp.heureVol ? { heure: comp.heureVol, international: !!comp.international } : null });
  if (!plan.ok) {
    ev.push({ t: "texte", delta: "Il me manque une heure de rendez-vous pour calculer la course." });
    return { evenements: ev, etat: { ...etat, course, complements: comp } };
  }
  ev.push({ t: "planning", planning: plan });
  for (const t of plan.trajets) if (t.morceaux) t.detail = `${detailMorceaux(t.morceaux, texteDuree)}, marge ${t.marge_min} min`;
  const rdv = plan.etapes[1];
  const fin = plan.etapes[plan.etapes.length - 1];
  const details = plan.trajets.filter((t) => t.detail).map((t) => `${t.detail}.`);
  const phrases = [
    ...details,
    `Pour être à ${course.rdv} à ${course.heureRdv} le ${dateLongue(course.date)}, pickup à ${plan.pickup.heure} à ${course.pickup || "l'hôtel"}.`,
    `Arrivée prévue vers ${rdv.arrivee_prevue.heure}${course.attente ? `, puis ${course.attente} min d'attente et départ à ${rdv.depart.heure}` : ""}.`,
    course.aeroport ? `Arrivée à l'aéroport vers ${fin.arrivee_prevue.heure}, au plus tard ${fin.arrivee_au_plus_tard.heure}.` : "",
  ].filter(Boolean);
  if (plan.vol) {
    const v = plan.vol;
    phrases.push(
      v.verdict === "tenable"
        ? `Le vol de ${v.heure} est tenable : il reste ${v.marge_restante_min} min de marge sur l'arrivée limite de ${v.arrivee_limite.heure}.`
        : v.verdict === "juste"
          ? `Le vol de ${v.heure} est juste : l'arrivée limite est ${v.arrivee_limite.heure} et toutes les marges y passent. Un pickup 15 min plus tôt règle ça.`
          : `Le vol de ${v.heure} n'est pas tenable avec un rendez-vous à ${course.heureRdv} : l'arrivée limite à l'aéroport est ${v.arrivee_limite.heure}.`
    );
  }
  const manque = [!comp.heureVol && course.aeroport ? "l'heure du vol" : "", !comp.personnes ? "le nombre de personnes" : "", comp.bagages === undefined || comp.bagages === null ? "les bagages" : ""].filter(Boolean);
  if (manque.length) phrases.push("", `Pour finir, il me faut ${manque.join(", ").replace(/, ([^,]*)$/, " et $1")}.`);
  phrases.push("", "Le prix de la course reste à fixer par vous : je ne le propose pas.");
  if (plan.alertes.includes("temps_simules")) phrases.push("", "Temps de route simulés pour la démo : en service, ils viennent de la table des temps de trajet, puis d'OpenStreetMap.");
  else if (plan.alertes.includes("temps_a_verifier")) phrases.push("", "Une durée vient d'une ligne de la table encore à vérifier.");
  ev.push({ t: "texte", delta: phrases.join("\n") });

  if (!manque.length && (!plan.vol || plan.vol.verdict !== "pas_tenable")) {
    ev.push({ t: "etape", outil: "proposer_dossier", texte: "Je prépare le dossier" });
    const service = (de, vers, h, remarque) => ({ texte: `Transfert privé ${de} → ${vers}`, libelle: `${de} → ${vers}`, offre: null, date: course.date, heure_pickup: h, lieu_pickup: de, de, vers, adultes: comp.personnes, enfants: 0, prix: null, origine_prix: "a_fixer", remarque, avertissements: [] });
    const services = [service(course.pickup, course.rdv, plan.pickup.heure, `Rendez-vous à ${course.heureRdv}, ${comp.bagages} bagage(s).`)];
    if (course.aeroport) services.push(service(course.rdv, course.aeroport, rdv.depart.heure, `Vol à ${comp.heureVol}.`));
    ev.push({ t: "carte", carte: { genre: "dossier", titre: `Course du ${dateLongue(course.date)}`, donnees: { client: { nom: "", telephone: "", hotel: course.pickup, langue: "en" }, adultes: comp.personnes, enfants: 0, bebes: 0, services }, avertissements: [] } });
    ev.push({ t: "etape", outil: "proposer_reponse", texte: "Je prépare la réponse" });
    const message = [
      "Hello,",
      "",
      `Thank you for your message 😊 Here is the plan for ${dateAnglaise(course.date)}:`,
      "",
      `→ Pickup at ${course.pickup} at ${plan.pickup.heure}`,
      `→ Arrival at ${course.rdv} around ${rdv.arrivee_prevue.heure}, for your ${course.heureRdv} appointment`,
      ...(course.aeroport ? [`→ Departure to the airport at ${rdv.depart.heure}, arrival around ${fin.arrivee_prevue.heure}`] : []),
      "",
      "I'll send you the price for this private transfer shortly.",
      ...(signer ? ["", `Have a nice day, ${entreprise}`] : []),
    ].join("\n");
    ev.push({ t: "carte", carte: { genre: "reponse", titre: "Plan de la course, prix à suivre", donnees: { langue: "en", message }, avertissements: [] } });
    ev.push({ t: "texte", delta: "\n\nJ'ai préparé le dossier (prix à fixer) et la réponse au client. Rien n'est enregistré ni envoyé : à vous de valider." });
  }
  return { evenements: ev, etat: { ...etat, course, complements: comp } };
}

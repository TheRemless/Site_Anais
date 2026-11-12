// Heure de pickup d'après la zone de l'hôtel : les grilles des partenaires (`partenaires.regles.pickups`) donnent, pour chaque zone et chaque départ,
// l'heure à laquelle le véhicule passe. Rien n'est deviné : une heure ne sort que d'une case de la grille, une case vide ou illisible ne donne rien.
// Format d'une grille : { titre, colonnes: ["Bateau 10h30", …], lignes: [["Klong Dao (คลองดาว)", "09:40", "12:10"], …] }.

const sansAcc = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const norm = (t) => sansAcc(t).replace(/[^a-z0-9]+/g, " ").trim();

// Une case de grille : « 09:40 », « 9:40 », « 9h40 », « 9.40 ». Vide, « - » ou illisible : rien.
export function heureDeGrille(valeur) {
  const m = /^\s*(\d{1,2})\s*[:h.]\s*([0-5]\d)\s*$/.exec(String(valeur ?? ""));
  if (!m || Number(m[1]) > 23) return "";
  return `${String(m[1]).padStart(2, "0")}:${m[2]}`;
}

// « Klong Dao (คลองดาว) » → « Klong Dao » : le nom latin, sans la graphie thaïe.
export const nomCourtZone = (libelle) => String(libelle || "").replace(/\s*\(.*\)\s*$/, "").trim();

// Les grilles d'un partenaire, prêtes à afficher. `cle` d'une zone : « numéro de grille : numéro de ligne ».
export function grillesDe(partenaire) {
  const brutes = (partenaire && partenaire.regles && partenaire.regles.pickups) || [];
  const out = [];
  brutes.forEach((g, gi) => {
    const colonnes = Array.isArray(g.colonnes) ? g.colonnes.map(String) : [];
    const zones = (Array.isArray(g.lignes) ? g.lignes : [])
      .filter((l) => Array.isArray(l) && String(l[0] || "").trim())
      .map((l, zi) => ({ cle: `${gi}:${zi}`, nom: nomCourtZone(l[0]), libelle: String(l[0]), heures: colonnes.map((_, ci) => heureDeGrille(l[ci + 1])) }));
    if (zones.length && colonnes.length) out.push({ index: gi, titre: String(g.titre || ""), colonnes, zones });
  });
  return out;
}

export const zoneDeCle = (grilles, cle) => {
  for (const g of grilles) {
    const z = g.zones.find((x) => x.cle === cle);
    if (z) return { grille: g, zone: z };
  }
  return null;
};

// L'heure de la case (zone, départ) ; vide quand la grille n'a pas de pickup à cet endroit pour ce départ.
export function heureDeLaGrille(grilles, cle, depart) {
  const r = zoneDeCle(grilles, cle);
  if (!r) return "";
  const i = r.grille.colonnes.indexOf(depart);
  return i >= 0 ? r.zone.heures[i] : "";
}

// Le départ à garder quand la zone change : le même s'il existe dans la grille de la nouvelle zone, le seul s'il n'y en a qu'un, sinon aucun.
export function departApresChoix(grilles, cle, depart) {
  const r = zoneDeCle(grilles, cle);
  if (!r) return "";
  if (depart && r.grille.colonnes.includes(depart)) return depart;
  return r.grille.colonnes.length === 1 ? r.grille.colonnes[0] : "";
}

// L'heure choisie par la grille ne remplace pas une heure que la personne a tapée à la main : seulement un champ vide ou la dernière heure venue de la grille.
export function heureAPoser({ actuelle = "", derniereGrille = "", nouvelle = "" }) {
  if (!nouvelle) return null;
  return !actuelle || actuelle === derniereGrille ? nouvelle : null;
}

// Ce qui se garde sur la réservation (`details.pickup_zone`) : le nom latin de la zone sert à la retrouver chez un autre partenaire.
export const zoneAGarder = (grilles, cle, depart) => {
  const r = zoneDeCle(grilles, cle);
  return r ? { zone: r.zone.nom, grille: r.grille.titre, depart: depart || "" } : null;
};

// Retrouve la zone gardée dans les grilles d'un partenaire : même grille et même nom, sinon le même nom dans une autre grille.
export function cleDeZoneGardee(grilles, gardee) {
  if (!gardee || !gardee.zone) return "";
  const nom = norm(gardee.zone);
  let meme = "";
  for (const g of grilles) {
    for (const z of g.zones) {
      if (norm(z.nom) !== nom) continue;
      if (g.titre === gardee.grille) return z.cle;
      meme = meme || z.cle;
    }
  }
  return meme;
}

// La zone proposée pour un hôtel : celle d'une réservation précédente du même hôtel (la plus récente), sinon un nom de zone écrit dans l'adresse.
// Jamais d'heure ici : seulement une zone à confirmer.
export function zoneProposee(hotel, grilles, reservations = []) {
  const h = norm(hotel);
  if (!h || !grilles.length) return null;
  const avant = reservations
    .filter((r) => r.details && r.details.pickup_zone && norm(r.lieu_pickup) === h)
    .sort((a, b) => String(b.date_service || "").localeCompare(String(a.date_service || "")));
  for (const r of avant) {
    const cle = cleDeZoneGardee(grilles, r.details.pickup_zone);
    if (cle) return { cle, origine: "memoire" };
  }
  let meilleure = null;
  for (const g of grilles) {
    for (const z of g.zones) {
      const n = norm(z.nom);
      if (n && ` ${h} `.includes(` ${n} `) && (!meilleure || n.length > meilleure.longueur)) meilleure = { cle: z.cle, origine: "adresse", longueur: n.length };
    }
  }
  return meilleure ? { cle: meilleure.cle, origine: "adresse" } : null;
}

// Le départ de la grille qui correspond à un trajet : l'heure du bateau écrite dans la colonne (« Bateau 10h30 », « Lanta vers Lipe 10h30 ») doit être celle du
// trajet. Si plusieurs colonnes ont cette heure, la destination du trajet (« Koh Lipe ») doit figurer dans une seule d'entre elles ; sinon aucun départ n'est deviné.
export function departDuTrajet(grille, { heure = "", vers = "" } = {}) {
  const h = heureDeGrille(String(heure).replace(/h/i, ":"));
  if (!h || !grille) return "";
  // L'heure écrite dans le libellé de la colonne : « 10h30 », « 09h00 », « 10:30 ». « 1 hour » n'est pas une heure.
  const dansColonne = (c) => {
    const m = /(\d{1,2})\s*(?:[:.]\s*([0-5]\d)|h\s*([0-5]\d)?)(?![a-z\d])/i.exec(c);
    return m && Number(m[1]) < 24 ? `${String(m[1]).padStart(2, "0")}:${m[2] || m[3] || "00"}` : "";
  };
  const memes = grille.colonnes.filter((c) => dansColonne(c) === h);
  if (memes.length === 1) return memes[0];
  if (memes.length < 2) return "";
  const mots = norm(vers).split(" ").filter((w) => w.length >= 3 && !["koh", "ko", "port", "pier", "airport"].includes(w));
  const cibles = memes.filter((c) => mots.some((w) => ` ${norm(c)} `.includes(` ${w} `)));
  return cibles.length === 1 ? cibles[0] : "";
}

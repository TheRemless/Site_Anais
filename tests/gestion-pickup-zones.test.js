// Heure de pickup d'après la zone : seules les heures des grilles des partenaires, jamais une heure inventée.
import { test } from "node:test";
import assert from "node:assert/strict";
import { heureDeGrille, nomCourtZone, grillesDe, heureDeLaGrille, departApresChoix, heureAPoser, zoneAGarder, cleDeZoneGardee, zoneProposee, departDuTrajet } from "../src/gestion/js/pickup-calc.mjs";

const BUND = {
  regles: {
    pickups: [
      {
        titre: "Pickup à Lanta",
        colonnes: ["Lanta vers Lipe 10h30", "Phi Phi et Phuket 10h00", "Ao Nang 09h00"],
        lignes: [
          ["Klong Dao (คลองดาว)", "09:40", "09:10", ""],
          ["Long Beach (หาดยาว)", "09:30", "-", "08:15"],
          ["Old Town (เมืองเก่า)", "9h00", "08:30", "08:00"],
        ],
      },
    ],
  },
};
const SATUN = {
  regles: {
    pickups: [
      { titre: "Pickup à Lanta, zone A", colonnes: ["Bateau 10h30"], lignes: [["Saladan", "09:45"]] },
      { titre: "Pickup à Lanta, zone B", colonnes: ["Bateau 10h30", "Bateau 15h00"], lignes: [["Klong Nin", "09:15", "14:15"]] },
    ],
  },
};
const grilles = grillesDe(BUND);

test("case de grille : 09:40, 9h40, 9.40 lus ; vide, tiret et texte ne donnent rien", () => {
  assert.equal(heureDeGrille("09:40"), "09:40");
  assert.equal(heureDeGrille("9:40"), "09:40");
  assert.equal(heureDeGrille("9h40"), "09:40");
  assert.equal(heureDeGrille("9.40"), "09:40");
  for (const v of ["", "-", "—", "complet", "25:00", null, undefined]) assert.equal(heureDeGrille(v), "", String(v));
});

test("nom de zone : la graphie thaïe est retirée", () => {
  assert.equal(nomCourtZone("Klong Dao (คลองดาว)"), "Klong Dao");
  assert.equal(nomCourtZone("Old Town"), "Old Town");
});

test("grilles : zones, colonnes et heures lues ; partenaire sans grille ou grille vide ignorés", () => {
  assert.equal(grilles.length, 1);
  assert.deepEqual(grilles[0].zones.map((z) => z.nom), ["Klong Dao", "Long Beach", "Old Town"]);
  assert.deepEqual(grilles[0].zones[2].heures, ["09:00", "08:30", "08:00"]);
  assert.deepEqual(grillesDe({}), []);
  assert.deepEqual(grillesDe(null), []);
  assert.deepEqual(grillesDe({ regles: { pickups: [{ titre: "x", colonnes: [], lignes: [["A", "09:00"]] }, { titre: "y", colonnes: ["B"], lignes: [] }] } }), []);
  assert.equal(grillesDe(SATUN).length, 2);
});

test("heure d'une zone pour un départ : celle de la case, vide si la case est vide", () => {
  assert.equal(heureDeLaGrille(grilles, "0:0", "Lanta vers Lipe 10h30"), "09:40");
  assert.equal(heureDeLaGrille(grilles, "0:1", "Ao Nang 09h00"), "08:15");
  assert.equal(heureDeLaGrille(grilles, "0:1", "Phi Phi et Phuket 10h00"), "", "case « - » : pas de pickup, rien d'inventé");
  assert.equal(heureDeLaGrille(grilles, "0:0", "Ao Nang 09h00"), "", "case vide");
  assert.equal(heureDeLaGrille(grilles, "0:0", "Départ inconnu"), "");
  assert.equal(heureDeLaGrille(grilles, "9:9", "Ao Nang 09h00"), "");
});

test("départ gardé quand la zone change : le même s'il existe, le seul de la grille, sinon aucun", () => {
  assert.equal(departApresChoix(grilles, "0:2", "Ao Nang 09h00"), "Ao Nang 09h00");
  assert.equal(departApresChoix(grilles, "0:2", ""), "");
  assert.equal(departApresChoix(grilles, "0:2", "Bateau 10h30"), "");
  const sat = grillesDe(SATUN);
  assert.equal(departApresChoix(sat, "0:0", ""), "Bateau 10h30", "une seule colonne : choisie d'office");
  assert.equal(departApresChoix(sat, "1:0", "Bateau 10h30"), "Bateau 10h30");
  assert.equal(departApresChoix(sat, "1:0", ""), "");
});

test("heure posée : jamais sur une heure tapée à la main, jamais une heure vide", () => {
  assert.equal(heureAPoser({ actuelle: "", derniereGrille: "", nouvelle: "09:40" }), "09:40");
  assert.equal(heureAPoser({ actuelle: "09:40", derniereGrille: "09:40", nouvelle: "09:30" }), "09:30", "la dernière heure venue de la grille se remplace");
  assert.equal(heureAPoser({ actuelle: "10:15", derniereGrille: "09:40", nouvelle: "09:30" }), null, "heure tapée à la main : gardée");
  assert.equal(heureAPoser({ actuelle: "09:40", derniereGrille: "09:40", nouvelle: "" }), null, "case vide : l'heure existante n'est pas effacée");
});

test("zone gardée sur la réservation et retrouvée chez le même partenaire ou un autre", () => {
  const g = zoneAGarder(grilles, "0:0", "Ao Nang 09h00");
  assert.deepEqual(g, { zone: "Klong Dao", grille: "Pickup à Lanta", depart: "Ao Nang 09h00" });
  assert.equal(zoneAGarder(grilles, "5:5", ""), null);
  assert.equal(cleDeZoneGardee(grilles, g), "0:0");
  const autre = grillesDe({ regles: { pickups: [{ titre: "Autre grille", colonnes: ["Bateau"], lignes: [["klong dao", "08:50"]] }] } });
  assert.equal(cleDeZoneGardee(autre, g), "0:0", "même nom de zone chez un autre partenaire, sans tenir compte de la casse");
  assert.equal(cleDeZoneGardee(grilles, { zone: "Ban Saladan", grille: "" }), "");
  assert.equal(cleDeZoneGardee(grilles, null), "");
});

test("zone proposée : l'hôtel déjà vu d'abord, puis le nom de zone dans l'adresse, sinon rien", () => {
  const vue = [{ lieu_pickup: "Hotel Sunset", date_service: "2026-10-01", details: { pickup_zone: { zone: "Long Beach", grille: "Pickup à Lanta" } } }];
  assert.deepEqual(zoneProposee("hotel sunset", grilles, vue), { cle: "0:1", origine: "memoire" });
  assert.deepEqual(zoneProposee("Sunset Resort, Klong Dao", grilles, []), { cle: "0:0", origine: "adresse" });
  assert.equal(zoneProposee("Sunset Resort", grilles, vue), null, "autre hôtel, aucune zone dans le nom");
  assert.equal(zoneProposee("", grilles, vue), null);
  assert.equal(zoneProposee("Klong Dao", [], vue), null);
  // le souvenir l'emporte sur le nom, et la réservation la plus récente l'emporte
  const deux = [
    { lieu_pickup: "Sunset Resort, Klong Dao", date_service: "2026-09-01", details: { pickup_zone: { zone: "Old Town", grille: "" } } },
    { lieu_pickup: "Sunset Resort, Klong Dao", date_service: "2026-10-01", details: { pickup_zone: { zone: "Long Beach", grille: "" } } },
  ];
  assert.deepEqual(zoneProposee("Sunset Resort, Klong Dao", grilles, deux), { cle: "0:1", origine: "memoire" });
  // une zone gardée que ce partenaire n'a pas : on retombe sur le nom écrit dans l'adresse
  const inconnue = [{ lieu_pickup: "Sunset Resort, Klong Dao", details: { pickup_zone: { zone: "Ban Saladan", grille: "" } } }];
  assert.deepEqual(zoneProposee("Sunset Resort, Klong Dao", grilles, inconnue), { cle: "0:0", origine: "adresse" });
});

test("nom de zone cherché sur des mots entiers", () => {
  assert.equal(zoneProposee("Old Townhouse Lodge", grilles, []), null);
  assert.deepEqual(zoneProposee("Hotel near Old Town, Lanta", grilles, []), { cle: "0:2", origine: "adresse" });
});

test("départ d'un trajet : la colonne dont l'heure est celle du bateau, la destination départage, sinon aucun", () => {
  const g = { colonnes: ["Lanta vers Lipe 10h30", "Phi Phi et Phuket 10h00", "Ao Nang 09h00", "Lanta vers Lipe 12h30"] };
  assert.equal(departDuTrajet(g, { heure: "10:30", vers: "Koh Lipe" }), "Lanta vers Lipe 10h30");
  assert.equal(departDuTrajet(g, { heure: "09:00", vers: "Ao Nang" }), "Ao Nang 09h00");
  assert.equal(departDuTrajet(g, { heure: "11:00", vers: "Koh Lipe" }), "", "aucune colonne à cette heure");
  assert.equal(departDuTrajet(g, { heure: "", vers: "Koh Lipe" }), "");
  assert.equal(departDuTrajet(null, { heure: "10:30" }), "");
  const deux = { colonnes: ["Phi Phi 10h30", "Lipe 10h30"] };
  assert.equal(departDuTrajet(deux, { heure: "10:30", vers: "Koh Lipe" }), "Lipe 10h30", "même heure, la destination départage");
  assert.equal(departDuTrajet(deux, { heure: "10:30", vers: "Phuket" }), "", "même heure, destination absente : rien de deviné");
  assert.equal(departDuTrajet({ colonnes: ["Bateau 10h30"] }, { heure: "10:30", vers: "x" }), "Bateau 10h30");
});

test("départ d'un trajet : « 1 hour » n'est pas une heure, « 10:30 » et « 10h » le sont", () => {
  assert.equal(departDuTrajet({ colonnes: ["Boat 1 hour before 10h30", "Other 12h00"] }, { heure: "10:30" }), "Boat 1 hour before 10h30");
  assert.equal(departDuTrajet({ colonnes: ["Bateau 10:30"] }, { heure: "10h30" }), "Bateau 10:30");
  assert.equal(departDuTrajet({ colonnes: ["Bateau 10h"] }, { heure: "10:00" }), "Bateau 10h");
  assert.equal(departDuTrajet({ colonnes: ["Pickup 1 hour"] }, { heure: "01:00" }), "");
});

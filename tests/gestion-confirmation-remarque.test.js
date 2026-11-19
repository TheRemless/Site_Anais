// « Coller une confirmation » (Jérémy, 19.11.2026) : la confirmation de Tom Heinzler perdait sa remarque (« Remark/other: ») dans « Lignes non
// reprises », « VIP » seul n'était pas lu comme la marque Taxi, et « ขอบคุณค่ะ 🫶🏼 » s'affichait comme une ligne oubliée.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lireConfirmation, lireMarque, estPolitesse } from "../src/gestion/js/confirmation-calc.mjs";
import { donneesVoucher, reservationApercu } from "../src/gestion/js/voucher-rapide-calc.mjs";
import { champsBooking, bagagesBooking, passagersBooking } from "../src/gestion/js/taxi-calc.mjs";

const AJD = "2026-11-19";
// Le texte exact collé par Jérémy, espaces en fin de ligne et ligne « espace » comprises.
const TOM = "📢 New booking confirmation:\nVIP\nName: Tom Heinzler\nDate: November 21 2026\nPick-up time: 1pm\nPick-up location: Jai Tiki Retreat\nDrop-off location: Krabi Airport \nNumber of passengers: 2 people + luggage \nPrice: 3’000 THB\nRemark/other: stop for 1h at Krabi Nakharin International Hospital\n \nขอบคุณค่ะ 🫶🏼";
const lire = (t) => lireConfirmation(t, { aujourdhui: AJD });

test("le texte de Tom Heinzler : tout est lu, la remarque comprise, rien dans « Lignes non reprises »", () => {
  const { marque, valeurs: v, ignorees } = lire(TOM);
  assert.equal(marque, "taxi", "« VIP » seul sur sa ligne");
  assert.deepEqual(ignorees, []);
  assert.equal(v.nom, "Tom Heinzler");
  assert.equal(v.date, "2026-11-21");
  assert.equal(v.heure, "13:00");
  assert.equal(v.pickup, "Jai Tiki Retreat");
  assert.equal(v.dropoff, "Krabi Airport");
  assert.equal(v.adultes, "2");
  assert.equal(v.remarques, "stop for 1h at Krabi Nakharin International Hospital");
  // Prix avec l'apostrophe typographique des milliers.
  assert.equal(v.prix, "3000");
  // La Booking confirmation : REMARKS et LUGGAGE « Yes ».
  const x = donneesVoucher(v);
  const r = reservationApercu(x);
  const lignes = champsBooking({ nom: x.nom, date: x.date, pickup: x.pickup, heure: x.heure, dropoff: x.dropoff, personnes: x.personnes, bagages: x.bagages, montant: x.prix, remarques: r.details.remarques });
  const val = (cle) => (lignes.find((l) => l.cle === cle) || {}).valeur;
  assert.equal(val("REMARKS"), "stop for 1h at Krabi Nakharin International Hospital");
  assert.equal(val("LUGGAGE"), "Yes");
  assert.ok(!lignes.some((l) => /yes pieces/i.test(String(l.valeur))));
});

test("libellés de remarque : toutes les variantes vont dans la remarque imprimée", () => {
  const variantes = ["Remark", "Remarks", "REMARK", "remarks", "Remark/other", "Remark / Other", "REMARK/OTHER", "Other", "Others", "Note", "Notes", "Comment", "Comments", "Special request", "Special requests", "Special Request(s)", "Request", "Extra", "Extras", "Info", "Infos", "Additional info", "Additional information", "Remarks/Notes", "Specialrequests"];
  for (const lib of variantes) {
    const { valeurs, ignorees } = lire(`Name: Anna\n${lib}: baby seat needed`);
    assert.equal(valeurs.remarques, "baby seat needed", lib);
    assert.deepEqual(ignorees, [], lib);
  }
  // Deux remarques s'ajoutent dans l'ordre ; une remarque sur deux lignes reste une remarque.
  assert.equal(lire("Remark: birthday\nOther: cake box").valeurs.remarques, "birthday; cake box");
  assert.equal(lire("Remark: stop at the hospital\nfor one hour").valeurs.remarques, "stop at the hospital for one hour");
});

test("un « libellé: valeur » inconnu n'est jamais perdu : il rejoint la remarque proposée", async () => {
  const { valeurs, ignorees } = lire("VIP\nName: Anna\nHotel room: 214\nDriver: Mr. Brown\nRemark: birthday\nDriver note:");
  assert.equal(valeurs.remarques, "Hotel room: 214; Driver: Mr. Brown; birthday");
  assert.deepEqual(ignorees, [], "un libellé vide n'a rien à perdre");
  // « Lignes non reprises » garde seulement les lignes sans libellé ; une heure ou un lien n'est pas un libellé.
  const autre = lire("Name: Anna\nsee you soon at the pier\n13:00\nhttps://maps.app/x");
  assert.deepEqual(autre.ignorees, ["see you soon at the pier", "13:00", "https://maps.app/x"]);
  assert.equal(autre.valeurs.remarques, "");
  // Un libellé inconnu ne fait pas d'un message de client une confirmation, et ne masque pas un nom collé seul.
  const { ressembleAConfirmation } = await import("../src/gestion/js/confirmation-calc.mjs");
  assert.equal(ressembleAConfirmation("Secret\nEmail: anna@example.com\nMessage: do you have a tour tomorrow?", { aujourdhui: AJD }), false);
  const seul = lire("Ref: 1234\nJulien Rochat\nDate: 22/11\nPick-up time: 9am");
  assert.equal(seul.valeurs.nom, "Julien Rochat");
  assert.equal(seul.valeurs.remarques, "Ref: 1234");
});

test("politesse en thaï, en anglais ou en emoji : nulle part", () => {
  for (const l of ["ขอบคุณค่ะ 🫶🏼", "ขอบคุณครับ", "สวัสดีค่ะ", "ขอบคุณมากๆ ค่ะ 🙏", "Thank you!", "Thanks", "Merci", "🙏🏽"]) {
    const { valeurs, ignorees } = lire(`Name: Anna\nRemark: birthday\n${l}`);
    assert.equal(valeurs.remarques, "birthday", l);
    assert.deepEqual(ignorees, [], l);
  }
  assert.equal(estPolitesse("ลูกค้ามีเด็กเล็ก"), false, "une vraie information en thaï n'est pas de la politesse");
  assert.deepEqual(lire("Name: Anna\nลูกค้ามีเด็กเล็ก").ignorees, ["ลูกค้ามีเด็กเล็ก"], "elle reste visible");
});

test("marque : une ligne seule, sans majuscules obligatoires", () => {
  for (const l of ["VIP", "vip", "VIP Taxi", "vip taxi", "VIP TAXI LANTA", "Vip Taxi Lanta", "Taxi Lanta", "VIP:"]) assert.equal(lireMarque(l), "taxi", l);
  for (const l of ["Secret", "SECRET", "Secret Travel", "secret travel", "SECRET TRAVEL & TOUR", "Secret Travel and Tours"]) assert.equal(lireMarque(l), "secret", l);
  for (const l of ["The secret beach", "VIP guest", "Name: VIP", "Taxi to the pier"]) assert.equal(lireMarque(l), null, l);
  assert.equal(lire("secret travel\nName: Anna").marque, "secret");
  assert.equal(lire("Name: VIP Lounge guest").marque, null);
});

test("bagages sans nombre : « Yes » sur la Booking confirmation, jamais « yes pieces »", () => {
  for (const p of ["2 people + luggage", "2 people with luggage", "2 adults and luggage"]) assert.equal(lire(`Number of passengers: ${p}`).valeurs.bagages, "Yes", p);
  assert.equal(lire("Luggage: yes").valeurs.bagages, "Yes");
  assert.equal(lire("Luggage: 3").valeurs.bagages, "3");
  assert.equal(lire("Number of passengers: 2 people no luggage").valeurs.bagages, "");
  for (const v of ["yes", "Yes", "YES", "y", "oui"]) assert.equal(bagagesBooking(v), "Yes", v);
  assert.equal(bagagesBooking("3"), "3 pieces");
  assert.equal(bagagesBooking("1"), "1 piece");
  assert.equal(passagersBooking({ adultes: 2 }, "yes"), "2 adults + luggage");
});

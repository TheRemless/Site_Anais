/* Feuille de réservation des pages de carnet (/carnet/).
   Le client choisit une offre, remplit la feuille, et envoie une DEMANDE : Anaïs la confirme après avoir vérifié la disponibilité,
   le paiement se fait sur place. Rien n'est payé en ligne.

   Les offres et les réglages viennent du guide : le JSON de la page (<script id="cg-data">) fabriqué par src/carnet/<guide>.11tydata.js.
   Ce fichier ne contient aucun tarif.

   Envoi : une copie de la demande part vers Gestion (contrat docs/gestion/demandes-site.md), comme le fait la feuille du site des excursions :
   corps JSON en text/plain (requête simple, pas de contrôle CORS préalable), keepalive, champ piège « website », erreur avalée.
   L'envoi ne bloque jamais l'ouverture de WhatsApp. Pas de Turnstile pour l'instant (le contrat le prévoit, sans clé).

   Les fonctions de calcul (estimation, contrôle, message, corps) n'utilisent pas le navigateur : tests/carnet-booking.test.js les charge
   avec require() et remplace fetch par un faux. Jamais d'appel réel à la fonction de production dans les tests. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.CarnetBooking = api;
    if (typeof document !== "undefined") {
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { api.init(document); });
      else api.init(document);
    }
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Adresse unique de la fonction qui reçoit les demandes (Supabase, projet de Gestion). Une seule constante, aucune autre adresse dans ce fichier.
  // La fonction n'accepte que les origines de sa liste SITE_ORIGINES : zwaldtravelplanner.com doit y figurer, sinon le navigateur refuse l'envoi
  // et la feuille propose WhatsApp à la place (voir « envoiNonConfirme » plus bas).
  var DEMANDE_URL = "https://lkxqcmzeidlyssoqmqkh.supabase.co/functions/v1/demande-site";
  // Slug technique de l'entreprise qui reçoit la demande dans Gestion. Jamais affiché.
  var BRAND = "secret";
  var NBSP = " ";
  var APOS = "’";
  var JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  var MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  var REF_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  // Limites reprises du contrat demandes-site : appliquées à la saisie (contrôle de la feuille), jamais en coupant le récapitulatif.
  // Au pire (60 personnes, 12 âges, champs au maximum) le récapitulatif reste sous 2 000 caractères et le corps sous 4 096 octets (testé).
  var PICKUP_MAX = 200, TEXT_MAX = 500;

  function clean(v) { return String(v === undefined || v === null ? "" : v).replace(/\s+/g, " ").trim(); }
  function digits(s) { return String(s || "").replace(/\D/g, ""); }
  function fmt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, APOS); }
  function thb(n) { return fmt(n) + NBSP + "THB"; }
  function plural(n, one, many) { return n + " " + (n > 1 ? many : one); }

  // ---------- Dates (heure de Bangkok) ----------
  function bangkokToday(now) {
    return new Date((now === undefined ? Date.now() : now) + 7 * 3600 * 1000).toISOString().slice(0, 10);
  }
  function addDays(iso, n) { var d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function weekday(iso) { return new Date(iso + "T00:00:00Z").getUTCDay(); }
  function validIso(iso) { return /^\d{4}-\d{2}-\d{2}$/.test(iso || "") && !isNaN(Date.parse(iso + "T00:00:00Z")) && new Date(iso + "T00:00:00Z").toISOString().slice(0, 10) === iso; }
  function formatDate(iso) {
    var d = new Date(iso + "T00:00:00Z");
    return JOURS[d.getUTCDay()] + " " + d.getUTCDate() + " " + MOIS[d.getUTCMonth()] + " " + d.getUTCFullYear();
  }

  // ---------- Numéro WhatsApp : format international obligatoire ----------
  // Écritures acceptées : « +41 79 123 45 67 », « 0041 79… », « (+41) 79… », « +41.79.123.45.67 », « +41 (0)79… », « 0041 (0)79… »,
  // et le zéro national laissé après l'indicatif (« +33 06… », « +66 081… »). Renvoie le numéro compacté, « + » puis 8 à 15 chiffres, ou une chaîne vide.
  // Pays dont le zéro national tombe quand on compose à l'international (leurs numéros nationaux ne commencent jamais par 0 :
  // retirer ce 0 est sûr). Les pays qui le GARDENT (Italie +39, y compris les fixes en 0…, Saint-Marin…) ne figurent jamais ici.
  var TRUNK_ZERO = ["971", "212", "353", "358", "27", "31", "32", "33", "41", "43", "44", "46", "49", "60", "61", "62", "64", "66", "81", "82", "84", "90", "91"];
  var KEEP_ZERO = ["39", "378", "379"];
  function phoneCompact(raw, keepZeroInParens) {
    var r = clean(raw).replace(/\(\s*0\s*\)/g, keepZeroInParens ? "0" : "");
    if (/[^\d\s()+.\-\/]/.test(r)) return null;
    return r.replace(/[\s().\-\/]/g, "");
  }
  function phoneE164(raw) {
    var c = phoneCompact(raw, false);
    var m = c === null ? null : /^(?:\+|00)(\d+)$/.exec(c);
    if (!m) return "";
    var d = m[1];
    for (var k = 0; k < KEEP_ZERO.length; k++) {
      if (d.indexOf(KEEP_ZERO[k]) === 0) { d = /^(?:\+|00)(\d+)$/.exec(phoneCompact(raw, true))[1]; return d.length >= 8 && d.length <= 15 ? "+" + d : ""; }
    }
    for (var i = 0; i < TRUNK_ZERO.length; i++) {
      var code = TRUNK_ZERO[i];
      if (d.indexOf(code + "0") === 0) { d = code + d.slice(code.length + 1); break; }
    }
    return d.length >= 8 && d.length <= 15 && d.charAt(0) !== "0" ? "+" + d : "";
  }
  function phoneError(raw) {
    var r = clean(raw);
    if (!r) return "Ajoutez votre numéro WhatsApp.";
    var c = phoneCompact(r);
    if (c === null) return "Utilisez seulement des chiffres pour le numéro.";
    if (!/^(\+|00)/.test(c)) return "Ajoutez l" + APOS + "indicatif de votre pays, par exemple +41.";
    return phoneE164(r) ? "" : "Vérifiez le numéro : 8 à 15 chiffres, indicatif du pays compris.";
  }
  function fullNameError(name) {
    var parts = clean(name).split(" ").filter(Boolean);
    if (parts.length < 2) return "Indiquez votre prénom et votre nom.";
    return clean(name).length > 120 ? "Le nom est trop long (120 caractères au plus)." : "";
  }

  // ---------- Fermeture annuelle du parc d'Ang Thong ----------
  // rule : { debut: "11-01", fin: "12-15", anneeConfirmee, message, messageAnnee }, une seule définition dans les données du guide.
  // Une date de n'importe quelle année dans la fenêtre est refusée ; la fin est incluse.
  function inClosure(iso, rule) {
    if (!rule || !validIso(iso)) return false;
    var md = iso.slice(5);
    return rule.debut <= md && md <= rule.fin;
  }
  // Premier jour réservable après la fermeture qui contient iso.
  function afterClosure(iso, rule) { return addDays(iso.slice(0, 4) + "-" + rule.fin, 1); }
  // Cette année la fermeture est confirmée (« jusqu'au 15 décembre 2026 ») ; les suivantes restent générales.
  function closureText(iso, rule) {
    return rule.anneeConfirmee && Number(iso.slice(0, 4)) === rule.anneeConfirmee ? rule.messageAnnee : rule.message;
  }

  // ---------- Tarifs et estimation ----------
  function tierFor(offer, pax) {
    var t = offer.paliers || [];
    for (var i = 0; i < t.length; i++) if (pax >= t[i].min && pax <= t[i].max) return t[i];
    return null;
  }
  function variantOf(offer, id) {
    var v = offer.variantes || [];
    for (var i = 0; i < v.length; i++) if (v[i].id === id) return v[i];
    return null;
  }
  // Prix par personne de l'offre (ou de la formule choisie) : { adulte, enfant }.
  function personPrices(offer, variantId) {
    var v = variantOf(offer, variantId);
    return {
      adulte: v ? v.adulte : offer.adulte,
      enfant: v ? v.enfant : (offer.enfant && offer.enfant.prix)
    };
  }
  function ages(state) {
    return (state.ages || []).map(function (a) { return a === "" || a === null || a === undefined ? null : Number(a); });
  }
  // Estimation en THB. state : { adults, ages: [..], variante, transfert }.
  // Renvoie { ok, total, lines: [{label, amount}], notes: [texte], error }.
  function estimate(offer, state) {
    var adults = Math.max(0, parseInt(state.adults, 10) || 0);
    var kids = ages(state);
    var lines = [], notes = [], total = 0, partial = 0;
    if (offer.type === "bateau") {
      var pax = adults + kids.length;
      var tier = tierFor(offer, pax);
      if (!tier) {
        return { ok: false, total: 0, lines: [], notes: [], error: pax < 1 ? "" : "Ce bateau accueille " + offer.capacite + " personnes au plus." };
      }
      lines.push({ label: "Bateau privé, " + (tier.min === tier.max ? plural(tier.min, "personne", "personnes") : tier.min + " à " + tier.max + " personnes"), amount: tier.prix });
      total += tier.prix;
    } else {
      var p = personPrices(offer, state.variante);
      if (offer.variantes && !variantOf(offer, state.variante)) return { ok: false, total: 0, lines: [], notes: [], error: "" };
      var asAdult = adults, children = 0, free = 0, unknown = 0, olderAsAdult = 0;
      var rule = offer.enfant || {};
      kids.forEach(function (a) {
        if (a === null) return;
        if (offer.bebe && a <= offer.bebe.max) free++;
        else if (rule.min !== undefined && a < rule.min) unknown++;
        else if (rule.max !== undefined && a <= rule.max) children++;
        else { asAdult++; if (!offer.adulteRegle) olderAsAdult++; } // sans règle écrite pour l'adulte, le tarif adulte d'un enfant plus âgé est une supposition
      });
      if (asAdult) lines.push({ label: plural(asAdult, "adulte", "adultes") + (olderAsAdult ? " (dont " + plural(olderAsAdult, "enfant plus âgé", "enfants plus âgés") + ", tarif adulte)" : "") + " × " + thb(p.adulte), amount: asAdult * p.adulte });
      if (children) lines.push({ label: plural(children, "enfant", "enfants") + " × " + thb(p.enfant), amount: children * p.enfant });
      if (free) lines.push({ label: plural(free, "bébé", "bébés") + " : gratuit", amount: 0 });
      partial = unknown + olderAsAdult;
      if (unknown) notes.push(plural(unknown, "enfant de moins de " + rule.min + " ans", "enfants de moins de " + rule.min + " ans") + " : pas de tarif écrit, non compté dans le total.");
      total += asAdult * p.adulte + children * p.enfant;
    }
    if (state.transfert && offer.transfert) {
      lines.push({ label: "Transfert depuis l" + APOS + "hôtel (" + offer.transfert.unite + ", indicatif)", amount: offer.transfert.prix });
      total += offer.transfert.prix;
    }
    return { ok: true, total: total, lines: lines, notes: notes, partial: partial, error: "" };
  }
  // Un enfant dont l'âge n'a pas de tarif écrit : le total n'est pas définitif, et le récapitulatif le dit.
  function partialMessage(n) {
    return "Estimation partielle : le tarif de " + plural(n, "enfant", "enfants") + " est à confirmer avec Anaïs";
  }

  // Entrée du parc d'Ang Thong (offer.parc), à payer sur place, hors estimation. Séparée des seuils de l'excursion :
  // gratuit avant parc.enfantMin ans, tarif enfant de parc.enfantMin à parc.enfantMax ans, tarif adulte au-delà ; la taille (1,40 m) n'est pas demandée.
  function parkFee(offer, state) {
    if (!offer.parc) return null;
    var p = offer.parc;
    var adults = Math.max(0, parseInt(state.adults, 10) || 0);
    var a = adults, c = 0, free = 0;
    ages(state).forEach(function (age) {
      if (age === null) return;
      if (age < p.enfantMin) free++;
      else if (age <= p.enfantMax) c++;
      else a++;
    });
    var parts = [];
    if (a) parts.push(plural(a, "adulte", "adultes") + " × " + thb(p.adulte));
    if (c) parts.push(plural(c, "enfant", "enfants") + " × " + thb(p.enfant));
    if (free) parts.push(plural(free, "enfant", "enfants") + " de moins de " + p.enfantMin + " ans : gratuit");
    return { amount: a * p.adulte + c * p.enfant, detail: parts.join(", ") };
  }

  // ---------- Contrôle de la feuille ----------
  // raw : { variante, date, creneau, adults, ages, pickup, transfert, name, whatsapp }. Renvoie { clé: message } (vide si tout est bon).
  // closure : règle de fermeture annuelle d'Ang Thong (voir inClosure), ou null.
  function validate(offer, raw, today, closure) {
    var e = {};
    var adults = parseInt(raw.adults, 10) || 0;
    var kids = raw.ages || [];
    if (offer.variantes && !variantOf(offer, raw.variante)) e.variante = "Choisissez une formule.";
    if (!raw.date) e.date = "Choisissez la date souhaitée.";
    else if (!validIso(raw.date)) e.date = "Cette date n" + APOS + "est pas valable.";
    else if (raw.date < today) e.date = "Cette date est passée.";
    else if (offer.angThong && inClosure(raw.date, closure)) e.date = closureText(raw.date, closure) + " Choisissez une date à partir du " + formatDate(afterClosure(raw.date, closure)) + ".";
    else if (raw.date > addDays(today, 365)) e.date = "Choisissez une date dans l" + APOS + "année qui vient.";
    else if (offer.jours && offer.jours.indexOf(weekday(raw.date)) < 0) e.date = "Ce départ en groupe a lieu " + offer.joursTexte + ". Choisissez l" + APOS + "un de ces jours.";
    if ((offer.creneaux || []).length > 1 && !creneauOf(offer, raw.creneau)) e.creneau = "Choisissez un créneau.";
    if (adults < 1) e.adults = "Indiquez au moins un adulte.";
    else if (adults + kids.length > 60) e.adults = "Pour plus de 60 personnes, écrivez à Anaïs.";
    kids.forEach(function (a, i) { if (a === "" || a === null || a === undefined || isNaN(Number(a))) e["age-" + i] = "Indiquez l" + APOS + "âge de l" + APOS + "enfant."; });
    if (offer.type === "bateau" && adults + kids.length > offer.capacite) e.pax = "Ce bateau accueille " + offer.capacite + " personnes au plus. Écrivez à Anaïs pour un groupe plus grand.";
    if (!clean(raw.pickup)) e.pickup = "Indiquez votre hôtel ou le lieu de prise en charge.";
    if (clean(raw.pickup).length > PICKUP_MAX) e.pickup = "Ce lieu est trop long (" + PICKUP_MAX + " caractères au plus).";
    if (clean(raw.message).length > TEXT_MAX) e.message = "Le message est trop long (" + TEXT_MAX + " caractères au plus).";
    var ne = fullNameError(raw.name);
    if (ne) e.name = ne;
    var pe = phoneError(raw.whatsapp);
    if (pe) e.whatsapp = pe;
    return e;
  }
  function creneauOf(offer, id) {
    var c = offer.creneaux || [];
    if (c.length === 1) return c[0];
    for (var i = 0; i < c.length; i++) if (c[i].id === id) return c[i];
    return null;
  }

  // ---------- Message, référence, corps ----------
  function makeRef(prefix, rand) {
    var s = "";
    var n = rand || function (max) {
      if (typeof crypto !== "undefined" && crypto.getRandomValues) { var a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % max; }
      return Math.floor(Math.random() * max);
    };
    for (var i = 0; i < 4; i++) s += REF_CHARS.charAt(n(REF_CHARS.length));
    return (prefix || "SAM") + "-" + s;
  }
  function agesText(raw) {
    var kids = (raw.ages || []).map(Number);
    if (!kids.length) return "";
    return kids.map(function (a) { return a < 1 ? "moins d" + APOS + "1 an" : a + (a > 1 ? " ans" : " an"); }).join(", ");
  }
  // Récapitulatif lisible, sans autre nom que celui de la prestation ; sert de message à Gestion et à WhatsApp.
  function buildRecap(offer, raw, est, ref) {
    var lines = ["Demande de réservation : " + offer.produit];
    var v = variantOf(offer, raw.variante);
    if (v) lines.push("Formule : " + v.label.toLowerCase());
    lines.push("Date : " + formatDate(raw.date));
    var c = creneauOf(offer, raw.creneau);
    if (c) lines.push("Créneau : " + c.label);
    var kids = (raw.ages || []).length;
    var adults = parseInt(raw.adults, 10) || 0;
    lines.push("Personnes : " + plural(adults, "adulte", "adultes") + (kids ? ", " + plural(kids, "enfant", "enfants") + " (" + agesText(raw) + ")" : ""));
    lines.push("Prise en charge : " + clean(raw.pickup));
    if (offer.transfert) lines.push("Transfert depuis l" + APOS + "hôtel : " + (raw.transfert ? "oui (" + thb(offer.transfert.prix) + " " + offer.transfert.unite + ", indicatif)" : "non"));
    if (est && est.ok) lines.push("Estimation : " + thb(est.total) + ", à payer sur place après confirmation");
    if (est && est.ok && est.partial) lines.push(partialMessage(est.partial));
    var park = parkFee(offer, raw);
    if (park) lines.push("Entrée du parc à payer sur place : " + thb(park.amount));
    lines.push("Nom : " + clean(raw.name));
    lines.push("WhatsApp : " + phoneE164(raw.whatsapp));
    if (clean(raw.message)) lines.push("Message : " + clean(raw.message));
    lines.push("Réf : " + ref);
    return lines.join("\n");
  }
  function waUrl(number, text) {
    return "https://wa.me/" + digits(number) + "?text=" + encodeURIComponent(text);
  }
  function waMessage(recap) { return "Bonjour Anaïs, voici ma demande de réservation.\n\n" + recap; }

  // Corps du contrat demandes-site (docs/gestion/demandes-site.md). Pas d'e-mail.
  function buildBody(offer, raw, est, ref, recap, pageUrl) {
    var v = variantOf(offer, raw.variante);
    var c = creneauOf(offer, raw.creneau);
    var option = v ? v.id : c ? c.id : "";
    var label = [v ? v.label.toLowerCase() : "", c ? c.label : ""].filter(Boolean).join(", ");
    var kids = (raw.ages || []).length;
    return {
      brand: BRAND,
      product_id: offer.id,
      product: offer.produit,
      option: option,
      option_label: label,
      date: raw.date,
      time: c && /^\d{2}:\d{2}$/.test(c.heure || "") ? c.heure : "",
      adults: parseInt(raw.adults, 10) || 0,
      children: kids,
      pickup: clean(raw.pickup),
      name: clean(raw.name),
      whatsapp: phoneE164(raw.whatsapp),
      estimated_total: est && est.ok ? est.total : null,
      currency: "THB",
      ref: ref,
      page_url: String(pageUrl || "").split("#")[0].slice(0, 300),
      message: recap,
      website: ""
    };
  }

  // Envoi sans attendre de réponse pour l'utilisateur, toute erreur est avalée. Renvoie une promesse qui ne rejette jamais :
  // vrai si la fonction a accepté la demande, faux sinon (la feuille propose alors WhatsApp).
  function sendCopy(body, fetchImpl, beaconImpl) {
    try {
      var data = JSON.stringify(body);
      if (typeof fetchImpl === "function") {
        return Promise.resolve(fetchImpl(DEMANDE_URL, { method: "POST", body: data, keepalive: true, mode: "cors", credentials: "omit", headers: { "Content-Type": "text/plain;charset=UTF-8" } }))
          .then(function (res) { return !!(res && res.ok); }, function () { return false; });
      }
      if (typeof beaconImpl === "function") return Promise.resolve(!!beaconImpl(DEMANDE_URL, data));
    } catch (err) { /* jamais bloquant */ }
    return Promise.resolve(false);
  }

  // Ouvre WhatsApp. « noopener » dans les features ferait toujours renvoyer null (même quand la fenêtre s'ouvre) : on ouvre sans, puis on coupe le lien
  // avec la page. « blocked » seulement si le navigateur a réellement refusé la fenêtre.
  function openWhatsApp(url, openFn) {
    var w = null;
    try { w = openFn(url, "_blank"); } catch (err) { w = null; }
    if (!w) return "blocked";
    try { w.opener = null; } catch (err) { /* fenêtre d'une autre origine */ }
    return "opened";
  }
  // Mémoire de page : nom, WhatsApp et hôtel saisis passent d'une offre à l'autre pendant la visite ; vidés après un envoi réussi.
  function makeMemory() {
    var m = {};
    return { set: function (k, v) { m[k] = String(v === undefined || v === null ? "" : v); }, get: function (k) { return m[k] || ""; }, clear: function () { m = {}; } };
  }
  // Un clic sur le fond ne ferme pas une feuille dont le formulaire a été modifié (Échap et le bouton fermer restent possibles).
  function shouldCloseOnBackdrop(dirty) { return !dirty; }
  // Jeton d'envoi : une réponse tardive du réseau ne touche que la demande qui l'a créée, jamais la confirmation suivante.
  function makeTracker() {
    var n = 0;
    return { next: function () { n += 1; return n; }, isCurrent: function (id) { return id === n; } };
  }

  // Cœur de l'envoi, sans navigateur : anti-robot, contrôle, message, copie vers Gestion.
  // deps : { fetch, beacon, now (ms), pageUrl, rand }. raw.openedAt : ouverture de la feuille (ms). raw.website : champ piège.
  // Robot (champ piège rempli) : testé AVANT tout contrôle, confirmation neutre identique à une vraie, rien n'est envoyé.
  // Envoi trop rapide : même confirmation qu'une vraie (le message WhatsApp part avec tout le détail), sans copie ; aucun message ne révèle le seuil.
  function submitRequest(config, offerId, raw, deps) {
    var offer = config.offres[offerId];
    deps = deps || {};
    var now = deps.now === undefined ? Date.now() : deps.now;
    if (!offer) return { ok: false, errors: { offre: "Offre inconnue." } };
    var ref;
    if (clean(raw.website)) {
      ref = makeRef(config.reglages && config.reglages.prefixeRef, deps.rand);
      var generic = "Demande de réservation : " + offer.produit + "\nRéf : " + ref;
      return { ok: true, silent: true, ref: ref, recap: generic, whatsappUrl: waUrl(config.whatsapp, waMessage(generic)), sent: Promise.resolve(true) };
    }
    var reglages = config.reglages || {};
    var errors = validate(offer, raw, bangkokToday(now), reglages.fermetureAngThong);
    if (Object.keys(errors).length) return { ok: false, errors: errors };
    var est = estimate(offer, raw);
    ref = makeRef(reglages.prefixeRef, deps.rand);
    var recap = buildRecap(offer, raw, est, ref);
    var delay = reglages.delaiMinimalMs || 0;
    var tooFast = raw.openedAt !== undefined && now - raw.openedAt < delay;
    var body = buildBody(offer, raw, est, ref, recap, deps.pageUrl);
    var sent = tooFast ? Promise.resolve(true) : sendCopy(body, deps.fetch, deps.beacon);
    return { ok: true, ref: ref, recap: recap, body: body, dropped: tooFast, whatsappUrl: waUrl(config.whatsapp, waMessage(recap)), sent: sent };
  }

  // ---------- Navigateur ----------
  function el(doc, tag, attrs, text) {
    var n = doc.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function init(doc) {
    var dataEl = doc.getElementById("cg-data");
    var dialog = doc.getElementById("cg-sheet");
    if (!dataEl || !dialog) return;
    var config;
    try { config = JSON.parse(dataEl.textContent); } catch (e) { return; }
    var $ = function (name) { return dialog.querySelector('[data-cg="' + name + '"]'); };
    var form = $("form"), done = $("done");
    var current = null, opener = null, openedAt = 0, submitted = false, dirty = false;
    var tracker = makeTracker();
    var memory = makeMemory(); // nom, WhatsApp et hôtel gardés d'une offre à l'autre
    var today = bangkokToday(); // recalculée à chaque ouverture de la feuille (fuseau de Bangkok)

    // Parc d'Ang Thong : fermeture annuelle (une seule règle dans les données). Le message des offres suit la date du jour.
    var closure = (config.reglages && config.reglages.fermetureAngThong) || null;
    function closureNote() {
      if (!closure) return "";
      return inClosure(today, closure) ? closureText(today, closure) : closure.message;
    }
    function refreshClosure() {
      var text = closureNote();
      Array.prototype.forEach.call(doc.querySelectorAll("[data-cg-fermeture]"), function (n) { n.textContent = text; n.hidden = !text; });
    }
    refreshClosure();

    function fallbackWa(offer) { return waUrl(config.whatsapp, "Bonjour Anaïs, je souhaite réserver : " + offer.produit); }

    function open(id, trigger) {
      var offer = config.offres[id];
      if (!offer) return;
      if (typeof dialog.showModal !== "function") { window.open(fallbackWa(offer), "_blank", "noopener"); return; }
      today = bangkokToday();
      refreshClosure();
      current = offer; opener = trigger; submitted = false; dirty = false; openedAt = Date.now();
      tracker.next(); // une réponse tardive de l'envoi précédent ne touche plus rien
      resetDone();
      render(offer);
      form.hidden = false; done.hidden = true;
      dialog.showModal();
      dialog.scrollTop = 0;
      $("title").focus();
    }
    function close() { if (dialog.open) dialog.close(); }
    function resetDone() {
      $("done-popup").hidden = true;
      $("done-warning").hidden = true;
    }

    function render(offer) {
      form.reset(); // ce qui dépend de l'offre repart de zéro (date, nombres, options) ; nom, WhatsApp et hôtel reviennent de la mémoire de page
      $("name").value = memory.get("name");
      $("whatsapp").value = memory.get("whatsapp");
      $("pickup").value = memory.get("pickup");
      $("title").textContent = offer.produit;
      clearErrors();
      // formule
      var vf = $("variantes"), vl = $("variantes-list");
      vf.hidden = !offer.variantes;
      vl.textContent = "";
      (offer.variantes || []).forEach(function (v, i) {
        var lab = el(doc, "label", { "class": "cg-choice" });
        var inp = el(doc, "input", { type: "radio", name: "variante", value: v.id });
        if (i === 0) inp.checked = true;
        lab.appendChild(inp);
        lab.appendChild(el(doc, "span", {}, v.label + " : adulte " + thb(v.adulte) + ", enfant " + thb(v.enfant)));
        vl.appendChild(lab);
      });
      // date
      var dateInput = $("date");
      dateInput.min = offer.angThong && closure && inClosure(today, closure) ? afterClosure(today, closure) : today;
      dateInput.max = addDays(today, 365);
      var hint = [];
      if (offer.jours) hint.push("Départs en groupe " + offer.joursTexte + ".");
      $("date-hint").textContent = hint.join(" ");
      $("date-hint").hidden = !hint.length;
      // créneaux
      var cf = $("creneaux"), cl = $("creneaux-list");
      var slots = offer.creneaux || [];
      cl.textContent = "";
      cf.hidden = slots.length < 2;
      if (slots.length > 1) slots.forEach(function (c) {
        var lab = el(doc, "label", { "class": "cg-choice" });
        lab.appendChild(el(doc, "input", { type: "radio", name: "creneau", value: c.id }));
        lab.appendChild(el(doc, "span", {}, c.label));
        cl.appendChild(lab);
      });
      var single = $("creneau-unique");
      single.hidden = slots.length !== 1;
      single.textContent = slots.length === 1 ? slots[0].label : "";
      // personnes
      var rules = [];
      if (offer.adulteRegle) rules.push(offer.adulteRegle + ".");
      if (offer.enfant && offer.enfant.regle) rules.push(offer.enfant.regle + ".");
      if (offer.bebe) rules.push(offer.bebe.regle + " : gratuit.");
      if (offer.parc) rules.push("Entrée du parc : enfant " + offer.parc.regle + ", gratuit avant " + offer.parc.enfantMin + " ans.");
      $("age-rule").textContent = rules.join(" ");
      $("age-rule").hidden = !rules.length;
      $("adults").value = "2";
      $("children").value = "0";
      $("ages").textContent = "";
      // prise en charge
      $("pickup-label").textContent = offer.pickupLabel || "Hôtel ou lieu de prise en charge";
      $("transfert-field").hidden = !offer.transfert;
      if (offer.transfert) $("transfert-label").textContent = "Transfert depuis l" + APOS + "hôtel (+" + thb(offer.transfert.prix) + " " + offer.transfert.unite + ", prix indicatif à confirmer par Anaïs)";
      // parc
      var ang = $("ang-note");
      ang.textContent = closureNote();
      ang.hidden = !(offer.angThong && closureNote());
      $("droits-note").hidden = !offer.droits;
      $("parc-line").hidden = !offer.parc;
      updateEstimate();
    }

    function ageSelects() { return form.querySelectorAll('[data-cg-age]'); }
    function syncAges() {
      var n = Math.max(0, Math.min(20, parseInt($("children").value, 10) || 0));
      var box = $("ages");
      var have = ageSelects();
      for (var i = have.length; i < n; i++) {
        var wrap = el(doc, "div", { "class": "cg-field cg-age" });
        var id = "cg-age-" + i;
        wrap.appendChild(el(doc, "label", { "for": id }, "Âge de l" + APOS + "enfant " + (i + 1)));
        var sel = el(doc, "select", { id: id, name: "age-" + i, "data-cg-age": String(i), "aria-describedby": "cg-err-age-" + i });
        sel.appendChild(el(doc, "option", { value: "" }, "Choisir"));
        for (var a = 0; a <= 17; a++) sel.appendChild(el(doc, "option", { value: String(a) }, a < 1 ? "Moins d" + APOS + "1 an" : a + (a > 1 ? " ans" : " an")));
        wrap.appendChild(sel);
        wrap.appendChild(el(doc, "p", { "class": "cg-err", id: "cg-err-age-" + i, hidden: "" }));
        box.appendChild(wrap);
      }
      while (box.children.length > n) box.removeChild(box.lastChild);
    }

    function readRaw() {
      var variante = form.querySelector('input[name="variante"]:checked');
      var creneau = form.querySelector('input[name="creneau"]:checked');
      var ageList = [];
      Array.prototype.forEach.call(ageSelects(), function (s) { ageList.push(s.value); });
      return {
        variante: variante ? variante.value : "",
        date: $("date").value,
        creneau: creneau ? creneau.value : "",
        adults: $("adults").value,
        ages: ageList,
        pickup: $("pickup").value,
        transfert: !!($("transfert").checked && current && current.transfert),
        name: $("name").value,
        whatsapp: $("whatsapp").value,
        message: $("message").value,
        website: $("website").value,
        openedAt: openedAt
      };
    }

    function updateEstimate() {
      if (!current) return;
      var raw = readRaw();
      var est = estimate(current, raw);
      var box = $("estimate"), list = $("estimate-lines"), total = $("estimate-total"), notes = $("estimate-notes");
      list.textContent = ""; notes.textContent = "";
      $("estimate-label").textContent = est.ok && est.partial ? "Estimation partielle" : "Estimation";
      if (est.ok) {
        est.lines.forEach(function (l) { list.appendChild(el(doc, "li", {}, l.label + (l.amount ? " : " + thb(l.amount) : ""))); });
        est.notes.forEach(function (t) { notes.appendChild(el(doc, "p", {}, t)); });
        if (est.partial) notes.appendChild(el(doc, "p", {}, partialMessage(est.partial) + "."));
        total.textContent = thb(est.total);
      } else {
        total.textContent = "";
        if (est.error) notes.appendChild(el(doc, "p", {}, est.error));
        else notes.appendChild(el(doc, "p", {}, "Choisissez vos options pour voir l" + APOS + "estimation."));
      }
      box.classList.toggle("is-empty", !est.ok);
      var park = parkFee(current, raw), pl = $("parc-line");
      pl.hidden = !park;
      if (park) pl.textContent = "Entrée du parc, à payer sur place en espèces, hors estimation : " + thb(park.amount) + (park.detail ? " (" + park.detail + ")" : "") + ".";
    }

    function clearErrors() {
      Array.prototype.forEach.call(dialog.querySelectorAll(".cg-err"), function (p) { p.hidden = true; p.textContent = ""; });
      Array.prototype.forEach.call(dialog.querySelectorAll("[aria-invalid]"), function (n) { n.removeAttribute("aria-invalid"); });
      $("general-error").hidden = true;
    }
    var FIELD = { variante: "variantes", date: "date", creneau: "creneaux", adults: "adults", pax: "adults", pickup: "pickup", name: "name", whatsapp: "whatsapp", message: "message" };
    function showErrors(errors) {
      clearErrors();
      var first = null;
      Object.keys(errors).forEach(function (k) {
        if (k === "general") { var g = $("general-error"); g.textContent = errors[k]; g.hidden = false; return; }
        var p = dialog.querySelector("#cg-err-" + k) || (k === "pax" ? dialog.querySelector("#cg-err-adults") : null);
        if (p) { p.textContent = errors[k]; p.hidden = false; }
        var input = k.indexOf("age-") === 0 ? dialog.querySelector("#cg-" + k) : $(FIELD[k]);
        var target = input && input.matches && input.matches("fieldset") ? input.querySelector("input") : input;
        if (target) { target.setAttribute("aria-invalid", "true"); if (!first) first = target; }
      });
      if (first) first.focus();
    }

    function showDone(res) {
      form.hidden = true; done.hidden = false;
      $("done-ref").textContent = res.ref;
      $("done-recap").textContent = res.recap;
      var link = $("done-wa");
      link.href = res.whatsappUrl;
      resetDone();
      $("done-title").focus();
      dialog.scrollTop = 0;
    }

    function onSubmit(e) {
      e.preventDefault();
      if (!current || submitted) return;
      var raw = readRaw();
      var res = submitRequest(config, current.id, raw, {
        fetch: typeof fetch === "function" ? function (u, o) { return fetch(u, o); } : null,
        beacon: navigator.sendBeacon ? function (u, d) { return navigator.sendBeacon(u, new Blob([d], { type: "text/plain;charset=UTF-8" })); } : null,
        pageUrl: window.location.href
      });
      if (!res.ok) { showErrors(res.errors || {}); return; }
      if (res.silent) { memory.clear(); dirty = false; showDone(res); return; } // robot : même écran, rien d'envoyé, WhatsApp ne s'ouvre pas
      submitted = true;
      var token = tracker.next();
      memory.clear(); // envoi réussi : plus rien n'est gardé
      dirty = false;
      showDone(res);
      // L'envoi n'attend rien : WhatsApp s'ouvre d'abord, la réponse de la copie arrive après.
      if (config.reglages && config.reglages.ouvrirWhatsApp) {
        if (openWhatsApp(res.whatsappUrl, function (u, t) { return window.open(u, t); }) === "blocked") $("done-popup").hidden = false;
      }
      // Réponse illisible ou refusée (un blocage CORS fait échouer fetch alors que Gestion a peut-être reçu la demande) :
      // formule neutre, jamais « renvoyez votre demande ». Elle ne touche que la demande qui l'a créée.
      res.sent.then(function (ok) { if (!ok && tracker.isCurrent(token)) $("done-warning").hidden = false; });
    }

    // Branchements
    // Les boutons « Réserver » n'existent qu'avec JavaScript : sans lui, la page ne propose que le lien WhatsApp du <noscript> (un seul bouton qui marche).
    Array.prototype.forEach.call(doc.querySelectorAll("[data-cg-slot]"), function (slot) {
      var id = slot.getAttribute("data-cg-slot");
      var offer = config.offres[id];
      if (!offer) return;
      var b = el(doc, "button", { type: "button", "class": "btn btn-teal cg-reserver", "data-cg-reserver": id });
      var span = el(doc, "span", {}, "Réserver");
      span.appendChild(el(doc, "span", { "class": "sr-only" }, " : " + offer.produit));
      b.appendChild(span);
      slot.appendChild(b);
      b.addEventListener("click", function () { open(id, b); });
    });
    Array.prototype.forEach.call(dialog.querySelectorAll("[data-cg-close]"), function (b) { b.addEventListener("click", close); });
    // Clic sur le fond (hors du panneau) : fermeture
    dialog.addEventListener("click", function (e) { if (e.target === dialog && shouldCloseOnBackdrop(dirty && !form.hidden)) close(); });
    dialog.addEventListener("close", function () { if (opener && opener.focus) opener.focus(); });
    form.addEventListener("submit", onSubmit);
    // Dès qu'un champ est corrigé, son message d'erreur disparaît.
    function clearFieldError(target) {
      var field = target && target.closest ? target.closest(".cg-field") : null;
      if (field) Array.prototype.forEach.call(field.querySelectorAll(".cg-err"), function (p) { p.hidden = true; p.textContent = ""; });
      if (target && target.removeAttribute) target.removeAttribute("aria-invalid");
    }
    var REMEMBER = { name: "name", whatsapp: "whatsapp", pickup: "pickup" };
    form.addEventListener("input", function (e) {
      dirty = true;
      var key = e.target && e.target.getAttribute && REMEMBER[e.target.getAttribute("data-cg")];
      if (key) memory.set(key, e.target.value);
      clearFieldError(e.target);
      if (e.target === $("children")) syncAges();
      updateEstimate();
    });
    form.addEventListener("change", function (e) { dirty = true; clearFieldError(e.target); updateEstimate(); });
    Array.prototype.forEach.call(form.querySelectorAll("[data-cg-step]"), function (b) {
      b.addEventListener("click", function () {
        var input = $(b.getAttribute("data-cg-for"));
        var min = parseInt(input.min, 10) || 0, max = parseInt(input.max, 10) || 60;
        var v = (parseInt(input.value, 10) || 0) + parseInt(b.getAttribute("data-cg-step"), 10);
        input.value = String(Math.max(min, Math.min(max, v)));
        dirty = true;
        clearFieldError(input);
        if (input === $("children")) syncAges();
        updateEstimate();
      });
    });
  }

  return {
    DEMANDE_URL: DEMANDE_URL, BRAND: BRAND,
    estimate: estimate, validate: validate, tierFor: tierFor, phoneE164: phoneE164, phoneError: phoneError, fullNameError: fullNameError,
    makeRef: makeRef, buildRecap: buildRecap, buildBody: buildBody, waUrl: waUrl, waMessage: waMessage,
    sendCopy: sendCopy, parkFee: parkFee, openWhatsApp: openWhatsApp, makeTracker: makeTracker, makeMemory: makeMemory, shouldCloseOnBackdrop: shouldCloseOnBackdrop, inClosure: inClosure, afterClosure: afterClosure, closureText: closureText, partialMessage: partialMessage, submitRequest: submitRequest, bangkokToday: bangkokToday, formatDate: formatDate, thb: thb, fmt: fmt, init: init
  };
});

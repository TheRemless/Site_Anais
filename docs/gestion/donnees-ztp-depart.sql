-- Gestion : données de départ de l'organisation Zwald Travel Planner (ZTP, Secret Travel & Tour, VIP Taxi Lanta).
-- Ne sert qu'à la base d'Anaïs : coordonnées, réglages, rôles des trois entreprises et catalogue de ZTP, sortis de schema.sql le 18.11.2026.
-- Sur une installation neuve : schema.sql, puis ce fichier, puis les migration-*.sql dans l'ordre. Un client du logiciel ne le reçoit jamais :
-- ses entreprises partent d'un modèle métier (src/gestion/js/modeles-metier.mjs, migration 45).
-- Contient les coordonnées de l'entreprise : ce fichier ne doit pas être publié.

-- Entreprises, rôles et réglages de départ, modifiables ensuite depuis le panneau d'administration.
insert into entites (id, slug, nom, ordre) values
  ('00000000-0000-4000-8000-000000000001', 'ztp', 'Zwald Travel Planner', 1),
  ('00000000-0000-4000-8000-000000000002', 'secret', 'Secret Travel & Tour', 2),
  ('00000000-0000-4000-8000-000000000003', 'taxi', 'VIP Taxi Lanta', 3);

insert into roles (entite_id, nom, description, portee, permissions, systeme)
select e.id, v.nom, v.description, v.portee, v.permissions, true
from entites e
cross join (values
  ('Administrateur', 'Tous les droits dans l''entreprise.', 'toute', array['clients.lire', 'clients.ecrire', 'clients.supprimer', 'dossiers.lire', 'dossiers.ecrire', 'dossiers.supprimer', 'documents.ecrire', 'documents.supprimer', 'finances.voir', 'paiements.ecrire', 'taches.ecrire', 'catalogue.ecrire', 'reglages.ecrire', 'exports.faire', 'analytics.voir', 'journal.voir', 'partenaires.lire', 'partenaires.ecrire', 'partenaires.nets']::text[]),
  ('Éditeur', 'Clients, dossiers, devis, factures et paiements. Ni réglages ni suppression.', 'toute', array['clients.lire', 'clients.ecrire', 'dossiers.lire', 'dossiers.ecrire', 'documents.ecrire', 'finances.voir', 'paiements.ecrire', 'taches.ecrire', 'catalogue.ecrire', 'partenaires.lire', 'partenaires.ecrire']::text[]),
  ('Lecteur', 'Consultation seulement, montants visibles.', 'toute', array['clients.lire', 'dossiers.lire', 'finances.voir', 'analytics.voir', 'partenaires.lire']::text[])
) as v (nom, description, portee, permissions);

insert into reglages (entite_id, valeur) values
  ('00000000-0000-4000-8000-000000000001', $json${
  "emetteur": {
    "nom": "Zwald Travel Planner Co., Ltd.",
    "sous_titre": "",
    "adresse": "292 Moo 2\n81150, Koh Lanta, Krabi",
    "telephone": "+ 66 95 868 38 46",
    "contact": "Anaïs Zwald\n+66 95 868 38 46 (WhatsApp)\nzwaldtravelplanner@gmail.com"
  },
  "paiement": {
    "texte": "Banque: à compléter\nIBAN: à compléter\nSwift: à compléter\nTitulaire du compte\nVille",
    "nom": "",
    "autres": []
  },
  "devise": "CHF",
  "conditions": {
    "acompte_pct": 50,
    "delai_jours": 10,
    "relance_jours": 7,
    "tva_mention": "TVA non applicable",
    "tva_mention_en": "",
    "cgv_url": "https://zwaldtravelplanner.com/cgv/"
  },
  "taux": {
    "eur": 1.058,
    "thb": 40.54
  },
  "numerotation": {
    "mode": "initiales",
    "prefixe": "",
    "chiffres": 4
  },
  "dossier": {
    "modele_bandeau": "VOYAGE EN {PAYS} - {PERIODE}",
    "libelle_pays": "Pays"
  },
  "listes": {
    "pays": [
      "Thaïlande",
      "Indonésie",
      "Vietnam"
    ],
    "civilites": [
      "Madame",
      "Monsieur",
      "Mademoiselle"
    ],
    "moyens": [
      {
        "id": "virement",
        "label": "Virement bancaire"
      },
      {
        "id": "wise",
        "label": "Wise"
      },
      {
        "id": "paypal",
        "label": "PayPal"
      },
      {
        "id": "twint",
        "label": "TWINT"
      },
      {
        "id": "especes",
        "label": "Espèces"
      },
      {
        "id": "autre",
        "label": "Autre"
      }
    ],
    "devises": [
      "CHF",
      "EUR",
      "THB",
      "USD"
    ]
  },
  "apparence": {
    "couleur": "#0b9999",
    "couleur_clair": "#53b7b7",
    "entete": "classique",
    "logo": "assets/logo.png",
    "titre_image": "assets/title.png",
    "type_images": {
      "devis": "assets/devis.png",
      "facture": "assets/facture.png"
    },
    "titre_texte": "",
    "qr_image": "assets/qr-wise.png",
    "qr_pseudo": "@anaisz21"
  },
  "libelles": {
    "devis": "DEVIS",
    "facture": "FACTURE",
    "facture_locale": "",
    "ref_devis": "Devis: réf.",
    "ref_facture": "Facture: réf.",
    "date_emission": "Date d'émission:",
    "unite": "UNITÉ",
    "qte": "QTÉ",
    "total": "TOTAL",
    "colonne_montant": "",
    "total_final": "",
    "sous_total": "SOUS-TOTAL",
    "remise": "Remise",
    "montant_recu": "Montant reçu",
    "equivalent": "Équivalent indicatif :",
    "conditions": "CONDITIONS DE PAIEMENT",
    "signature_1": "NOM, PRENOM, DATE ET SIGNATURE DU CLIENT",
    "signature_2": "précédé de la mention “Bon pour accord”",
    "coordonnees": "COORDONNÉES",
    "infos_paiement": "INFORMATIONS DE PAIEMENT",
    "pied_court": "voir les instructions de paiement transmises par e-mail.",
    "qr_titre": "WISE - virements internationaux",
    "facture_a": "",
    "prestataire": "Prestataire :",
    "note_devise": "",
    "pied_note": "",
    "cgv": "Le client reconnaît avoir pris connaissance des [Conditions Générales de Vente]({cgv_url}) de {entreprise} et les accepter sans réserve. La signature du présent devis vaut acceptation des CGV et engagement contractuel."
  },
  "libelles_en": {
    "devis": "QUOTE",
    "facture": "INVOICE",
    "facture_locale": "",
    "ref_devis": "Quote: ref.",
    "ref_facture": "Invoice: ref.",
    "date_emission": "Date of issue:",
    "unite": "UNIT",
    "qte": "QTY",
    "total": "TOTAL",
    "colonne_montant": "",
    "total_final": "",
    "sous_total": "SUBTOTAL",
    "remise": "Discount",
    "montant_recu": "Amount received",
    "equivalent": "Indicative equivalent:",
    "conditions": "PAYMENT TERMS",
    "signature_1": "FULL NAME, DATE AND SIGNATURE OF THE CLIENT",
    "signature_2": "preceded by the words “Approved”",
    "coordonnees": "CONTACT",
    "infos_paiement": "PAYMENT DETAILS",
    "pied_court": "see the payment instructions sent by e-mail.",
    "qr_titre": "",
    "facture_a": "",
    "prestataire": "Service provider:",
    "note_devise": "",
    "pied_note": "",
    "cgv": "The client acknowledges having read the [Terms and Conditions]({cgv_url}) of {entreprise} and accepts them without reservation. Signing this quote constitutes acceptance of the Terms and Conditions and a binding commitment."
  },
  "textes": {
    "variantes": [
      {
        "id": "qr",
        "nom": "Avec QR Wise dans le pied de page",
        "corps": "Un acompte de {acompte}% de la facture (non-remboursable) est demandé à la signature du devis, payable à {delai} jours, le reste du montant est à verser à la réception du carnet de voyage.\nModes de paiement :\n- Virement bancaire en CHF.\n- Paiement en EUR (1 CHF = 1,10€) possible sur demande (via PayPal ou virement bancaire)\n- **Paiement facile avec un compte Wise** : scannez le QR code et réglez dans votre devise habituelle (CHF ou Euro). Je pourrai alors le changer en THB pour moi, sans frais supplémentaires pour vous.",
        "cloture": "Merci pour votre confiance !\nJe reste à votre disposition pour toute question ou demande supplémentaire.\nCordialement,"
      },
      {
        "id": "email",
        "nom": "Coordonnées de paiement envoyées par e-mail",
        "corps": "Un acompte de {acompte} % du montant total est demandé à la signature du devis. Cet acompte est **non remboursable** et doit être réglé dans un délai de {delai} jours suivant l'acceptation du devis.\nLe solde de {solde} % est à régler à la réception du carnet de voyage final.\n\nLe montant total de la prestation s'élève à **{total}**{indicatif}.\nAfin d'éviter les frais liés aux virements internationaux, le paiement peut être effectué facilement via **Wise**, en CHF ou en EUR, selon votre préférence.\n_Les coordonnées de paiement Wise sont indiquées dans l'e-mail accompagnant le devis._",
        "cloture": "Merci pour votre confiance !\nNous restons à votre disposition pour toute question ou demande supplémentaire.\nCordialement,"
      }
    ]
  }
}$json$::jsonb),
  ('00000000-0000-4000-8000-000000000002', $json${
  "emetteur": {
    "nom": "Secret Travel & Tour",
    "sous_titre": "",
    "adresse": "292, Moo 2, Sala Dan\nKoh Lanta Yai, Krabi 81150",
    "telephone": "+66 95 868 3846",
    "contact": ""
  },
  "paiement": {
    "texte": "",
    "nom": "",
    "autres": []
  },
  "devise": "",
  "conditions": {
    "acompte_pct": 0,
    "delai_jours": 10,
    "relance_jours": 7,
    "tva_mention": "",
    "tva_mention_en": "",
    "cgv_url": ""
  },
  "taux": {
    "eur": 1.058,
    "thb": 40.54
  },
  "numerotation": {
    "mode": "sequence",
    "prefixe": "",
    "chiffres": 4
  },
  "dossier": {
    "modele_bandeau": "{PAYS} - {PERIODE}",
    "libelle_pays": "Pays"
  },
  "listes": {
    "pays": [],
    "civilites": [
      "Madame",
      "Monsieur",
      "Mademoiselle"
    ],
    "moyens": [
      {
        "id": "virement",
        "label": "Virement bancaire"
      },
      {
        "id": "wise",
        "label": "Wise"
      },
      {
        "id": "paypal",
        "label": "PayPal"
      },
      {
        "id": "twint",
        "label": "TWINT"
      },
      {
        "id": "especes",
        "label": "Espèces"
      },
      {
        "id": "autre",
        "label": "Autre"
      }
    ],
    "devises": [
      "CHF",
      "EUR",
      "THB",
      "USD"
    ]
  },
  "apparence": {
    "couleur": "#0b9999",
    "couleur_clair": "#53b7b7",
    "entete": "classique",
    "logo": "",
    "titre_image": "",
    "type_images": null,
    "titre_texte": "",
    "qr_image": "",
    "qr_pseudo": ""
  },
  "libelles": {
    "devis": "DEVIS",
    "facture": "FACTURE",
    "facture_locale": "",
    "ref_devis": "Devis: réf.",
    "ref_facture": "Facture: réf.",
    "date_emission": "Date d'émission:",
    "unite": "UNITÉ",
    "qte": "QTÉ",
    "total": "TOTAL",
    "colonne_montant": "",
    "total_final": "",
    "sous_total": "SOUS-TOTAL",
    "remise": "Remise",
    "montant_recu": "Montant reçu",
    "equivalent": "Équivalent indicatif :",
    "conditions": "CONDITIONS DE PAIEMENT",
    "signature_1": "NOM, PRENOM, DATE ET SIGNATURE DU CLIENT",
    "signature_2": "précédé de la mention “Bon pour accord”",
    "coordonnees": "COORDONNÉES",
    "infos_paiement": "INFORMATIONS DE PAIEMENT",
    "pied_court": "voir les instructions de paiement transmises par e-mail.",
    "qr_titre": "",
    "facture_a": "",
    "prestataire": "Prestataire :",
    "note_devise": "",
    "pied_note": "",
    "cgv": "Le client reconnaît avoir pris connaissance des [Conditions Générales de Vente]({cgv_url}) de {entreprise} et les accepter sans réserve. La signature du présent devis vaut acceptation des CGV et engagement contractuel."
  },
  "libelles_en": {
    "devis": "QUOTE",
    "facture": "INVOICE",
    "facture_locale": "",
    "ref_devis": "Quote: ref.",
    "ref_facture": "Invoice: ref.",
    "date_emission": "Date of issue:",
    "unite": "UNIT",
    "qte": "QTY",
    "total": "TOTAL",
    "colonne_montant": "",
    "total_final": "",
    "sous_total": "SUBTOTAL",
    "remise": "Discount",
    "montant_recu": "Amount received",
    "equivalent": "Indicative equivalent:",
    "conditions": "PAYMENT TERMS",
    "signature_1": "FULL NAME, DATE AND SIGNATURE OF THE CLIENT",
    "signature_2": "preceded by the words “Approved”",
    "coordonnees": "CONTACT",
    "infos_paiement": "PAYMENT DETAILS",
    "pied_court": "see the payment instructions sent by e-mail.",
    "qr_titre": "",
    "facture_a": "",
    "prestataire": "Service provider:",
    "note_devise": "",
    "pied_note": "",
    "cgv": "The client acknowledges having read the [Terms and Conditions]({cgv_url}) of {entreprise} and accepts them without reservation. Signing this quote constitutes acceptance of the Terms and Conditions and a binding commitment."
  },
  "textes": {
    "variantes": [
      {
        "id": "standard",
        "nom": "Standard",
        "corps": "",
        "cloture": ""
      }
    ]
  }
}$json$::jsonb),
  ('00000000-0000-4000-8000-000000000003', $json${
  "emetteur": {
    "nom": "VIP Taxi Lanta",
    "sous_titre": "",
    "adresse": "",
    "telephone": "",
    "contact": ""
  },
  "paiement": {
    "texte": "",
    "nom": "",
    "autres": []
  },
  "devise": "",
  "conditions": {
    "acompte_pct": 0,
    "delai_jours": 10,
    "relance_jours": 7,
    "tva_mention": "",
    "tva_mention_en": "",
    "cgv_url": ""
  },
  "taux": {
    "eur": 1.058,
    "thb": 40.54
  },
  "numerotation": {
    "mode": "sequence",
    "prefixe": "",
    "chiffres": 4
  },
  "dossier": {
    "modele_bandeau": "{PAYS} - {PERIODE}",
    "libelle_pays": "Pays"
  },
  "listes": {
    "pays": [],
    "civilites": [
      "Madame",
      "Monsieur",
      "Mademoiselle"
    ],
    "moyens": [
      {
        "id": "virement",
        "label": "Virement bancaire"
      },
      {
        "id": "wise",
        "label": "Wise"
      },
      {
        "id": "paypal",
        "label": "PayPal"
      },
      {
        "id": "twint",
        "label": "TWINT"
      },
      {
        "id": "especes",
        "label": "Espèces"
      },
      {
        "id": "autre",
        "label": "Autre"
      }
    ],
    "devises": [
      "CHF",
      "EUR",
      "THB",
      "USD"
    ]
  },
  "apparence": {
    "couleur": "#0b9999",
    "couleur_clair": "#53b7b7",
    "entete": "classique",
    "logo": "",
    "titre_image": "",
    "type_images": null,
    "titre_texte": "",
    "qr_image": "",
    "qr_pseudo": ""
  },
  "libelles": {
    "devis": "DEVIS",
    "facture": "FACTURE",
    "facture_locale": "",
    "ref_devis": "Devis: réf.",
    "ref_facture": "Facture: réf.",
    "date_emission": "Date d'émission:",
    "unite": "UNITÉ",
    "qte": "QTÉ",
    "total": "TOTAL",
    "colonne_montant": "",
    "total_final": "",
    "sous_total": "SOUS-TOTAL",
    "remise": "Remise",
    "montant_recu": "Montant reçu",
    "equivalent": "Équivalent indicatif :",
    "conditions": "CONDITIONS DE PAIEMENT",
    "signature_1": "NOM, PRENOM, DATE ET SIGNATURE DU CLIENT",
    "signature_2": "précédé de la mention “Bon pour accord”",
    "coordonnees": "COORDONNÉES",
    "infos_paiement": "INFORMATIONS DE PAIEMENT",
    "pied_court": "voir les instructions de paiement transmises par e-mail.",
    "qr_titre": "",
    "facture_a": "",
    "prestataire": "Prestataire :",
    "note_devise": "",
    "pied_note": "",
    "cgv": "Le client reconnaît avoir pris connaissance des [Conditions Générales de Vente]({cgv_url}) de {entreprise} et les accepter sans réserve. La signature du présent devis vaut acceptation des CGV et engagement contractuel."
  },
  "libelles_en": {
    "devis": "QUOTE",
    "facture": "INVOICE",
    "facture_locale": "",
    "ref_devis": "Quote: ref.",
    "ref_facture": "Invoice: ref.",
    "date_emission": "Date of issue:",
    "unite": "UNIT",
    "qte": "QTY",
    "total": "TOTAL",
    "colonne_montant": "",
    "total_final": "",
    "sous_total": "SUBTOTAL",
    "remise": "Discount",
    "montant_recu": "Amount received",
    "equivalent": "Indicative equivalent:",
    "conditions": "PAYMENT TERMS",
    "signature_1": "FULL NAME, DATE AND SIGNATURE OF THE CLIENT",
    "signature_2": "preceded by the words “Approved”",
    "coordonnees": "CONTACT",
    "infos_paiement": "PAYMENT DETAILS",
    "pied_court": "see the payment instructions sent by e-mail.",
    "qr_titre": "",
    "facture_a": "",
    "prestataire": "Service provider:",
    "note_devise": "",
    "pied_note": "",
    "cgv": "The client acknowledges having read the [Terms and Conditions]({cgv_url}) of {entreprise} and accepts them without reservation. Signing this quote constitutes acceptance of the Terms and Conditions and a binding commitment."
  },
  "textes": {
    "variantes": [
      {
        "id": "standard",
        "nom": "Standard",
        "corps": "",
        "cloture": ""
      }
    ]
  }
}$json$::jsonb);

-- Catalogue de départ de Zwald Travel Planner, déduit de ses anciens devis. Les prix sont à vérifier dans l'écran Catalogue.
insert into catalogue (entite_id, kind, libelle, intro, puces, prix, ordre) values
  ('00000000-0000-4000-8000-000000000001', 'formule', 'Formule “par région”', 'comprenant:', '["création de l''itinéraire personnalisé","2-3 options de transports entre les régions","sélection d''hébergements par région","sélection d''activités par région","carnet de voyage personnalisé","accompagnement continu avant et pendant le voyage"]'::jsonb, null, 1),
  ('00000000-0000-4000-8000-000000000001', 'formule', 'Formule “par région” EXPRESS', 'comprenant:', '["appel découverte / réservation des vols & itinéraire aux meilleurs prix","2-3 options de transports entre les régions","sélection d''hébergements par région","sélection d''activités par région","carnet de voyage personnalisé","accompagnement continu avant et pendant le voyage"]'::jsonb, null, 2),
  ('00000000-0000-4000-8000-000000000001', 'formule', 'Formule complète DUO', 'comprenant:', '["conception de l''itinéraire sur mesure","sélection de transports par ville","sélection d''hébergements par ville","sélection d''activités jour par jour","carnet de voyage personnalisé","accompagnement avant et pendant le voyage"]'::jsonb, 40, 3),
  ('00000000-0000-4000-8000-000000000001', 'formule', 'Formule complète FAMILLE', 'comprenant:', '["itinéraire personnalisé","sélection de transports par ville","sélection d''hébergements par ville","sélection d''activités jour par jour","carnet de voyage personnalisé","support continu avant et pendant le voyage"]'::jsonb, 43, 4),
  ('00000000-0000-4000-8000-000000000001', 'formule', 'Forfait “jour par jour”', 'comprenant:', '["2-3 options de transports par ville","sélection d''hébergements par ville","sélection d''activités jour par jour","carnet de voyage personnalisé","support continu avant et pendant le voyage"]'::jsonb, 40, 5),
  ('00000000-0000-4000-8000-000000000001', 'formule', 'Forfait “itinéraire & transports”', 'comprenant:', '["optimisation de l''itinéraire","sélection des transferts et transports optimisés entre les régions / hôtels / aéroports","liens des réservations et planning des transports","carnet de voyage personnalisé","support continu avant et pendant le voyage"]'::jsonb, 199, 6),
  ('00000000-0000-4000-8000-000000000001', 'region', 'Bangkok', '', '[]'::jsonb, 120, 7),
  ('00000000-0000-4000-8000-000000000001', 'region', 'Ayutthaya', '', '[]'::jsonb, 50, 8),
  ('00000000-0000-4000-8000-000000000001', 'region', 'Chiang Mai', '', '[]'::jsonb, 120, 9),
  ('00000000-0000-4000-8000-000000000001', 'region', 'Chiang Rai', '', '[]'::jsonb, 90, 10),
  ('00000000-0000-4000-8000-000000000001', 'region', 'Khao Sok', '', '[]'::jsonb, 90, 11),
  ('00000000-0000-4000-8000-000000000001', 'region', 'Krabi', '', '[]'::jsonb, 90, 12),
  ('00000000-0000-4000-8000-000000000001', 'region', 'Phuket', '', '[]'::jsonb, 150, 13),
  ('00000000-0000-4000-8000-000000000001', 'region', 'Koh Lanta', '', '[]'::jsonb, 150, 14),
  ('00000000-0000-4000-8000-000000000001', 'region', 'Koh Samui', '', '[]'::jsonb, 150, 15),
  ('00000000-0000-4000-8000-000000000001', 'region', 'Koh Tao', '', '[]'::jsonb, 150, 16),
  ('00000000-0000-4000-8000-000000000001', 'region', 'Hua Hin', '', '[]'::jsonb, 150, 17),
  ('00000000-0000-4000-8000-000000000001', 'region', 'Kuala Lumpur', '', '[]'::jsonb, 50, 18),
  ('00000000-0000-4000-8000-000000000001', 'region', 'Koh Lipe', '', '[]'::jsonb, 120, 19),
  ('00000000-0000-4000-8000-000000000001', 'region', 'Bali (Ubud + Amed)', '', '[]'::jsonb, 150, 20),
  ('00000000-0000-4000-8000-000000000001', 'region', 'Lombok (Tetebatu)', '', '[]'::jsonb, 120, 21),
  ('00000000-0000-4000-8000-000000000001', 'region', 'Gili Air', '', '[]'::jsonb, 120, 22),
  ('00000000-0000-4000-8000-000000000001', 'supplement', 'Réservation train + transports minivan', '', '[]'::jsonb, null, 23),
  ('00000000-0000-4000-8000-000000000001', 'supplement', 'Supplément nombre de villes', '', '[]'::jsonb, 80, 24),
  ('00000000-0000-4000-8000-000000000001', 'supplement', 'Supplément 2e logement/zone d''activité', '', '[]'::jsonb, 30, 25);

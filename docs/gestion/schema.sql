-- Gestion Zwald : schéma de la base Supabase.
-- À coller une seule fois dans Supabase, menu « SQL Editor », puis « Run ».
-- Contient les coordonnées de l'entreprise : ce fichier ne doit pas être publié.

create extension if not exists pgcrypto;

create table clients (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  civilite text,
  prenom text,
  nom text not null,
  adresse text,
  telephone text,
  email text,
  notes text
);

create table dossiers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  ref text not null unique,
  client_id uuid not null references clients (id) on delete restrict,
  pays text,
  bandeau text,
  date_depart date,
  date_retour date,
  accepte_le date,
  annule boolean not null default false,
  notes text
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  dossier_id uuid not null references dossiers (id) on delete cascade,
  type text not null check (type in ('devis', 'facture')),
  date_emission date not null,
  envoye_le date,
  contenu jsonb not null
);

create table paiements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  dossier_id uuid not null references dossiers (id) on delete cascade,
  date date not null,
  montant numeric(12, 2) not null check (montant > 0),
  type text,
  moyen text,
  origine_montant numeric(12, 2),
  origine_devise text,
  note text
);

create table catalogue (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('formule', 'region', 'supplement')),
  libelle text not null,
  intro text not null default '',
  puces jsonb not null default '[]',
  prix numeric(12, 2),
  ordre integer not null default 0,
  actif boolean not null default true
);

create table reglages (
  cle text primary key,
  valeur jsonb not null
);

create index on dossiers (client_id);
create index on documents (dossier_id);
create index on paiements (dossier_id);

-- Sécurité : seules les personnes connectées lisent et écrivent. Le visiteur anonyme n'a accès à rien.
revoke all on all tables in schema public from anon;
alter table clients enable row level security;
create policy "personnes connectées" on clients for all to authenticated using (true) with check (true);
alter table dossiers enable row level security;
create policy "personnes connectées" on dossiers for all to authenticated using (true) with check (true);
alter table documents enable row level security;
create policy "personnes connectées" on documents for all to authenticated using (true) with check (true);
alter table paiements enable row level security;
create policy "personnes connectées" on paiements for all to authenticated using (true) with check (true);
alter table catalogue enable row level security;
create policy "personnes connectées" on catalogue for all to authenticated using (true) with check (true);
alter table reglages enable row level security;
create policy "personnes connectées" on reglages for all to authenticated using (true) with check (true);

-- Réglages de départ, modifiables ensuite depuis l'écran Réglages.
insert into reglages (cle, valeur) values ('principal', $json${
  "emetteur": {
    "nom": "Zwald Travel Planner Co., Ltd.",
    "adresse": "290 Moo 2\n81150, Koh Lanta, Krabi",
    "telephone": "+ 66 95 868 38 46",
    "contact_nom": "Anaïs Zwald",
    "whatsapp": "+66 95 868 38 46 (WhatsApp)",
    "email": "zwaldtravelplanner@gmail.com"
  },
  "paiement": {
    "banque": "PostFinance (Suisse)",
    "iban": "CH89 0900 0000 1249 3929 7",
    "swift": "POFICHBEXXX",
    "titulaire": "Anaïs Zwald",
    "ville_titulaire": "1233 Bernex",
    "wise_pseudo": "@anaisz21"
  },
  "conditions": {
    "acompte_pct": 50,
    "delai_jours": 10,
    "relance_jours": 7,
    "tva_mention": "TVA non applicable",
    "cgv_url": "https://zwaldtravelplanner.com/cgv/"
  },
  "taux": {
    "eur": 1.058,
    "thb": 40.54
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
}$json$::jsonb);

-- Catalogue de départ, déduit de ses anciens devis. Les prix sont à vérifier dans l'écran Catalogue.
insert into catalogue (kind, libelle, intro, puces, prix, ordre) values
  ('formule', 'Formule “par région”', 'comprenant:', '["création de l''itinéraire personnalisé", "2-3 options de transports entre les régions", "sélection d''hébergements par région", "sélection d''activités par région", "carnet de voyage personnalisé", "accompagnement continu avant et pendant le voyage"]'::jsonb, null, 1),
  ('formule', 'Formule “par région” EXPRESS', 'comprenant:', '["appel découverte / réservation des vols & itinéraire aux meilleurs prix", "2-3 options de transports entre les régions", "sélection d''hébergements par région", "sélection d''activités par région", "carnet de voyage personnalisé", "accompagnement continu avant et pendant le voyage"]'::jsonb, null, 2),
  ('formule', 'Formule complète DUO', 'comprenant:', '["conception de l''itinéraire sur mesure", "sélection de transports par ville", "sélection d''hébergements par ville", "sélection d''activités jour par jour", "carnet de voyage personnalisé", "accompagnement avant et pendant le voyage"]'::jsonb, 40, 3),
  ('formule', 'Formule complète FAMILLE', 'comprenant:', '["itinéraire personnalisé", "sélection de transports par ville", "sélection d''hébergements par ville", "sélection d''activités jour par jour", "carnet de voyage personnalisé", "support continu avant et pendant le voyage"]'::jsonb, 43, 4),
  ('formule', 'Forfait “jour par jour”', 'comprenant:', '["2-3 options de transports par ville", "sélection d''hébergements par ville", "sélection d''activités jour par jour", "carnet de voyage personnalisé", "support continu avant et pendant le voyage"]'::jsonb, 40, 5),
  ('formule', 'Forfait “itinéraire & transports”', 'comprenant:', '["optimisation de l''itinéraire", "sélection des transferts et transports optimisés entre les régions / hôtels / aéroports", "liens des réservations et planning des transports", "carnet de voyage personnalisé", "support continu avant et pendant le voyage"]'::jsonb, 199, 6),
  ('region', 'Bangkok', '', '[]'::jsonb, 120, 7),
  ('region', 'Ayutthaya', '', '[]'::jsonb, 50, 8),
  ('region', 'Chiang Mai', '', '[]'::jsonb, 120, 9),
  ('region', 'Chiang Rai', '', '[]'::jsonb, 90, 10),
  ('region', 'Khao Sok', '', '[]'::jsonb, 90, 11),
  ('region', 'Krabi', '', '[]'::jsonb, 90, 12),
  ('region', 'Phuket', '', '[]'::jsonb, 150, 13),
  ('region', 'Koh Lanta', '', '[]'::jsonb, 150, 14),
  ('region', 'Koh Samui', '', '[]'::jsonb, 150, 15),
  ('region', 'Koh Tao', '', '[]'::jsonb, 150, 16),
  ('region', 'Hua Hin', '', '[]'::jsonb, 150, 17),
  ('region', 'Kuala Lumpur', '', '[]'::jsonb, 50, 18),
  ('region', 'Koh Lipe', '', '[]'::jsonb, 120, 19),
  ('region', 'Bali (Ubud + Amed)', '', '[]'::jsonb, 150, 20),
  ('region', 'Lombok (Tetebatu)', '', '[]'::jsonb, 120, 21),
  ('region', 'Gili Air', '', '[]'::jsonb, 120, 22),
  ('supplement', 'Réservation train + transports minivan', '', '[]'::jsonb, null, 23),
  ('supplement', 'Supplément nombre de villes', '', '[]'::jsonb, 80, 24),
  ('supplement', 'Supplément 2e logement/zone d''activité', '', '[]'::jsonb, 30, 25);

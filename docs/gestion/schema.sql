-- Gestion : schéma complet de la base Supabase (plusieurs entreprises, rôles personnalisables, journal d'activité).
-- À coller une seule fois dans Supabase, menu « SQL Editor », puis « Run ». Pour mettre à jour une base existante, utiliser les fichiers migration-*.sql dans l'ordre.
-- Contient les coordonnées de l'entreprise : ce fichier ne doit pas être publié.

create extension if not exists pgcrypto;

create table entites (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  slug text not null unique,
  nom text not null,
  actif boolean not null default true,
  ordre integer not null default 0
);

create table profils (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  email text,
  nom text,
  super_admin boolean not null default false,
  actif boolean not null default true
);

create table roles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  entite_id uuid not null references entites (id) on delete cascade,
  nom text not null,
  description text not null default '',
  portee text not null default 'toute' check (portee in ('toute', 'mes_dossiers')),
  permissions text[] not null default '{}',
  systeme boolean not null default false,
  unique (entite_id, nom)
);

create table membres (
  user_id uuid not null references profils (user_id) on delete cascade,
  entite_id uuid not null references entites (id) on delete cascade,
  role_id uuid not null references roles (id) on delete restrict,
  primary key (user_id, entite_id)
);

create table reglages (
  entite_id uuid primary key references entites (id) on delete cascade,
  valeur jsonb not null
);

create table journal (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  entite_id uuid references entites (id) on delete cascade,
  user_id uuid,
  table_name text not null,
  action text not null,
  cible text,
  libelle text,
  details jsonb not null default '{}'
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  entite_id uuid not null references entites (id) on delete restrict,
  civilite text,
  prenom text,
  nom text not null,
  adresse text,
  telephone text,
  email text,
  notes text,
  cree_par uuid default auth.uid(),
  modifie_par uuid,
  unique (id, entite_id)
);

create table dossiers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  entite_id uuid not null references entites (id) on delete restrict,
  ref text not null,
  client_id uuid not null,
  pays text,
  bandeau text,
  date_depart date,
  date_retour date,
  accepte_le date,
  annule boolean not null default false,
  notes text,
  responsable_id uuid references profils (user_id) on delete set null default auth.uid(),
  cree_par uuid default auth.uid(),
  modifie_par uuid,
  unique (entite_id, ref),
  unique (id, entite_id),
  foreign key (client_id, entite_id) references clients (id, entite_id) on delete restrict
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  entite_id uuid not null references entites (id) on delete restrict,
  dossier_id uuid not null,
  type text not null check (type in ('devis', 'facture')),
  date_emission date not null,
  envoye_le date,
  contenu jsonb not null,
  cree_par uuid default auth.uid(),
  modifie_par uuid,
  foreign key (dossier_id, entite_id) references dossiers (id, entite_id) on delete cascade
);

create table paiements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  entite_id uuid not null references entites (id) on delete restrict,
  dossier_id uuid not null,
  date date not null,
  montant numeric(12, 2) not null check (montant > 0),
  type text,
  moyen text,
  origine_montant numeric(12, 2),
  origine_devise text,
  note text,
  cree_par uuid default auth.uid(),
  modifie_par uuid,
  foreign key (dossier_id, entite_id) references dossiers (id, entite_id) on delete cascade
);

create table catalogue (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  entite_id uuid not null references entites (id) on delete restrict,
  kind text not null check (kind in ('formule', 'region', 'supplement')),
  libelle text not null,
  intro text not null default '',
  puces jsonb not null default '[]',
  prix numeric(12, 2),
  ordre integer not null default 0,
  actif boolean not null default true
);

create index on clients (entite_id);
create index on dossiers (entite_id);
create index on dossiers (responsable_id);
create index on documents (entite_id);
create index on documents (dossier_id);
create index on paiements (entite_id);
create index on paiements (dossier_id);
create index on catalogue (entite_id);
create index on roles (entite_id);
create index on membres (entite_id);
create index on journal (entite_id, created_at desc);

-- Qui peut faire quoi, calculé à partir de la connexion en cours (auth.uid()) et de son rôle dans l'entreprise.
create or replace function toutes_permissions() returns text[] language sql immutable as $$
  select array['clients.lire', 'clients.ecrire', 'clients.supprimer', 'dossiers.lire', 'dossiers.ecrire', 'dossiers.supprimer', 'documents.ecrire', 'documents.supprimer', 'finances.voir', 'paiements.ecrire', 'catalogue.ecrire', 'reglages.ecrire', 'exports.faire', 'analytics.voir', 'journal.voir']::text[]
$$;

create or replace function est_super_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select super_admin and actif from profils where user_id = auth.uid()), false)
$$;

create or replace function permissions_dans(e uuid) returns text[] language sql stable security definer set search_path = public as $$
  select case
    when est_super_admin() then toutes_permissions()
    else coalesce((select r.permissions from membres m join roles r on r.id = m.role_id join profils p on p.user_id = m.user_id where m.user_id = auth.uid() and m.entite_id = e and p.actif), '{}')
  end
$$;

create or replace function a_permission(e uuid, code text) returns boolean language sql stable security definer set search_path = public as $$
  select code = any (permissions_dans(e))
$$;

create or replace function est_membre(e uuid) returns boolean language sql stable security definer set search_path = public as $$
  select est_super_admin() or exists (select 1 from membres m join profils p on p.user_id = m.user_id where m.user_id = auth.uid() and m.entite_id = e and p.actif)
$$;

-- Un rôle peut se limiter aux dossiers dont la personne est responsable ou qu'elle a créés.
create or replace function voit_tout(e uuid) returns boolean language sql stable security definer set search_path = public as $$
  select est_super_admin() or coalesce((select r.portee = 'toute' from membres m join roles r on r.id = m.role_id join profils p on p.user_id = m.user_id where m.user_id = auth.uid() and m.entite_id = e and p.actif), false)
$$;

-- Les collègues d'une entreprise, pour choisir un responsable de dossier sans ouvrir la table des profils.
create or replace function equipe_de(e uuid) returns table (user_id uuid, nom text, email text) language sql stable security definer set search_path = public as $$
  select p.user_id, p.nom, p.email from profils p
  where p.actif and est_membre(e) and (p.super_admin or exists (select 1 from membres m where m.user_id = p.user_id and m.entite_id = e))
$$;

create or replace function creer_profil() returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Le tout premier compte créé devient administrateur général.
  insert into profils (user_id, email, super_admin) values (new.id, new.email, not exists (select 1 from profils)) on conflict do nothing;
  return new;
end
$$;

create or replace function noter_modification() returns trigger language plpgsql as $$
begin
  new.modifie_par = auth.uid();
  return new;
end
$$;

-- Journal d'activité : qui a fait quoi. Les valeurs longues (documents, réglages) ne sont pas recopiées.
create or replace function journaliser() returns trigger language plpgsql security definer set search_path = public as $$
declare
  ligne jsonb;
  ancien jsonb;
  champs jsonb := '{}';
  k text;
  libelle text;
  cible text;
begin
  ligne := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  ancien := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  cible := coalesce(ligne->>'id', (ligne->>'entite_id') || coalesce(':' || (ligne->>'user_id'), ''));
  libelle := case tg_table_name
    when 'dossiers' then ligne->>'ref'
    when 'clients' then trim(coalesce(ligne->>'prenom', '') || ' ' || coalesce(ligne->>'nom', ''))
    when 'documents' then (ligne->>'type') || ' ' || coalesce((select ref from dossiers where id = (ligne->>'dossier_id')::uuid), '')
    when 'paiements' then (ligne->>'montant') || ' ' || coalesce((select ref from dossiers where id = (ligne->>'dossier_id')::uuid), '')
    when 'catalogue' then ligne->>'libelle'
    when 'roles' then ligne->>'nom'
    when 'membres' then coalesce((select email from profils where user_id = (ligne->>'user_id')::uuid), '')
    else ''
  end;
  if tg_op = 'UPDATE' and tg_table_name <> 'reglages' then
    for k in select jsonb_object_keys(ligne) loop
      continue when k in ('updated_at', 'modifie_par');
      if ligne->k is distinct from ancien->k then
        champs := champs || jsonb_build_object(k, case when length((ligne->k)::text) <= 120 and length((ancien->k)::text) <= 120 then jsonb_build_object('avant', ancien->k, 'apres', ligne->k) else to_jsonb('modifié'::text) end);
      end if;
    end loop;
    if champs = '{}'::jsonb then return null; end if;
  end if;
  insert into journal (entite_id, user_id, table_name, action, cible, libelle, details)
  values ((ligne->>'entite_id')::uuid, auth.uid(), tg_table_name, lower(tg_op), cible, libelle, champs);
  return null;
end
$$;

create trigger noter_modification before update on clients for each row execute function noter_modification();
create trigger noter_modification before update on dossiers for each row execute function noter_modification();
create trigger noter_modification before update on documents for each row execute function noter_modification();
create trigger noter_modification before update on paiements for each row execute function noter_modification();

create trigger journaliser after insert or update or delete on clients for each row execute function journaliser();
create trigger journaliser after insert or update or delete on dossiers for each row execute function journaliser();
create trigger journaliser after insert or update or delete on documents for each row execute function journaliser();
create trigger journaliser after insert or update or delete on paiements for each row execute function journaliser();
create trigger journaliser after insert or update or delete on catalogue for each row execute function journaliser();
create trigger journaliser after insert or update or delete on reglages for each row execute function journaliser();
create trigger journaliser after insert or update or delete on roles for each row execute function journaliser();
create trigger journaliser after insert or update or delete on membres for each row execute function journaliser();

create trigger sur_nouvel_utilisateur after insert on auth.users for each row execute function creer_profil();

-- Sécurité : le visiteur anonyme n'a accès à rien. Une personne connectée n'accède qu'aux entreprises dont elle est
-- membre, avec les droits de son rôle, et seulement aux dossiers que la portée de son rôle lui montre.
revoke all on all tables in schema public from anon;

alter table entites enable row level security;
alter table profils enable row level security;
alter table roles enable row level security;
alter table membres enable row level security;
alter table reglages enable row level security;
alter table journal enable row level security;
alter table clients enable row level security;
alter table dossiers enable row level security;
alter table documents enable row level security;
alter table paiements enable row level security;
alter table catalogue enable row level security;

create policy "voir ses entreprises" on entites for select to authenticated using (est_membre(id));
create policy "gérer les entreprises" on entites for all to authenticated using (est_super_admin()) with check (est_super_admin());

create policy "voir son profil" on profils for select to authenticated using (user_id = auth.uid() or est_super_admin());
create policy "gérer les profils" on profils for update to authenticated using (est_super_admin()) with check (est_super_admin());

create policy "voir les rôles" on roles for select to authenticated using (est_membre(entite_id));
create policy "gérer les rôles" on roles for all to authenticated using (est_super_admin()) with check (est_super_admin());

create policy "voir ses accès" on membres for select to authenticated using (user_id = auth.uid() or est_super_admin());
create policy "gérer les accès" on membres for all to authenticated using (est_super_admin()) with check (est_super_admin());

create policy "lire les réglages" on reglages for select to authenticated using (est_membre(entite_id));
create policy "modifier les réglages" on reglages for all to authenticated using (a_permission(entite_id, 'reglages.ecrire')) with check (a_permission(entite_id, 'reglages.ecrire'));

create policy "lire le journal" on journal for select to authenticated using (a_permission(entite_id, 'journal.voir'));
revoke insert, update, delete on journal from authenticated;

create policy "lire le catalogue" on catalogue for select to authenticated using (est_membre(entite_id));
create policy "modifier le catalogue" on catalogue for all to authenticated using (a_permission(entite_id, 'catalogue.ecrire')) with check (a_permission(entite_id, 'catalogue.ecrire'));

create policy "lire les dossiers" on dossiers for select to authenticated using (a_permission(entite_id, 'dossiers.lire') and (voit_tout(entite_id) or responsable_id = auth.uid() or cree_par = auth.uid()));
create policy "créer des dossiers" on dossiers for insert to authenticated with check (a_permission(entite_id, 'dossiers.ecrire'));
create policy "modifier des dossiers" on dossiers for update to authenticated using (a_permission(entite_id, 'dossiers.ecrire') and (voit_tout(entite_id) or responsable_id = auth.uid() or cree_par = auth.uid())) with check (a_permission(entite_id, 'dossiers.ecrire'));
create policy "supprimer des dossiers" on dossiers for delete to authenticated using (a_permission(entite_id, 'dossiers.supprimer') and (voit_tout(entite_id) or responsable_id = auth.uid() or cree_par = auth.uid()));

create policy "lire les clients" on clients for select to authenticated using (a_permission(entite_id, 'clients.lire') and (voit_tout(entite_id) or cree_par = auth.uid() or exists (select 1 from dossiers d where d.client_id = clients.id)));
create policy "créer des clients" on clients for insert to authenticated with check (a_permission(entite_id, 'clients.ecrire'));
create policy "modifier des clients" on clients for update to authenticated using (a_permission(entite_id, 'clients.ecrire')) with check (a_permission(entite_id, 'clients.ecrire'));
create policy "supprimer des clients" on clients for delete to authenticated using (a_permission(entite_id, 'clients.supprimer'));

-- Montants : sans le droit « finances », ni devis, ni factures, ni paiements ne sont lisibles.
create policy "lire les documents" on documents for select to authenticated using (a_permission(entite_id, 'finances.voir') and exists (select 1 from dossiers d where d.id = documents.dossier_id));
create policy "créer des documents" on documents for insert to authenticated with check (a_permission(entite_id, 'documents.ecrire') and exists (select 1 from dossiers d where d.id = documents.dossier_id));
create policy "modifier des documents" on documents for update to authenticated using (a_permission(entite_id, 'documents.ecrire') and exists (select 1 from dossiers d where d.id = documents.dossier_id)) with check (a_permission(entite_id, 'documents.ecrire'));
create policy "supprimer des documents" on documents for delete to authenticated using (a_permission(entite_id, 'documents.supprimer') and exists (select 1 from dossiers d where d.id = documents.dossier_id));

create policy "lire les paiements" on paiements for select to authenticated using (a_permission(entite_id, 'finances.voir') and exists (select 1 from dossiers d where d.id = paiements.dossier_id));
create policy "créer des paiements" on paiements for insert to authenticated with check (a_permission(entite_id, 'paiements.ecrire') and exists (select 1 from dossiers d where d.id = paiements.dossier_id));
create policy "modifier des paiements" on paiements for update to authenticated using (a_permission(entite_id, 'paiements.ecrire') and exists (select 1 from dossiers d where d.id = paiements.dossier_id)) with check (a_permission(entite_id, 'paiements.ecrire'));
create policy "supprimer des paiements" on paiements for delete to authenticated using (a_permission(entite_id, 'paiements.ecrire') and exists (select 1 from dossiers d where d.id = paiements.dossier_id));

-- Entreprises, rôles et réglages de départ, modifiables ensuite depuis le panneau d'administration.
insert into entites (id, slug, nom, ordre) values
  ('00000000-0000-4000-8000-000000000001', 'ztp', 'Zwald Travel Planner', 1),
  ('00000000-0000-4000-8000-000000000002', 'secret', 'Secret Travel & Tour', 2),
  ('00000000-0000-4000-8000-000000000003', 'taxi', 'VIP Taxi Lanta', 3);

insert into roles (entite_id, nom, description, portee, permissions, systeme)
select e.id, v.nom, v.description, v.portee, v.permissions, true
from entites e
cross join (values
  ('Administrateur', 'Tous les droits dans l''entreprise.', 'toute', array['clients.lire', 'clients.ecrire', 'clients.supprimer', 'dossiers.lire', 'dossiers.ecrire', 'dossiers.supprimer', 'documents.ecrire', 'documents.supprimer', 'finances.voir', 'paiements.ecrire', 'catalogue.ecrire', 'reglages.ecrire', 'exports.faire', 'analytics.voir', 'journal.voir']::text[]),
  ('Éditeur', 'Clients, dossiers, devis, factures et paiements. Ni réglages ni suppression.', 'toute', array['clients.lire', 'clients.ecrire', 'dossiers.lire', 'dossiers.ecrire', 'documents.ecrire', 'finances.voir', 'paiements.ecrire', 'catalogue.ecrire']::text[]),
  ('Lecteur', 'Consultation seulement, montants visibles.', 'toute', array['clients.lire', 'dossiers.lire', 'finances.voir', 'analytics.voir']::text[])
) as v (nom, description, portee, permissions);

insert into reglages (entite_id, valeur) values
  ('00000000-0000-4000-8000-000000000001', $json${
  "emetteur": {
    "nom": "Zwald Travel Planner Co., Ltd.",
    "adresse": "290 Moo 2\n81150, Koh Lanta, Krabi",
    "telephone": "+ 66 95 868 38 46",
    "contact": "Anaïs Zwald\n+66 95 868 38 46 (WhatsApp)\nzwaldtravelplanner@gmail.com"
  },
  "paiement": {
    "texte": "Banque: PostFinance (Suisse)\nIBAN: CH89 0900 0000 1249 3929 7\nSwift: POFICHBEXXX\nAnaïs Zwald\n1233 Bernex"
  },
  "devise": "CHF",
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
  "numerotation": {
    "mode": "initiales",
    "prefixe": ""
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
    "ref_devis": "Devis: réf.",
    "ref_facture": "Facture: réf.",
    "date_emission": "Date d'émission:",
    "unite": "UNITÉ",
    "qte": "QTÉ",
    "total": "TOTAL",
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
    "cgv": "Le client reconnaît avoir pris connaissance des [Conditions Générales de Vente]({cgv_url}) de {entreprise} et les accepter sans réserve. La signature du présent devis vaut acceptation des CGV et engagement contractuel."
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
    "adresse": "292, Moo 2, Sala Dan\nKoh Lanta Yai, Krabi 81150",
    "telephone": "+66 95 868 3846",
    "contact": ""
  },
  "paiement": {
    "texte": ""
  },
  "devise": "",
  "conditions": {
    "acompte_pct": 0,
    "delai_jours": 10,
    "relance_jours": 7,
    "tva_mention": "",
    "cgv_url": ""
  },
  "taux": {
    "eur": 1.058,
    "thb": 40.54
  },
  "numerotation": {
    "mode": "sequence",
    "prefixe": ""
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
    "ref_devis": "Devis: réf.",
    "ref_facture": "Facture: réf.",
    "date_emission": "Date d'émission:",
    "unite": "UNITÉ",
    "qte": "QTÉ",
    "total": "TOTAL",
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
    "cgv": "Le client reconnaît avoir pris connaissance des [Conditions Générales de Vente]({cgv_url}) de {entreprise} et les accepter sans réserve. La signature du présent devis vaut acceptation des CGV et engagement contractuel."
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
    "adresse": "",
    "telephone": "",
    "contact": ""
  },
  "paiement": {
    "texte": ""
  },
  "devise": "",
  "conditions": {
    "acompte_pct": 0,
    "delai_jours": 10,
    "relance_jours": 7,
    "tva_mention": "",
    "cgv_url": ""
  },
  "taux": {
    "eur": 1.058,
    "thb": 40.54
  },
  "numerotation": {
    "mode": "sequence",
    "prefixe": ""
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
    "ref_devis": "Devis: réf.",
    "ref_facture": "Facture: réf.",
    "date_emission": "Date d'émission:",
    "unite": "UNITÉ",
    "qte": "QTÉ",
    "total": "TOTAL",
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
    "cgv": "Le client reconnaît avoir pris connaissance des [Conditions Générales de Vente]({cgv_url}) de {entreprise} et les accepter sans réserve. La signature du présent devis vaut acceptation des CGV et engagement contractuel."
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

-- Les comptes déjà créés avant ce script reçoivent un profil, le plus ancien devient administrateur général.
insert into profils (user_id, email, super_admin)
select u.id, u.email, row_number() over (order by u.created_at) = 1 from auth.users u on conflict do nothing;

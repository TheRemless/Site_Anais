-- Gestion : migration 30, le site secrettravelandtour.com relié à Gestion (16.11.2026).
--   1. demandes_site : les demandes de réservation envoyées depuis la feuille du site (Secret ou VIP Taxi Lanta). Le site continue d'ouvrir
--      WhatsApp comme avant ; il envoie en plus une copie de la demande à la fonction « demande-site », qui l'écrit ici et prévient l'équipe.
--   2. bandeaux_site : le bandeau d'information du site (mer agitée, saison, nouveauté, perturbation), allumé et éteint depuis Gestion,
--      lu par le site grâce à la fonction publique « bandeau-site ».
--
-- À exécuter une seule fois, AVANT de déployer les deux fonctions et de publier la nouvelle version de l'outil. Ne modifie aucune donnée existante.
-- Tant qu'elle n'est pas appliquée, l'outil ne montre ni « Demandes du site » ni « Bandeau du site » (il détecte l'absence des tables).
--
-- Principes :
--   * le public n'écrit JAMAIS directement : ni anon ni authenticated n'ont le droit d'insérer une demande, seule la fonction (clé de service) le fait ;
--   * chaque entreprise ne voit que ses demandes et ses bandeaux (entite_id), comme le reste de l'outil ;
--   * une demande contient le nom et l'hôtel d'un client : seuls les rôles qui voient TOUS les dossiers de l'entreprise la lisent, jamais un rôle
--     limité à ses dossiers ni l'écran « Nouveau voucher » (droit vouchers.seul) ;
--   * l'outil ne modifie d'une demande que son traitement (statut, dossier créé, décision), jamais ce que le client a envoyé ;
--   * l'adresse IP n'est jamais gardée : seulement une empreinte salée, qui sert à limiter le nombre d'envois par appareil.

begin;

create table demandes_site (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  entite_id uuid not null references entites (id) on delete cascade,
  marque text not null check (marque in ('secret', 'taxi')),
  statut text not null default 'nouvelle' check (statut in ('nouvelle', 'confirmee', 'refusee', 'classee')),
  -- Ce que le visiteur a envoyé, tel quel (la fonction a déjà vérifié les tailles et les formats).
  ref text check (ref is null or ref ~ '^[A-Z0-9-]{3,24}$'),
  produit_id text not null check (produit_id ~ '^[a-z0-9-]{1,60}$'),
  produit text check (length(produit) <= 120),
  option_id text check (length(option_id) <= 80),
  option_titre text check (length(option_titre) <= 120),
  date_service date,
  heure text check (heure is null or heure ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  adultes integer check (adultes between 0 and 60),
  enfants integer check (enfants between 0 and 60),
  pickup text check (length(pickup) <= 200),
  nom text check (length(nom) <= 100),
  total_estime numeric(12, 2) check (total_estime is null or total_estime between 0 and 10000000),
  devise text not null default 'THB' check (devise ~ '^[A-Z]{3}$'),
  page_url text check (length(page_url) <= 300),
  message text check (length(message) <= 2000),
  ip_empreinte text,
  -- Traitement dans Gestion.
  traitee_le timestamptz,
  traitee_par uuid,
  dossier_id uuid references dossiers (id) on delete set null,
  -- Ce qu'Anaïs a décidé : changements (date, heure, option, prix), motif du refus, autre proposition. Jamais le texte envoyé au client.
  decision jsonb not null default '{}'::jsonb check (jsonb_typeof(decision) = 'object' and length(decision::text) <= 4000)
);
create index on demandes_site (entite_id, created_at desc);
create index on demandes_site (ip_empreinte, created_at desc);
create index on demandes_site (entite_id) where statut = 'nouvelle';

create table bandeaux_site (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  entite_id uuid not null references entites (id) on delete cascade,
  cree_par uuid default auth.uid(),
  -- Sur quelles pages de quelle marque : Secret, VIP Taxi Lanta (/taxi/) ou les deux.
  marques text[] not null check (cardinality(marques) between 1 and 2 and marques <@ array['secret', 'taxi']),
  type text not null check (type in ('info', 'sea', 'season', 'new', 'urgent')),
  -- Modèle anglais choisi et ce qu'Anaïs y a mis (sortie, date) ; le texte final est recalculé par l'outil et gardé ici, prêt pour le site.
  modele text not null check (modele ~ '^[a-z0-9-]{1,40}$'),
  valeurs jsonb not null default '{}'::jsonb check (jsonb_typeof(valeurs) = 'object' and length(valeurs::text) <= 1000),
  texte text not null check (length(texte) between 1 and 140),
  -- Lien facultatif : une page du site (chemin commençant par /), ou « Ask on WhatsApp ».
  lien text not null default 'aucun' check (lien in ('aucun', 'page', 'whatsapp')),
  lien_page text check (lien_page is null or lien_page ~ '^/[a-z0-9/-]{0,120}$'),
  -- Pages visées : tout le site, des sections, ou des produits choisis (slug du site).
  cible text not null default 'tout' check (cible in ('tout', 'sections', 'produits')),
  sections text[] not null default '{}' check (sections <@ array['islands', 'activities', 'transfers', 'rental', 'taxi']),
  produits text[] not null default '{}' check (cardinality(produits) <= 40),
  debut timestamptz not null default now(),
  fin timestamptz,
  fermable boolean not null default true,
  priorite integer not null default 2 check (priorite between 1 and 3),
  actif boolean not null default true,
  check (fin is null or fin > debut),
  check (lien <> 'page' or lien_page is not null),
  check (cible <> 'sections' or cardinality(sections) > 0),
  check (cible <> 'produits' or cardinality(produits) > 0)
);
create index on bandeaux_site (entite_id);
create index on bandeaux_site (actif, debut, fin);

-- Date de mise à jour tenue par la base.
create or replace function site_tenir_a_jour() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end
$$;
create trigger tenir_a_jour before update on demandes_site for each row execute function site_tenir_a_jour();
create trigger tenir_a_jour before update on bandeaux_site for each row execute function site_tenir_a_jour();

-- Ce que la personne envoie ne change jamais : seuls le statut, le dossier, la décision et les dates de traitement se modifient.
-- Une demande ne revient pas non plus à « nouvelle » et ne change pas d'entreprise.
create or replace function demandes_site_figer() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - array['statut', 'dossier_id', 'decision', 'traitee_le', 'traitee_par', 'updated_at']) is distinct from (to_jsonb(old) - array['statut', 'dossier_id', 'decision', 'traitee_le', 'traitee_par', 'updated_at']) then
    raise exception 'Une demande du site ne se modifie pas : seul son traitement change.' using errcode = '42501';
  end if;
  if new.statut <> old.statut then
    new.traitee_le := now();
    new.traitee_par := auth.uid();
  end if;
  return new;
end
$$;
create trigger figer before update on demandes_site for each row execute function demandes_site_figer();

-- Qui lit les demandes d'une entreprise : un rôle qui voit tous ses dossiers, sauf l'écran « Nouveau voucher » seul.
create or replace function lit_demandes_site(e uuid) returns boolean language sql stable security definer set search_path = public as $$
  select a_permission(e, 'dossiers.lire') and voit_tout(e) and not a_permission(e, 'vouchers.seul')
$$;
revoke all on function lit_demandes_site(uuid) from public, anon;
grant execute on function lit_demandes_site(uuid) to authenticated;

alter table demandes_site enable row level security;
alter table bandeaux_site enable row level security;
revoke all on demandes_site, bandeaux_site from anon, authenticated;

-- Demandes : lecture et traitement depuis l'outil, aucune insertion ni suppression (les statistiques gardent tout ; « classée » range un envoi de test).
grant select on demandes_site to authenticated;
grant update (statut, dossier_id, decision) on demandes_site to authenticated;
create policy "lire les demandes du site" on demandes_site for select to authenticated using (lit_demandes_site(entite_id));
create policy "traiter les demandes du site" on demandes_site for update to authenticated
  using (lit_demandes_site(entite_id) and a_permission(entite_id, 'dossiers.ecrire'))
  with check (lit_demandes_site(entite_id) and a_permission(entite_id, 'dossiers.ecrire') and statut <> 'nouvelle'
    and (dossier_id is null or exists (select 1 from dossiers d where d.id = dossier_id and d.entite_id = demandes_site.entite_id)));
create trigger journaliser after update on demandes_site for each row execute function journaliser();

-- Bandeaux : les membres de l'entreprise les voient, les rôles qui créent des dossiers (et voient toute l'entreprise) les gèrent.
grant select, insert, update, delete on bandeaux_site to authenticated;
create policy "lire les bandeaux" on bandeaux_site for select to authenticated using (a_permission(entite_id, 'dossiers.lire'));
create policy "créer un bandeau" on bandeaux_site for insert to authenticated with check (lit_demandes_site(entite_id) and a_permission(entite_id, 'dossiers.ecrire'));
create policy "modifier un bandeau" on bandeaux_site for update to authenticated
  using (lit_demandes_site(entite_id) and a_permission(entite_id, 'dossiers.ecrire'))
  with check (lit_demandes_site(entite_id) and a_permission(entite_id, 'dossiers.ecrire'));
create policy "supprimer un bandeau" on bandeaux_site for delete to authenticated using (lit_demandes_site(entite_id) and a_permission(entite_id, 'dossiers.ecrire'));
create trigger journaliser after insert or update or delete on bandeaux_site for each row execute function journaliser();

commit;

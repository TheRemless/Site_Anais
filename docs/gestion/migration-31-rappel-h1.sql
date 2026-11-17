-- Gestion : migration 31, rappels avant le service (17.11.2026).
-- Jérémy : Anaïs reçoit une notification une heure avant chaque réservation de Secret et de Taxi, pour rappeler le client et le partenaire
-- elle-même ; pour ZTP, une notification la veille du départ du client (avec le passage de 18h). La fonction « rappels » (déjà déployée) gagne
-- un mode « h1 », appelé toutes les 5 minutes par pg_cron (tâche posée à part, voir le rapport), et envoie les départs ZTP au passage de 18h.
--
-- À exécuter une seule fois, AVANT de redéployer la fonction « rappels » et de poser la tâche pg_cron. Ne modifie aucune donnée existante.
--
--   * rappels_h1_envois : une ligne par service et par heure de début déjà notifiés. La fonction l'écrit avant d'envoyer (insertion qui ignore
--     un doublon) : un service n'est notifié qu'une fois, même si deux exécutions se chevauchent ; une heure changée est une autre ligne,
--     donc un nouveau rappel. Personne d'autre que la fonction (clé de service) ne la lit ni ne l'écrit.
--   * rappels_depart_envois : même principe pour ZTP, une ligne par dossier et par date de départ (une date changée donne un nouveau rappel).
--   * profils.rappel_h1 : chacun coupe ou rallume ces rappels pour lui, dans la fenêtre « Rappels » (fonction definir_rappel_h1, comme la langue).
--     Le réglage par entreprise est dans les réglages (valeur.rappels.h1) : allumé par défaut pour les trois entreprises.
--   * rappels_suivi accepte le type « h1 » (une ligne seulement quand un rappel part ou échoue).

begin;

create table if not exists rappels_h1_envois (
  reservation_id uuid not null references reservations (id) on delete cascade,
  debut timestamptz not null,
  envoye_le timestamptz not null default now(),
  primary key (reservation_id, debut)
);
alter table rappels_h1_envois enable row level security;
revoke all on rappels_h1_envois from anon, authenticated;

create table if not exists rappels_depart_envois (
  dossier_id uuid not null references dossiers (id) on delete cascade,
  date_depart date not null,
  envoye_le timestamptz not null default now(),
  primary key (dossier_id, date_depart)
);
alter table rappels_depart_envois enable row level security;
revoke all on rappels_depart_envois from anon, authenticated;

-- Les lignes de plus de 30 jours ne servent plus à rien (le service est passé) : purgées à chaque écriture, comme le suivi des rappels.
create or replace function purger_rappels_h1() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from rappels_h1_envois where envoye_le < now() - interval '30 days';
  delete from rappels_depart_envois where envoye_le < now() - interval '30 days';
  return null;
end
$$;
drop trigger if exists purger on rappels_h1_envois;
create trigger purger after insert on rappels_h1_envois for each statement execute function purger_rappels_h1();
drop trigger if exists purger on rappels_depart_envois;
create trigger purger after insert on rappels_depart_envois for each statement execute function purger_rappels_h1();

alter table profils add column if not exists rappel_h1 boolean not null default true;

-- Paramètre nommé « allume » et lu par sa position ($1) : « actif » désignerait la colonne profils.actif, que Postgres préfère au paramètre.
create or replace function definir_rappel_h1(allume boolean) returns void language sql security definer set search_path = public as $$
  update profils set rappel_h1 = coalesce($1, true) where user_id = auth.uid()
$$;
revoke all on function definir_rappel_h1(boolean) from public, anon;
grant execute on function definir_rappel_h1(boolean) to authenticated;

alter table rappels_suivi drop constraint if exists rappels_suivi_type_check;
alter table rappels_suivi add constraint rappels_suivi_type_check check (type in ('veille', 'lendemain', 'h1'));

commit;

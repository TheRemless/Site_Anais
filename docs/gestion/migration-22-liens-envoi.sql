-- Gestion : migration 22, envoi des vouchers, devis et factures par lien (11.11.2026).
-- Le copier-coller d'une image et le partage natif dépendent du navigateur. Le lien marche partout : le fichier (image du voucher ou PDF) est déposé
-- dans un stockage PRIVÉ, la base garde une ligne par lien (qui l'a créé, quand, jusqu'à quand), et le message WhatsApp contient une adresse signée
-- à durée limitée que le client ouvre pour voir et enregistrer son document.
-- Confidentialité : le bucket « envois » n'est jamais public et aucune règle ne permet de le lister ; l'adresse signée contient un jeton que seul le
-- stockage sait produire, et le chemin du fichier est un identifiant aléatoire (aucun nom de client). Le lien expire à `expire_le`. Le révoquer supprime
-- le fichier. Les fichiers expirés sont retirés par l'outil à l'ouverture de la fenêtre d'envoi (`nettoye_le` garde la trace).
-- Droits : créer, lire, révoquer un lien exige le droit d'écrire les dossiers (vouchers) ou les devis et factures (documents), dans l'entreprise du dossier.
-- À exécuter une seule fois. Ne modifie aucune donnée existante. Idempotente.

begin;

insert into storage.buckets (id, name, public, file_size_limit) values ('envois', 'envois', false, 10485760)
  on conflict (id) do update set public = false, file_size_limit = 10485760;

create table if not exists liens_envoi (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  entite_id uuid not null references entites (id) on delete cascade,
  dossier_id uuid not null,
  genre text not null check (genre in ('voucher', 'document')),
  objet_id text not null default '',
  nom text not null default '',
  type text not null default '',
  taille integer not null default 0,
  chemin text not null unique,
  expire_le timestamptz not null,
  revoque_le timestamptz,
  nettoye_le timestamptz,
  cree_par uuid default auth.uid(),
  unique (id, entite_id),
  foreign key (dossier_id, entite_id) references dossiers (id, entite_id) on delete cascade
);
create index if not exists liens_envoi_dossier on liens_envoi (dossier_id);
create index if not exists liens_envoi_a_nettoyer on liens_envoi (entite_id, expire_le) where nettoye_le is null;

alter table liens_envoi enable row level security;
revoke all on liens_envoi from anon;
-- Un lien ne se modifie pas : seulement le révoquer ou noter qu'il a été nettoyé.
revoke update on liens_envoi from authenticated;
grant select, insert, delete on liens_envoi to authenticated;
grant update (revoque_le, nettoye_le) on liens_envoi to authenticated;

drop policy if exists "lire les liens d'envoi" on liens_envoi;
drop policy if exists "créer des liens d'envoi" on liens_envoi;
drop policy if exists "révoquer des liens d'envoi" on liens_envoi;
drop policy if exists "supprimer des liens d'envoi" on liens_envoi;
create policy "lire les liens d'envoi" on liens_envoi for select to authenticated
  using (a_permission(entite_id, case when genre = 'document' then 'documents.ecrire' else 'dossiers.ecrire' end) and exists (select 1 from dossiers d where d.id = liens_envoi.dossier_id));
create policy "créer des liens d'envoi" on liens_envoi for insert to authenticated
  with check (a_permission(entite_id, case when genre = 'document' then 'documents.ecrire' else 'dossiers.ecrire' end) and cree_par = auth.uid() and exists (select 1 from dossiers d where d.id = liens_envoi.dossier_id));
create policy "révoquer des liens d'envoi" on liens_envoi for update to authenticated
  using (a_permission(entite_id, case when genre = 'document' then 'documents.ecrire' else 'dossiers.ecrire' end) and exists (select 1 from dossiers d where d.id = liens_envoi.dossier_id))
  with check (a_permission(entite_id, case when genre = 'document' then 'documents.ecrire' else 'dossiers.ecrire' end));
create policy "supprimer des liens d'envoi" on liens_envoi for delete to authenticated
  using (a_permission(entite_id, case when genre = 'document' then 'documents.ecrire' else 'dossiers.ecrire' end) and exists (select 1 from dossiers d where d.id = liens_envoi.dossier_id));

-- Stockage : le fichier se dépose APRÈS la ligne du lien (la règle vérifie que la ligne existe et que la personne a le droit), se signe tant que le lien
-- n'est pas révoqué, et se supprime avec les mêmes droits. Aucune règle de lecture publique : sans la ligne, rien n'est lisible.
drop policy if exists "envois : déposer" on storage.objects;
drop policy if exists "envois : signer" on storage.objects;
drop policy if exists "envois : retirer" on storage.objects;
create policy "envois : déposer" on storage.objects for insert to authenticated
  with check (bucket_id = 'envois' and exists (select 1 from liens_envoi l where l.chemin = storage.objects.name and l.revoque_le is null and a_permission(l.entite_id, case when l.genre = 'document' then 'documents.ecrire' else 'dossiers.ecrire' end)));
create policy "envois : signer" on storage.objects for select to authenticated
  using (bucket_id = 'envois' and exists (select 1 from liens_envoi l where l.chemin = storage.objects.name and l.revoque_le is null and a_permission(l.entite_id, case when l.genre = 'document' then 'documents.ecrire' else 'dossiers.ecrire' end)));
create policy "envois : retirer" on storage.objects for delete to authenticated
  using (bucket_id = 'envois' and exists (select 1 from liens_envoi l where l.chemin = storage.objects.name and a_permission(l.entite_id, case when l.genre = 'document' then 'documents.ecrire' else 'dossiers.ecrire' end)));

commit;

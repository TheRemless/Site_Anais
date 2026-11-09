-- Gestion : migration 17, rappels sur téléphone (notifications Web Push).
-- À exécuter une seule fois, AVANT de publier la nouvelle version de l'outil. N'altère aucune donnée existante.
-- Les envois eux-mêmes (18h et 9h, heure de Bangkok) sont planifiés à part, dans un SQL privé qui contient le secret de la fonction.

begin;

-- Un appareil abonné aux rappels : l'adresse du service de notification du téléphone et les deux clés de chiffrement qui vont avec.
create table abonnements_push (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profils (user_id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  cree_le timestamptz not null default now()
);
create index on abonnements_push (user_id);
alter table abonnements_push enable row level security;
revoke all on abonnements_push from anon, authenticated;
grant select, delete on abonnements_push to authenticated;
create policy "voir ses abonnements" on abonnements_push for select to authenticated using (user_id = auth.uid());
create policy "retirer ses abonnements" on abonnements_push for delete to authenticated using (user_id = auth.uid());

-- Abonne l'appareil à la personne connectée. Un appareil partagé qui change de compte passe au nouveau compte : l'ancien lien est remplacé.
create or replace function abonner_rappels(p_endpoint text, p_p256dh text, p_auth text) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  delete from abonnements_push where endpoint = p_endpoint;
  insert into abonnements_push (user_id, endpoint, p256dh, auth) values (auth.uid(), p_endpoint, p_p256dh, p_auth);
end
$$;
revoke all on function abonner_rappels(text, text, text) from public, anon;
grant execute on function abonner_rappels(text, text, text) to authenticated;

commit;

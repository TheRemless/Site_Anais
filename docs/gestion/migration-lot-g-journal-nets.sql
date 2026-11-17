-- Gestion : migration du lot G (17.11.2026, audit n° 78), journal des nets et commissions des réservations.
-- Numéro à donner à l'intégration (après la 30), le fichier sera renommé en conséquence. À exécuter une seule fois, après les migrations 18 et 28. Idempotente.
--
-- Jusqu'ici, la table reservations_nets ne passait pas par le journal : le journal est lisible avec le droit « journal.voir », il aurait recopié des nets
-- à des personnes qui n'ont pas le droit « partenaires.nets ». Résultat : un net prévu, un net payé ou une commission changés ne laissaient aucune trace.
-- Maintenant :
-- 1. un déclencheur note chaque création, modification et suppression d'une ligne de reservations_nets (montants avant et après, date de paiement) ;
-- 2. ces lignes du journal ne sont lisibles qu'avec les deux droits « journal.voir » et « partenaires.nets ». Les autres lignes du journal ne changent pas.
-- Aucune donnée existante n'est modifiée. Le journal reste fermé à l'écriture directe (seuls les déclencheurs y écrivent).

begin;

create or replace function journaliser_nets_reservation() returns trigger language plpgsql security definer set search_path = public as $$
declare
  ligne jsonb;
  ancien jsonb;
  champs jsonb := '{}';
  k text;
  libelle text;
begin
  ligne := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  ancien := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  for k in select jsonb_object_keys(ligne) loop
    continue when k in ('id', 'entite_id', 'reservation_id');
    if tg_op = 'UPDATE' then
      if ligne->k is distinct from ancien->k then
        champs := champs || jsonb_build_object(k, jsonb_build_object('avant', ancien->k, 'apres', ligne->k));
      end if;
    elsif ligne->k is not null and ligne->k <> 'null'::jsonb then
      -- Création : les valeurs saisies ; suppression : celles qui disparaissent.
      champs := champs || jsonb_build_object(k, case when tg_op = 'INSERT' then jsonb_build_object('avant', null, 'apres', ligne->k) else jsonb_build_object('avant', ligne->k, 'apres', null) end);
    end if;
  end loop;
  if tg_op = 'UPDATE' and champs = '{}'::jsonb then return null; end if;
  -- Le libellé de la réservation et la référence du dossier. Si la réservation vient d'être supprimée (suppression en cascade), le libellé reste vide.
  select r.libelle || coalesce(' · ' || d.ref, '') into libelle
  from reservations r left join dossiers d on d.id = r.dossier_id
  where r.id = (ligne->>'reservation_id')::uuid;
  insert into journal (entite_id, user_id, table_name, action, cible, libelle, details)
  values ((ligne->>'entite_id')::uuid, auth.uid(), 'reservations_nets', lower(tg_op), ligne->>'reservation_id', coalesce(libelle, ''), champs);
  return null;
end
$$;
revoke all on function journaliser_nets_reservation() from public, anon, authenticated;

drop trigger if exists journaliser on reservations_nets;
create trigger journaliser after insert or update or delete on reservations_nets for each row execute function journaliser_nets_reservation();

drop policy if exists "lire le journal" on journal;
create policy "lire le journal" on journal for select to authenticated using (
  a_permission(entite_id, 'journal.voir') and (table_name <> 'reservations_nets' or a_permission(entite_id, 'partenaires.nets'))
);

commit;

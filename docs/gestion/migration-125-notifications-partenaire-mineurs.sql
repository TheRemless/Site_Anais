-- Gestion : migration 125 (24.11.2026), notifications du partenaire chauffeur : points mineurs de la relecture de la migration 123.
-- À exécuter une seule fois, APRÈS la migration 123, et avec la fonction « rappels » du même commit. Idempotente. Ne modifie aucune donnée.
-- Retour en arrière : retour-125-notifications-partenaire-mineurs.sql (rend les deux fonctions de la 123).
--
-- 1. Frais de parc : la même reconnaissance que estFraisDeParc des membres (un libellé sans partenaire qui CONTIENT un frais : « Koh Rok park fee »,
--    « Frais d'entrée du parc », « Park entrance fee »), plus la famille de prestation « frais ». Une course qui nomme seulement un parc reste
--    notifiée. Le filtre des membres perd en même temps sa faille « national park » n'importe où (même motif, FRAIS_PARC).
-- 2. Une course annoncée « sans date » puis confiée à une autre fiche, passée ailleurs, supprimée ou annulée : la notification correspondante
--    (« ne vous est plus confiée » ou « annulée ») part, une seule fois.
-- Le titre « sans date » change dans la fonction rappels (partenaire.js), pas ici.

begin;

create or replace function partenaire_notif_courses(p_user uuid) returns table (
  id uuid, date_service date, heure text, pickup text, dropoff text, retour boolean, programme text,
  adultes integer, enfants integer, bebes integer, client text, libelle text, jour date, entite_id uuid
)
language sql stable security definer set search_path = public as $$
  select c.id, c.date_service, coalesce(c.heure, ''), coalesce(c.pickup, ''), c.dropoff, c.retour, c.programme,
    c.adultes, c.enfants, c.bebes, c.client, coalesce(c.libelle, ''), a.jour, a.entite_id
  from partenaire_acces_de(p_user) a
  cross join lateral partenaire_courses_de(p_user) c
  join reservations r on r.id = c.id
  left join prestations p on p.id = r.prestation_id
  where c.date_service >= a.jour
    -- Frais de parc (une somme payée sur l'île, pas une course) : une prestation de la famille « frais », ou, sans partenaire, un libellé qui
    -- CONTIENT un frais (« Koh Rok park fee », « Frais d'entrée du parc », « Park entrance fee »). Même règle que estFraisDeParc des membres
    -- (FRAIS_PARC, operations-calc.mjs et rappels/calc.js, un test compare les trois). Une course qui nomme seulement un parc
    -- (« Hotel → Mu Ko Lanta National Park ») reste une course (relecture du 24.11.2026).
    and coalesce(p.famille, '') <> 'frais'
    and not (r.partenaire_id is null and coalesce(r.libelle, '') ~* 'frais (de|du) parc|frais d[''’]entr[ée]e|park (entrance )?fees?|entrance fees?|droits? (d[''’]entr[ée]e|(de|du) parc)')
  order by c.date_service, c.heure
$$;
revoke all on function partenaire_notif_courses(uuid) from public, anon, authenticated;

create or replace function partenaire_notifs_changements(p_delai interval default interval '10 minutes')
returns table (user_id uuid, reservation_id uuid, genre text, apercu jsonb, apercu_avant jsonb)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_user uuid;
  v_acces record;
begin
  -- Résumés et rappels de plus de trois jours : plus utiles pour éviter un double envoi.
  delete from partenaires_notifs_envois e where e.envoye_le < now() - interval '3 days';
  for v_user in select a.user_id from partenaires_acces a order by a.user_id for no key update of a loop
    select * into v_acces from partenaire_acces_de(v_user);
    if v_acces.partenaire_id is null or not exists (select 1 from abonnements_push p where p.user_id = v_user) then
      -- Coupé (compte, partenaire, entreprise) ou aucun téléphone : on oublie tout. Au retour, la première prise ne notifie rien.
      delete from partenaires_notifs_courses x where x.user_id = v_user;
      delete from partenaires_notifs_etat x where x.user_id = v_user;
      continue;
    end if;

    if not exists (select 1 from partenaires_notifs_etat x where x.user_id = v_user) then
      insert into partenaires_notifs_courses (user_id, reservation_id, empreinte_vue, vue_le, empreinte_envoyee, apercu, apercu_envoye)
      select v_user, c.id, partenaire_notif_empreinte(to_jsonb(c)), now(), partenaire_notif_empreinte(to_jsonb(c)), to_jsonb(c), to_jsonb(c)
      from partenaire_notif_courses(v_user) c
      on conflict on constraint partenaires_notifs_courses_pkey do nothing;
      insert into partenaires_notifs_etat (user_id) values (v_user) on conflict on constraint partenaires_notifs_etat_pkey do nothing;
      continue;
    end if;

    -- Les courses suivies qui ne sont plus dans sa liste (relecture du 24.11.2026, point B1) :
    --   * annulées (course ou dossier) dans son périmètre, date à venir : « annule » ;
    --   * sorties autrement (confiée à une autre fiche, passée chez Secret, supprimée…), date encore dans sa fenêtre (aujourd'hui à 60 jours) :
    --     « retire », il doit savoir qu'il ne la fait plus ;
    --   * date effacée (course de son périmètre, ni annulée ni retirée) : « sans_date », elle n'est plus sur son écran ;
    --   * sorties par la date (passée, ou repoussée au-delà de 60 jours) : oubliées sans notification ;
    --   * encore sur son écran mais plus notifiable (devenue des frais de parc) : oubliées sans notification, jamais « retire ».
    update partenaires_notifs_courses x set empreinte_vue = 'annule', vue_le = now()
    from reservations r join dossiers d on d.id = r.dossier_id
    where x.user_id = v_user and x.reservation_id = r.id and x.empreinte_vue <> 'annule'
      and r.entite_id = v_acces.entite_id and (r.partenaire_id is null or r.partenaire_id = v_acces.partenaire_id)
      -- Une course sans date (« sans_date » annoncé) puis annulée : annulée aussi (relecture, point 3).
      and (r.statut = 'annule' or d.annule) and (r.date_service >= v_acces.jour or (r.date_service is null and x.empreinte_vue = 'sans_date'))
      and not exists (select 1 from partenaire_notif_courses(v_user) c where c.id = x.reservation_id);
    update partenaires_notifs_courses x set empreinte_vue = 'sans_date', vue_le = now()
    from reservations r join dossiers d on d.id = r.dossier_id
    where x.user_id = v_user and x.reservation_id = r.id and x.empreinte_vue not in ('annule', 'retire', 'sans_date')
      and r.date_service is null and r.statut <> 'annule' and not d.annule
      and r.entite_id = v_acces.entite_id and (r.partenaire_id is null or r.partenaire_id = v_acces.partenaire_id);
    -- Encore sur son écran (partenaire_courses_de) mais hors des notifications : oubliée, sans rien envoyer.
    delete from partenaires_notifs_courses x
    where x.user_id = v_user
      and not exists (select 1 from partenaire_notif_courses(v_user) c where c.id = x.reservation_id)
      and exists (select 1 from partenaire_courses_de(v_user) c where c.id = x.reservation_id and c.date_service >= v_acces.jour);
    -- L'état est recalculé à chaque passage : une course passée à « annule » puis confiée à une autre fiche devient « retire » (le genre envoyé
    -- est celui de l'état final, relecture du 24.11.2026). Une course « sans_date » confiée à une autre fiche, passée ailleurs ou supprimée
    -- devient « retire » elle aussi (relecture, point 3) ; tant qu'elle reste à lui sans date, elle reste « sans_date ».
    update partenaires_notifs_courses x set empreinte_vue = 'retire', vue_le = now()
    where x.user_id = v_user and x.empreinte_vue <> 'retire'
      and not exists (select 1 from partenaire_notif_courses(v_user) c where c.id = x.reservation_id)
      and not exists (
        select 1 from reservations r join dossiers d on d.id = r.dossier_id
        where r.id = x.reservation_id and r.entite_id = v_acces.entite_id and (r.partenaire_id is null or r.partenaire_id = v_acces.partenaire_id)
          and (r.statut = 'annule' or d.annule)
          and (r.date_service >= v_acces.jour or (r.date_service is null and x.empreinte_vue = 'sans_date')))
      and not exists (
        select 1 from reservations r join dossiers d on d.id = r.dossier_id
        where r.id = x.reservation_id and r.date_service is null and r.statut <> 'annule' and not d.annule
          and r.entite_id = v_acces.entite_id and (r.partenaire_id is null or r.partenaire_id = v_acces.partenaire_id))
      and (exists (select 1 from reservations r where r.id = x.reservation_id and r.date_service between v_acces.jour and v_acces.jour + 60)
        or (not exists (select 1 from reservations r where r.id = x.reservation_id) and ((x.apercu->>'date_service')::date >= v_acces.jour or x.empreinte_vue = 'sans_date'))
        or (x.empreinte_vue = 'sans_date' and exists (select 1 from reservations r where r.id = x.reservation_id and r.date_service is null)));
    -- Hors de sa liste et hors de sa fenêtre de dates : oubliée.
    delete from partenaires_notifs_courses x
    where x.user_id = v_user
      and not exists (select 1 from partenaire_notif_courses(v_user) c where c.id = x.reservation_id)
      and not exists (select 1 from reservations r where r.id = x.reservation_id and r.date_service between v_acces.jour and v_acces.jour + 60)
      and not (not exists (select 1 from reservations r where r.id = x.reservation_id) and (x.apercu->>'date_service')::date >= v_acces.jour)
      and not (x.empreinte_vue = 'sans_date' and exists (select 1 from reservations r where r.id = x.reservation_id and r.date_service is null))
      -- Une annulation ou un retrait pas encore envoyé reste jusqu'à son envoi (une course sans date n'a plus de fenêtre de dates).
      and not (x.empreinte_vue in ('annule', 'retire') and x.empreinte_vue is distinct from x.empreinte_envoyee);

    -- Les courses de sa liste : nouvelles, ou changées depuis le dernier passage (le délai repart).
    insert into partenaires_notifs_courses as x (user_id, reservation_id, empreinte_vue, vue_le, apercu)
    select v_user, c.id, partenaire_notif_empreinte(to_jsonb(c)), now(), to_jsonb(c) from partenaire_notif_courses(v_user) c
    on conflict on constraint partenaires_notifs_courses_pkey do update
      set empreinte_vue = excluded.empreinte_vue, apercu = excluded.apercu,
          vue_le = case when x.empreinte_vue is distinct from excluded.empreinte_vue then now() else x.vue_le end;

    -- Jamais notifiée (ou déjà annoncée annulée ou retirée) puis annulée, retirée ou sans date : rien à dire. Annoncée sans date puis annulée
    -- ou retirée : il doit le savoir, la notification part (relecture, point 3).
    update partenaires_notifs_courses x set empreinte_envoyee = x.empreinte_vue, apercu_envoye = x.apercu
    where x.user_id = v_user and x.empreinte_vue in ('annule', 'retire', 'sans_date')
      and (x.empreinte_envoyee is null or x.empreinte_envoyee in ('annule', 'retire'));

    return query
    with pretes as (
      select x.reservation_id, x.empreinte_vue, x.empreinte_envoyee, x.apercu, x.apercu_envoye from partenaires_notifs_courses x
      where x.user_id = v_user and x.empreinte_vue is distinct from x.empreinte_envoyee and x.vue_le <= now() - p_delai
      for update
    ), marquees as (
      update partenaires_notifs_courses x set empreinte_envoyee = p.empreinte_vue, apercu_envoye = p.apercu
      from pretes p where x.user_id = v_user and x.reservation_id = p.reservation_id
      returning x.reservation_id
    )
    select v_user, p.reservation_id,
      case when p.empreinte_vue = 'annule' then 'annulee' when p.empreinte_vue = 'retire' then 'retiree' when p.empreinte_vue = 'sans_date' then 'sans_date'
           when p.empreinte_envoyee is null or p.empreinte_envoyee in ('annule', 'retire', 'sans_date') then 'nouvelle' else 'modifiee' end,
      p.apercu, p.apercu_envoye
    from pretes p join marquees m on m.reservation_id = p.reservation_id;
  end loop;
end
$$;
revoke all on function partenaire_notifs_changements(interval) from public, anon, authenticated;

commit;

-- Gestion : migration 116 (22.11.2026), tout le détail des courses pour le partenaire chauffeur (Mr. Brown, VIP Taxi Lanta).
-- À exécuter une seule fois, APRÈS la migration 115 et AVANT de publier la version de l'outil qui l'utilise. Idempotente. Ne modifie aucune donnée.
-- Retour en arrière : retour-116-courses-partenaire-details.sql (rend la fonction de la migration 115).
--
-- Jérémy (22.11.2026) : « il faut vraiment qu'il ait les informations de chaque réservation pour transmettre au chauffeur ». Chaque course montre
-- tout ce qu'imprime la Booking confirmation de Taxi et le voucher de Mook, sauf ce qui est interne. partenaire_courses() rend en plus :
--   * ref : la référence de la course (référence du dossier, celle du voucher) ; reference_partenaire : sa propre référence s'il l'a donnée ;
--   * libelle et service : le libellé de la course (« Private minivan: Krabi Airport → Koh Lanta ») et le groupe du tarif (« Private Taxi »),
--     qui disent le type de véhicule ; vehicules : le nombre de véhicules (quantité de la ligne vendue au véhicule, 1 sinon) ;
--   * adresse_client : la première ligne de l'adresse du client si sa fiche est dans l'entreprise Taxi (son hôtel), jamais celle d'une fiche
--     partagée d'une autre entreprise (adresse postale) ;
--   * details : les seuls champs du voucher de la course (liste blanche ci-dessous : chambre, hôtel, bagages, sièges, vol, bateau, retour,
--     programme, durée, point de rendez-vous, remarques…). Jamais un net, une note interne, une trace d'envoi ou le nom d'un autre partenaire ;
--   * paiement : « sur_place » (le chauffeur encaisse), « paye », « acompte » ou « en_attente », et a_encaisser : ce que le chauffeur encaisse.
-- Mêmes courses, mêmes droits et même saisie de commission que la migration 115 : seule la liste des colonnes s'allonge.
-- Attention : rejouer la migration 115 après celle-ci rend l'ancienne fonction (sans le détail) ; relancer alors la 116.

begin;

-- Les champs du voucher qu'un partenaire peut lire, tels que CHAMPS_VOUCHER (operations-calc.mjs) les définit pour les cinq modèles, plus la
-- zone de prise en charge. Les autres clés de `details` (lignes, envois, voucher figé, prix d'origine, traces de demande, copies…) restent internes.
-- Tenue à l'identique de CHAMPS_COURSE dans courses-partenaire-calc.mjs (un test compare les deux listes).
create or replace function partenaire_champs_details() returns text[] language sql immutable set search_path = public as $$
  select array[
    'type_trajet', 'drop_off', 'programme_trajet', 'duree_h', 'vol', 'bagages', 'sieges', 'type_transfert', 'remarques', 'remarques_paiement',
    'hotel', 'chambre', 'type_tour', 'bateau', 'parc', 'parc_texte', 'programme', 'heure_service',
    'retour_date', 'retour_heure', 'retour_lieu', 'permis', 'equipement', 'caution', 'conditions',
    'de', 'vers', 'depart', 'arrivee', 'embarquement', 'checkin', 'pickup_zone'
  ]::text[]
$$;
revoke all on function partenaire_champs_details() from public, anon, authenticated;

drop function if exists partenaire_courses();
create function partenaire_courses() returns table (
  id uuid, date_service date, heure text, pickup text, dropoff text, retour boolean, programme text,
  adultes integer, enfants integer, bebes integer, client text, telephone text, vol text, prix numeric,
  commission numeric, commission_payee numeric, reglee boolean, par_moi boolean, modifiable boolean,
  ref text, reference_partenaire text, libelle text, service text, vehicules numeric, adresse_client text, details jsonb,
  paiement text, a_encaisser numeric
)
language sql stable security definer set search_path = public as $$
  select r.id, r.date_service, r.heure_pickup, r.lieu_pickup,
    coalesce(r.details->>'drop_off', ''), coalesce(r.details->>'type_trajet', '') = 'retour_depart', coalesce(r.details->>'programme_trajet', ''),
    coalesce(nombre_json(r.personnes->'adultes'), 0)::integer, coalesce(nombre_json(r.personnes->'enfants'), 0)::integer, coalesce(nombre_json(r.personnes->'bebes'), 0)::integer,
    trim(coalesce(c.prenom, '') || ' ' || coalesce(c.nom, '')), coalesce(c.telephone, ''), coalesce(r.details->>'vol', ''), r.montant_vente,
    n.commission_prevue, n.commission_recue, n.commission_recue_le is not null,
    coalesce(n.commission_prevue = n.commission_partenaire, false),
    n.commission_recue_le is null and coalesce(n.commission_recue, 0) = 0 and (n.commission_prevue is null or coalesce(n.commission_prevue = n.commission_partenaire, false)),
    d.ref,
    -- Sa référence : seulement sur une course qui lui est confiée (jamais celle d'un autre prestataire).
    case when r.partenaire_id = a.partenaire_id then coalesce(r.reference_partenaire, '') else '' end,
    r.libelle, coalesce(p.groupe, ''),
    coalesce((
      select sum(coalesce(nombre_json(l->'qte'), 1))
      from documents doc cross join lateral jsonb_array_elements(case when jsonb_typeof(doc.contenu->'lignes') = 'array' then doc.contenu->'lignes' else '[]'::jsonb end) l
      where doc.dossier_id = r.dossier_id
        and (l->>'id' = r.ligne_id or coalesce(r.details->'lignes_ids', '[]'::jsonb) ? (l->>'id'))
        and coalesce(nullif(l->>'par', ''), p.unite, '') = 'veh'
    ), 1),
    case when c.entite_id = r.entite_id then split_part(coalesce(c.adresse, ''), E'\n', 1) else '' end,
    (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(coalesce(r.details, '{}'::jsonb)) as e(k, v) where k = any (partenaire_champs_details())),
    case when r.paye_sur_place then 'sur_place'
         when coalesce(s.total, 0) > 0 and coalesce(s.recu, 0) >= s.total then 'paye'
         when coalesce(s.recu, 0) > 0 then 'acompte'
         else 'en_attente' end,
    case when r.paye_sur_place then r.montant_vente
         when coalesce(s.total, 0) > 0 and coalesce(s.recu, 0) >= s.total then 0
         when coalesce(s.recu, 0) > 0 then greatest(least(r.montant_vente, s.total - s.recu), 0)
         else r.montant_vente end
  from partenaire_acces_actuel() a
  join reservations r on r.entite_id = a.entite_id and (r.partenaire_id is null or r.partenaire_id = a.partenaire_id)
  join dossiers d on d.id = r.dossier_id and d.entite_id = r.entite_id
  -- Le client peut être une fiche partagée d'une autre entreprise (migration 46) : seuls son nom et son téléphone sortent.
  join clients c on c.id = d.client_id
  left join prestations p on p.id = r.prestation_id
  left join dossiers_resume s on s.dossier_id = d.id
  left join reservations_nets n on n.reservation_id = r.id
  where r.statut <> 'annule' and not d.annule and r.date_service is not null
    and ((r.date_service >= a.jour and r.date_service <= a.jour + 60)
      or (r.date_service < a.jour and n.commission_recue_le is null
          and (n.commission_prevue is null or n.commission_prevue - coalesce(n.commission_recue, 0) > 0)))
  order by r.date_service, r.heure_pickup, r.created_at
$$;
revoke all on function partenaire_courses() from public, anon;
grant execute on function partenaire_courses() to authenticated;

commit;

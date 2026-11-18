-- Gestion : migration 43, règles des partenaires (préparation du logiciel pour d'autres clients).
-- Les règles qui nommaient une compagnie ou un lieu dans le code deviennent des données :
--   * partenaires.payer_avant_veille, payer_avant_veille_sauf : « à payer au prestataire avant la veille du départ », sauf départ de ces lieux
--     (avant : nom contenant « Bundhaya », sauf départ contenant « Lanta ») ;
--   * partenaires.checkin_passeport : consigne de check-in d'un trajet vers ou depuis une destination à passeport (avant : texte de Bundhaya écrit dans le code) ;
--   * partenaires.regles.checkin_voucher : consigne de check-in du billet, déjà sur la fiche ; remplie pour Bundhaya et Satun Pakbara quand elle est vide
--     (avant : leur texte écrit dans le code d'après le nom) ;
--   * partenaires.tarif_zone : tarifs par zone sans départ fixe (avant : groupe de prestation contenant « Saladan ») ;
--   * partenaires.taxi_defaut : partenaire taxi par défaut du voucher rapide (avant : nom contenant « taxi ») ;
--   * reglages.valeur.destinations_passeport : destinations à passeport de chaque entreprise (avant : « Langkawi », « Malaysia », « Malaisie » dans le code) ;
--   * reglages.valeur.compagnies : compagnies que « par X » traduit en « by X » (avant : « Lomprayah », « Seatran » dans le code).
-- Les valeurs reprennent exactement les règles d'avant pour l'organisation Zwald : rien ne change pour Anaïs.
-- Les nouvelles organisations commencent sans aucune règle.
-- À exécuter une seule fois, après la migration 42 et AVANT de publier le code qui lit ces colonnes. Idempotente.

begin;

-- 1. Colonnes.
alter table partenaires add column if not exists payer_avant_veille boolean not null default false;
alter table partenaires add column if not exists payer_avant_veille_sauf text not null default '' check (length(payer_avant_veille_sauf) <= 300);
alter table partenaires add column if not exists checkin_passeport text not null default '' check (length(checkin_passeport) <= 1000);
alter table partenaires add column if not exists tarif_zone boolean not null default false;
alter table partenaires add column if not exists taxi_defaut boolean not null default false;

-- 2. Partenaires de l'organisation Zwald : les règles d'avant, écrites sur leur fiche.
-- Le filtre « organisation Zwald » garde les autres organisations sans règle, même avec un partenaire du même nom.
update partenaires p set payer_avant_veille = true, payer_avant_veille_sauf = 'Lanta'
from entites e
where e.id = p.entite_id and e.organisation_id = '00000000-0000-0000-0000-00000000a000'
  and p.nom ~* 'bundhaya' and not p.payer_avant_veille;

update partenaires p set checkin_passeport = 'Check-in 90 minutes before departure, counter closes 45 minutes before. Passport of each passenger required (immigration), kept by the captain during the crossing.'
from entites e
where e.id = p.entite_id and e.organisation_id = '00000000-0000-0000-0000-00000000a000'
  and p.nom ~* 'bundhaya' and p.checkin_passeport = '';

-- Consigne du billet : seulement quand la fiche n'en a pas (une consigne écrite sur la fiche passait déjà avant sur le voucher).
update partenaires p set regles = jsonb_set(p.regles, '{checkin_voucher}', to_jsonb('Check-in at the pier 45 minutes before departure, counter closes 15 minutes before. Please bring this voucher and your passport or ID.'::text))
from entites e
where e.id = p.entite_id and e.organisation_id = '00000000-0000-0000-0000-00000000a000'
  and p.nom ~* 'bundhaya' and coalesce(trim(p.regles->>'checkin_voucher'), '') = '';

update partenaires p set regles = jsonb_set(p.regles, '{checkin_voucher}', to_jsonb('Please present this voucher at the counter 30 minutes before departure, counter closes 20 minutes before. Passport or ID required.'::text))
from entites e
where e.id = p.entite_id and e.organisation_id = '00000000-0000-0000-0000-00000000a000'
  and p.nom ~* 'satun' and p.nom !~* 'bundhaya' and coalesce(trim(p.regles->>'checkin_voucher'), '') = '';

-- Tarifs par zone : les partenaires qui ont un tarif dans un groupe « Saladan » (les taxis de Saladan).
update partenaires p set tarif_zone = true
from entites e
where e.id = p.entite_id and e.organisation_id = '00000000-0000-0000-0000-00000000a000'
  and not p.tarif_zone
  and exists (select 1 from prestations x where x.partenaire_id = p.id and x.groupe ~* 'saladan');

-- Partenaire taxi par défaut : le nom contenait « taxi ».
update partenaires p set taxi_defaut = true
from entites e
where e.id = p.entite_id and e.organisation_id = '00000000-0000-0000-0000-00000000a000'
  and p.nom ~* 'taxi' and not p.taxi_defaut;

-- 3. Réglages des entreprises de Zwald (ZTP, Secret, Taxi). Une valeur absente ou vide s'écrit : vide est la valeur par défaut du code, qu'un
-- enregistrement des réglages a pu poser si le code est publié avant la migration (aucun écran ne permettait encore de les remplir).
--   * destinations_passeport : un départ ou une arrivée « Langkawi » demande la consigne passeport ; « Malaysia » ou « Malaisie » dans le libellé
--     ajoute seulement la note, comme avant ;
--   * compagnies : citées dans les libellés sans être partenaires (« par Lomprayah » → « by Lomprayah »), en plus des noms des partenaires.
-- L'historique des réglages (migration 38) ne garde pas de version pour cet ajout : Anaïs n'a rien changé.
alter table reglages disable trigger archiver_reglages;
update reglages r set valeur = r.valeur || jsonb_build_object('destinations_passeport', jsonb_build_array(jsonb_build_object(
  'lieux', jsonb_build_array('Langkawi'),
  'mentions', jsonb_build_array('Malaysia', 'Malaisie'),
  'note_en', 'Travelling to or from Langkawi (Malaysia): please bring your passport, valid for at least six months.',
  'note_fr', 'Trajet vers ou depuis Langkawi (Malaisie) : prévoyez votre passeport, valable au moins six mois.'
)))
from entites e
where e.id = r.entite_id and e.organisation_id = '00000000-0000-0000-0000-00000000a000'
  and coalesce(r.valeur->'destinations_passeport', '[]'::jsonb) in ('[]'::jsonb, 'null'::jsonb);
update reglages r set valeur = r.valeur || jsonb_build_object('compagnies', jsonb_build_array('Lomprayah', 'Seatran'))
from entites e
where e.id = r.entite_id and e.organisation_id = '00000000-0000-0000-0000-00000000a000'
  and coalesce(r.valeur->'compagnies', '[]'::jsonb) in ('[]'::jsonb, 'null'::jsonb);
alter table reglages enable trigger archiver_reglages;

commit;

-- Contrôle à lancer avant la migration (lecture seule) : une consigne de billet déjà écrite sur la fiche de Bundhaya ou de Satun
-- remplaçait seulement le texte du voucher. Après la migration, elle sert aussi au rappel H-1 et à la note passeport.
--   select nom, regles->>'checkin_voucher' from partenaires where nom ~* 'bundhaya|satun' and coalesce(trim(regles->>'checkin_voucher'), '') <> '';
-- Et les trois entreprises ont bien une ligne de réglages (sinon la destination à passeport ne s'écrit pas) :
--   select e.slug, r.entite_id is not null as a_des_reglages from entites e left join reglages r on r.entite_id = e.id where e.organisation_id = '00000000-0000-0000-0000-00000000a000';

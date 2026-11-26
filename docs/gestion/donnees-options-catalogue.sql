-- Gestion : les prestations de Secret qui sont en fait des options d'un service deviennent des options (26.11.2026, INV-2026-055).
-- À appliquer APRÈS la migration 130 et après l'accord explicite de Jérémy. Données seulement : aucun prix, net, libellé ni autre ligne touchés.
-- Idempotente : relancée, elle ne change plus rien. Relevé du catalogue en lecture seule le 26.11.2026 (mots « extension », « extra »,
-- « supplement », « additional », « option », « add-on » dans les trois entreprises) : ZTP et VIP Taxi Lanta n'en ont aucune.
-- Aucune réservation existante ne porte ces prestations : seul le catalogue change.
--
-- Pas des options (restent telles quelles) :
--   - « … option Economy / VIP / Mini Luxury / Luxury / Prestige » (Preaek Chailey, Rose Voyage, Krabi Aoanang Tour) : des variantes du
--     service, chacune avec son prix ;
--   - « Program A/B/C, extra person, on top of the first 2 people » (Lacha Ru Tour) : des suppléments par personne (unité « sup »), déjà
--     réunis avec leur programme dans une seule réservation.
-- Une option complète les services du même partenaire (contrôlé par la base, migration 130).

begin;

-- 1. Sûres : le libellé dit à quel service elles s'ajoutent.
-- Lanta Longtail Tour : extension Koh Kradan des trois tarifs du 4 Islands privé (1 à 2, 3 à 4, 5 à 6 personnes).
update prestations set option_de = array['86089978-5c93-5713-aae4-5231d9be8f3c', '71b95917-0c36-58fe-a833-0cc27c17c101', '1e3a5589-f9ee-56f7-acb4-387caf77167d']::uuid[]
where id = 'a766a679-79ad-5c5c-ab72-794e4537d220' and option_de = '{}';

-- Preaek Chailey Tour : lunch box et VIP Set des trois sorties privées Economy d'Ao Nang.
update prestations set option_de = array['61ffc98d-74b2-7419-65f6-3706fdb56f8a', '84b2720f-044b-b9a8-8bad-e3e867719406', '0cc62dcf-0c43-c4ec-5f30-1deceef428c5']::uuid[]
where id in ('2afec5a3-a0b9-53aa-f25f-1253f957a33a', '208d312e-0ee3-fcdc-8eb5-0e2f8081f267') and option_de = '{}';

-- Rose Voyage Krabi : lunch box des neuf sorties privées d'Ao Nang (VIP, Mini Luxury, Luxury).
update prestations set option_de = array['71fbcdc8-da30-0638-07d1-dd546301a798', 'fe677b55-7ab2-2949-ccb0-b0b98ec28d8a', '451d4e81-d8c5-9d5c-c92b-9167f00758d0', '97793120-adef-788a-5ac4-f7c5b8ceb5a3', 'f764e2f3-d32b-c0e9-7eaa-fe15381b8147', '67f70d48-4349-2947-a778-16630bddd1c0', '40d9876c-fb1d-6b6f-542b-4def16622fa6', '4b6173cc-5109-4807-ed79-40a5ce5d8ec0', '9002f286-91a1-747e-1346-1ef5cc488ff5']::uuid[]
where id = '6c578603-c8aa-bab2-da8e-6003fe29cb63' and option_de = '{}';

-- U Villa & Tour : transfert d'hôtel par van des sorties privées de Koh Samui (treize tarifs « Koh Samui, private boats »).
update prestations set option_de = array['922eb263-bf39-9301-c3f8-05dde06d13ce', '2bfcb916-85f9-dcb5-96e8-89b243d79053', '1a071603-d9e9-7a9b-6e7e-cc6043be608c', 'cae4525c-de3d-6e1f-b443-a032ab588e3f', '816aaefc-7105-508e-a918-a248cc12b649', '6c9d65e1-5948-27c1-905d-3369ce1f21ab', '9cbb0dc2-60ad-4a30-deb5-b8716bb24a35', 'b63780b7-3fd9-75e2-f8d9-66b3616e9108', 'cb946e54-9f2b-d456-9dd1-735237149dbf', 'ee96aba6-0883-c13e-13a2-bb8f1e8ba3a0', '9fa49abc-4e05-a6b7-f38f-2654cce8c274', 'f6ce2f78-229c-cf77-e711-7c3e2bc19d01', '04a0b150-0ed7-3f94-a2a9-c3bce937f985']::uuid[]
where id = '23d3dda4-9f14-2ae3-ef66-291ec3378725' and option_de = '{}';

-- Blue Planet Divers : plongée supplémentaire des sorties pour plongeurs certifiés (Koh Haa, Phi Phi et Koh Bida), « Deep Adventure Dive »
-- des sorties spéciales en catamaran (nord, sud).
update prestations set option_de = array['cf7ed517-1fb7-5489-aefb-e1e394a4681b', '9854ddaf-1e9e-597c-a969-340f25f9dce8']::uuid[]
where id = 'c8bfabc9-780f-5124-ab89-d14b646a5da6' and option_de = '{}';
update prestations set option_de = array['549e2aae-2dd0-5dde-a4f9-bdf545234036', 'e44f254f-730a-5954-acd2-0e1b7e113cf0']::uuid[]
where id = '9bb538f7-62ed-514a-a9fb-3259885f43c6' and option_de = '{}';

commit;

-- 2. À confirmer par Jérémy, NON appliqué (décommenter après accord) : Blue Planet Divers, à quelles sorties s'ajoutent-elles ?
--   - « Refresher, added to a local trip » (c626c2c3-7b79-5e2b-a241-c125371522b7) : aucune sortie « locale » nommée ainsi au catalogue ;
--   - locations « Dive computer rental » (8f168f53-c60d-5e81-a1a6-28f191187120), « GoPro Hero and accessories rental »
--     (8e01d0c8-356d-55d5-a9d7-ae57b29a8b27), « Nitrox tank rental » 12 L (4c2fe5f3-5e94-5515-a354-5c4b6bcf42f0) et 15 L
--     (ceffdd76-5e8d-56e4-af43-a8ea19c2c9d0) : toutes les plongées, ou seulement les sorties pour plongeurs certifiés ?
--   - « Nanny on board for your children » (6e11b321-8c84-5371-ad33-9b7f72b86b3a) : le snorkelling sur le bateau de plongée ?
-- update prestations set option_de = array['cf7ed517-1fb7-5489-aefb-e1e394a4681b', '9854ddaf-1e9e-597c-a969-340f25f9dce8', '549e2aae-2dd0-5dde-a4f9-bdf545234036', 'e44f254f-730a-5954-acd2-0e1b7e113cf0']::uuid[]
-- where id in ('8f168f53-c60d-5e81-a1a6-28f191187120', '8e01d0c8-356d-55d5-a9d7-ae57b29a8b27', '4c2fe5f3-5e94-5515-a354-5c4b6bcf42f0', 'ceffdd76-5e8d-56e4-af43-a8ea19c2c9d0') and option_de = '{}';

-- Contrôle après application (lecture seule) : chaque option, son partenaire et le nombre de services qu'elle complète.
-- select pa.nom, o.libelle_en, cardinality(o.option_de) as services from prestations o join partenaires pa on pa.id = o.partenaire_id
-- where cardinality(o.option_de) > 0 order by 1, 2;

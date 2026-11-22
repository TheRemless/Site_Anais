# Accès d'un partenaire chauffeur (Mr. Brown, VIP Taxi Lanta)

Migration 115 (22.11.2026). Le partenaire voit en thaï ses courses de Taxi (aujourd'hui, demain, les jours suivants, et les courses passées dont la commission reste à payer) et saisit sur chacune la commission qu'il doit à Nani. L'outil fait le total.

## Ce que le compte voit et peut faire

| Il voit | Il ne voit jamais |
|---|---|
| Heure, lieu de prise en charge, destination (ou aller-retour et programme) | Nets, marges, notes internes, référence du dossier |
| Nombre de personnes, nom et téléphone du client, numéro de vol | Courses d'un autre partenaire, d'une autre entreprise (Secret, ZTP) |
| Prix payé par le client, sa commission, ce qui est déjà payé | Réglages, équipe, journal, menu de Gestion |

Il ne peut que saisir ou corriger la commission d'une de ses courses tant qu'elle n'est pas payée (même en partie). Rien d'autre.

Le compte n'est membre d'aucune entreprise. La base lui ferme toutes les tables et ne lui répond que par trois fonctions (`partenaire_mon_acces`, `partenaire_courses`, `partenaire_saisir_commission`). Contrôlé sur Postgres par `verif-acces-partenaire.mjs`.

La commission saisie devient la « commission prévue » de la course : Nani la retrouve dans « Commissions à demander » (« Commission annoncée ») et dans « À encaisser ». Le journal des nets note chaque saisie avec le compte. Aucune notification n'est envoyée.

## Créer le compte (Jérémy)

Aucun identifiant ne passe par Claude ni par ce dépôt.

1. Supabase, projet Gestion, **Authentication > Users > Add user > Create new user** : l'e-mail choisi pour Mr. Brown, un mot de passe que tu choisis, « Auto Confirm User » coché.
2. Supabase, **SQL Editor**, en remplaçant l'e-mail :

```sql
-- Rattache le profil à l'organisation de VIP Taxi Lanta (utile s'il existe plusieurs organisations), puis donne l'accès partenaire.
update profils set organisation_id = (select organisation_id from entites where id = '00000000-0000-4000-8000-000000000003')
where email = 'EMAIL_DE_MR_BROWN' and organisation_id is null;

insert into partenaires_acces (user_id, partenaire_id)
select p.user_id, pa.id
from profils p, partenaires pa
where p.email = 'EMAIL_DE_MR_BROWN'
  and pa.entite_id = '00000000-0000-4000-8000-000000000003'
  and pa.nom = 'VIP Taxi Lanta';

-- Contrôle : une ligne, le bon partenaire, aucun accès à une entreprise. Aucune ligne : vérifier l'e-mail et le nom du partenaire (Partenaires).
select pr.email, pa.nom as partenaire, (select count(*) from membres m where m.user_id = a.user_id) as entreprises
from partenaires_acces a join profils pr on pr.user_id = a.user_id join partenaires pa on pa.id = a.partenaire_id;
```

La base refuse l'accès si le compte est déjà membre d'une entreprise, administrateur, hors de l'organisation, ou si le partenaire n'est pas dans une entreprise en mode taxi. Elle refuse aussi, ensuite, de donner un rôle à ce compte.

3. Sur le téléphone de Mr. Brown : ouvrir gestion.zwaldtravelplanner.com, se connecter avec l'e-mail et le mot de passe, puis **Partager > Sur l'écran d'accueil** (iPhone) ou **Ajouter à l'écran d'accueil** (Android). L'écran s'ouvre directement en thaï.

## Couper l'accès

- Tout de suite : Gestion, Administration, Utilisateurs, désactiver le compte. Ou désactiver le partenaire.
- Pour de bon : `delete from partenaires_acces where user_id = (select user_id from profils where email = 'EMAIL_DE_MR_BROWN');`

## Textes thaïs à faire relire

Tous dans `src/gestion/js/courses-partenaire-calc.mjs` (objet `TH`, le français en commentaire). À faire relire par Nani ou Mook, surtout :

- `ค่าคอมที่ต้องจ่ายให้ Nani` (commission à payer à Nani) et `รวมทุกงานที่ยังไม่ได้จ่าย` (total des courses pas encore payées) ;
- `งานรับส่งลูกค้า` (titre de l'écran) ;
- `งานที่ผ่านมา ยังไม่ได้จ่ายค่าคอม` (courses passées, commission pas encore payée) ;
- `จ่ายแล้วบางส่วน` (payée en partie) et `จ่ายแล้ว แก้ไม่ได้` (déjà payée, ne se modifie plus).

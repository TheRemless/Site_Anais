# Accès d'un partenaire chauffeur (Mr. Brown, VIP Taxi Lanta)

Migration 115 (22.11.2026). Le partenaire voit en thaï les courses de l'entreprise Taxi confiées à sa fiche ou sans partenaire (décision de Jérémy du 22.11.2026), d'aujourd'hui à 60 jours, et les courses passées tant que leur commission n'est pas payée (aujourd'hui, demain, les jours suivants, et les courses passées dont la commission reste à payer) et saisit sur chacune la commission qu'il doit à Nani. L'outil fait le total.

## Ce que le compte voit et peut faire

| Il voit | Il ne voit jamais |
|---|---|
| Les courses de Taxi de sa fiche ou sans partenaire : heure, lieu de prise en charge, destination (ou aller-retour et programme) | Nets, marges, notes internes, référence du dossier |
| Nombre de personnes, nom et téléphone du client, numéro de vol | Courses confiées à une autre fiche, courses d'une autre entreprise (Secret, ZTP) |
| Prix payé par le client, sa commission, ce qui est déjà payé | Réglages, équipe, journal, menu de Gestion |

Il ne peut que saisir ou corriger SA commission sur une course de sa liste, tant qu'elle n'est pas payée (même en partie). Une commission posée par Nani ou l'équipe s'affiche en lecture seule : il ne l'écrase jamais. Zéro est refusé. Plafond : le prix de vente de la course, ou 10 000 si le prix est vide. Rien d'autre.

Le compte n'est membre d'aucune entreprise. La base lui ferme toutes les tables et ne lui répond que par trois fonctions (`partenaire_mon_acces`, `partenaire_courses`, `partenaire_saisir_commission`). Contrôlé sur Postgres par `verif-acces-partenaire.mjs`.

La commission saisie devient la « commission prévue » de la course, marquée « saisie par le partenaire » (`commission_partenaire`, `commission_partenaire_le`). Nani le voit dans la fiche de la course et dans « Commissions à demander ». Si elle la change, la commission redevient la sienne et passe en lecture seule pour lui. Le journal des nets note chaque saisie avec le compte. Aucune notification n'est envoyée.

## Détail de chaque course (migration 116)

Chaque course montre tout ce qu'imprime la Booking confirmation de Taxi et le voucher de Mook, sauf l'interne. En gros : lieu de prise en charge (et chambre), destination ou aller-retour avec programme et durée, vol ou bateau, personnes (adultes, enfants, bébés, sièges enfant), bagages, véhicule et nombre de véhicules, paiement (ce que le chauffeur encaisse en espèces, ou déjà payé), prix. En dessous, toujours visibles : hôtel et chambre, point de rendez-vous, zone, retour (date, heure, lieu), horaires de bateau, remarques, remarques de paiement, libellé de la course, référence de la réservation et sa propre référence.

Les champs de `details` qui sortent sont une liste blanche (`partenaire_champs_details()` en base, `CHAMPS_COURSE` dans le code, comparées par `verif-courses-partenaire-details.mjs`). Ne sortent jamais : nets, marges, notes internes (réservation, dossier, client, Mook), traces d'envoi, prix d'origine, nom ou référence d'un autre prestataire.

Rejouer la migration 115 après la 116 rend l'ancienne fonction : relancer alors la 116.

## Créer le compte (Jérémy)

Aucun identifiant ne passe par Claude ni par ce dépôt.

1. Supabase, projet Gestion, **Authentication > Users > Add user > Create new user** : l'e-mail choisi pour Mr. Brown, un mot de passe que tu choisis, « Auto Confirm User » coché.
2. Supabase, **SQL Editor**, en remplaçant l'e-mail :

```sql
-- Crée l'accès partenaire de Mr. Brown. Refuse tout (rien n'est écrit) si le compte n'existe pas, ou si la fiche partenaire
-- « VIP Taxi Lanta » (nom exact) n'existe pas une et une seule fois dans l'entreprise VIP Taxi Lanta. Aucun repli sur une autre fiche.
do $$
declare
  v_user uuid;
  v_fiche uuid;
  v_n integer;
begin
  select user_id into v_user from profils where email = 'EMAIL_DE_MR_BROWN';
  if v_user is null then raise exception 'Compte introuvable : créez-le d''abord (Authentication, Add user).'; end if;
  select count(*), (array_agg(id))[1] into v_n, v_fiche from partenaires
  where entite_id = '00000000-0000-4000-8000-000000000003' and nom = 'VIP Taxi Lanta';
  if v_n <> 1 then raise exception 'Fiche « VIP Taxi Lanta » introuvable sous ce nom exact (ou en double) : rien n''est créé.'; end if;
  -- Rattache le profil à l'organisation de VIP Taxi Lanta (utile s'il existe plusieurs organisations).
  update profils set organisation_id = (select organisation_id from entites where id = '00000000-0000-4000-8000-000000000003')
  where user_id = v_user and organisation_id is null;
  insert into partenaires_acces (user_id, partenaire_id) values (v_user, v_fiche);
end
$$;

-- Contrôle : une ligne, le bon partenaire, aucun accès à une entreprise.
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

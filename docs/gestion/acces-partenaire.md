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

La commission saisie devient la « commission prévue » de la course, marquée « saisie par le partenaire » (`commission_partenaire`, `commission_partenaire_le`). Nani le voit dans la fiche de la course et dans « Commissions à demander ». Si elle la change, la commission redevient la sienne et passe en lecture seule pour lui. Le journal des nets note chaque saisie avec le compte. Cette saisie ne déclenche aucune notification.

## Détail de chaque course (migration 116)

Chaque course montre tout ce qu'imprime la Booking confirmation de Taxi et le voucher de Mook, sauf l'interne. En gros : lieu de prise en charge (et chambre), destination ou aller-retour avec programme et durée, vol ou bateau, personnes (adultes, enfants, bébés, sièges enfant), bagages, véhicule et nombre de véhicules (lu sur la dernière facture, sinon le dernier devis), paiement, prix. En dessous, toujours visibles : hôtel et chambre, point de rendez-vous, zone (son nom seul, jamais la grille de tarifs), retour (date, heure, lieu), remarques, libellé de la course, référence de la réservation et sa propre référence.

Paiement : payé sur place, le chauffeur encaisse le prix de la course ; tout payé, rien ; un acompte sur la seule course réglée d'avance du dossier, le reste dû exact. Un acompte réparti sur plusieurs courses (aller et retour) n'affiche aucun montant : « ลูกค้าจ่ายมัดจำแล้ว ถามยอดที่ต้องเก็บกับ Nani » (acompte versé, demander le montant à Nani).

Ne sortent pas non plus les champs qu'aucun document de Taxi n'imprime (remarques de paiement, caution, conditions, champs d'excursion, de billet ou de location).

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

## Notifications sur son téléphone (migration 123)

Trois notifications en thaï, sur les seules courses de son écran (même règle en base : `partenaire_courses_de`, appelée par `partenaire_courses()` et par la fonction d'envoi) :

| Quand | Ce qu'elle dit | Ce qu'elle ne dit jamais |
|---|---|---|
| Une course de sa liste est créée, ou sa date, son heure, son lieu de prise en charge, sa destination, ses personnes changent, ou elle est annulée, ou elle ne lui est plus confiée | Date, heure, trajet, personnes ; ce qui a changé ; le nom du client seulement pour une nouvelle course | Prix, commission, net, note, référence, et pourquoi une course lui est retirée |
| Le soir, à l'heure de la veille de l'entreprise Taxi (Réglages, rappels, 18 h par défaut) | Nombre de courses de demain, puis l'heure et le trajet de chacune. Rien s'il n'en a aucune | Nom de client |
| Une heure avant chaque prise en charge (passage « h1 », toutes les 5 minutes) | Heure, trajet, personnes | Nom de client |

Une rafale de changements sur une course ne donne qu'une notification : elle part quand la course n'a plus bougé depuis 10 minutes (empreinte dans `partenaires_notifs_courses`). Une course créée puis annulée dans ces 10 minutes ne donne rien. Le premier passage après l'activation enregistre ses courses sans rien envoyer. Une course déjà notifiée qui sort de sa liste sans être annulée (confiée à une autre fiche, passée chez Secret, supprimée), alors que sa date est encore à venir, lui est annoncée à part : « งานนี้ไม่ใช่ของคุณแล้ว » (cette course ne vous est plus confiée), avec la date, l'heure et le trajet. Une course dont la date est effacée sort de son écran : il reçoit « งานนี้ยังไม่กำหนดวัน » (date pas encore fixée) avec la date qu'il avait vue, puis « nouvelle course » quand une date revient. Seules les sorties par la date restent silencieuses : course passée, ou repoussée au-delà de 60 jours. Une course réservée à plus de 60 jours arrive comme « nouvelle » le jour où elle entre dans sa liste. Les frais de parc ne sont jamais notifiés (ils restent sur son écran) : une prestation de la famille « frais », ou, sans tarif ni partenaire, un libellé qui commence par « Frais de parc », « Park fee » ou « National park fee ». Une course qui nomme seulement un parc (« Hotel → Mu Ko Lanta National Park ») est notifiée.

Chaque notification est marquée envoyée **avant** l'envoi, dans la même transaction que la lecture : deux passages qui se chevauchent n'envoient jamais deux fois la même. En échange, un téléphone injoignable à ce moment (réseau Apple ou Google en panne) ne la reçoit pas et elle n'est pas renvoyée ; l'écran, lui, est toujours juste. Les notifications d'une même course remplacent la précédente sur le téléphone et sonnent à chaque fois, avec l'icône de VIP Taxi Lanta.

### Mise en route (Jérémy)

1. Sauvegarde de la base, puis Supabase, **SQL Editor** : `docs/gestion/migration-123-notifications-partenaire.sql` (après les 115, 116 et 119). Retour : `retour-123-notifications-partenaire.sql`.
2. Déployer la fonction **rappels** (elle porte `partenaire.js`) : `supabase functions deploy rappels`. Aucun nouveau cron : elle passe déjà toutes les heures (veille) et toutes les 5 minutes (h1).
3. Fusionner la PR (écran thaï avec le bouton).
4. Sur le téléphone de Mr. Brown, l'app ouverte depuis l'écran d'accueil (obligatoire sur iPhone, l'écran le dit en thaï) : **เปิดการแจ้งเตือน**, puis autoriser. Une notification d'essai s'affiche et le bloc passe à **เปิดการแจ้งเตือนแล้ว ✓**.
5. Contrôle, dans le SQL Editor :

```sql
-- Le téléphone de Mr. Brown est abonné, et ses courses sont suivies (après le passage suivant, 5 minutes au plus).
select (select count(*) from abonnements_push p where p.user_id = a.user_id) as telephones,
       (select count(*) from partenaires_notifs_courses x where x.user_id = a.user_id) as courses_suivies
from partenaires_acces a;
```

La réponse de la fonction (journal Supabase, passage « h1 ») porte un bloc `partenaires` : changements, rappels une heure avant, envois, échecs. Une panne de ce passage (y compris une erreur SQL dans une fonction présente : seule l'absence des objets de la migration 123 vaut « migration absente ») rend le statut 500 avec `partenaires.erreur`. Une panne des changements n'empêche pas le rappel d'une heure avant du même passage (visible dans les exécutions du cron), sans toucher aux envois ni à `rappels_suivi` des membres. Si la lecture des services des membres échoue, le passage du partenaire part quand même.

### Couper les notifications

- Lui-même : le lien discret **ปิดการแจ้งเตือน** sur son écran, puis **ปิด** pour confirmer (retire l'abonnement de ce téléphone), ou les réglages du téléphone.
- Le rappel d'une heure avant seulement : `update profils set rappel_h1 = false where user_id = (select user_id from partenaires_acces);` (ou couper « Rappel 1 h avant » de l'entreprise Taxi, qui le coupe aussi pour l'équipe).
- Le résumé du soir suit l'heure de la veille de l'entreprise Taxi : la couper la coupe aussi pour l'équipe.
- Tout, tout de suite : désactiver le compte ou le partenaire (voir ci-dessous). Au passage suivant, ses empreintes sont effacées et plus rien ne part. Supprimer sa ligne `partenaires_acces` efface tout (cascade).
- Tous ses téléphones : `delete from abonnements_push where user_id = (select user_id from partenaires_acces);`

Rejouer les migrations 116 ou 119, ou leur retour en arrière, rend à `partenaire_courses()` sa forme d'avant : l'écran reste juste, mais la règle n'est plus commune. Relancer alors la 123.

## Couper l'accès

- Tout de suite : Gestion, Administration, Utilisateurs, désactiver le compte. Ou désactiver le partenaire.
- Pour de bon : `delete from partenaires_acces where user_id = (select user_id from profils where email = 'EMAIL_DE_MR_BROWN');`

## Textes thaïs à faire relire

Notifications : `supabase/functions/rappels/partenaire.js` (objet `TH_NOTIF`), bouton de l'écran : `TH.notif_*` dans `courses-partenaire-calc.mjs`. Le français est en commentaire à côté de chaque texte.

Tous dans `src/gestion/js/courses-partenaire-calc.mjs` (objet `TH`, le français en commentaire). À faire relire par Nani ou Mook, surtout :

- `ค่าคอมที่ต้องจ่ายให้ Nani` (commission à payer à Nani) et `รวมทุกงานที่ยังไม่ได้จ่าย` (total des courses pas encore payées) ;
- `งานรับส่งลูกค้า` (titre de l'écran) ;
- `งานที่ผ่านมา ยังไม่ได้จ่ายค่าคอม` (courses passées, commission pas encore payée) ;
- `จ่ายแล้วบางส่วน` (payée en partie) et `จ่ายแล้ว แก้ไม่ได้` (déjà payée, ne se modifie plus).

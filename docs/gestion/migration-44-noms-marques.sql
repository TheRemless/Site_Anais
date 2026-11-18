-- Gestion : migration 44, noms et marques à l'écran (SaaS, 18.11.2026).
-- Plus aucun nom de personne ni de marque d'Anaïs écrit dans le code de l'outil, des documents, des messages et de l'assistant IA.
-- Ces textes viennent désormais des réglages de chaque entreprise (reglages.valeur) ou de l'organisation :
--   * reglages.valeur.responsable = { user_id, prenom, prenom_th } : la personne responsable de l'entreprise. Son prénom remplace « Anaïs »
--     dans « prévenez Anaïs », « envoyer à Anaïs », « WhatsApp d'Anaïs ». Vide : la première administratrice de l'entreprise ;
--   * reglages.valeur.emetteur.licence_libelle / licence_libelle_en : « Licence TAT » / « TAT licence » sur les devis et factures (vide : « Licence ») ;
--   * reglages.valeur.voucher.textes : licence, b_merci, b_signature, b_lieu. Les textes par défaut deviennent neutres (« Licence »,
--     « {ENTREPRISE} Team », pas de lieu) : on enregistre ici ceux d'Anaïs pour que ses vouchers restent identiques mot pour mot ;
--   * reglages.valeur.assistant_voix = { lieu, fr, en } : la voix de l'assistant IA (vide : voix neutre signée du nom de l'entreprise) ;
--   * organisations.libelle_admin : le libellé du rôle d'administration (vide : « Administration de l'organisation »).
-- Pour l'organisation « Zwald Travel Planner » (00000000-0000-0000-0000-00000000a000), la migration remplit les valeurs d'aujourd'hui :
-- rien ne change pour Anaïs. Une valeur déjà enregistrée n'est jamais écrasée. Ne touche à aucune autre organisation.
-- Dépend des migrations 42 (organisations). Ne change aucun droit. Se rejoue sans erreur et sans effet la deuxième fois.
--
-- À lire avant (lecture seule) : le compte qui deviendra « personne responsable » (le prénom affiché est « Anaïs » dans tous les cas).
--   select user_id, nom, email, super_admin, created_at from profils
--   where organisation_id = '00000000-0000-0000-0000-00000000a000' and actif order by super_admin desc, created_at;
-- Et ce que chaque entreprise a déjà (une valeur présente est gardée) :
--   select e.slug, r.valeur -> 'responsable', r.valeur #> '{emetteur,licence_libelle}', r.valeur #> '{voucher,textes}', r.valeur -> 'assistant_voix'
--   from reglages r join entites e on e.id = r.entite_id where e.organisation_id = '00000000-0000-0000-0000-00000000a000';

begin;

-- 1. Libellé du rôle d'administration, par organisation.
alter table organisations add column if not exists libelle_admin text check (libelle_admin is null or length(libelle_admin) between 1 and 60);
update organisations set libelle_admin = 'Administratrice générale'
where id = '00000000-0000-0000-0000-00000000a000' and libelle_admin is null;

-- 2. Valeurs d'Anaïs dans les réglages de ses entreprises (ZTP, Secret, Taxi). `||` : la valeur déjà enregistrée (à droite) l'emporte.
with anais as (
  select user_id from profils
  where organisation_id = '00000000-0000-0000-0000-00000000a000' and actif and super_admin
    and (nom ilike 'ana_s%' or email ilike 'ana_s%')
  order by created_at limit 1
),
cibles as (
  select r.entite_id, r.valeur, coalesce(r.valeur ->> 'fonctionnement', 'sur_mesure') as fon
  from reglages r join entites e on e.id = r.entite_id
  where e.organisation_id = '00000000-0000-0000-0000-00000000a000'
),
calcul as (
  select c.entite_id, c.valeur
  -- Personne responsable : Anaïs.
  || jsonb_build_object('responsable',
       jsonb_build_object('user_id', coalesce((select user_id::text from anais), ''), 'prenom', 'Anaïs', 'prenom_th', 'อานาอิส')
       || coalesce(case when jsonb_typeof(c.valeur -> 'responsable') = 'object' then c.valeur -> 'responsable' end, '{}'::jsonb))
  -- Libellé de licence des devis et factures.
  || jsonb_build_object('emetteur',
       jsonb_build_object('licence_libelle', 'Licence TAT', 'licence_libelle_en', 'TAT licence')
       || coalesce(case when jsonb_typeof(c.valeur -> 'emetteur') = 'object' then c.valeur -> 'emetteur' end, '{}'::jsonb))
  -- Vouchers de Secret et Booking confirmation de Taxi : les textes d'avant, enregistrés (ils étaient les textes par défaut).
  || case when c.fon in ('excursions', 'taxi') then jsonb_build_object('voucher',
       coalesce(case when jsonb_typeof(c.valeur -> 'voucher') = 'object' then c.valeur -> 'voucher' end, '{}'::jsonb)
       || jsonb_build_object('textes',
            jsonb_build_object(
              'licence', 'TAT licence',
              'b_merci', $t$Thank you for choosing VIP TAXI LANTA – we look forward to driving you safely and comfortably to your destination! 🚐✨$t$,
              'b_signature', 'VIP TAXI LANTA Team',
              'b_lieu', 'Koh Lanta, Krabi, Thailand')
            || coalesce(case when jsonb_typeof(c.valeur #> '{voucher,textes}') = 'object' then c.valeur #> '{voucher,textes}' end, '{}'::jsonb)))
     else '{}'::jsonb end
  -- Voix de l'assistant IA : celle d'Anaïs, celle de Taxi signée du nom de l'entreprise ({entreprise}).
  || jsonb_build_object('assistant_voix',
       jsonb_build_object(
         'lieu', 'Koh Lanta (Thaïlande)',
         'fr', case when c.fon = 'taxi' then $v$Tu écris pour {entreprise}, un service de taxi privé à Koh Lanta, qui répond à chaque client sur WhatsApp. Elle vouvoie toujours, même chaleureuse.
Ouverture « Bonjour Prénom, » puis un merci pour le message, avec un 😊. Phrases concrètes, « nous » plutôt que « je ».
Un ou deux emoji par paragraphe au plus (😊 🌴 ✈️), jamais en rafale. Les services en liste, une ligne chacun avec une flèche → ou un emoji.
Pas de superlatif touristique (paradisiaque, inoubliable, authentique), pas de pression commerciale, pas de « la magie de la Thaïlande ».
Quand une information manque, elle la demande simplement. Elle termine par « N'hésitez pas à me répondre directement ici » ou « Au plaisir d'échanger avec vous », puis « Belle journée, {entreprise} ».$v$ else $v$Tu écris comme Anaïs, qui vit à Koh Lanta et répond elle-même à chaque client sur WhatsApp. Elle vouvoie toujours, même chaleureuse.
Ouverture « Bonjour Prénom, » puis un merci pour le message, avec un 😊. Phrases concrètes, beaucoup de « je » (« je vous propose », « je m'en occupe »).
Un ou deux emoji par paragraphe au plus (😊 🌴 ✈️), jamais en rafale. Les services en liste, une ligne chacun avec une flèche → ou un emoji.
Pas de superlatif touristique (paradisiaque, inoubliable, authentique), pas de pression commerciale, pas de « la magie de la Thaïlande ».
Quand une information manque, elle la demande simplement. Elle termine par « N'hésitez pas à me répondre directement ici » ou « Au plaisir d'échanger avec vous », puis « Belle journée, Anaïs ».$v$ end,
         'en', case when c.fon = 'taxi' then $v$You write for {entreprise}, a private taxi service on Koh Lanta, answering each guest on WhatsApp: warm, short, practical, in plain English.
Open with "Hello Firstname," and a thank-you for the message, with a 😊. One or two emoji per paragraph at most (😊 🌴), never in bursts.
List the services one per line with a → or an emoji, each with its date and price. No tourist superlatives (paradise, unforgettable, authentic), no sales pressure.
When something is missing (hotel, pickup time, number of people), ask for it simply. End with a short line inviting them to reply here, then "Have a nice day, {entreprise}".$v$ else $v$You write as Anaïs, who lives on Koh Lanta and answers each guest herself on WhatsApp: warm, short, practical, in plain English.
Open with "Hello Firstname," and a thank-you for the message, with a 😊. One or two emoji per paragraph at most (😊 🌴), never in bursts.
List the services one per line with a → or an emoji, each with its date and price. No tourist superlatives (paradise, unforgettable, authentic), no sales pressure.
When something is missing (hotel, pickup time, number of people), ask for it simply. End with a short line inviting them to reply here, then "Have a lovely day, Anaïs".$v$ end)
       || coalesce(case when jsonb_typeof(c.valeur -> 'assistant_voix') = 'object' then c.valeur -> 'assistant_voix' end, '{}'::jsonb))
    as nouvelle
  from cibles c
)
-- Seules les entreprises dont les réglages changent sont écrites (le journal ne voit rien au deuxième passage).
update reglages r set valeur = k.nouvelle
from calcul k
where r.entite_id = k.entite_id and r.valeur is distinct from k.nouvelle;

commit;

-- Gestion : migration 44, noms et marques à l'écran (SaaS, 18.11.2026, revue du 18.11.2026 comprise).
-- Plus aucun nom de personne ni de marque d'Anaïs écrit dans le code de l'outil, des documents, des messages et de l'assistant IA.
-- Ces textes viennent désormais des réglages de chaque entreprise (reglages.valeur) ou de l'organisation :
--   * reglages.valeur.responsable = { user_id, prenom, prenom_th } : la personne responsable de l'entreprise. Son prénom remplace « Anaïs »
--     dans « prévenez Anaïs », « envoyer à Anaïs », « WhatsApp d'Anaïs ». Vide : la première administratrice de l'entreprise ;
--   * reglages.valeur.emetteur.licence_libelle / licence_libelle_en : « Licence TAT » / « TAT licence » (vide : « Licence ») ;
--   * reglages.valeur.voucher.textes : licence, b_merci, b_signature, b_lieu. Les textes par défaut deviennent neutres ;
--   * reglages.valeur.assistant_voix = { lieu, fr, en } : la voix de l'assistant IA (vide : voix neutre signée du nom de l'entreprise) ;
--   * reglages.valeur.apparence.logo et voucher.bandeau : plus d'image de marque par défaut dans le code ;
--   * reglages.valeur.messages : les messages types par défaut perdent « Koh Lanta » ; ZTP, qui n'en a aucun d'enregistré, reçoit ceux d'avant ;
--   * organisations.libelle_admin : le libellé du rôle d'administration (vide : « Administration de l'organisation »), modifiable par
--     l'administration de l'organisation.
-- Pour l'organisation « Zwald Travel Planner » (…a000), la migration enregistre les valeurs d'aujourd'hui : rien ne change pour Anaïs.
-- Une valeur déjà enregistrée et non vide n'est jamais écrasée. Une valeur vide ("", {}, null), par exemple écrite par l'outil déployé
-- avant la migration, compte comme absente. Ne touche à aucune autre organisation. Dépend de la migration 42. Se rejoue sans effet.
--
-- Relevé en production (lecture seule, 18.11.2026) : le compte d'Anaïs est le profil 1b7ea0fd-cad0-44a8-bf1d-4a004478bb71 (nom vide) ;
-- ZTP n'a aucun message enregistré ; Secret et Taxi ont les leurs ; Taxi a son logo mais pas de photo de bandeau.
-- À relire avant (lecture seule) :
--   select e.slug, r.valeur -> 'responsable', r.valeur #> '{emetteur,licence_libelle}', jsonb_typeof(r.valeur -> 'messages'),
--          r.valeur #> '{apparence,logo}', r.valeur #> '{voucher,bandeau}', r.valeur -> 'assistant_voix'
--   from reglages r join entites e on e.id = r.entite_id where e.organisation_id = '00000000-0000-0000-0000-00000000a000';

begin;

-- 1. Libellé du rôle d'administration, par organisation, modifiable par son administration (comme le nom, le fuseau et la langue).
alter table organisations add column if not exists libelle_admin text check (libelle_admin is null or length(libelle_admin) between 1 and 60);
grant update (libelle_admin) on organisations to authenticated;
update organisations set libelle_admin = 'Administratrice générale'
where id = '00000000-0000-0000-0000-00000000a000' and libelle_admin is null;

-- 2. Outils de la migration (session seulement).
-- Valeur absente : manquante, null, "" ou {}.
create or replace function pg_temp.vide(v jsonb) returns boolean language sql immutable as $$
  select v is null or v in ('null'::jsonb, '""'::jsonb, '{}'::jsonb)
$$;
-- L'objet « actuel » complété : chaque clé de « defaut » absente ou vide dans « actuel » en prend la valeur, le reste d'« actuel » est gardé.
create or replace function pg_temp.completer(actuel jsonb, defaut jsonb) returns jsonb language sql immutable as $$
  select coalesce(case when jsonb_typeof(actuel) = 'object' then actuel end, '{}'::jsonb)
    || coalesce((select jsonb_object_agg(d.key, d.value) from jsonb_each(defaut) d
                 where pg_temp.vide(case when jsonb_typeof(actuel) = 'object' then actuel -> d.key end)), '{}'::jsonb)
$$;

-- 3. Valeurs d'Anaïs dans les réglages de ses entreprises (ZTP, Secret, Taxi).
with cibles as (
  select r.entite_id, r.valeur, coalesce(nullif(r.valeur ->> 'fonctionnement', ''), 'sur_mesure') as fon
  from reglages r join entites e on e.id = r.entite_id
  where e.organisation_id = '00000000-0000-0000-0000-00000000a000'
),
etape1 as (
  select c.entite_id, c.valeur, c.fon,
    -- Chaque bloc est complété (sa valeur non vide gardée), puis remplace l'ancien.
    c.valeur || jsonb_build_object(
      -- Personne responsable : Anaïs (son compte, relevé en production).
      'responsable', pg_temp.completer(c.valeur -> 'responsable', jsonb_build_object(
        'user_id', coalesce((select user_id::text from profils where user_id = '1b7ea0fd-cad0-44a8-bf1d-4a004478bb71'
                             and organisation_id = '00000000-0000-0000-0000-00000000a000'), ''),
        'prenom', 'Anaïs', 'prenom_th', 'อานาอิส')),
      -- Libellé de licence des devis et factures.
      'emetteur', pg_temp.completer(c.valeur -> 'emetteur', jsonb_build_object('licence_libelle', 'Licence TAT', 'licence_libelle_en', 'TAT licence')),
      -- Voix de l'assistant IA : celle d'Anaïs ; celle de Taxi signée du nom de l'entreprise ({entreprise}).
      'assistant_voix', pg_temp.completer(c.valeur -> 'assistant_voix', jsonb_build_object(
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
When something is missing (hotel, pickup time, number of people), ask for it simply. End with a short line inviting them to reply here, then "Have a lovely day, Anaïs".$v$ end))
    ) as v1
  from cibles c
),
etape2 as (
  select e.entite_id, e.valeur,
    case when e.fon in ('excursions', 'taxi') then
      -- Vouchers de Secret et Booking confirmation de Taxi : textes, logo et photo d'avant (ils étaient les valeurs par défaut du code).
      e.v1
      || jsonb_build_object('apparence', pg_temp.completer(e.v1 -> 'apparence', jsonb_build_object('logo',
           case when e.fon = 'taxi' then 'assets/logo-vip-taxi.webp' else 'assets/logo-secret.png' end)))
      || jsonb_build_object('voucher', pg_temp.completer(e.v1 -> 'voucher', jsonb_build_object('bandeau',
           case when e.fon = 'taxi' then 'assets/taxi-bandeau.webp' else 'assets/secret-bandeau.webp' end))
         || jsonb_build_object('textes', pg_temp.completer(e.v1 #> '{voucher,textes}', jsonb_build_object(
              'licence', 'TAT licence',
              'b_merci', $t$Thank you for choosing VIP TAXI LANTA – we look forward to driving you safely and comfortably to your destination! 🚐✨$t$,
              'b_signature', 'VIP TAXI LANTA Team',
              'b_lieu', 'Koh Lanta, Krabi, Thailand'))))
    else e.v1 end as v2
  from etape1 e
),
calcul as (
  select e.entite_id, e.valeur,
    case
      -- Aucun message enregistré (ZTP) : les messages types d'avant, mot pour mot.
      when jsonb_typeof(e.v2 -> 'messages') is distinct from 'array' then e.v2 || jsonb_build_object('messages', $m$[{"id": "confirmation-fr", "pour": "client", "cle": "confirmation", "titre": "Confirmation au client", "langue": "fr", "corps": "Bonjour {prenom},\n\nVotre réservation est confirmée :\n• {prestation}\n• Date : {date}\n• {personnes}\n• Prise en charge : {hotel}{a_heure}\n\nSi quelque chose change, écrivez-nous ici. Merci d'avoir réservé avec {entreprise}, à très bientôt !\n{telephone}"}, {"id": "confirmation-en", "pour": "client", "cle": "confirmation", "titre": "Confirmation to the client", "langue": "en", "corps": "Hello {prenom},\n\nYour booking is confirmed:\n• {prestation}\n• Date: {date}\n• {personnes}\n• Pickup: {hotel}{a_heure}\n\nIf anything changes, just message us here. Thank you for booking with {entreprise}, see you soon!\n{telephone}"}, {"id": "rappel-fr", "pour": "client", "cle": "rappel", "titre": "Rappel de la veille", "langue": "fr", "corps": "Bonjour {prenom},\n\nPetit rappel pour demain : {prestation}.\nPrise en charge à {heure} à {hotel}. Merci d'être prêt quelques minutes avant, avec votre voucher sur votre téléphone.\nPensez à l'eau, à la crème solaire et à des espèces pour les éventuels frais de parc national.\n\nBonne journée,\n{entreprise}"}, {"id": "rappel-en", "pour": "client", "cle": "rappel", "titre": "Reminder for tomorrow", "langue": "en", "corps": "Hello {prenom},\n\nA quick reminder for tomorrow: {prestation}.\nPickup at {heure} from {hotel}. Please be ready a few minutes early, with your voucher on your phone.\nBring water, sunscreen and some cash for any national park fees.\n\nHave a great day,\n{entreprise}"}, {"id": "avis-fr", "pour": "client", "cle": "avis", "titre": "Demande d'avis après le voyage", "langue": "fr", "corps": "Bonjour {prenom},\n\nNous espérons que {prestation} vous a plu ! Si vous avez deux minutes, un avis Google nous aiderait beaucoup :\n{lien_avis}\nMerci d'avance.\n\nÀ bientôt à Koh Lanta,\n{entreprise}"}, {"id": "avis-en", "pour": "client", "cle": "avis", "titre": "Review request after the trip", "langue": "en", "corps": "Hello {prenom},\n\nWe hope you enjoyed {prestation}! If you have two minutes, a Google review would help us a lot:\n{lien_avis}\nThank you in advance.\n\nSee you again in Koh Lanta,\n{entreprise}"}, {"id": "meteo-fr", "pour": "client", "cle": "meteo", "titre": "Météo, report ou annulation", "langue": "fr", "corps": "Bonjour {prenom},\n\nLa météo du {date} ne permet pas de maintenir {prestation} en toute sécurité. Nous pouvons reporter à une autre date ou vous rembourser intégralement. Dites-nous ce que vous préférez.\n\nDésolés pour ce contretemps,\n{entreprise}"}, {"id": "meteo-en", "pour": "client", "cle": "meteo", "titre": "Weather, postponement or cancellation", "langue": "en", "corps": "Hello {prenom},\n\nThe weather on {date} does not allow us to run {prestation} safely. We can move it to another date or refund you in full. Let us know what you prefer.\n\nSorry for the inconvenience,\n{entreprise}"}, {"id": "reponse-fr", "pour": "client", "cle": "reponse", "titre": "Réponse à une demande", "langue": "fr", "corps": "{bonjour}\n\nMerci pour votre message. Voici ce que nous pouvons vous proposer :\n\n{services}\n\nTotal : {total}\n\nSouhaitez-vous que je réserve ?\n{entreprise}"}, {"id": "reponse-en", "pour": "client", "cle": "reponse", "titre": "Reply to a request", "langue": "en", "corps": "{bonjour}\n\nThank you for your message. Here is what we can offer:\n\n{services}\n\nTotal: {total}\n\nWould you like me to book it?\n{entreprise}"}, {"id": "envoi-devis-fr", "pour": "client", "cle": "envoi_devis", "titre": "Envoi du devis", "langue": "fr", "corps": "{bonjour} voici votre devis {numero}."}, {"id": "envoi-facture-fr", "pour": "client", "cle": "envoi_facture", "titre": "Envoi de la facture", "langue": "fr", "corps": "{bonjour} voici votre facture {numero}."}, {"id": "objet-devis-fr", "pour": "client", "cle": "objet_devis", "titre": "Objet de l'e-mail du devis", "langue": "fr", "corps": "Votre devis {numero}"}, {"id": "objet-facture-fr", "pour": "client", "cle": "objet_facture", "titre": "Objet de l'e-mail de la facture", "langue": "fr", "corps": "Votre facture {numero}"}, {"id": "envoi-devis-en", "pour": "client", "cle": "envoi_devis", "titre": "Sending the quote", "langue": "en", "corps": "{bonjour} here is your quote {numero}."}, {"id": "envoi-facture-en", "pour": "client", "cle": "envoi_facture", "titre": "Sending the invoice", "langue": "en", "corps": "{bonjour} here is your invoice {numero}."}, {"id": "objet-devis-en", "pour": "client", "cle": "objet_devis", "titre": "Email subject for the quote", "langue": "en", "corps": "Your quote {numero}"}, {"id": "objet-facture-en", "pour": "client", "cle": "objet_facture", "titre": "Email subject for the invoice", "langue": "en", "corps": "Your invoice {numero}"}, {"id": "renvoi-facture-fr", "pour": "client", "cle": "renvoi_facture", "titre": "Renvoi de la facture mise à jour", "langue": "fr", "corps": "{bonjour} voici votre facture {numero} mise à jour. Elle remplace celle envoyée plus tôt."}, {"id": "objet-renvoi-facture-fr", "pour": "client", "cle": "objet_renvoi_facture", "titre": "Objet de l'e-mail de la facture mise à jour", "langue": "fr", "corps": "Votre facture {numero} mise à jour"}, {"id": "renvoi-facture-en", "pour": "client", "cle": "renvoi_facture", "titre": "Sending the updated invoice", "langue": "en", "corps": "{bonjour} here is your updated invoice {numero}. It replaces the one we sent earlier."}, {"id": "objet-renvoi-facture-en", "pour": "client", "cle": "objet_renvoi_facture", "titre": "Email subject for the updated invoice", "langue": "en", "corps": "Your updated invoice {numero}"}, {"id": "partenaire-en", "pour": "partenaire", "cle": "partenaire", "titre": "Booking request", "langue": "en", "corps": "Hello {partenaire},\n\nBooking request from {entreprise}:\n• {prestation}\n• Date: {date}\n• {personnes}\n• Pickup: {hotel}{a_heure}\n• Guest: {client}\n• Our ref: {reference}\n\nCould you please confirm availability and the pickup time? Thank you!"}, {"id": "relance-en", "pour": "partenaire", "cle": "relance", "titre": "Follow-up, no answer yet", "langue": "en", "corps": "Hello {partenaire},\n\nJust following up on our booking request {reference}: {prestation} on {date}, {personnes}, guest {client}.\nCould you confirm? Thank you!"}, {"id": "modification-en", "pour": "partenaire", "cle": "modification", "titre": "Change on a booking", "langue": "en", "corps": "Hello {partenaire},\n\nChange on our booking {reference} ({client}):\n• {prestation}\n• Date: {date}\n• {personnes}\n• Pickup: {hotel}{a_heure}\n\nPlease confirm the change. Thank you!"}, {"id": "annulation-en", "pour": "partenaire", "cle": "annulation", "titre": "Cancellation", "langue": "en", "corps": "Hello {partenaire},\n\nPlease cancel our booking {reference}: {prestation} on {date}, guest {client}.\nSorry for the inconvenience, and thank you!"}, {"id": "partenaire-th", "pour": "partenaire", "cle": "partenaire", "titre": "ขอจอง (à relire)", "langue": "th", "corps": "สวัสดีค่ะ {partenaire}\n\nขอจองจาก {entreprise} ค่ะ\n• {prestation}\n• วันที่ {date}\n• {personnes}\n• รับที่ {hotel}{a_heure}\n• ชื่อลูกค้า: {client}\n• เลขอ้างอิง: {reference}\n\nรบกวนยืนยันที่ว่างและเวลารับด้วยนะคะ ขอบคุณค่ะ"}, {"id": "relance-th", "pour": "partenaire", "cle": "relance", "titre": "ติดตามการจอง (à relire)", "langue": "th", "corps": "สวัสดีค่ะ {partenaire}\n\nขอติดตามการจอง {reference} ค่ะ: {prestation} วันที่ {date} {personnes} ลูกค้า {client}\nรบกวนยืนยันด้วยนะคะ ขอบคุณค่ะ"}, {"id": "modification-th", "pour": "partenaire", "cle": "modification", "titre": "แก้ไขการจอง (à relire)", "langue": "th", "corps": "สวัสดีค่ะ {partenaire}\n\nขอแก้ไขการจอง {reference} ({client}) ค่ะ\n• {prestation}\n• วันที่ {date}\n• {personnes}\n• รับที่ {hotel}{a_heure}\n\nรบกวนยืนยันการแก้ไขด้วยนะคะ ขอบคุณค่ะ"}, {"id": "annulation-th", "pour": "partenaire", "cle": "annulation", "titre": "ยกเลิกการจอง (à relire)", "langue": "th", "corps": "สวัสดีค่ะ {partenaire}\n\nขอยกเลิกการจอง {reference} ค่ะ: {prestation} วันที่ {date} ลูกค้า {client}\nขออภัยในความไม่สะดวกนะคะ ขอบคุณค่ะ"}]$m$::jsonb)
      -- Messages enregistrés par l'outil déployé avant la migration, avec les nouveaux textes neutres de l'avis : ceux d'avant.
      else e.v2 || jsonb_build_object('messages', coalesce((
        select jsonb_agg(case
          when m ->> 'id' = 'avis-fr' and m ->> 'corps' = $n$Bonjour {prenom},

Nous espérons que {prestation} vous a plu ! Si vous avez deux minutes, un avis Google nous aiderait beaucoup :
{lien_avis}
Merci d'avance.

À bientôt,
{entreprise}$n$ then jsonb_set(m, '{corps}', to_jsonb($a$Bonjour {prenom},

Nous espérons que {prestation} vous a plu ! Si vous avez deux minutes, un avis Google nous aiderait beaucoup :
{lien_avis}
Merci d'avance.

À bientôt à Koh Lanta,
{entreprise}$a$::text))
          when m ->> 'id' = 'avis-en' and m ->> 'corps' = $n$Hello {prenom},

We hope you enjoyed {prestation}! If you have two minutes, a Google review would help us a lot:
{lien_avis}
Thank you in advance.

Hope to see you again,
{entreprise}$n$ then jsonb_set(m, '{corps}', to_jsonb($a$Hello {prenom},

We hope you enjoyed {prestation}! If you have two minutes, a Google review would help us a lot:
{lien_avis}
Thank you in advance.

See you again in Koh Lanta,
{entreprise}$a$::text))
          else m end order by o)
        from jsonb_array_elements(e.v2 -> 'messages') with ordinality as x(m, o)), '[]'::jsonb))
    end as nouvelle
  from etape2 e
)
-- Seules les entreprises dont les réglages changent sont écrites (le journal et l'historique ne voient rien au deuxième passage).
update reglages r set valeur = k.nouvelle
from calcul k
where r.entite_id = k.entite_id and r.valeur is distinct from k.nouvelle;

commit;

-- Secret Travel & Tour : messages « envoi du voucher » (confirmation-en) et « avis » (avis-en) dans le style de ceux de VIP Taxi Lanta.
-- Textes à faire approuver par Jérémy avant passage. Idempotent : remplace le corps des deux modèles par leur id, ne touche à rien d'autre.
-- Secret n'a pas un seul mode de paiement (chez nous, au quai, au chauffeur) : le message renvoie aux cases de paiement du voucher.
begin;
update reglages set valeur = jsonb_set(valeur, '{messages}', (
  select jsonb_agg(case m->>'id'
    when 'confirmation-en' then m || jsonb_build_object('titre', 'Voucher sent', 'corps', 'Thank you for booking with Secret Travel & Tour. ✨

Please find your voucher attached and keep it on your phone for the day of your activity.
Let us know if everything is correct.

How to pay is written on your voucher.

If anything changes, please let us know as soon as possible.

Have a nice day ☀️
Secret Travel & Tour 🌴')
    when 'avis-en' then m || jsonb_build_object('titre', 'Review request the day after', 'corps', 'Thank you again for choosing Secret Travel & Tour.

We hope you had a great time and that everything went well.

If you were happy with our service, we would really appreciate a review on Google. It helps us a lot and lets other travelers find us 😊 ✨

You can leave your review here:
{lien_avis}

Thank you for your trust, and we hope to see you again on Koh Lanta!

Have a lovely trip ✨🌴
Secret Travel & Tour')
    else m end order by i)
  from jsonb_array_elements(valeur->'messages') with ordinality as t(m, i))), updated_at = now()
where entite_id = '00000000-0000-4000-8000-000000000002' and jsonb_typeof(valeur->'messages') = 'array';
select m->>'id' as id, m->>'corps' as corps from reglages, jsonb_array_elements(valeur->'messages') m where entite_id = '00000000-0000-4000-8000-000000000002' and m->>'id' in ('confirmation-en', 'avis-en');
commit;

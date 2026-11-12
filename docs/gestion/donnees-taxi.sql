-- VIP Taxi Lanta dans Gestion (12.11.2026) : réglages, droits, membres et catalogue de l'entreprise « taxi ».
-- Idempotent : relancer donne le même résultat. Rien n'est supprimé. Le catalogue est COPIÉ depuis Secret (lecture des lignes en base,
-- aucun prix ni net écrit ici) : les trajets de VIP Taxi Lanta restent aussi dans Secret, pour les dossiers qui les combinent à des excursions.
-- Chaque copie garde l'identifiant de sa source dans details.copie_de : le contrôle des prix compare les deux.
begin;

-- 1. Réglages : mode taxi, THB, coordonnées du modèle de Booking confirmation, lien d'avis, logo, messages types.
--    Les autres clés déjà en base sont gardées ; apparence garde ses couleurs, seul le logo est posé.
update reglages set
  valeur = valeur || '{"fonctionnement":"taxi","devise":"THB","emetteur":{"nom":"VIP Taxi Lanta","sous_titre":"by Mr. Brown","adresse":"Koh Lanta, Krabi, Thailand","telephone":"+66 95 868 38 46","contact":"+66 95 868 38 46\nviptaxilanta@outlook.com","lien_avis":"https://g.page/r/CWNKOXzQIRddEBM/review","licence":""},"voucher":{"nom":"VIP Taxi Lanta","whatsapp":"+66 95 868 38 46","email":"viptaxilanta@outlook.com","adresse":"Koh Lanta, Krabi, Thailand","licence":""},"libelles":{"devis":"QUOTE","facture":"INVOICE","facture_locale":"","ref_devis":"Quote: ref.","ref_facture":"Invoice: ref.","date_emission":"Date of issue:","unite":"UNIT","qte":"QTY","total":"TOTAL","colonne_montant":"","total_final":"","sous_total":"SUBTOTAL","remise":"Discount","montant_recu":"Amount received","equivalent":"Indicative equivalent:","conditions":"PAYMENT TERMS","signature_1":"FULL NAME, DATE AND SIGNATURE OF THE CLIENT","signature_2":"preceded by the words “Approved”","coordonnees":"CONTACT","infos_paiement":"PAYMENT DETAILS","pied_court":"see the payment instructions sent by e-mail.","qr_titre":"","facture_a":"","prestataire":"Service provider:","note_devise":"","pied_note":"","cgv":"The client acknowledges having read the [Terms and Conditions]({cgv_url}) of {entreprise} and accepts them in full. Signing this quote constitutes acceptance of the Terms and Conditions and a binding commitment."},"messages":[{"id":"taxi-confirmation-en","pour":"client","cle":"confirmation","titre":"Booking confirmation sent","langue":"en","corps":"Thank you for choosing VIP TAXI LANTA. ✨\n\nPlease see the attached confirmation and show it to the driver at pick-up.\nLet us know if everything is correct\n\nPayment will be collected in cash directly by the driver (or you can pay through Wise before your transfer (3% fee), please let us know before.)\n\nIf you have any changes, please inform us as soon as possible.\n\nHave a nice day ☀️\nVIP TAXI LANTA 🌴"},{"id":"taxi-avis-en","pour":"client","cle":"avis","titre":"Review request the day after","langue":"en","corps":"Thank you again for choosing VIP TAXI LANTA today.\n\nWe hope you had a comfortable journey and that everything went smoothly with the driver and the transfer.\n\nIf you were satisfied with our service, we would truly appreciate it if you could leave us a review on Google. It really helps us grow and allows other travelers to discover our service 😊 ✨\n\nYou can leave your review here:\n{lien_avis}\n\nThank you very much for your trust, and we hope to drive you again in the future!\n\nSafe travels ✨🌴\nVIP TAXI LANTA by Mr. Brown"},{"id":"taxi-partenaire-en","pour":"partenaire","cle":"partenaire","titre":"New transfer","langue":"en","corps":"Hello {contact},\n\nNew transfer:\n• {prestation}\n• Date: {date}\n• Pickup: {hotel}{a_heure}\n• Drop-off: {dropoff}\n• {personnes}\n• Guest: {client}\n• Price: {prix}, paid to the driver\n• Ref: {reference}\n\nCan you confirm? Thank you 🙏"},{"id":"taxi-relance-en","pour":"partenaire","cle":"relance","titre":"Follow-up, no answer yet","langue":"en","corps":"Hello {contact},\n\nJust checking on transfer {reference}: {prestation} on {date}, {personnes}, guest {client}.\nCan you confirm? Thank you 🙏"},{"id":"taxi-modification-en","pour":"partenaire","cle":"modification","titre":"Change on a transfer","langue":"en","corps":"Hello {contact},\n\nChange on transfer {reference} ({client}):\n• {prestation}\n• Date: {date}\n• Pickup: {hotel}{a_heure}\n• Drop-off: {dropoff}\n• {personnes}\n\nCan you confirm the change? Thank you 🙏"},{"id":"taxi-annulation-en","pour":"partenaire","cle":"annulation","titre":"Cancellation","langue":"en","corps":"Hello {contact},\n\nPlease cancel transfer {reference}: {prestation} on {date}, guest {client}.\nSorry for the change, thank you 🙏"},{"id":"taxi-commission-en","pour":"partenaire","cle":"commission","titre":"Commission for yesterday''s transfer","langue":"en","corps":"Hello {contact},\n\nAbout yesterday''s transfer: {prestation} on {date}, guest {client} ({prix}).\nHow much is the commission for this one?\n\nThank you 🙏"},{"id":"taxi-partenaire-th","pour":"partenaire","cle":"partenaire","titre":"งานใหม่ (à relire)","langue":"th","corps":"สวัสดีค่ะ {contact}\n\nมีงานรับส่งใหม่ค่ะ\n• {prestation}\n• วันที่ {date}\n• รับที่: {hotel}{a_heure}\n• ส่งที่: {dropoff}\n• {personnes}\n• ลูกค้า: {client}\n• ราคา: {prix} ลูกค้าจ่ายคนขับ\n• เลขอ้างอิง: {reference}\n\nช่วยยืนยันด้วยนะคะ ขอบคุณค่ะ 🙏"},{"id":"taxi-relance-th","pour":"partenaire","cle":"relance","titre":"ติดตามงาน (à relire)","langue":"th","corps":"สวัสดีค่ะ {contact}\n\nขอติดตามงาน {reference} ค่ะ: {prestation} วันที่ {date} {personnes} ลูกค้า {client}\nช่วยยืนยันด้วยนะคะ ขอบคุณค่ะ 🙏"},{"id":"taxi-modification-th","pour":"partenaire","cle":"modification","titre":"แก้ไขงาน (à relire)","langue":"th","corps":"สวัสดีค่ะ {contact}\n\nขอแก้ไขงาน {reference} ({client}) ค่ะ\n• {prestation}\n• วันที่ {date}\n• รับที่: {hotel}{a_heure}\n• ส่งที่: {dropoff}\n• {personnes}\n\nช่วยยืนยันด้วยนะคะ ขอบคุณค่ะ 🙏"},{"id":"taxi-annulation-th","pour":"partenaire","cle":"annulation","titre":"ยกเลิกงาน (à relire)","langue":"th","corps":"สวัสดีค่ะ {contact}\n\nขอยกเลิกงาน {reference} ค่ะ: {prestation} วันที่ {date} ลูกค้า {client}\nขอโทษด้วยนะคะ ขอบคุณค่ะ 🙏"},{"id":"taxi-commission-th","pour":"partenaire","cle":"commission","titre":"ค่าคอมมิชชั่นงานเมื่อวาน (à relire)","langue":"th","corps":"สวัสดีค่ะ {contact}\n\nงานเมื่อวาน: {prestation} วันที่ {date} ลูกค้า {client} ({prix})\nค่าคอมมิชชั่นงานนี้เท่าไหร่คะ\n\nขอบคุณค่ะ 🙏"},{"id":"reponse-en","pour":"client","cle":"reponse","titre":"Reply to a request","langue":"en","corps":"{bonjour}\n\nThank you for your message. Here is what we can offer:\n\n{services}\n\nTotal: {total}\n\nWould you like me to book it?\n{entreprise}"}]}'::jsonb
    || jsonb_build_object('apparence', coalesce(valeur->'apparence', '{}'::jsonb) || '{"logo": "assets/logo-vip-taxi.webp"}'::jsonb),
  updated_at = now()
where entite_id = '00000000-0000-4000-8000-000000000003';

-- 2. Droits : le rôle Éditeur de Taxi reprend exactement les permissions du rôle Éditeur de Secret.
update roles t set permissions = s.permissions
from roles s
where t.entite_id = '00000000-0000-4000-8000-000000000003' and t.nom = 'Éditeur' and t.systeme
  and s.entite_id = '00000000-0000-4000-8000-000000000002' and s.nom = 'Éditeur' and s.systeme
  and t.permissions is distinct from s.permissions;

-- 3. Membres : chaque membre de Secret entre dans Taxi avec le rôle du même nom (Anaïs passe par l'administration générale).
insert into membres (user_id, entite_id, role_id)
select m.user_id, '00000000-0000-4000-8000-000000000003', rt.id
from membres m
join roles rs on rs.id = m.role_id
join roles rt on rt.entite_id = '00000000-0000-4000-8000-000000000003' and rt.nom = rs.nom
where m.entite_id = '00000000-0000-4000-8000-000000000002'
on conflict (user_id, entite_id) do nothing;

-- 4. Partenaire : VIP Taxi Lanta (Mr. Brown) dans Taxi, payé sur place, sans règle de commission (décidée course par course).
insert into partenaires (id, entite_id, nom, nom_thai, categorie, groupe, role, contact, regles, contrat, notes, ordre, actif)
select md5('taxi-copie:' || p.id::text)::uuid, '00000000-0000-4000-8000-000000000003', p.nom, p.nom_thai, p.categorie, p.groupe, p.role,
  p.contact || '{"personne": "Mr. Brown"}'::jsonb,
  (p.regles - 'commission') || '{"mode_reglement": "sur_place"}'::jsonb,
  p.contrat, p.notes, 1, true
from partenaires p where p.id = 'd03d7b49-c5ef-58d8-a549-964a3d195ae6'
on conflict (id) do update set nom = excluded.nom, contact = excluded.contact, regles = excluded.regles, notes = excluded.notes, updated_at = now();

-- 5. Prestations : copie des tarifs de VIP Taxi Lanta (prix de vente, unité, notes : prix pour 1 à 2 clients, bac compris jusqu'à
--    4 personnes puis 60 ฿ dès la 5e, siège bébé offert). Pas de net ni de commission copiés. Une copie existante reprend le prix de Secret.
insert into prestations (id, entite_id, partenaire_id, famille, groupe, libelle, libelle_en, details, prix_vente, unite, sur_place, ordre, actif)
select md5('taxi-copie:' || p.id::text)::uuid, '00000000-0000-4000-8000-000000000003', md5('taxi-copie:' || p.partenaire_id::text)::uuid, p.famille, p.groupe, p.libelle, p.libelle_en,
  p.details || jsonb_build_object('copie_de', p.id::text), p.prix_vente, p.unite, p.sur_place, p.ordre, p.actif
from prestations p where p.partenaire_id = 'd03d7b49-c5ef-58d8-a549-964a3d195ae6'
on conflict (id) do update set famille = excluded.famille, groupe = excluded.groupe, libelle = excluded.libelle, libelle_en = excluded.libelle_en,
  details = excluded.details, prix_vente = excluded.prix_vente, unite = excluded.unite, actif = excluded.actif, updated_at = now();

-- Contrôle : ce que Taxi contient après coup.
select (select valeur->>'fonctionnement' from reglages where entite_id = '00000000-0000-4000-8000-000000000003') as fonctionnement,
  (select count(*) from membres where entite_id = '00000000-0000-4000-8000-000000000003') as membres,
  (select count(*) from partenaires where entite_id = '00000000-0000-4000-8000-000000000003') as partenaires,
  (select count(*) from prestations where entite_id = '00000000-0000-4000-8000-000000000003') as prestations,
  (select count(*) from prestations t join prestations s on s.id::text = t.details->>'copie_de' where t.entite_id = '00000000-0000-4000-8000-000000000003' and t.prix_vente is distinct from s.prix_vente) as prix_differents;
commit;

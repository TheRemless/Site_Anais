-- Gestion : décision 3 de Jérémy (17.11.2026). Mook, dans Secret, ne modifie plus un prix de vente ni ne supprime un partenaire.
-- À passer APRÈS la migration 38 (qui crée le droit « partenaires.prix » et le donne à tout rôle qui modifie les partenaires).
--
-- Rôle visé : « Éditeur + factures fiduciaire » de l'entreprise « secret », celui de Mook (relevé en lecture seule le 17.11.2026 : une personne,
-- droits catalogue.ecrire, clients.ecrire, clients.lire, documents.ecrire, dossiers.ecrire, dossiers.lire, fiduciaire.preparer, finances.voir,
-- partenaires.ecrire, partenaires.lire, taches.ecrire). Il n'a pas « partenaires.supprimer » : la migration 33 ne le donne qu'aux Administrateurs.
--
-- Effet : ce rôle perd « partenaires.prix » (et « partenaires.supprimer » s'il l'avait reçu entre-temps). Tout le reste est gardé :
-- elle crée et modifie toujours les partenaires, les prestations et les trajets (libellés, horaires, masquer), sans en changer les prix.
-- Le rôle du même nom dans Taxi (personne ne l'a) et le rôle Taxi de Mook (« Vouchers et factures fiduciaire », sans partenaires.ecrire)
-- ne sont pas touchés. Se rejoue sans effet.

begin;

update roles r
set permissions = array(select p from unnest(r.permissions) p where p not in ('partenaires.prix', 'partenaires.supprimer'))
from entites e
where e.id = r.entite_id
  and e.slug = 'secret'
  and r.nom = 'Éditeur + factures fiduciaire'
  and not r.systeme
  and (r.permissions && array['partenaires.prix', 'partenaires.supprimer']);

commit;

-- Contrôle en lecture seule, après coup :
-- select r.nom, r.permissions from roles r join entites e on e.id = r.entite_id where e.slug = 'secret' and r.nom = 'Éditeur + factures fiduciaire';

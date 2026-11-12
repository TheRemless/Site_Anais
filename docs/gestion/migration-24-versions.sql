-- Gestion : migration 24, versions des dossiers et des paiements (ne plus écraser le travail de l'autre).
-- Les clients, devis, factures et réservations ont déjà leur version (migration 15). Il manquait les dossiers et les paiements : une correction de
-- paiement ou une modification de dossier réécrivait la fiche sans pouvoir savoir qu'une autre personne l'avait changée entre-temps.
-- Ne modifie aucune donnée : ajoute une colonne `updated_at` (valeur du jour de la migration pour les lignes existantes) et un déclencheur qui la
-- renouvelle à chaque modification. À exécuter une seule fois, AVANT ou APRÈS la publication de l'outil (le code fonctionne dans les deux cas :
-- sans la colonne, rien n'est vérifié, comme avant). Idempotente.

begin;

alter table dossiers add column if not exists updated_at timestamptz not null default now();
alter table paiements add column if not exists updated_at timestamptz not null default now();

-- Paiements : même déclencheur que les autres fiches (tenir_a_jour, migration 15).
drop trigger if exists tenir_a_jour on paiements;
create trigger tenir_a_jour before update on paiements for each row execute function tenir_a_jour();

-- Dossiers : le recalcul automatique du résumé (devis_envoye_le, a_facture, à chaque enregistrement d'un devis ou d'un paiement) n'est pas une
-- modification de la fiche. Sans cette exception, enregistrer un devis rendrait toute fiche dossier ouverte « modifiée entre-temps ».
create or replace function tenir_a_jour_dossier() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - array['devis_envoye_le', 'a_facture', 'modifie_par', 'updated_at']) = (to_jsonb(old) - array['devis_envoye_le', 'a_facture', 'modifie_par', 'updated_at']) then
    new.updated_at = old.updated_at;
  else
    new.updated_at = clock_timestamp();
  end if;
  return new;
end
$$;
drop trigger if exists tenir_a_jour on dossiers;
create trigger tenir_a_jour before update on dossiers for each row execute function tenir_a_jour_dossier();

commit;

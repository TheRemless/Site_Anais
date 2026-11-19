-- Gestion : migration 50, usage « brochure » de l'assistant (Importer une brochure, 20.11.2026).
-- Le journal de l'assistant (migration 27) n'accepte que les usages listés dans sa contrainte. Sans « brochure », l'appel serait fait et payé
-- mais pas noté : ni compté dans la limite du jour, ni dans le coût.
--
-- Écrite pour passer que la migration 49 (usage « trier », lot 1) soit passée ou non, avant ou après elle : la contrainte en place est relue et
-- tous ses usages sont gardés, puis « brochure » et « trier » s'ajoutent à la liste. Aucun usage n'est retiré.
-- Ne modifie aucune donnée. Se rejoue sans effet.
-- Retour en arrière (seulement si aucune ligne « brochure » n'est au journal) : rejouer le bloc en retirant 'brochure' de la liste ajoutée et du
-- tableau final (array_remove(usages, 'brochure')).
-- Contrôle : select pg_get_constraintdef(oid) from pg_constraint where conname = 'assistant_journal_usage_check';

begin;

do $$
declare
  def text;
  usages text[];
begin
  select pg_get_constraintdef(c.oid) into def
  from pg_constraint c
  where c.conrelid = 'public.assistant_journal'::regclass and c.conname = 'assistant_journal_usage_check';
  -- def ressemble à : CHECK ((usage = ANY (ARRAY['lire'::text, 'rediger'::text, …])))
  usages := array(select m[1] from regexp_matches(coalesce(def, ''), '''([a-z_]+)''', 'g') as m);
  usages := array(
    select distinct u from unnest(usages || array['lire', 'rediger', 'itineraire', 'situer', 'repondre_itineraire', 'trier', 'brochure']) as u order by u
  );
  alter table public.assistant_journal drop constraint if exists assistant_journal_usage_check;
  execute format(
    'alter table public.assistant_journal add constraint assistant_journal_usage_check check (usage in (%s))',
    (select string_agg(quote_literal(u), ', ' order by u) from unnest(usages) as u)
  );
end
$$;

commit;

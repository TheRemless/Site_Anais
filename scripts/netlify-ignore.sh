#!/bin/bash
# Netlify : « exit 0 » = ne pas construire, « exit 1 » = construire. Les minutes de build sont comptées (demande de Jérémy du 12.11.2026).
# 1. Aperçu de PR : construit seulement si le dernier commit contient « [preview] ».
if [ "$CONTEXT" = "deploy-preview" ]; then
  if git log -1 --pretty=%B | grep -q "\[preview\]"; then echo "Aperçu demandé ([preview]) : build."; exit 1; fi
  echo "Aperçu non demandé : build ignoré (ajouter [preview] au message du commit pour en avoir un)."; exit 0
fi
# 2. Production : pas de build si rien de ce qui part en ligne n'a changé (tests, docs, notes, workflows, taux de change).
if [ -n "$CACHED_COMMIT_REF" ] && [ "$CACHED_COMMIT_REF" != "$COMMIT_REF" ] && \
   git diff --quiet "$CACHED_COMMIT_REF" "$COMMIT_REF" -- . ':!tests' ':!docs' ':!*.md' ':!.github' ':!data/currency-rates.json'; then
  echo "Aucun changement publié : build ignoré."; exit 0
fi
exit 1

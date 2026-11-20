#!/usr/bin/env bash
# Déploie les fonctions Supabase de Gestion depuis origin/master, et seulement celles dont un fichier embarqué a changé depuis leur dernier
# déploiement (audit dev B1 et I26 du 20.11.2026 : whatsapp-preparer et whatsapp-envoi tournaient sur un vieux code de l'agent).
# Doc : docs/gestion/deployer-gestion.md.
#
#   scripts/deployer-gestion.sh            liste ce qui partirait, demande « o », déploie, note chaque commit déployé
#   scripts/deployer-gestion.sh --essai    liste seulement (rien ne part)
#   scripts/deployer-gestion.sh --tout     toutes les fonctions, changées ou non
#   scripts/deployer-gestion.sh --oui      sans question (après le oui de Jérémy)
#   scripts/deployer-gestion.sh agent whatsapp   seulement ces fonctions (si elles ont changé, ou avec --tout)
#
# Refuse de partir si le dossier n'est pas exactement sur origin/master à jour (fichiers suivis modifiés, branche en retard ou en avance).
# Ne pose, ne lit et n'affiche aucun secret : les secrets restent ceux du projet (supabase secrets list).
# Journal des déploiements : $GESTION_DEPLOIEMENTS, par défaut ~/.gestion/deploiements.tsv (date, fonction, commit, qui), partagé par tous les
# worktrees de cette machine. Sans ligne pour une fonction, elle est considérée comme changée.
set -euo pipefail

PROJET="${GESTION_PROJET:-lkxqcmzeidlyssoqmqkh}"
JOURNAL="${GESTION_DEPLOIEMENTS:-$HOME/.gestion/deploiements.tsv}"
ESSAI=0
TOUT=0
OUI=0
SEULES=""

arreter() { echo "deployer-gestion : $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --essai) ESSAI=1 ;;
    --tout) TOUT=1 ;;
    --oui) OUI=1 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    -*) arreter "option inconnue : $1" ;;
    *) SEULES="$SEULES $1" ;;
  esac
  shift
done

RACINE="$(git rev-parse --show-toplevel 2>/dev/null)" || arreter "pas dans un dépôt git"
cd "$RACINE"
[ -d supabase/functions ] || arreter "supabase/functions introuvable dans $RACINE"

# 1. Exactement origin/master, à jour, sans modification.
git fetch --quiet origin master || arreter "git fetch origin master impossible (réseau ?)"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git status --short --untracked-files=no >&2
  arreter "des fichiers suivis sont modifiés : rien ne part (commit, ou un worktree propre sur origin/master)"
fi
TETE="$(git rev-parse HEAD)"
MASTER="$(git rev-parse origin/master)"
[ "$TETE" = "$MASTER" ] || arreter "HEAD ($(git rev-parse --short HEAD)) n'est pas origin/master ($(git rev-parse --short origin/master)) : git switch --detach origin/master dans un worktree propre"

# 2. Ce que chaque fonction embarque (imports relatifs de proche en proche), plus supabase/config.toml (verify_jwt).
DEPS="$(node scripts/deployer-gestion-dependances.mjs "$RACINE")" || arreter "lecture des imports impossible"
# Un fichier embarqué qui n'est pas suivi par git partirait sans être dans master.
NON_SUIVIS="$(printf '%s\n' "$DEPS" | cut -f2 | sort -u | while read -r f; do git ls-files --error-unmatch -- "$f" >/dev/null 2>&1 || echo "$f"; done)"
[ -z "$NON_SUIVIS" ] || arreter "fichiers embarqués absents de git : $NON_SUIVIS"
FONCTIONS="$(printf '%s\n' "$DEPS" | cut -f1 | sort -u)"
if [ -n "$SEULES" ]; then
  for f in $SEULES; do printf '%s\n' "$FONCTIONS" | grep -qx "$f" || arreter "fonction inconnue : $f"; done
  FONCTIONS="$(for f in $SEULES; do echo "$f"; done | sort -u)"
fi

dernier_commit() { [ -f "$JOURNAL" ] && awk -F'\t' -v f="$1" '$2 == f { c = $3 } END { print c }' "$JOURNAL" || true; }

# 3. Ce qui part, et pourquoi.
A_DEPLOYER=""
echo "Commit : $(git log -1 --format='%h %s' HEAD)"
echo "Journal : $JOURNAL"
echo
for f in $FONCTIONS; do
  fichiers="$(printf '%s\n' "$DEPS" | awk -F'\t' -v f="$f" '$1 == f { print $2 }')"
  dernier="$(dernier_commit "$f")"
  if [ "$TOUT" = 1 ]; then
    raison="--tout"
  elif [ -z "$dernier" ]; then
    raison="aucun déploiement noté"
  elif ! git cat-file -e "${dernier}^{commit}" 2>/dev/null; then
    raison="commit noté inconnu ($dernier)"
  else
    # shellcheck disable=SC2086
    changes="$(git diff --name-only "$dernier" "$TETE" -- $fichiers supabase/config.toml)"
    if [ -z "$changes" ]; then
      printf '  =  %-20s à jour (%s)\n' "$f" "$(git rev-parse --short "$dernier")"
      continue
    fi
    raison="$(printf '%s' "$changes" | tr '\n' ' ')"
  fi
  printf '  >  %-20s %s\n' "$f" "$raison"
  A_DEPLOYER="$A_DEPLOYER $f"
done
echo

if [ -z "$A_DEPLOYER" ]; then echo "Rien à déployer."; exit 0; fi
if [ "$ESSAI" = 1 ]; then echo "Essai : rien n'est parti."; exit 0; fi
if [ "$OUI" != 1 ]; then
  printf 'Déployer%s depuis %s ? [o/N] ' "$A_DEPLOYER" "$(git rev-parse --short HEAD)"
  read -r reponse
  [ "$reponse" = "o" ] || [ "$reponse" = "O" ] || arreter "annulé"
fi

# 4. Déploiement, une fonction à la fois ; chaque réussite est notée tout de suite. Une erreur arrête la suite.
if command -v supabase >/dev/null 2>&1; then SB="supabase"; else SB="npx -y supabase@3.0.0"; fi
mkdir -p "$(dirname "$JOURNAL")"
[ -f "$JOURNAL" ] || printf 'date\tfonction\tcommit\tqui\n' > "$JOURNAL"
QUI="$(whoami)"
for f in $A_DEPLOYER; do
  echo "== $f"
  # shellcheck disable=SC2086
  $SB functions deploy "$f" --remote="$PROJET" --use-api --yes || arreter "échec du déploiement de $f : les fonctions suivantes ne sont pas parties ($A_DEPLOYER)"
  printf '%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$f" "$TETE" "$QUI" >> "$JOURNAL"
done
echo
echo "Déployé depuis $(git rev-parse --short HEAD) :$A_DEPLOYER (noté dans $JOURNAL)"

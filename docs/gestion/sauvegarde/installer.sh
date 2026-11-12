#!/bin/bash
# Installe la sauvegarde automatique de Gestion sur ce Mac : copie les scripts, crée la phrase de chiffrement dans le trousseau si elle manque, active la tâche launchd.
# Relançable sans danger. Désinstaller : launchctl bootout gui/$(id -u)/fr.zwald.sauvegarde-gestion && rm ~/Library/LaunchAgents/fr.zwald.sauvegarde-gestion.plist
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/Library/Application Support/Sauvegardes Gestion"
BIN="$APP/bin"
PLIST="$HOME/Library/LaunchAgents/fr.zwald.sauvegarde-gestion.plist"
NODE="$(command -v node || echo /opt/homebrew/bin/node)"
SUPABASE="$(command -v supabase || echo /opt/homebrew/bin/supabase)"
REF="${GESTION_PROJET:-lkxqcmzeidlyssoqmqkh}"

mkdir -p "$BIN" "$APP/supabase" "$HOME/Documents/Sauvegardes Gestion"
cp "$SRC/sauvegarde-lib.mjs" "$SRC/sauvegarder.mjs" "$SRC/restaurer.mjs" "$BIN/"
# Dossier de travail minimal pour la CLI Supabase (elle y cherche le projet).
printf 'project_id = "%s"\n' "$REF" > "$APP/supabase/config.toml"

# Phrase de chiffrement : créée une fois, dans le trousseau, jamais affichée ici.
if ! security find-generic-password -s "Sauvegardes Gestion" -a gestion >/dev/null 2>&1; then
  security add-generic-password -s "Sauvegardes Gestion" -a gestion -w "$(openssl rand -base64 32)" -j "Phrase de chiffrement des sauvegardes de la base Gestion"
  echo "Phrase de chiffrement créée dans le trousseau (service « Sauvegardes Gestion »)."
  echo "IMPORTANT : copiez-la une fois dans votre gestionnaire de mots de passe, sinon les sauvegardes sont illisibles si ce Mac est perdu :"
  echo "  security find-generic-password -s \"Sauvegardes Gestion\" -a gestion -w"
fi

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>fr.zwald.sauvegarde-gestion</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$BIN/sauvegarder.mjs</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>SUPABASE_BIN</key><string>$SUPABASE</string>
    <key>GESTION_PROJET</key><string>$REF</string>
  </dict>
  <!-- Toutes les heures et à l'ouverture de session : le script ne fait quelque chose que si la sauvegarde du jour manque (Mac éteint ou en veille : rattrapage). -->
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$APP/launchd.log</string>
  <key>StandardErrorPath</key><string>$APP/launchd.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/fr.zwald.sauvegarde-gestion" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Sauvegarde automatique activée. Dossier : $HOME/Documents/Sauvegardes Gestion (journal.log à l'intérieur)."

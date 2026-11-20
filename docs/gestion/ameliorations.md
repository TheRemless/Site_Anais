# Faire évoluer Gestion depuis l'Assistant (20.11.2026)

Anaïs ou Nani demande une amélioration à l'agent de l'onglet Assistant (« ajoute un champ numéro de vol », « mets ce bouton plus haut »).
L'agent trie la demande en deux niveaux.

## Niveau 1 : sans code

Ce qui se règle dans l'outil lui-même. L'agent lit l'existant puis propose une carte **Réglage** (avant, après, raison) que
l'administratrice applique d'un clic, par les écritures habituelles de l'outil (RLS, verrou des réglages).

| Sujet | Ce qui change | Droit |
|---|---|---|
| Voix | voix de l'assistant en français, en anglais, lieu de l'entreprise (`assistant_voix`) | `reglages.ecrire` |
| Texte type | titre ou texte d'un message existant, ou un nouveau message pour le client (Secret : anglais seulement) | `reglages.ecrire` |
| Catalogue | libellé, libellé anglais, prix de vente (montant tapé par la personne seulement), mis en vente | `catalogue.ecrire` |
| Réglage | délais (paiement, relance, solde), acompte, écrans affichés, textes des vouchers | `reglages.ecrire` |

Rien d'autre ne passe par une carte (paiement, émetteur, numérotation, apparence, droits) : l'écran Réglages reste la voie. Une carte
dont l'« avant » ne correspond plus à la valeur en place est refusée (quelqu'un a changé la valeur entre-temps).

Code : `supabase/functions/agent/ameliorer.js` (outils `lire_reglages`, `proposer_reglage`), `src/gestion/js/agent-calc.mjs`
(`reglageApplique`, `prestationModifiee`), `views/agent.mjs`.

## Niveau 2 : avec du code

1. **Dans l'Assistant.** L'agent reformule la demande avec la personne (écran, ce qui doit se passer, pour quelle entreprise, ce qui ne
   change pas), résume ce qui changera et attend son accord. Puis il propose la carte **Amélioration de l'outil** : titre et texte
   modifiables, bouton « Demander cette amélioration ».
2. **Fonction `ameliorations`.** Contrôles (administratrice, carte à elle et pas encore décidée, 3 demandes par jour au plus, texte
   public sans nom, téléphone, e-mail, lien, montant ni accès), ligne dans la table `ameliorations` (migration 56), puis issue sur
   `TheRemless/Site_Anais` avec le label `amelioration-gestion`, ouverte avec le jeton `GITHUB_ISSUES_TOKEN` (droits Issues seulement).
3. **Action `.github/workflows/amelioration-gestion.yml`.** `anthropics/claude-code-action@v1.0.284` (vérifiée le 20.11.2026) fait le
   changement en suivant `docs/gestion/ameliorations-consignes.md`, avec un jeton GitHub en lecture seule et sans pouvoir exécuter de
   code (un code lancé dans ce job pourrait lire la clé Anthropic). Un job sans aucun secret lance build et tests (résultat indicatif).
   Une étape fixe, sans Claude et sans exécuter de code du dépôt, contrôle les fichiers touchés, pousse `amelioration/issue-N-…` et ouvre
   une **PR en brouillon** (« Closes #N », résumé de Claude dans un bloc de code), avec le label `a-relire-de-pres` si elle touche `supabase/`, une migration, les droits,
   l'authentification, les paiements ou la sauvegarde. Le lien de la PR est écrit dans l'issue.
4. **Suivi.** La fonction `rappels` (`{"type":"ameliorations"}`, pg_cron toutes les 10 minutes) lit l'issue et ses commentaires
   (seulement ceux de `github-actions[bot]`) et met la table à jour. Notification push à Jérémy quand la PR est prête ou que l'Action
   a échoué ; à l'autrice quand la demande est en ligne ou non retenue. Le lien de la notification ouvre la PR.
5. **Dans l'Assistant**, la carte envoyée et la liste « Améliorations demandées » montrent le statut :

| Statut | Quand | Libellé |
|---|---|---|
| `envoyee` | issue ouverte, l'Action travaille | Envoyée, en préparation |
| `pr_prete` | PR en brouillon ouverte | Prête, Jérémy relit |
| `en_ligne` | PR fusionnée (l'issue se ferme seule) | Acceptée, en ligne |
| `refusee` | PR fermée sans fusion ou issue fermée « not planned » | Non retenue |
| `echec` | l'Action s'est arrêtée (plafond, aucun changement, fichier interdit, panne) | En attente de Jérémy |

**Fusion** : toujours une décision humaine. Jérémy, ou une session Claude Code qui fait `/code-review` (et `/security-review` pour une PR
à relire de près) avant. La CI ne part pas seule sur une PR ouverte par l'Action (règle de GitHub) : fermer puis rouvrir la PR la lance.
Une migration écrite par l'Action n'est appliquée qu'avec l'accord de Jérémy, après une sauvegarde. Pour refuser : fermer la PR sans
fusionner (l'issue se ferme « not planned »). Pour relancer après un échec : retirer puis remettre le label `amelioration-gestion`.

## Garde-fous

| Risque | Garde-fou |
|---|---|
| Quelqu'un d'autre qu'une administratrice | outil `proposer_amelioration` et fonction refusent sans `reglages.ecrire` ; table lisible par les administratrices seulement |
| Un message de client ou un fichier devient une demande | le texte est assemblé des mots de la personne et relu par elle ; refus si la conversation a une pièce jointe ; noms de clients vus et prestataires refusés |
| Le dépôt est **public** | aucun nom, téléphone, e-mail, lien, montant, accès ; mots d'argent interne signalés, refusés avec un chiffre à côté ; noms de clients vus gardés dans la carte et recontrôlés par la fonction ; commentaires HTML, chevrons et mentions neutralisés |
| Une issue ou un commentaire d'un inconnu | l'Action part seulement si l'issue et le label viennent du propriétaire et si le corps porte le repère ; le suivi ne lit que les commentaires de `github-actions[bot]` et des liens de PR du dépôt |
| L'Action fusionne, déploie ou touche la base | Claude a un jeton en lecture seule et des outils fermés (lecture et édition seulement : ni npm, node, shell, push, `gh`, `curl`, `supabase`, réseau) ; tests dans un job sans secret ; aucun secret Supabase ni Netlify dans le dépôt ; PR en brouillon ; Netlify ignore l'aperçu sans `[preview]`, retiré du titre |
| La clé Anthropic de l'Action fuit | aucun code du dépôt ne tourne dans le job qui la tient ; clé dédiée avec sa propre limite de dépense, à révoquer au moindre doute |
| L'Action change la CI ou les dépendances | ajout, modification, suppression ou renommage de `.github/`, `.claude/`, `netlify.toml`, `scripts/netlify-ignore.sh`, `package*.json`, `.npmrc`, `supabase/config.toml`, `CLAUDE.md`, `.gitattributes` refusés (chemins lus sans renommage ni guillemets) ; liens symboliques et sous-modules refusés |
| Coût | par demande : 60 tours, 5 $ (`--max-budget-usd`), 40 minutes ; 3 demandes par jour dans la fonction (`AMELIORATIONS_LIMITE_JOUR`), 5 issues par jour dans l'Action ; clé Anthropic à part avec sa propre limite de dépense |

## Mise en route (Jérémy)

Claude ne pose aucun secret. Dans l'ordre :

1. **Jeton GitHub, Issues seulement.** github.com > Settings > Developer settings > Fine-grained tokens > Generate new token :
   nom « Gestion issues », expiration 1 an, *Only select repositories* : `TheRemless/Site_Anais`, *Repository permissions* :
   **Issues : Read and write** (Metadata en lecture vient seul), rien d'autre. Puis, dans le dossier du dépôt :

   ```bash
   read -s GH_ISSUES && supabase secrets set GITHUB_ISSUES_TOKEN="$GH_ISSUES" --project-ref lkxqcmzeidlyssoqmqkh; unset GH_ISSUES
   ```

2. **Clé Anthropic pour l'Action.** console.anthropic.com : une clé à part « Action Gestion », dans un espace de travail avec une
   limite de dépense mensuelle (par exemple 30 $). Puis :

   ```bash
   read -s CLE && printf '%s' "$CLE" | gh secret set ANTHROPIC_API_KEY -R TheRemless/Site_Anais; unset CLE
   ```

3. **Réglage GitHub.** Settings > Actions > General > Workflow permissions : garder « Read repository contents » et cocher
   **Allow GitHub Actions to create and approve pull requests** (l'Action n'approuve jamais rien, mais GitHub groupe les deux). Ou :

   ```bash
   gh api -X PUT repos/TheRemless/Site_Anais/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true
   ```

4. **Label.** `gh label create amelioration-gestion --color 0b9999 --description "Demande d'amélioration envoyée depuis Gestion" -R TheRemless/Site_Anais`
5. **Base et fonctions** (mise en service groupée depuis master, après sauvegarde et accord de Jérémy) : migration 56, déploiement de `ameliorations`, `agent` et `rappels`, job
   pg_cron du suivi copié de `rappels-h1` sans manipuler son secret :

   ```sql
   select cron.schedule('ameliorations-suivi', '*/10 * * * *', replace((select command from cron.job where jobname = 'rappels-h1'), '{"type":"h1"}', '{"type":"ameliorations"}'));
   ```

6. Activer les notifications sur le téléphone de Jérémy (cloche du menu) s'il ne l'a pas fait : c'est là qu'arrive « Amélioration prête à relire ».

Retour arrière : `select cron.unschedule('ameliorations-suivi');`, supprimer le secret GitHub et révoquer le jeton, puis le retour arrière
de la migration 56 (en tête du fichier).

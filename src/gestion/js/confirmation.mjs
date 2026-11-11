// Réponse d'une fenêtre de confirmation, sans DOM pour pouvoir la tester. `ouvrir({ fin, annuler })` ouvre la fenêtre et renvoie sa fonction de
// fermeture ; la fermeture (croix, Échap, fond ou appel direct) appelle `annuler`, qui répond « non ».
// La réponse choisie part AVANT la fermeture : sinon la fermeture répondrait « non » la première et la confirmation ne s'exécuterait jamais
// (bug de la PR 126, corrigé par la PR 151).
export function confirmation(ouvrir) {
  return new Promise((resolve) => {
    let ferme;
    const fin = (reponse) => {
      resolve(reponse);
      ferme();
    };
    ferme = ouvrir({ fin, annuler: () => resolve(false) });
  });
}

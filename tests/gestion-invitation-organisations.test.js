// Fonction « invitation » et organisations (migration 41) : chaque geste reste dans l'organisation de l'appelant ; l'éditeur crée les clients.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lireDemande, memeOrganisation, entreprisesDeLOrganisation, suppressionPermise } from "../supabase/functions/invitation/calc.js";

const ORIGINES = ["https://gestion.exemple.com"];
const retour = "https://gestion.exemple.com/gestion/";
const A = "00000000-0000-0000-0000-00000000a000";
const B = "11111111-1111-1111-1111-111111111111";

test("creer_client : nom d'organisation obligatoire, anglais et Bangkok par défaut, fuseau contrôlé", () => {
  assert.equal(lireDemande({ action: "creer_client", email: "marc@b.ch", retour }, { origines: ORIGINES }).erreur, "organisation_invalide");
  const l = lireDemande({ action: "creer_client", email: "Marc@B.ch", organisation: " Agence B ", retour }, { origines: ORIGINES });
  assert.deepEqual({ ...l, retour: undefined }, { ok: true, action: "creer_client", email: "marc@b.ch", nom: "", langue: "en", organisation: "Agence B", fuseau: "Asia/Bangkok", retour: undefined });
  assert.equal(lireDemande({ action: "creer_client", email: "m@b.ch", organisation: "B", fuseau: "Europe/Zurich", langue: "fr", retour }, { origines: ORIGINES }).fuseau, "Europe/Zurich");
  assert.equal(lireDemande({ action: "creer_client", email: "m@b.ch", organisation: "B", fuseau: "'; drop table x", retour }, { origines: ORIGINES }).fuseau, "Asia/Bangkok");
  assert.equal(lireDemande({ action: "creer_client", email: "m@b.ch", organisation: "B", retour: "https://pirate.com/" }, { origines: ORIGINES }).erreur, "retour_refuse");
});

test("un compte d'une autre organisation est inconnu : ni lien de mot de passe ni suppression", () => {
  assert.equal(memeOrganisation(A, { organisation_id: A }), true);
  assert.equal(memeOrganisation(A, { organisation_id: B }), false);
  assert.equal(memeOrganisation(null, { organisation_id: null }), false);
  assert.deepEqual(suppressionPermise({ appelant: "x", cible: { user_id: "y", organisation_id: B }, superAdminsActifs: 3, organisation: A }), { ok: false, erreur: "personne_inconnue" });
  assert.deepEqual(suppressionPermise({ appelant: "x", cible: { user_id: "y", organisation_id: A, super_admin: true, actif: true }, superAdminsActifs: 1, organisation: A }), { ok: false, erreur: "derniere_administratrice" });
  assert.deepEqual(suppressionPermise({ appelant: "x", cible: { user_id: "y", organisation_id: A }, superAdminsActifs: 1, organisation: A }), { ok: true });
});

test("inviter : les entreprises demandées sont toutes de l'organisation", () => {
  const ents = [{ id: "e1", organisation_id: A }, { id: "e2", organisation_id: B }];
  assert.equal(entreprisesDeLOrganisation([{ entite_id: "e1" }], ents, A), true);
  assert.equal(entreprisesDeLOrganisation([{ entite_id: "e1" }, { entite_id: "e2" }], ents, A), false);
  assert.equal(entreprisesDeLOrganisation([{ entite_id: "inconnue" }], ents, A), false);
});

test("la fonction applique ces règles et rattache l'invité à l'organisation", () => {
  const f = fs.readFileSync(new URL("../supabase/functions/invitation/index.ts", import.meta.url), "utf8");
  assert.match(f, /sb\.rpc\("est_plateforme"\)/, "creer_client réservé à l'éditeur");
  assert.match(f, /data: \{ nouvelle_organisation: "true" \}/);
  assert.match(f, /sb\.rpc\("creer_organisation"/, "l'organisation est créée avec la session de l'éditeur, pas la clé de service");
  assert.match(f, /deleteUser\(userId\)/, "un compte sans organisation est retiré");
  assert.match(f, /upsert\(\{ user_id: userId, email: lu\.email, nom: lu\.nom \|\| null, organisation_id: organisation,/, "l'invité est rattaché par la clé de service, jamais par sa métadonnée");
  assert.ok(!/data: \{ organisation_id/.test(f), "plus de métadonnée « utilisateur » pour l'organisation");
  assert.match(f, /table_name: "comptes"/);
  assert.match(f, /entite_id: null, organisation_id: organisation, user_id/, "le journal des comptes porte l'organisation");
  assert.match(f, /!memeOrganisation\(organisation, p\)\) return json\(\{ erreur: "personne_inconnue" \}, 404\)/, "pas de lien de mot de passe hors organisation");
  assert.match(f, /\.eq\("organisation_id", organisation\)/, "dernier administrateur compté dans l'organisation");
  assert.match(f, /suppressionPermise\(\{ appelant: qui\.user\.id, cible, superAdminsActifs: count \|\| 0, organisation \}\)/);
  assert.match(f, /entreprisesDeLOrganisation\(lu\.acces, ents \|\| \[\], organisation\)/);
  // L'ordre compte : le contrôle d'administrateur passe avant tout usage de la clé de service pour les trois gestes d'équipe.
  assert.ok(f.indexOf('sb.rpc("est_super_admin")') < f.indexOf("const admin = createClient"));
});

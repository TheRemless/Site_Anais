import { test } from "node:test";
import assert from "node:assert/strict";
import { construirePdf, decouperPages, hauteurPage } from "../src/gestion/js/pdf-simple.mjs";

const texte = (u8) => Buffer.from(u8).toString("latin1");
const jpeg = (n) => new Uint8Array([0xff, 0xd8, ...Array.from({ length: n }, (_, i) => i % 250), 0xff, 0xd9]);

test("PDF : en-tête, une page par image, fin de fichier", () => {
  const pdf = construirePdf([{ jpeg: jpeg(40), largeur: 1588, hauteur: 2246 }, { jpeg: jpeg(10), largeur: 1588, hauteur: 900 }], { titre: "Devis ST-2026-0001 - Équipe" });
  const t = texte(pdf);
  assert.ok(t.startsWith("%PDF-1.4"));
  assert.ok(t.trimEnd().endsWith("%%EOF"));
  assert.match(t, /\/Count 2 /);
  assert.equal((t.match(/\/Type \/Page /g) || []).length, 2);
  assert.equal((t.match(/\/Subtype \/Image/g) || []).length, 2);
});

test("PDF : la table xref pointe exactement sur chaque objet", () => {
  const pdf = construirePdf([{ jpeg: jpeg(300), largeur: 1000, hauteur: 1414 }]);
  const t = texte(pdf);
  const debut = Number(/startxref\n(\d+)/.exec(t)[1]);
  assert.ok(t.slice(debut).startsWith("xref"));
  const lignes = t.slice(debut).split("\n");
  const [, taille] = lignes[1].split(" ").map(Number);
  for (let n = 1; n < taille; n++) {
    const pos = Number(lignes[2 + n].slice(0, 10));
    assert.ok(t.slice(pos).startsWith(`${n} 0 obj`), `objet ${n} à ${pos}`);
  }
});

test("PDF : l'image garde ses octets et la longueur du flux est juste", () => {
  const j = jpeg(500);
  const pdf = construirePdf([{ jpeg: j, largeur: 800, hauteur: 600 }]);
  const t = texte(pdf);
  assert.match(t, new RegExp(`/Length ${j.length} >>`));
  const i = t.indexOf("stream\n\xff\xd8");
  assert.ok(i > 0);
  assert.deepEqual([...pdf.slice(i + 7, i + 7 + j.length)], [...j]);
});

test("PDF : l'image est placée en haut de la page, à pleine largeur", () => {
  const t = texte(construirePdf([{ jpeg: jpeg(5), largeur: 1000, hauteur: 707 }]));
  const m = /q ([\d.]+) 0 0 ([\d.]+) 0 ([\d.]+) cm/.exec(t);
  assert.equal(Number(m[1]), 595.28);
  assert.ok(Math.abs(Number(m[2]) + Number(m[3]) - 841.89) < 0.02);
});

test("PDF : sans page, refuse", () => assert.throws(() => construirePdf([])));

test("découpe : une page A4 reste une page, un document plus long donne deux pages", () => {
  const hp = hauteurPage(794);
  assert.equal(hp, 1123);
  assert.deepEqual(decouperPages(hp, 794), [{ debut: 0, hauteur: hp }]);
  assert.deepEqual(decouperPages(hp + 5, 794), [{ debut: 0, hauteur: hp }]);
  const deux = decouperPages(hp + 400, 794);
  assert.equal(deux.length, 2);
  assert.equal(deux[1].hauteur, 400);
  assert.equal(decouperPages(600, 794).length, 1);
});

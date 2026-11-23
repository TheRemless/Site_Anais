// tests/aides-dom.mjs : un DOM minimal pour faire tourner les écrans de Gestion sous node, sans navigateur (relecture de la PR 332).
// De quoi construire une fenêtre (modal), ses champs, ses boutons et ses formulaires, les relire, cliquer et soumettre : éléments avec
// parents, attributs, valeurs, cases, événements qui remontent, sélecteurs simples (balise, #id, .classe, [attr], [attr="v"], :not(),
// descendant et enfant), getElementById, sessionStorage et localStorage en mémoire. Rien de plus : un écran qui demande autre chose échoue
// en clair plutôt que de passer en silence.

class Noeud {
  constructor() {
    this.parentNode = null;
  }
  get parentElement() {
    return this.parentNode instanceof Element ? this.parentNode : null;
  }
  remove() {
    if (!this.parentNode) return;
    const l = this.parentNode.childNodes;
    const i = l.indexOf(this);
    if (i >= 0) l.splice(i, 1);
    this.parentNode = null;
  }
  get nextSibling() {
    const l = this.parentNode ? this.parentNode.childNodes : [];
    return l[l.indexOf(this) + 1] || null;
  }
  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n === globalThis.document.documentElement;
  }
}

class Texte extends Noeud {
  constructor(t) {
    super();
    this.data = String(t);
    this.nodeType = 3;
  }
  get textContent() {
    return this.data;
  }
  set textContent(t) {
    this.data = String(t);
  }
}

// ---- Sélecteurs ---------------------------------------------------------------------------------------------------------------------
function decouperComposes(sel) {
  // « a b > c » → [{ c: "a" }, { op: " ", c: "b" }, { op: ">", c: "c" }]
  const parts = [];
  let cur = "";
  let profondeur = 0;
  let op = null;
  for (const ch of sel.trim()) {
    if (ch === "[" || ch === "(") profondeur++;
    if (ch === "]" || ch === ")") profondeur--;
    if (profondeur === 0 && (ch === " " || ch === ">")) {
      if (cur) parts.push({ op, c: cur }), (cur = ""), (op = " ");
      if (ch === ">") op = ">";
      continue;
    }
    cur += ch;
  }
  if (cur) parts.push({ op, c: cur });
  return parts;
}
function testeCompose(el, c) {
  const re = /(\*|[a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([~^$*|]?=)"?([^"\]]*)"?)?\]|:not\(([^)]*)\)|:(checked|disabled)/g;
  let m;
  let lu = 0;
  while ((m = re.exec(c))) {
    if (m.index !== lu) throw new Error(`aides-dom : sélecteur non pris en charge « ${c} »`);
    lu = re.lastIndex;
    if (m[1] && m[1] !== "*" && el.localName !== m[1].toLowerCase()) return false;
    if (m[2] && el.id !== m[2]) return false;
    if (m[3] && !el.classList.contains(m[3])) return false;
    if (m[4]) {
      const v = el.getAttribute(m[4]);
      if (v === null) return false;
      if (m[5] === "=" && v !== m[6]) return false;
    }
    if (m[7] !== undefined && testeCompose(el, m[7])) return false;
    if (m[8] === "checked" && !el.checked) return false;
    if (m[8] === "disabled" && !el.disabled) return false;
  }
  if (lu !== c.length) throw new Error(`aides-dom : sélecteur non pris en charge « ${c} »`);
  return true;
}
function correspond(el, sel) {
  return sel.split(",").some((un) => {
    const parts = decouperComposes(un);
    const verifier = (e, i) => {
      if (!testeCompose(e, parts[i].c)) return false;
      if (i === 0) return true;
      const op = parts[i].op;
      if (op === ">") return !!e.parentElement && verifier(e.parentElement, i - 1);
      for (let p = e.parentElement; p; p = p.parentElement) if (verifier(p, i - 1)) return true;
      return false;
    };
    return verifier(el, parts.length - 1);
  });
}

class ListeClasses {
  constructor(el) {
    this.el = el;
  }
  get liste() {
    return String(this.el.className || "").split(/\s+/).filter(Boolean);
  }
  contains(c) {
    return this.liste.includes(c);
  }
  add(...cs) {
    this.el.className = [...new Set([...this.liste, ...cs])].join(" ");
  }
  remove(...cs) {
    this.el.className = this.liste.filter((x) => !cs.includes(x)).join(" ");
  }
  toggle(c, force) {
    const oui = force === undefined ? !this.contains(c) : !!force;
    if (oui) this.add(c);
    else this.remove(c);
    return oui;
  }
}

class Element extends Noeud {
  constructor(tag) {
    super();
    this.localName = String(tag).toLowerCase();
    this.tagName = this.localName.toUpperCase();
    this.nodeType = 1;
    this.childNodes = [];
    this.attributs = new Map();
    this.ecouteurs = new Map();
    this.style = { setProperty() {}, removeProperty() {} };
    this.dataset = {};
    this.classList = new ListeClasses(this);
    this.hidden = false;
    this.disabled = false;
    this.open = false;
    this._checked = false;
    this._valeur = undefined;
  }
  get id() {
    return this.getAttribute("id") || "";
  }
  set id(v) {
    this.setAttribute("id", v);
  }
  get className() {
    return this.getAttribute("class") || "";
  }
  set className(v) {
    this.setAttribute("class", v);
  }
  get type() {
    return this.getAttribute("type") || (this.localName === "button" ? "submit" : this.localName === "input" ? "text" : "");
  }
  set type(v) {
    this.setAttribute("type", v);
  }
  get checked() {
    return this._checked;
  }
  set checked(v) {
    this._checked = !!v;
  }
  get options() {
    return this.querySelectorAll("option");
  }
  get value() {
    // Comme un navigateur : sans choix, la première option ; une valeur absente des options ne choisit rien ("").
    if (this.localName === "select") {
      const opts = this.options;
      if (this._valeur !== undefined) return opts.some((o) => o.value === this._valeur) ? this._valeur : "";
      return opts.length ? opts[0].value : "";
    }
    if (this.localName === "option") return this._valeur ?? this.getAttribute("value") ?? this.textContent;
    return this._valeur === undefined ? this.getAttribute("value") || "" : this._valeur;
  }
  set value(v) {
    this._valeur = v === null || v === undefined ? "" : String(v);
  }
  get form() {
    return this.closest("form");
  }
  get children() {
    return this.childNodes.filter((n) => n instanceof Element);
  }
  get firstChild() {
    return this.childNodes[0] || null;
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] || null;
  }
  get firstElementChild() {
    return this.children[0] || null;
  }
  get textContent() {
    return this.childNodes.map((n) => n.textContent).join("");
  }
  set textContent(t) {
    for (const n of this.childNodes) n.parentNode = null;
    this.childNodes = [];
    if (t !== "" && t !== null && t !== undefined) this.append(String(t));
  }
  set innerHTML(t) {
    if (t) throw new Error("aides-dom : innerHTML non pris en charge");
    this.textContent = "";
  }
  get innerHTML() {
    return "";
  }
  setAttribute(k, v) {
    this.attributs.set(k, String(v));
  }
  getAttribute(k) {
    return this.attributs.has(k) ? this.attributs.get(k) : null;
  }
  hasAttribute(k) {
    return this.attributs.has(k);
  }
  removeAttribute(k) {
    this.attributs.delete(k);
  }
  toggleAttribute(k, force) {
    const oui = force === undefined ? !this.hasAttribute(k) : !!force;
    if (oui) this.setAttribute(k, "");
    else this.removeAttribute(k);
    return oui;
  }
  _inserer(n, i) {
    if (n instanceof Fragment) {
      const enfants = [...n.childNodes];
      n.childNodes = [];
      enfants.forEach((e, k) => ((e.parentNode = null), this._inserer(e, i + k)));
      return;
    }
    const noeud = n instanceof Noeud ? n : new Texte(n);
    noeud.remove();
    noeud.parentNode = this;
    this.childNodes.splice(i, 0, noeud);
  }
  append(...xs) {
    for (const x of xs) this._inserer(x, this.childNodes.length);
  }
  appendChild(x) {
    this.append(x);
    return x;
  }
  prepend(...xs) {
    xs.forEach((x, i) => this._inserer(x, i));
  }
  insertBefore(x, ref) {
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    this._inserer(x, i >= 0 ? i : this.childNodes.length);
    return x;
  }
  replaceChildren(...xs) {
    this.textContent = "";
    this.append(...xs);
  }
  replaceWith(...xs) {
    const p = this.parentNode;
    if (!p) return;
    const i = p.childNodes.indexOf(this);
    this.remove();
    xs.forEach((x, k) => p._inserer(x, i + k));
  }
  before(...xs) {
    const p = this.parentNode;
    if (p) xs.forEach((x) => p._inserer(x, p.childNodes.indexOf(this)));
  }
  after(...xs) {
    const p = this.parentNode;
    if (p) xs.reverse().forEach((x) => p._inserer(x, p.childNodes.indexOf(this) + 1));
  }
  contains(n) {
    for (let p = n; p; p = p.parentNode) if (p === this) return true;
    return false;
  }
  descendants() {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
  matches(sel) {
    return correspond(this, sel);
  }
  closest(sel) {
    for (let e = this; e; e = e.parentElement) if (correspond(e, sel)) return e;
    return null;
  }
  querySelectorAll(sel) {
    return this.descendants().filter((e) => correspond(e, sel));
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
  getElementsByTagName(t) {
    return this.querySelectorAll(t);
  }
  addEventListener(type, fn, opts) {
    if (!fn) return;
    if (!this.ecouteurs.has(type)) this.ecouteurs.set(type, []);
    this.ecouteurs.get(type).push({ fn, once: !!(opts && opts.once) });
  }
  removeEventListener(type, fn) {
    const l = this.ecouteurs.get(type) || [];
    const i = l.findIndex((x) => x.fn === fn);
    if (i >= 0) l.splice(i, 1);
  }
  dispatchEvent(ev) {
    if (!ev.target) Object.defineProperty(ev, "target", { value: this, configurable: true });
    const bulles = ev.bubbles !== false;
    for (let n = this; n; n = bulles ? n.parentNode || (n === globalThis.document.documentElement ? globalThis.document : null) : null) {
      Object.defineProperty(ev, "currentTarget", { value: n, configurable: true });
      for (const e of [...((n.ecouteurs && n.ecouteurs.get(ev.type)) || [])]) {
        if (e.once) n.removeEventListener(ev.type, e.fn);
        e.fn.call(n, ev);
      }
      if (ev.cancelBubble || ev._arret) break;
      if (n === globalThis.document) break;
    }
    return !ev.defaultPrevented;
  }
  click() {
    if (this.disabled) return;
    if (this.localName === "input" && ["checkbox", "radio"].includes(this.type)) this.checked = this.type === "radio" ? true : !this.checked;
    this.dispatchEvent(evenement("click"));
    if (this.localName === "input" && ["checkbox", "radio"].includes(this.type)) this.dispatchEvent(evenement("change"));
    if (this.localName === "button" && this.type === "submit" && this.form) this.form.requestSubmit(this);
  }
  focus() {
    globalThis.document.activeElement = this;
  }
  blur() {
    if (globalThis.document.activeElement === this) globalThis.document.activeElement = globalThis.document.body;
  }
  select() {}
  requestSubmit(submitter = null) {
    const ev = evenement("submit");
    Object.defineProperty(ev, "submitter", { value: submitter, configurable: true });
    this.dispatchEvent(ev);
  }
  reportValidity() {
    return true;
  }
  checkValidity() {
    return true;
  }
  setCustomValidity() {}
  scrollIntoView() {}
  scrollTo() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
  getBoundingClientRect() {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  }
}
class Fragment extends Element {
  constructor() {
    super("#fragment");
  }
}

const evenement = (type, init = {}) => {
  const ev = new Event(type, { bubbles: true, cancelable: true, ...init });
  const arret = ev.stopPropagation.bind(ev);
  ev.stopPropagation = () => ((ev._arret = true), arret());
  return ev;
};

const memoire = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
};

// Installe le DOM minimal (une seule fois par fichier de test) et rend ses aides.
export function installerDom() {
  if (globalThis.__domMinimal) return globalThis.__domMinimal;
  const racine = new Element("html");
  const head = new Element("head");
  const body = new Element("body");
  racine.append(head, body);
  const document = {
    documentElement: racine,
    head,
    body,
    activeElement: body,
    ecouteurs: new Map(),
    createElement: (t) => new Element(t),
    createElementNS: (_ns, t) => new Element(t),
    createTextNode: (t) => new Texte(t),
    createDocumentFragment: () => new Fragment(),
    getElementById: (id) => racine.descendants().find((e) => e.id === id) || null,
    querySelector: (s) => racine.querySelector(s),
    querySelectorAll: (s) => racine.querySelectorAll(s),
    contains: (n) => racine.contains(n),
    addEventListener: Element.prototype.addEventListener,
    removeEventListener: Element.prototype.removeEventListener,
    dispatchEvent: (ev) => Element.prototype.dispatchEvent.call(document, ev),
    hidden: false,
    visibilityState: "visible",
  };
  globalThis.Node = Noeud;
  globalThis.Element = Element;
  globalThis.HTMLElement = Element;
  globalThis.document = document;
  globalThis.window = globalThis;
  globalThis.ecouteurs = new Map();
  globalThis.addEventListener = (t, fn) => Element.prototype.addEventListener.call(globalThis, t, fn);
  globalThis.removeEventListener = (t, fn) => Element.prototype.removeEventListener.call(globalThis, t, fn);
  if (!globalThis.HashChangeEvent) globalThis.HashChangeEvent = class extends Event {};
  globalThis.dispatchEvent = () => true;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  globalThis.innerHeight = 800;
  globalThis.innerWidth = 1200;
  globalThis.visualViewport = null;
  globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
  globalThis.sessionStorage = memoire();
  globalThis.localStorage = memoire();
  globalThis.location = { hash: "", href: "http://localhost/gestion/", pathname: "/gestion/", search: "", origin: "http://localhost" };
  globalThis.history = { replaceState() {}, pushState() {} };
  globalThis.scrollTo = () => {};
  const aides = {
    document,
    // Le champ ou le bouton d'id `id`, n'importe où dans la page.
    parId: (id) => document.getElementById(id),
    // Les boutons dont le texte contient `texte`.
    boutons: (texte, dans = racine) => dans.querySelectorAll("button").filter((b) => b.textContent.includes(texte)),
    // Taper une valeur dans un champ, comme la personne (input puis change).
    saisir: (el, v) => {
      el.value = v;
      el.dispatchEvent(evenement("input"));
      el.dispatchEvent(evenement("change"));
    },
    // Laisser finir les promesses et les minuteries courtes (imports à la demande, écritures).
    attendre: async (n = 20) => {
      for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
    },
  };
  globalThis.__domMinimal = aides;
  return aides;
}

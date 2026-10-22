// The app in the player's language. Pages are written in English; when the
// language is Spanish, this translates what is on screen as React renders it
// (shared/i18n): text, placeholders, labels and the browser's confirm boxes.
//
// React may split a sentence into several text nodes ("Round ", "2"); the
// English of each node is remembered, so a whole element's sentence is
// translated at once, and React's later updates to any piece still work.
// Players' own words (names, stories, rules text, Thorgrim's answers) are
// left alone: those elements carry translate="no".

import { translate, type Lang } from "../../shared/i18n/index.ts";

const KEY = "thorgrim-lang";
export type LangSetting = "auto" | Lang;

export function langSetting(): LangSetting {
  try {
    const v = localStorage.getItem(KEY);
    return v === "en" || v === "es" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function setLangSetting(v: LangSetting) {
  try {
    if (v === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, v);
  } catch {
    /* private mode: just this visit */
  }
  window.location.reload();
}

/** The language in use: the setting, or the phone's. */
export function currentLang(): Lang {
  const s = langSetting();
  if (s !== "auto") return s;
  return (navigator.languages ?? [navigator.language]).some((l) => l?.toLowerCase().startsWith("es")) ? "es" : "en";
}

const ATTRS = ["placeholder", "aria-label", "title", "alt"];
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "CODE", "PRE"]);

/** English as React last wrote it, and what we wrote over it. */
const english = new WeakMap<Text, string>();
const ours = new WeakMap<Text, string>();
const englishAttr = new WeakMap<Element, Record<string, string>>();
const oursAttr = new WeakMap<Element, Record<string, string>>();

const skipped = (el: Element | null): boolean => !!el?.closest('[translate="no"]') || (!!el && SKIP_TAGS.has(el.tagName));

function englishOf(t: Text): string {
  const now = t.nodeValue ?? "";
  if (ours.get(t) !== now) english.set(t, now); // React (or the first look) wrote it
  return english.get(t) ?? now;
}

function write(t: Text, value: string) {
  ours.set(t, value);
  if (t.nodeValue !== value) t.nodeValue = value;
}

function translateElement(el: Element, lang: Lang) {
  if (skipped(el)) return;
  // What the player types (a textarea's text) stays; its placeholder and label are translated below.
  const kids = el.tagName === "TEXTAREA" ? [] : [...el.childNodes];
  const texts = kids.filter((n): n is Text => n.nodeType === Node.TEXT_NODE);
  if (texts.length) {
    const whole = texts.map(englishOf);
    // Only text inside: translate the sentence as a whole.
    if (texts.length > 1 && texts.length === kids.length) {
      const sentence = whole.join("");
      const t = translate(sentence, lang);
      if (t !== sentence) {
        texts.forEach((x, i) => write(x, i === 0 ? t : ""));
        return;
      }
    }
    texts.forEach((x, i) => write(x, translate(whole[i], lang)));
  }
  for (const a of ATTRS) {
    const now = el.getAttribute(a);
    if (now === null) continue;
    const mine = oursAttr.get(el) ?? {};
    const eng = englishAttr.get(el) ?? {};
    if (mine[a] !== now) eng[a] = now;
    englishAttr.set(el, eng);
    const t = translate(eng[a], lang);
    mine[a] = t;
    oursAttr.set(el, mine);
    if (t !== now) el.setAttribute(a, t);
  }
}

function translateTree(root: Element, lang: Lang) {
  if (skipped(root)) return;
  translateElement(root, lang);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => ((n as Element).getAttribute("translate") === "no" || SKIP_TAGS.has((n as Element).tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) translateElement(n as Element, lang);
}

/** Start translating the page (no-op in English). */
export function startTranslating() {
  const lang = currentLang();
  document.documentElement.lang = lang;
  if (lang === "en") return;
  // The browser's own boxes.
  const { confirm: c, alert: a, prompt: p } = window;
  window.confirm = (m?: string) => c.call(window, m === undefined ? m : translate(m, lang));
  window.alert = (m?: unknown) => a.call(window, typeof m === "string" ? translate(m, lang) : m);
  window.prompt = (m?: string, d?: string) => p.call(window, m === undefined ? m : translate(m, lang), d);

  translateTree(document.body, lang);
  new MutationObserver((records) => {
    const parents = new Set<Element>();
    for (const r of records) {
      if (r.type === "childList") {
        r.addedNodes.forEach((n) => {
          if (n.nodeType === Node.ELEMENT_NODE) translateTree(n as Element, lang);
          else if (n.parentElement) parents.add(n.parentElement);
        });
      } else if (r.type === "characterData") {
        if (r.target.parentElement) parents.add(r.target.parentElement);
      } else if (r.type === "attributes" && r.target.nodeType === Node.ELEMENT_NODE) {
        parents.add(r.target as Element);
      }
    }
    parents.forEach((el) => translateElement(el, lang));
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

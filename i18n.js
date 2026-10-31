'use strict';
(() => {
  const dictionaries = window.SITE_TRANSLATIONS || {};
  const locales = { en: 'en', fr: 'fr', ja: 'ja', zh: 'zh-Hans', 'zh-Hant': 'zh-Hant' };
  const storageKey = 'notes-and-music.language';
  let language = 'en';
  try { const saved = localStorage.getItem(storageKey); if (Object.hasOwn(locales, saved)) language = saved; } catch {}

  const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const templates = {};
  for (const [locale, dictionary] of Object.entries(dictionaries)) {
    templates[locale] = Object.keys(dictionary).filter(key => key.includes('{')).map(key => {
      const names = [];
      const pieces = key.split(/(\{[a-z]+\})/g).map(part => {
        const found = /^\{([a-z]+)\}$/.exec(part);
        if (!found) return escapeRegExp(part);
        names.push(found[1]);
        return '(.+?)';
      });
      return { key, names, regex: new RegExp(`^${pieces.join('')}$`) };
    });
  }
  function translate(value) {
    if (language === 'en' || !value) return value;
    const dictionary = dictionaries[language] || {};
    if (Object.hasOwn(dictionary, value)) return dictionary[value];
    for (const item of templates[language] || []) {
      const match = item.regex.exec(value);
      if (!match) continue;
      const replacements = Object.fromEntries(item.names.map((name, i) => [name, name === 'title' ? translate(match[i + 1]) : match[i + 1]]));
      return dictionary[item.key].replace(/\{([a-z]+)\}/g, (all, name) => replacements[name] ?? all);
    }
    return value;
  }
  window.translateSiteText = translate;

  // Keep the English source for each DOM value so switching languages never
  // translates an already translated string. User-authored text is excluded.
  const records = new WeakMap();
  const trackedAttributes = ['aria-label', 'placeholder', 'title', 'alt'];
  function applyValue(node, attribute) {
    const value = attribute ? node.getAttribute(attribute) : node.data;
    if (!value || !value.trim()) return;
    let values = records.get(node);
    if (!values) { values = {}; records.set(node, values); }
    const key = attribute || 'text';
    let record = values[key];
    if (!record || value !== record.last) record = values[key] = { original: value, last: value };
    const original = record.original;
    const leading = original.match(/^\s*/)[0];
    const trailing = original.match(/\s*$/)[0];
    const result = leading + translate(original.trim()) + trailing;
    record.last = result;
    if (value !== result) { if (attribute) node.setAttribute(attribute, result); else node.data = result; }
  }
  function excludedText(node) {
    return !!node.parentElement?.closest('script,style,textarea,input,canvas,#pdf-text,#note-list,#contact-list,[data-i18n-skip]');
  }
  function applyTree(root) {
    if (root.nodeType === Node.TEXT_NODE) { if (!excludedText(root)) applyValue(root); return; }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE && root.closest('[data-i18n-skip],#pdf-text')) return;
    const elements = root.nodeType === Node.ELEMENT_NODE ? [root, ...root.querySelectorAll('*')] : [...root.querySelectorAll('*')];
    for (const element of elements) {
      if (element.closest('[data-i18n-skip],#pdf-text')) continue;
      for (const attribute of trackedAttributes) if (element.hasAttribute(attribute)) applyValue(element, attribute);
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) if (!excludedText(walker.currentNode)) applyValue(walker.currentNode);
  }
  const holder = document.querySelector('.sidebar-language') || document.querySelector('.reader-header');
  const label = document.createElement('label'); label.className = 'language-selector';
  const labelText = document.createElement('span'); labelText.textContent = 'Language';
  const select = document.createElement('select'); select.setAttribute('aria-label', 'Language');
  const choices = [['en', 'English'], ['fr', 'Français'], ['ja', '日本語'], ['zh', '简体中文'], ['zh-Hant', '繁體中文']];
  for (const [value, name] of choices) { const option = document.createElement('option'); option.value = value; option.textContent = name; option.setAttribute('data-i18n-skip', ''); select.append(option); }
  select.value = language; label.append(labelText, select); holder?.append(label);
  function changeLanguage() {
    language = select.value;
    document.documentElement.lang = locales[language];
    try { localStorage.setItem(storageKey, language); } catch {}
    applyTree(document.body);
    window.dispatchEvent(new Event('site-language-change'));
  }
  select.addEventListener('change', changeLanguage);
  document.documentElement.lang = locales[language];
  applyTree(document.body);
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        if (mutation.target.hasAttribute(mutation.attributeName)) applyValue(mutation.target, mutation.attributeName);
      } else if (mutation.type === 'characterData') {
        if (!excludedText(mutation.target)) applyValue(mutation.target);
      } else for (const node of mutation.addedNodes) applyTree(node);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: trackedAttributes });
})();

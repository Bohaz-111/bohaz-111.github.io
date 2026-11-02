'use strict';
const $ = (selector) => document.querySelector(selector);
const labels = { home: 'Home', notes: 'Notes', 'sheet-music': 'Sheet Music', contacts: 'Contacts' };
$('.skip-link').addEventListener('click', event => { event.preventDefault(); $('#main').focus(); });
let studyNotes = [];
function route() {
  const requested = location.hash.slice(1);
  const current = Object.hasOwn(labels, requested) ? requested : 'home';
  document.querySelectorAll('.page').forEach(page => page.hidden = page.id !== current);
  document.querySelectorAll('.nav-item').forEach(link => { const active = link.hash === `#${current}`; link.classList.toggle('active', active); if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  document.title = `${window.translateSiteText(labels[current])} — Notes & Music`;
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function icon(id) { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.classList.add('icon'); s.setAttribute('aria-hidden', 'true'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', `#i-${id}`); s.append(u); return s; }
async function loadStudyNotes() {
  const status = $('#study-status');
  status.textContent = 'Loading your notes…';
  try {
    const response = await fetch('assets/notes/catalog.json?v=note-titles-2026');
    if (!response.ok) throw new Error('Notes unavailable');
    studyNotes = (await response.json()).sort((a, b) => a.number - b.number);
    const list = $('#study-list'); list.replaceChildren();
    for (const note of studyNotes) {
      const row = element('li', 'study-row');
      const title = element('a', 'study-title-link');
      title.href = `note.html?n=${note.number}`;
      title.append(element('span', 'study-number', `N${note.number}`));
      const detail = element('span', 'study-detail');
      detail.append(element('strong', '', note.title));
      const size = note.bytes >= 1000000 ? `${(note.bytes / 1000000).toFixed(1)} MB` : `${Math.round(note.bytes / 1000)} KB`;
      detail.append(element('small', '', `${note.pages} ${note.pages === 1 ? 'page' : 'pages'} · PDF · ${size}`));
      title.append(detail); row.append(title);
      const actions = element('div', 'study-actions');
      const view = element('a', 'study-view', 'View'); view.href = title.href; view.setAttribute('aria-label', `View N${note.number}: ${note.title}`);
      const download = element('a', 'icon-button'); download.append(icon('download')); download.setAttribute('aria-label', `Download N${note.number}: ${note.title}`); download.title = 'Download PDF';
      if (note.url) { download.href = note.url; download.download = note.originalFilename; }
      else { download.href = `${title.href}&download=1`; }
      actions.append(view, download); row.append(actions); list.append(row);
    }
    status.hidden = true;
  } catch {
    status.replaceChildren(document.createTextNode('The notes could not load. '));
    const retry = element('button', 'contact-edit', 'Try again');
    retry.type = 'button'; retry.addEventListener('click', loadStudyNotes); status.append(retry);
  }
}
window.addEventListener('hashchange', route);
window.addEventListener('site-language-change', () => {
  const current = Object.hasOwn(labels, location.hash.slice(1)) ? location.hash.slice(1) : 'home';
  document.title = `${window.translateSiteText(labels[current])} — Notes & Music`;
});
route(); loadStudyNotes();

// Keep each recording’s repeat control independent.
document.querySelectorAll('.audio-loop').forEach(button => {
  const audio = document.getElementById(button.getAttribute('aria-controls'));
  if (!audio) return;
  button.addEventListener('click', () => {
    audio.loop = !audio.loop;
    button.setAttribute('aria-pressed', String(audio.loop));
  });
});

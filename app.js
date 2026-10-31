'use strict';
const $ = (selector) => document.querySelector(selector);
const labels = { home: 'Home', notes: 'Notes', 'sheet-music': 'Sheet Music', contacts: 'Contacts' };
$('.skip-link').addEventListener('click', event => { event.preventDefault(); $('#main').focus(); });
$('#contact-dialog').setAttribute('aria-labelledby', 'contact-dialog-title');
const storageKey = 'notes-and-music.v1';
let state = { notes: [], contacts: [] };
try { const stored = JSON.parse(localStorage.getItem(storageKey)); if (stored && Array.isArray(stored.notes) && Array.isArray(stored.contacts)) state = stored; } catch {}
let selectedNote = state.notes[0]?.id || null;
let editingContact = null;
let undo = null;
let toastTimer;
let studyNotes = [];
const uid = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const dateLabel = (value) => new Date(value).toLocaleDateString(document.documentElement.lang, { month: 'short', day: 'numeric' });
function save() {
  try { localStorage.setItem(storageKey, JSON.stringify(state)); $('#note-status').textContent = 'Saved in this browser'; }
  catch { $('#note-status').textContent = 'Could not save in this browser'; notify('Browser storage is unavailable. Keep a copy of your changes.'); }
  updateCounts();
}
function updateCounts() {
  $('#home-note-count').textContent = studyNotes.length ? `${studyNotes.length} notes${state.notes.length ? ` · ${state.notes.length} personal` : ' in your collection'}` : state.notes.length ? `${state.notes.length} ${state.notes.length === 1 ? 'note' : 'notes'} in your notebook` : 'A blank page for your next idea';
  $('#home-contact-count').textContent = state.contacts.length ? `${state.contacts.length} ${state.contacts.length === 1 ? 'person' : 'people'} in your collection` : 'Keep the right people close';
}
function route() {
  const requested = location.hash.slice(1);
  const current = Object.hasOwn(labels, requested) ? requested : 'home';
  document.querySelectorAll('.page').forEach(page => page.hidden = page.id !== current);
  document.querySelectorAll('.nav-item').forEach(link => { const active = link.hash === `#${current}`; link.classList.toggle('active', active); if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  $('#current-section').textContent = labels[current];
  document.title = `${window.translateSiteText(labels[current])} — Notes & Music`;
  if (current === 'notes') renderNotes();
  if (current === 'contacts') renderContacts();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function icon(id) { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.classList.add('icon'); s.setAttribute('aria-hidden', 'true'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', `#i-${id}`); s.append(u); return s; }
async function loadStudyNotes() {
  const status = $('#study-status');
  status.textContent = 'Loading your notes…';
  try {
    const response = await fetch('assets/notes/catalog.json');
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
    $('#study-count').textContent = `${studyNotes.length} notes · ${studyNotes.reduce((sum, n) => sum + n.pages, 0)} pages`;
    status.hidden = true; updateCounts();
  } catch {
    status.replaceChildren(document.createTextNode('The notes could not load. '));
    const retry = element('button', 'contact-edit', 'Try again');
    retry.type = 'button'; retry.addEventListener('click', loadStudyNotes); status.append(retry);
  }
}
function notify(message, callback) {
  clearTimeout(toastTimer); undo = callback || null;
  $('#toast-message').textContent = message;
  $('#undo-action').hidden = !undo;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; undo = null; }, 8000);
}
$('#undo-action').addEventListener('click', () => { if (undo) undo(); undo = null; $('#toast').hidden = true; });
function renderNoteList() {
  const list = $('#note-list'); list.replaceChildren();
  for (const note of state.notes) {
    const button = element('button', `note-list-button${note.id === selectedNote ? ' selected' : ''}`);
    button.type = 'button'; button.setAttribute('aria-pressed', String(note.id === selectedNote));
    button.append(element('strong', '', note.title || window.translateSiteText('Untitled note')), element('small', '', dateLabel(note.updated)));
    button.addEventListener('click', () => { selectedNote = note.id; renderNotes(); }); list.append(button);
  }
}
function renderNotes() {
  $('#notes-empty').hidden = state.notes.length > 0;
  $('#notes-workspace').hidden = !state.notes.length;
  if (!state.notes.length) return;
  if (!state.notes.some(note => note.id === selectedNote)) selectedNote = state.notes[0].id;
  renderNoteList(); const note = state.notes.find(note => note.id === selectedNote);
  $('#note-title').value = note.title; $('#note-body').value = note.body;
}
function newNote() { const note = { id: uid(), title: '', body: '', updated: Date.now() }; state.notes.unshift(note); selectedNote = note.id; save(); renderNotes(); $('#notes-workspace').scrollIntoView({ block: 'start' }); $('#note-title').focus(); }
$('#new-note').addEventListener('click', newNote); $('#first-note').addEventListener('click', newNote);
for (const field of ['title', 'body']) $(`#note-${field}`).addEventListener('input', () => { const note = state.notes.find(n => n.id === selectedNote); if (!note) return; note[field] = $(`#note-${field}`).value; note.updated = Date.now(); save(); renderNoteList(); });
$('#delete-note').addEventListener('click', () => { const index = state.notes.findIndex(n => n.id === selectedNote); if (index < 0) return; const [removed] = state.notes.splice(index, 1); selectedNote = state.notes[0]?.id || null; save(); renderNotes(); notify('Note deleted', () => { state.notes.splice(index, 0, removed); selectedNote = removed.id; save(); renderNotes(); }); });
function openContact(contact = null) {
  editingContact = contact?.id || null;
  $('#contact-dialog-title').textContent = contact ? 'Edit contact' : 'Add a contact';
  $('#contact-name').value = contact?.name || ''; $('#contact-email').value = contact?.email || ''; $('#contact-detail').value = contact?.detail || '';
  $('#contact-dialog').showModal(); $('#contact-name').focus();
}
$('#new-contact').addEventListener('click', () => openContact()); $('#first-contact').addEventListener('click', () => openContact());
$('#close-dialog').addEventListener('click', () => $('#contact-dialog').close()); $('#cancel-contact').addEventListener('click', () => $('#contact-dialog').close());
$('#contact-form').addEventListener('submit', event => {
  event.preventDefault(); const name = $('#contact-name').value.trim(); if (!name) { $('#contact-name').setCustomValidity('Please enter a name.'); $('#contact-name').reportValidity(); return; }
  const contact = { id: editingContact || uid(), name, email: $('#contact-email').value.trim(), detail: $('#contact-detail').value.trim() };
  const index = state.contacts.findIndex(c => c.id === editingContact); if (index >= 0) state.contacts[index] = contact; else state.contacts.push(contact);
  state.contacts.sort((a, b) => a.name.localeCompare(b.name)); save(); renderContacts(); $('#contact-dialog').close();
});
$('#contact-name').addEventListener('input', () => $('#contact-name').setCustomValidity(''));
function renderContacts() {
  $('#contacts-empty').hidden = state.contacts.length > 0;
  const list = $('#contact-list'); list.replaceChildren();
  for (const contact of state.contacts) {
    const row = element('article', 'contact-row');
    const initials = contact.name.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
    row.append(element('div', 'contact-avatar', initials)); const content = element('div', 'contact-content');
    content.append(element('h2', '', contact.name)); if (contact.detail) content.append(element('p', '', contact.detail));
    if (contact.email) { const mail = element('a', '', contact.email); mail.href = `mailto:${contact.email}`; content.append(mail); }
    row.append(content); const actions = element('div', 'contact-actions'); const edit = element('button', 'contact-edit', window.translateSiteText('Edit')); edit.setAttribute('aria-label', `Edit ${contact.name}`); edit.addEventListener('click', () => openContact(contact));
    const remove = element('button', 'icon-button'); remove.setAttribute('aria-label', `Delete ${contact.name}`); remove.append(icon('trash'));
    remove.addEventListener('click', () => { const index = state.contacts.findIndex(c => c.id === contact.id); state.contacts.splice(index, 1); save(); renderContacts(); notify('Contact deleted', () => { state.contacts.push(contact); state.contacts.sort((a, b) => a.name.localeCompare(b.name)); save(); renderContacts(); }); });
    actions.append(edit, remove); row.append(actions); list.append(row);
  }
}
window.addEventListener('hashchange', route);
window.addEventListener('site-language-change', () => {
  const current = Object.hasOwn(labels, location.hash.slice(1)) ? location.hash.slice(1) : 'home';
  document.title = `${window.translateSiteText(labels[current])} — Notes & Music`;
  renderNoteList(); renderContacts(); updateCounts();
});
updateCounts(); route(); loadStudyNotes();

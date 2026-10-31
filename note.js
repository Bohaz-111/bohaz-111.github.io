'use strict';
import * as pdfjsLib from './vendor/pdfjs/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.mjs';
const get = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const requested = Number(params.get('n'));
let pdfBlobUrl;
let pdfDocument;
let currentPage = 1;
let renderTask;
let renderVersion = 0;
let fitWidth = true;

async function renderPage() {
  if (!pdfDocument) return;
  const version = ++renderVersion;
  if (renderTask) {
    renderTask.cancel();
    try { await renderTask.promise; } catch {}
  }
  const page = await pdfDocument.getPage(currentPage);
  if (version !== renderVersion) return;
  const surface = get('pdf-surface');
  const natural = page.getViewport({ scale: 1 });
  const slider = get('page-zoom');
  if (fitWidth) {
    const percent = Math.round((Math.min(960, Math.max(1, surface.clientWidth - 32)) / natural.width / 1.3333 * 100) / 5) * 5;
    slider.value = String(Math.max(Number(slider.min), Math.min(Number(slider.max), percent)));
  }
  const percent = Number(slider.value);
  get('zoom-value').textContent = `${percent}%`;
  slider.setAttribute('aria-valuetext', `${percent}%`);
  const scale = fitWidth ? Math.min(960, Math.max(1, surface.clientWidth - 32)) / natural.width : percent / 100 * 1.3333;
  const viewport = page.getViewport({ scale });
  const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(20000000 / (viewport.width * viewport.height)));
  const canvas = get('pdf-canvas');
  canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio);
  canvas.style.width = `${Math.ceil(viewport.width)}px`; canvas.style.height = `${Math.ceil(viewport.height)}px`;
  canvas.setAttribute('aria-label', `Page ${currentPage} of ${pdfDocument.numPages}`);
  get('page-number').value = currentPage;
  get('page-prev').disabled = currentPage === 1;
  get('page-next').disabled = currentPage === pdfDocument.numPages;
  renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] });
  try { await renderTask.promise; }
  catch (error) { if (error.name !== 'RenderingCancelledException') throw error; }
  if (version !== renderVersion) return;
  const text = await page.getTextContent();
  if (version === renderVersion) get('pdf-text').textContent = text.items.map(item => item.str).join(' ');
}

function changePage(value) {
  if (!pdfDocument) return;
  currentPage = Math.max(1, Math.min(pdfDocument.numPages, Math.floor(Number(value) || 1)));
  renderPage().catch(showError);
}

function showError(error) {
  get('reader-status').hidden = false;
  get('reader-message').textContent = error.message || 'The PDF could not be displayed. You can still open or download it above.';
  get('reader-progress').hidden = true;
  get('reader-retry').hidden = false;
}

async function readLargePdf(note) {
  const parts = [];
  let loaded = 0;
  const progress = get('reader-progress'); progress.hidden = false;
  for (const part of note.chunks) {
    const response = await fetch(part.url);
    if (!response.ok) throw new Error('The PDF could not be loaded.');
    const data = await response.arrayBuffer();
    if (data.byteLength !== part.bytes) throw new Error('The PDF download was interrupted.');
    parts.push(data); loaded += data.byteLength;
    progress.value = Math.round(loaded / note.bytes * 100);
    get('reader-message').textContent = `Loading your PDF… ${progress.value}%`;
  }
  const pdf = new Blob(parts, { type: 'application/pdf' });
  if (pdf.size !== note.bytes) throw new Error('The PDF download was interrupted.');
  if (crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', await pdf.arrayBuffer());
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== note.sha256) throw new Error('The PDF download was interrupted.');
  }
  pdfBlobUrl = URL.createObjectURL(pdf);
  return pdfBlobUrl;
}

async function loadNote() {
  const status = get('reader-status'); status.hidden = false;
  get('reader-message').textContent = 'Loading your note…';
  get('reader-retry').hidden = true;
  get('pdf-reader').hidden = true;
  get('reader-progress').hidden = true;
  get('reader-progress').value = 0;
  try {
    const response = await fetch('assets/notes/catalog.json');
    if (!response.ok) throw new Error('The notes could not be loaded.');
    const notes = (await response.json()).sort((a, b) => a.number - b.number);
    const index = notes.findIndex(note => note.number === requested);
    if (index < 0) throw new Error('This note was not found. Return to All notes to choose one.');
    const note = notes[index];
    document.title = `N${note.number} · ${window.translateSiteText(note.title)} — Notes & Music`;
    get('reader-number').textContent = `NOTE N${note.number}`;
    get('reader-title').textContent = note.title;
    get('reader-meta').textContent = `${note.pages} ${note.pages === 1 ? 'page' : 'pages'} · PDF`;
    get('reader-position').textContent = `${index + 1} of ${notes.length}`;
    for (const [id, adjacent] of [['reader-prev', notes[index - 1]], ['reader-next', notes[index + 1]]]) {
      const link = get(id); link.hidden = !adjacent;
      if (adjacent) { link.href = `note.html?n=${adjacent.number}`; link.title = `N${adjacent.number}: ${adjacent.title}`; }
    }
    const url = note.url || await readLargePdf(note);
    const open = get('reader-open'); open.href = url; open.hidden = false;
    const download = get('reader-download'); download.href = url; download.download = note.originalFilename; download.hidden = false;
    if (params.get('download') === '1') download.click();
    if (pdfDocument) await pdfDocument.destroy();
    pdfDocument = await pdfjsLib.getDocument({ url, cMapUrl: './vendor/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: './vendor/pdfjs/standard_fonts/', wasmUrl: './vendor/pdfjs/wasm/' }).promise;
    currentPage = 1;
    get('page-number').max = pdfDocument.numPages;
    get('page-total').textContent = `of ${pdfDocument.numPages}`;
    get('pdf-reader').hidden = false;
    await renderPage();
    status.hidden = true;
  } catch (error) {
    showError(error);
  }
}
get('reader-retry').addEventListener('click', loadNote);
get('page-prev').addEventListener('click', () => changePage(currentPage - 1));
get('page-next').addEventListener('click', () => changePage(currentPage + 1));
get('page-number').addEventListener('change', event => changePage(event.target.value));
get('page-zoom').addEventListener('input', event => {
  fitWidth = false;
  get('zoom-fit').setAttribute('aria-pressed', 'false');
  get('zoom-value').textContent = `${event.target.value}%`;
  event.target.setAttribute('aria-valuetext', `${event.target.value}%`);
  renderPage().catch(showError);
});
get('zoom-fit').addEventListener('click', () => {
  fitWidth = true;
  get('zoom-fit').setAttribute('aria-pressed', 'true');
  renderPage().catch(showError);
});
window.addEventListener('site-language-change', () => {
  const title = get('reader-title').textContent;
  if (requested && title) document.title = `N${requested} · ${title} — Notes & Music`;
});
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => renderPage().catch(showError), 180); });
window.addEventListener('pagehide', event => { if (!event.persisted && pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl); });
loadNote();

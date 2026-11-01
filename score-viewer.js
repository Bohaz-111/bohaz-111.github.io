'use strict';

// A score is loaded only when its preview is opened. The image remains a normal
// PDF link if JavaScript is unavailable.
let pdfLibrary;
let openViewer;
let openVersion = 0;

async function library() {
  if (!pdfLibrary) {
    pdfLibrary = import('./vendor/pdfjs/pdf.min.mjs').then(pdfjs => {
      pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.mjs';
      return pdfjs;
    });
  }
  return pdfLibrary;
}

function setupScore(card, index, selector = '.score-preview', isThesis = false) {
  const preview = card.querySelector(selector);
  if (!preview) return;
  const viewer = document.createElement('section');
  viewer.className = 'score-viewer';
  viewer.id = `score-viewer-${index}`;
  viewer.hidden = true;
  viewer.setAttribute('aria-label', 'PDF reader');
  viewer.innerHTML = `
    <div class="score-viewer-toolbar">
      <button class="score-viewer-previous button" type="button" aria-label="Previous page">←</button>
      <label>Page <input class="score-viewer-page" type="number" min="1" value="1" aria-label="Page number"></label>
      <span class="score-viewer-total"></span>
      <button class="score-viewer-next button" type="button" aria-label="Next page">→</button>
      <label class="score-viewer-zoom-label">Zoom <input class="score-viewer-zoom" type="range" min="25" max="300" step="5" value="100" aria-label="Zoom"></label>
      <output class="score-viewer-percent">100%</output>
      <button class="score-viewer-fit button" type="button">Fit width</button>
      <button class="score-viewer-close button" type="button">Close</button>
    </div>
    <p class="score-viewer-status" role="status" hidden></p>
    <div class="score-viewer-surface"><canvas role="img" aria-label="PDF page"></canvas><div class="score-viewer-text sr-only"></div></div>`;
  card.append(viewer);
  preview.setAttribute('role', 'button');
  preview.setAttribute('aria-expanded', 'false');
  preview.setAttribute('aria-controls', viewer.id);
  const $ = selector => viewer.querySelector(selector);
  const surface = $('.score-viewer-surface');
  const canvas = $('canvas');
  const status = $('.score-viewer-status');
  const previous = $('.score-viewer-previous');
  const next = $('.score-viewer-next');
  const pageInput = $('.score-viewer-page');
  const total = $('.score-viewer-total');
  const zoom = $('.score-viewer-zoom');
  const output = $('.score-viewer-percent');
  const fit = $('.score-viewer-fit');
  let pdfDocument;
  let loadingTask;
  let renderTask;
  let generation = 0;
  let currentPage = 1;
  let fitWidth = true;
  let resizeTimer;
  let pointerGesture;
  let turnAnimation;
  let turnVersion = 0;
  let turning = false;
  let wheelAmount = 0;
  let wheelTriggered = false;
  let wheelTimer;

  // When the page is zoomed wider than its container, leave horizontal
  // scrolling available and only turn at the relevant edge.
  function atPageEdge(direction) {
    if (surface.scrollWidth <= surface.clientWidth + 2) return true;
    return direction > 0
      ? surface.scrollLeft >= surface.scrollWidth - surface.clientWidth - 2
      : surface.scrollLeft <= 2;
  }
  function canTurn(direction) {
    return !!pdfDocument && !viewer.hidden && !turning &&
      currentPage + direction >= 1 && currentPage + direction <= pdfDocument.numPages;
  }
  function stopTurn() {
    ++turnVersion;
    if (turnAnimation) turnAnimation.cancel();
    turnAnimation = undefined;
    turning = false;
    canvas.style.transform = '';
    canvas.classList.remove('score-viewer-dragging');
  }

  function reportError() {
    if (viewer.hidden) return;
    status.textContent = isThesis ? 'The thesis could not be displayed.' : 'The score could not be displayed.';
    status.hidden = false;
  }
  function showPercent(value) {
    output.textContent = `${Math.round(value)}%`;
    zoom.value = Math.max(Number(zoom.min), Math.min(Number(zoom.max), Math.round(value / 5) * 5));
    zoom.setAttribute('aria-valuetext', `${Math.round(value)}%`);
  }
  async function renderPage() {
    if (!pdfDocument || viewer.hidden) return;
    const version = ++generation;
    if (renderTask) {
      renderTask.cancel();
      try { await renderTask.promise; } catch {}
    }
    let page;
    try { page = await pdfDocument.getPage(currentPage); }
    catch (error) { if (version !== generation || viewer.hidden) return; throw error; }
    if (version !== generation || viewer.hidden) return;
    const natural = page.getViewport({ scale: 1 });
    let scale;
    if (fitWidth) {
      scale = Math.min(960, Math.max(1, surface.clientWidth - 24)) / natural.width;
      showPercent(scale / (96 / 72) * 100);
    } else {
      scale = Number(zoom.value) / 100 * (96 / 72);
      showPercent(Number(zoom.value));
    }
    const viewport = page.getViewport({ scale });
    const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(20000000 / (viewport.width * viewport.height)));
    canvas.width = Math.ceil(viewport.width * ratio);
    canvas.height = Math.ceil(viewport.height * ratio);
    canvas.style.width = `${Math.ceil(viewport.width)}px`;
    canvas.style.height = `${Math.ceil(viewport.height)}px`;
    surface.classList.toggle('score-viewer-pannable', surface.scrollWidth > surface.clientWidth + 2);
    canvas.setAttribute('aria-label', `Page ${currentPage} of ${pdfDocument.numPages}`);
    pageInput.value = currentPage;
    pageInput.max = pdfDocument.numPages;
    total.textContent = `of ${pdfDocument.numPages}`;
    previous.disabled = currentPage <= 1;
    next.disabled = currentPage >= pdfDocument.numPages;
    renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] });
    try { await renderTask.promise; }
    catch (error) { if (error.name !== 'RenderingCancelledException') throw error; }
    if (version !== generation || viewer.hidden) return;
    let text;
    try { text = await page.getTextContent(); }
    catch (error) { if (version !== generation || viewer.hidden) return; throw error; }
    if (version === generation && !viewer.hidden) $('.score-viewer-text').textContent = text.items.map(item => item.str).join(' ');
  }
  function changePage(value) {
    if (!pdfDocument) return;
    stopTurn();
    currentPage = Math.max(1, Math.min(pdfDocument.numPages, Math.floor(Number(value) || 1)));
    renderPage().catch(reportError);
  }
  async function turnPage(direction, dragOffset = 0) {
    if (!canTurn(direction)) return;
    stopTurn();
    const version = turnVersion;
    turning = true;
    const motionAllowed = !window.matchMedia('(prefers-reduced-motion: reduce)').matches && typeof canvas.animate === 'function';
    try {
      if (motionAllowed) {
        // Fold the current page towards the edge before drawing the new page.
        turnAnimation = canvas.animate([
          { transform: `translateX(${dragOffset}px) rotateY(0deg)`, opacity: 1 },
          { transform: `translateX(${-direction * 35}px) rotateY(${direction * 9}deg)`, opacity: 0.25 }
        ], { duration: 150, easing: 'ease-in', fill: 'forwards' });
        await turnAnimation.finished;
      }
      if (version !== turnVersion || viewer.hidden || !pdfDocument) return;
      currentPage += direction;
      await renderPage();
      if (version !== turnVersion || viewer.hidden || !pdfDocument) return;
      if (turnAnimation) { turnAnimation.cancel(); turnAnimation = undefined; }
      if (motionAllowed) {
        turnAnimation = canvas.animate([
          { transform: `translateX(${direction * 35}px) rotateY(${-direction * 9}deg)`, opacity: 0.25 },
          { transform: 'translateX(0) rotateY(0deg)', opacity: 1 }
        ], { duration: 190, easing: 'ease-out' });
        await turnAnimation.finished;
      }
    } catch (error) {
      if (error.name !== 'AbortError') reportError();
    } finally {
      if (version === turnVersion) {
        if (turnAnimation) turnAnimation.cancel();
        turnAnimation = undefined;
        turning = false;
      }
    }
  }
  async function close() {
    stopTurn();
    pointerGesture = undefined;
    clearTimeout(wheelTimer);
    wheelAmount = 0;
    wheelTriggered = false;
    const version = ++generation;
    viewer.hidden = true;
    preview.setAttribute('aria-expanded', 'false');
    if (openViewer === close) openViewer = undefined;
    const previousRender = renderTask;
    const previousLoading = loadingTask;
    renderTask = undefined;
    loadingTask = undefined;
    pdfDocument = undefined;
    if (previousRender) {
      previousRender.cancel();
      try { await previousRender.promise; } catch {}
    }
    if (previousLoading) {
      try { await previousLoading.destroy(); } catch {}
    }
    if (version === generation && viewer.hidden) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
  async function open() {
    const request = ++openVersion;
    if (openViewer && openViewer !== close) await openViewer();
    if (request !== openVersion) return;
    openViewer = close;
    const version = ++generation;
    viewer.hidden = false;
    preview.setAttribute('aria-expanded', 'true');
    status.hidden = false;
    status.textContent = isThesis ? 'Loading thesis…' : 'Loading score…';
    currentPage = 1;
    fitWidth = true;
    try {
      const pdfjs = await library();
      if (version !== generation || viewer.hidden) return;
      loadingTask = pdfjs.getDocument({ url: preview.href, cMapUrl: new URL('./vendor/pdfjs/cmaps/', document.baseURI).href, cMapPacked: true, standardFontDataUrl: new URL('./vendor/pdfjs/standard_fonts/', document.baseURI).href, wasmUrl: new URL('./vendor/pdfjs/wasm/', document.baseURI).href });
      const loaded = await loadingTask.promise;
      if (version !== generation || viewer.hidden) { await loaded.destroy(); return; }
      pdfDocument = loaded;
      status.hidden = true;
      await renderPage();
      if (!viewer.hidden) viewer.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (error) { if (!viewer.hidden && openViewer === close) reportError(error); }
  }
  preview.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    if (viewer.hidden) open(); else { ++openVersion; close(); }
  });
  preview.addEventListener('keydown', event => {
    if (event.key === ' ') { event.preventDefault(); preview.click(); }
  });
  previous.addEventListener('click', () => changePage(currentPage - 1));
  next.addEventListener('click', () => changePage(currentPage + 1));
  pageInput.addEventListener('change', () => changePage(pageInput.value));
  zoom.addEventListener('input', () => { stopTurn(); fitWidth = false; showPercent(Number(zoom.value)); renderPage().catch(reportError); });
  fit.addEventListener('click', () => { stopTurn(); fitWidth = true; renderPage().catch(reportError); });
  canvas.addEventListener('pointerdown', event => {
    if (!event.isPrimary) { pointerGesture = undefined; canvas.style.transform = ''; canvas.classList.remove('score-viewer-dragging'); return; }
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (!pdfDocument || viewer.hidden || turning) return;
    // Let touch devices pan naturally when the zoomed page overflows.
    if (event.pointerType !== 'mouse' && surface.classList.contains('score-viewer-pannable')) return;
    pointerGesture = { id: event.pointerId, x: event.clientX, y: event.clientY, active: false, offset: 0 };
  });
  canvas.addEventListener('pointermove', event => {
    if (!pointerGesture || pointerGesture.id !== event.pointerId) return;
    const dx = event.clientX - pointerGesture.x;
    const dy = event.clientY - pointerGesture.y;
    if (!pointerGesture.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { pointerGesture = undefined; return; }
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
      const direction = dx < 0 ? 1 : -1;
      if (!atPageEdge(direction) || !canTurn(direction)) { pointerGesture = undefined; return; }
      pointerGesture.active = true;
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('score-viewer-dragging');
    }
    event.preventDefault();
    pointerGesture.offset = Math.max(-45, Math.min(45, dx * 0.35));
    canvas.style.transform = `translateX(${pointerGesture.offset}px)`;
  });
  function endPointer(event, cancelled = false) {
    if (!pointerGesture || pointerGesture.id !== event.pointerId) return;
    const gesture = pointerGesture;
    pointerGesture = undefined;
    canvas.classList.remove('score-viewer-dragging');
    canvas.style.transform = '';
    if (!cancelled && gesture.active && Math.abs(event.clientX - gesture.x) >= 50) {
      const direction = event.clientX < gesture.x ? 1 : -1;
      if (atPageEdge(direction) && canTurn(direction)) turnPage(direction, gesture.offset);
    }
  }
  canvas.addEventListener('pointerup', event => endPointer(event));
  canvas.addEventListener('pointercancel', event => endPointer(event, true));
  canvas.addEventListener('lostpointercapture', event => endPointer(event, true));
  surface.addEventListener('wheel', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !pdfDocument || viewer.hidden) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? surface.clientWidth : 1;
    const dx = event.deltaX * unit;
    const dy = event.deltaY * unit;
    if (Math.abs(dx) < 1 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    const direction = dx > 0 ? 1 : -1;
    if (!atPageEdge(direction) || (!wheelTriggered && !canTurn(direction))) return;
    event.preventDefault();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { wheelAmount = 0; wheelTriggered = false; }, 220);
    if (wheelTriggered) return;
    if (wheelAmount && Math.sign(wheelAmount) !== Math.sign(dx)) wheelAmount = 0;
    wheelAmount += dx;
    if (Math.abs(wheelAmount) >= 70) {
      wheelTriggered = true;
      wheelAmount = 0;
      turnPage(direction);
    }
  }, { passive: false });
  $('.score-viewer-close').addEventListener('click', async () => { const request = ++openVersion; await close(); if (request === openVersion && viewer.hidden) preview.focus(); });
  window.addEventListener('resize', () => {
    if (!fitWidth || viewer.hidden) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { stopTurn(); renderPage().catch(reportError); }, 180);
  });
}
document.querySelectorAll('#sheet-music .score-detail').forEach((card, index) => setupScore(card, index + 1));

const thesisEntry = document.querySelector('.thesis-preview')?.closest('.cv-entry');
if (thesisEntry) setupScore(thesisEntry, 'thesis', '.thesis-preview', true);

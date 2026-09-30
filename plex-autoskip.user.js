// ==UserScript==
// @name         Plex Auto Skip
// @namespace    https://github.com/polo2005x/plex-autoskip
// @version      3.0.0
// @description  Auto-click Skip Intro / Skip Credits / Play Next in Plex Web. Toggle each from a small on-screen panel. Language-independent (matches stable attributes, not button text).
// @author       polo2005x
// @homepageURL  https://github.com/polo2005x/plex-autoskip
// @supportURL   https://github.com/polo2005x/plex-autoskip/issues
// @downloadURL  https://raw.githubusercontent.com/polo2005x/plex-autoskip/main/plex-autoskip.user.js
// @updateURL    https://raw.githubusercontent.com/polo2005x/plex-autoskip/main/plex-autoskip.user.js
// @match        *://app.plex.tv/*
// @include      /^https?:\/\/[^/]+\.plex\.direct(:\d+)?\/web\/.*$/
// @include      /^https?:\/\/[^/]+:32400\/web\/.*$/
// @run-at       document-start
// @grant        none
// ==/UserScript==

// NOTE: @grant is intentionally "none" so the script runs in the PAGE context.
// Plex's Skip/Play buttons are React components whose click handlers live in the
// page context; a userscript running in an extension sandbox (which any @grant
// GM_* enables) can focus them but its synthetic clicks never reach React, so
// nothing skips. Running in the page context is what makes the clicks register.
// Toggles therefore use an on-page panel + localStorage instead of a GM menu.

(function () {
  'use strict';

  /* ============================================================
   *  TOGGLES — change these from the on-screen panel (bottom-left
   *  of Plex). The values below are only first-run defaults; after
   *  that your panel choices are remembered (localStorage).
   * ============================================================ */
  const DEFAULTS = {
    skipIntro:   true,   // click "Skip Intro" (and "Skip Recap")
    skipCredits: true,   // click "Skip Credits"
    playNext:    true,   // click "Play Next" / "Up Next" (auto-advance episode)
    debug:       true,   // log to the console when it skips something
  };

  /* ============================================================
   *  ADVANCED — timing knobs. Fine to leave as-is.
   * ============================================================ */
  const CLICK_DELAY_MS     = 500;  // wait after a button appears before clicking
  const RESCAN_INTERVAL_MS = 1000; // safety-net re-scan (catches CSS fade-ins that
                                   // fire no DOM mutation, e.g. Play Next). 0 = off.

  /* ============================================================
   *  DETECTION
   *  Buttons are found by stable CSS class (Plex ships localized text,
   *  so we never match labels). Class hashes change per build, so we
   *  match the stable prefix with [class*="..."]. A found button is
   *  then classified by matching its text/aria-label against KEYWORDS.
   * ============================================================ */
  const CANDIDATE_SELECTORS = [
    'button[class*="AudioVideoFullPlayer-overlayButton"]', // Skip Intro / Skip Credits
    'button[class*="AudioVideoUpNext-playButton"]',        // Play Next (Up Next card)
    'button[class*="overlayButton"]',                      // looser fallback
  ];

  const KEYWORDS = {
    skipIntro:   ['intro', 'recap', 'sammanfattning'],
    skipCredits: ['credit', 'eftertext', 'sluttext', 'rulltext'],
    playNext:    ['next', 'nästa', 'up next'],
  };

  const LABELS = {
    skipIntro:   'Skip Intro',
    skipCredits: 'Skip Credits',
    playNext:    'Play Next',
    debug:       'Console log',
  };

  /* ============================================================
   *  SETTINGS STORAGE (localStorage — works in page context)
   * ============================================================ */
  const LS_PREFIX = 'plexAutoSkip.';
  function getSetting(key) {
    try {
      const v = localStorage.getItem(LS_PREFIX + key);
      return v === null ? DEFAULTS[key] : v === '1';
    } catch (e) { return DEFAULTS[key]; }
  }
  function setSetting(key, value) {
    try { localStorage.setItem(LS_PREFIX + key, value ? '1' : '0'); } catch (e) {}
  }

  /* ============================================================
   *  INTERNALS
   * ============================================================ */
  const TAG = '[Plex Auto Skip]';
  const clicked = new WeakSet();
  const pending = new WeakSet();

  function log(...args) {
    if (getSetting('debug')) console.log(TAG, ...args);
  }

  function isClickable(el) {
    if (!el || el.disabled) return false;
    if (el.getAttribute('aria-disabled') === 'true') return false;
    if (!el.isConnected) return false;
    if (el.getClientRects().length === 0) return false;
    return true;
  }

  // Some Plex buttons (e.g. Play Next) react to pointer/mouse events, not a
  // plain .click(). Dispatch the full sequence so every button type responds.
  function robustClick(el) {
    const opts = { bubbles: true, cancelable: true, view: window, button: 0 };
    try { el.focus({ preventScroll: true }); } catch (e) {}
    const sequence = [
      ['pointerover', PointerEvent], ['pointerenter', PointerEvent],
      ['pointerdown', PointerEvent], ['mousedown', MouseEvent],
      ['pointerup', PointerEvent],   ['mouseup', MouseEvent],
      ['click', MouseEvent],
    ];
    for (const [type, Ctor] of sequence) {
      try { el.dispatchEvent(new Ctor(type, opts)); } catch (e) {}
    }
  }

  function classify(el) {
    const text = [
      el.textContent || '',
      el.getAttribute('aria-label') || '',
      el.getAttribute('title') || '',
    ].join(' ').trim().toLowerCase();
    if (!text) return null;
    for (const category of Object.keys(KEYWORDS)) {
      if (KEYWORDS[category].some((kw) => text.includes(kw))) return category;
    }
    return null;
  }

  function scheduleClick(el, category) {
    pending.add(el);
    const label = (el.textContent || el.getAttribute('aria-label') || category).trim();
    log(`Found "${label}" [${category}] — clicking in ${CLICK_DELAY_MS}ms`, el);
    setTimeout(() => {
      pending.delete(el);
      if (clicked.has(el)) return;
      if (!isClickable(el)) { log(`"${label}" gone before click`); return; }
      clicked.add(el);
      robustClick(el);
      log(`Clicked "${label}" [${category}]`);
    }, CLICK_DELAY_MS);
  }

  function scan() {
    const seen = new Set();
    for (const sel of CANDIDATE_SELECTORS) {
      let nodes;
      try { nodes = document.querySelectorAll(sel); } catch (e) { continue; }
      for (const el of nodes) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (clicked.has(el) || pending.has(el)) continue;
        if (!isClickable(el)) continue;
        const category = classify(el);
        if (!category) continue;
        if (!getSetting(category)) continue;
        scheduleClick(el, category);
      }
    }
  }

  let scanQueued = false;
  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => { scanQueued = false; scan(); });
  }

  /* ============================================================
   *  ON-PAGE TOGGLE PANEL
   * ============================================================ */
  const PANEL_ID = 'plex-auto-skip-panel';

  function buildPanel() {
    if (!document.body || document.getElementById(PANEL_ID)) return;

    const collapsed = getSetting('_panelCollapsed');

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    Object.assign(panel.style, {
      position: 'fixed', left: '10px', bottom: '10px', zIndex: '2147483647',
      font: '12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif',
      color: '#fff', background: 'rgba(20,20,20,0.88)',
      border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px',
      padding: '6px 8px', userSelect: 'none', backdropFilter: 'blur(2px)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.4)', maxWidth: '170px',
    });

    // Header (click to collapse/expand)
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
      fontWeight: '600', color: '#e5a00d', /* Plex gold */
    });
    const caret = document.createElement('span');
    caret.textContent = collapsed ? '▸' : '▾';
    const title = document.createElement('span');
    title.textContent = 'Auto Skip';
    header.appendChild(caret);
    header.appendChild(title);
    panel.appendChild(header);

    // Body with checkboxes
    const body = document.createElement('div');
    body.style.marginTop = '6px';
    body.style.display = collapsed ? 'none' : 'block';

    for (const key of ['skipIntro', 'skipCredits', 'playNext', 'debug']) {
      const row = document.createElement('label');
      Object.assign(row.style, {
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '2px 0', cursor: 'pointer',
        opacity: key === 'debug' ? '0.7' : '1',
      });
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = getSetting(key);
      cb.style.cursor = 'pointer';
      cb.addEventListener('change', () => {
        setSetting(key, cb.checked);
        log(`Toggle ${key} -> ${cb.checked}`);
      });
      const span = document.createElement('span');
      span.textContent = LABELS[key];
      row.appendChild(cb);
      row.appendChild(span);
      body.appendChild(row);
    }
    panel.appendChild(body);

    header.addEventListener('click', () => {
      const nowCollapsed = body.style.display !== 'none';
      body.style.display = nowCollapsed ? 'none' : 'block';
      caret.textContent = nowCollapsed ? '▸' : '▾';
      setSetting('_panelCollapsed', nowCollapsed);
    });

    document.body.appendChild(panel);
  }

  // Re-add the panel if Plex ever wipes the body.
  function ensurePanel() {
    if (document.body && !document.getElementById(PANEL_ID)) buildPanel();
  }

  /* ============================================================
   *  START
   * ============================================================ */
  function start() {
    ensurePanel();

    new MutationObserver(() => { queueScan(); ensurePanel(); })
      .observe(document.documentElement, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ['class', 'aria-disabled', 'disabled', 'style'],
      });

    queueScan();
    if (RESCAN_INTERVAL_MS > 0) setInterval(() => { queueScan(); ensurePanel(); }, RESCAN_INTERVAL_MS);

    log('Loaded.', {
      skipIntro: getSetting('skipIntro'),
      skipCredits: getSetting('skipCredits'),
      playNext: getSetting('playNext'),
    });
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();

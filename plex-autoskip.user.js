// ==UserScript==
// @name         Plex Auto Skip
// @namespace    https://github.com/polo2005x/plex-autoskip
// @version      2.0.0
// @description  Auto-click Skip Intro / Skip Credits / Play Next in Plex Web. Toggle each from the Violentmonkey menu. Language-independent (matches stable attributes, not button text).
// @author       polo2005
// @homepageURL  https://github.com/polo2005x/plex-autoskip
// @supportURL   https://github.com/polo2005x/plex-autoskip/issues
// @downloadURL  https://raw.githubusercontent.com/polo2005x/plex-autoskip/main/plex-autoskip.user.js
// @updateURL    https://raw.githubusercontent.com/polo2005x/plex-autoskip/main/plex-autoskip.user.js
// @match        *://app.plex.tv/*
// @include      /^https?:\/\/[^/]+\.plex\.direct(:\d+)?\/web\/.*$/
// @include      /^https?:\/\/[^/]+:32400\/web\/.*$/
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  /* ============================================================
   *  TOGGLES — change these from the Violentmonkey menu (click the
   *  extension icon). The values below are just the defaults used
   *  the first time the script runs; after that your menu choices
   *  are remembered.
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
  const CLICK_DELAY_MS    = 500;   // wait after a button appears before clicking
  const RESCAN_INTERVAL_MS = 1000; // safety-net re-scan (catches CSS fade-ins that
                                   // fire no DOM mutation, e.g. Play Next). 0 = off.

  /* ============================================================
   *  HOW BUTTONS ARE FOUND
   *
   *  Detection is by stable CLASS (Plex ships localized text, so we
   *  never match on labels). Class name hashes change per Plex build,
   *  so we match the stable prefix with [class*="..."].
   *
   *  A found button is then CLASSIFIED into a category by matching its
   *  text / aria-label against KEYWORDS, so the toggles work. Anything
   *  unrecognized is left alone (keeps it from mis-clicking).
   *
   *  If Plex renames a class, update CANDIDATE_SELECTORS. If Plex is in
   *  a language not covered, add a lowercase word to KEYWORDS.
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

  /* ============================================================
   *  SETTINGS STORAGE (persisted via Violentmonkey)
   * ============================================================ */
  function getSetting(key) {
    try { return GM_getValue(key, DEFAULTS[key]); }
    catch (e) { return DEFAULTS[key]; }
  }
  function setSetting(key, value) {
    try { GM_setValue(key, value); } catch (e) { /* ignore */ }
  }

  /* ============================================================
   *  MENU (Violentmonkey / Tampermonkey extension icon)
   * ============================================================ */
  const MENU_ITEMS = [
    ['skipIntro',   'Skip Intro'],
    ['skipCredits', 'Skip Credits'],
    ['playNext',    'Play Next'],
    ['debug',       'Console logging'],
  ];
  let menuIds = [];

  function buildMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    if (typeof GM_unregisterMenuCommand === 'function') {
      for (const id of menuIds) { try { GM_unregisterMenuCommand(id); } catch (e) {} }
    }
    menuIds = [];
    for (const [key, label] of MENU_ITEMS) {
      const on = getSetting(key);
      const title = `${on ? '✅' : '⬜'} ${label}: ${on ? 'ON' : 'OFF'}`;
      let id;
      try {
        id = GM_registerMenuCommand(title, () => {
          setSetting(key, !on);
          buildMenu();          // refresh labels
        }, { autoClose: false });
      } catch (e) {
        // Older engines: no options arg.
        id = GM_registerMenuCommand(title, () => { setSetting(key, !on); buildMenu(); });
      }
      menuIds.push(id);
    }
  }

  /* ============================================================
   *  INTERNALS
   * ============================================================ */
  const TAG = '[Plex Auto Skip]';
  const clicked = new WeakSet();   // elements already clicked
  const pending = new WeakSet();   // elements with a click scheduled

  function log(...args) {
    if (getSetting('debug')) console.log(TAG, ...args);
  }

  // Only reject genuinely non-rendered / disabled elements. We do NOT gate on
  // opacity or size: Plex's Play Next button wraps an absolutely-positioned SVG
  // (button reports 0 size) and fades in via CSS opacity; a synthetic click
  // works regardless.
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
    try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    const sequence = [
      ['pointerover', PointerEvent], ['pointerenter', PointerEvent],
      ['pointerdown', PointerEvent], ['mousedown', MouseEvent],
      ['pointerup', PointerEvent],   ['mouseup', MouseEvent],
      ['click', MouseEvent],
    ];
    for (const [type, Ctor] of sequence) {
      try { el.dispatchEvent(new Ctor(type, opts)); } catch (e) { /* ignore */ }
    }
  }

  // Returns 'skipIntro' | 'skipCredits' | 'playNext' | null
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
      if (!isClickable(el)) {
        log(`"${label}" disappeared before click — skipping`);
        return;
      }
      clicked.add(el);
      robustClick(el);
      log(`Clicked "${label}" [${category}]`);
    }, CLICK_DELAY_MS);
  }

  function scan() {
    const seen = new Set();
    for (const sel of CANDIDATE_SELECTORS) {
      let nodes;
      try { nodes = document.querySelectorAll(sel); }
      catch (e) { continue; }
      for (const el of nodes) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (clicked.has(el) || pending.has(el)) continue;
        if (!isClickable(el)) continue;

        const category = classify(el);
        if (!category) continue;      // not one of ours — leave it alone
        if (!getSetting(category)) continue; // toggle is off
        scheduleClick(el, category);
      }
    }
  }

  // Coalesce mutation bursts into one scan per frame.
  let scanQueued = false;
  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => { scanQueued = false; scan(); });
  }

  function start() {
    buildMenu();

    new MutationObserver(queueScan).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'aria-disabled', 'disabled', 'style'],
    });
    queueScan();

    if (RESCAN_INTERVAL_MS > 0) setInterval(queueScan, RESCAN_INTERVAL_MS);

    log('Loaded.', {
      skipIntro: getSetting('skipIntro'),
      skipCredits: getSetting('skipCredits'),
      playNext: getSetting('playNext'),
    });
  }

  // @run-at document-start can fire before <html> exists.
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();

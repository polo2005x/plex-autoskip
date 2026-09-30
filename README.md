# Plex Auto Skip

A userscript for [Violentmonkey](https://violentmonkey.github.io/) / Tampermonkey that automatically clicks Plex Web's **Skip Intro**, **Skip Credits**, and **Play Next** buttons.

Plex Web has no built-in "auto skip" setting, and no way to shorten the auto-play countdown — this fills that gap.

## Features

- **Auto-clicks** Skip Intro, Skip Credits, and Play Next as they appear.
- **Per-action toggles** from a small on-screen panel — no editing required, choices are remembered.
- **Language-independent detection** — finds buttons by stable CSS classes, not their text, so it works in any Plex UI language.
- **Efficient** — driven by a `MutationObserver` with a light once-per-second safety-net re-scan (for buttons that fade in without firing a DOM mutation).
- Never clicks the same button twice; short configurable delay before clicking.
- Console logging you can toggle on/off for debugging.

## Install

1. Install [Violentmonkey](https://violentmonkey.github.io/) (or Tampermonkey) in your browser.
2. Open [`plex-autoskip.user.js`](plex-autoskip.user.js) → **Raw**, and Violentmonkey will offer to install it.
   - Or: Violentmonkey icon → **Create a new script**, paste the file contents, **Ctrl+S**.
3. Open Plex Web and play something. Hard-reload the tab (**Ctrl+Shift+R**) if it was already open.

Works on:

- `https://app.plex.tv/*` (Plex cloud app)
- `https://*.plex.direct:*/web/*` (secure local server connections)
- `http(s)://<host>:32400/web/*` (direct local server access)

## Usage

A small **Auto Skip** panel appears at the bottom-left **together with the player
controls** — it shows when you move the mouse (or while paused) during playback and
auto-hides with the controls after a few seconds, staying hidden on the home/browse
screens. Click its header to collapse/expand it; tick/untick each action:

- Skip Intro
- Skip Credits
- Play Next
- Console log (debug logging)

**Drag** the panel by its "Auto Skip" header to reposition it anywhere; the spot is
remembered. **Double-click** the header to reset it to the default position.

Changes apply immediately and are remembered (stored in `localStorage`).

> The panel is used instead of a Violentmonkey menu on purpose: the script runs
> with `@grant none` so it executes in the page context. That's required for the
> synthetic clicks to reach Plex's React handlers — a sandboxed script (which any
> `@grant GM_*` enables) can focus the buttons but its clicks don't register.

## Configuration

Most people only need the menu toggles. For fine-tuning, edit the constants near the top of the script:

| Setting | Default | What it does |
| --- | --- | --- |
| `CLICK_DELAY_MS` | `500` | Delay after a button appears before clicking. |
| `RESCAN_INTERVAL_MS` | `1000` | Safety-net re-scan interval (ms). `0` disables it. |
| `DEFAULTS` | all `true` | First-run defaults for the toggles. |

## When Plex updates and it stops working

Plex's button class names include a build-specific hash (e.g. `AudioVideoFullPlayer-overlayButton-D2xSex`). The script matches only the **stable prefix**, so hash changes are fine — but if Plex renames the prefix itself, detection can break.

To fix it:

1. In Firefox/Chrome, play until the button appears.
2. Right-click it → **Inspect**.
3. Copy the `<button ...>` opening tag (its `class` and `aria-label`).
4. Update the matching entry in `CANDIDATE_SELECTORS` (detection by class) or `KEYWORDS` (classification by text/aria-label) in the script.

If Plex is in a language whose button wording isn't covered, just add a lowercase word to the relevant `KEYWORDS` list.

## How it works

1. A `MutationObserver` (plus the interval re-scan) looks for buttons matching `CANDIDATE_SELECTORS`.
2. Each match is classified into `skipIntro` / `skipCredits` / `playNext` by matching its text/`aria-label` against `KEYWORDS`.
3. If that category's toggle is on, it clicks the button (a full pointer + mouse + click event sequence, since some Plex buttons ignore a plain `.click()`).

## License

MIT — see [LICENSE](LICENSE).

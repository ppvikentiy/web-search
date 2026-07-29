# Page Word Search

[Русский](README.md)

A Chromium-based browser extension (Chrome, Edge, and compatible browsers) for on-page search with Russian morphology, text annotations, reader mode, offline page archives, a personal dictionary, and QR tools.

**Repository:** [https://github.com/ppvikentiy/web-search](https://github.com/ppvikentiy/web-search)  
**License:** [GNU General Public License v3.0](LICENSE) ([GPLv3](https://www.gnu.org/licenses/gpl-3.0.html))  
**Version:** 1.0.3 (Manifest V3)

**Display name in the browser:** «Поиск слов на странице» (Russian UI by default).

---

## Table of contents

- [Why it exists](#why-it-exists)
- [Features](#features)
- [Installation](#installation)
- [Quick start](#quick-start)
- [On-page search](#on-page-search)
- [Annotations](#annotations)
- [Reader mode](#reader-mode)
- [Offline archive](#offline-archive)
- [Dictionary](#dictionary)
- [QR codes](#qr-codes)
- [Settings](#settings)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Export](#export)
- [Russian morphology](#russian-morphology)
- [Project structure](#project-structure)
- [Permissions](#permissions)
- [Development and tests](#development-and-tests)
- [Limitations](#limitations)
- [Mission](#mission)
- [License](#license)
- [Links](#links)

---

## Why it exists

The browser’s built-in find does not understand Russian word forms: searching for «кот» will not match «кота», «коту», or «котами». This extension searches with morphology, highlights matches, lets you mark quotes with notes, open articles in a clean reader, save pages as ZIP archives for offline viewing, and keep a personal glossary of terms.

Everything runs locally in the browser: no account, no cloud, and no build step required before install.

---

## Features

| Module | Summary |
|--------|---------|
| **Search** | Words and phrases; case; whole word / substring; morphology; iframes and Shadow DOM |
| **Highlighting** | Colors for normal and current match; “N of M” navigation |
| **Annotations** | Quote highlights, notes, export, bibliography (GOST / APA / MLA / Chicago) |
| **Reader** | Mozilla Readability + DOMPurify; in-article search and annotations; Markdown |
| **Offline archive** | Self-contained ZIP (`index.html` + assets), journal, and built-in viewer |
| **Dictionary** | Folders, tags, word forms, JSON import/export, lookup from selection |
| **QR** | QR for the current page (copy / PNG) and decode QR from images |
| **Sidebar** | Same search and annotation tools docked at the page edge |

---

## Installation

The extension is not published to the Chrome Web Store yet — load it unpacked.

### 1. Get the source

```bash
git clone https://github.com/ppvikentiy/web-search.git
cd web-search
```

Or download a ZIP from GitHub: **Code → Download ZIP** and extract it.

### 2. Load in the browser

1. Open the extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the project folder — the one that contains `manifest.json`.
5. Optionally pin the icon to the toolbar.

No build is required: the extension is plain JavaScript. The `node_modules` folder is **not** needed to run in the browser (only for tests).

After code changes, click **Reload** on the extension card.

---

## Quick start

1. Open a normal `http://` or `https://` page (not `chrome://` / `edge://`).
2. Click the extension icon.
3. Enter a word or phrase → **Find** (or press Enter).
4. Step through matches with the popup arrows or **F3** / **Ctrl+G**.
5. Enable **Word forms** to search Russian inflections.
6. Enable **Annotation mode**, select text — a quote with note and export appears.

---

## On-page search

### How to open

- Toolbar popup
- **Pin to screen edge** — sidebar injected into the page
- Context menu on selected text: **Find on page**
- **Find selection** in the popup / sidebar

### Search options

| Option | Description |
|--------|-------------|
| **Match case** | «Дом» and «дом» are different matches |
| **Whole word** | Do not match inside other words («кот» ≠ «который») |
| **Word forms** | Russian morphology: «кот» → «кота», «коту», … |
| **Phrase mode** | Exact / flexible (spaces & punctuation) / morphology per word |
| **Match mode** | Whole word or substring |
| **Iframe / Shadow DOM** | Optional search in nested documents and shadow trees |
| **Exclusions** | HTML tags and CSS selectors to skip |

Matches are highlighted on the page; the active match uses a separate color. A counter shows the current position among all hits.

---

## Annotations

1. Turn on **Annotation mode** in the popup or sidebar.
2. Select a text fragment — an annotation is created.
3. Or select text and choose **Annotate** from the context menu.

### What you can do

- Add and edit a note on a quote
- Navigate annotations via a floating pill (counter, list, clear all)
- Export a quote (TXT / Markdown via template)
- Copy a bibliographic citation
- Export as literature
- Delete a note or the whole annotation

Style: background, underline, or both. Colors for normal and active annotations are configurable. Popup theme: system, light, dark, or custom colors.

Annotations are stored locally per page URL (`chrome.storage.local`). The URL hash is ignored; in reader mode the source article URL is used.

---

## Reader mode

Open from the popup (book icon), the context menu **Open in reader**, or from in-page extension logic.

### What happens

1. The article is extracted with **Mozilla Readability**.
2. HTML is sanitized with **DOMPurify**.
3. A `reader/reader.html` tab opens with clean text, title, and metadata.

### Inside the reader

- Search within the article (including morphology)
- Annotation mode and quote list
- Appearance: font size, line height, column width, background color
- **Back to original**
- Follow in-article links (extract the next article into the same reader)
- Export: download Markdown; copy plain text or Markdown (optionally with an annotations section)

---

## Offline archive

Saves a page as a self-contained ZIP for offline reading.

### How to save

- Download icon in the popup
- **Offline archive** section in settings
- Save by pasting a URL (background tab → archive → tab closed)

### ZIP contents

```
archive.zip
├── index.html      # page with rewritten local URLs
├── README.txt      # short notes
└── assets/
    ├── styles/
    ├── scripts/
    ├── fonts/
    ├── images/
    └── files/
```

### Journal and viewing

- Archive metadata lives in `chrome.storage.local`
- ZIP bytes live in IndexedDB (with cache eviction by size)
- Open from the journal, or pick / drop a ZIP → `archive/viewer.html`
- You can re-select the file if the cache was cleared

Before collecting resources, the page is scrolled to load lazy images. Limits apply to page size, per-resource size, and resource count (see `lib/defaults.js`).

---

## Dictionary

Personal glossary under Settings → **Dictionary**.

- Folders and tags
- Lemma, extra forms, description
- Search and filters
- JSON import and export
- Context menu on selection: **Look up in dictionary** (morphology-aware)

Data is stored in `chrome.storage.local` (schema v2). While annotation mode is on, the dictionary context-menu item is disabled so it does not interfere with quoting.

---

## QR codes

| Action | How |
|--------|-----|
| **Generate** | In the popup — QR for the current tab URL → copy link or download PNG |
| **Scan** | Right-click an image → **Scan QR code** → text, copy, open URL |

Decoding runs in the page or via an offscreen document when the image cannot be read directly.

---

## Settings

Open via the gear in the popup or the extension options page (`settings/settings.html`). Changes auto-save to `chrome.storage.sync`.

| Section | What you configure |
|---------|-------------------|
| **Search** | Case, whole word, morphology, phrase and match modes |
| **Highlighting** | Match colors |
| **Annotations** | Colors, style, popup theme, iframes, exclusions |
| **Quote export** | TXT / MD, fields (note, URL, title, date), templates `{text}` `{note}` `{url}` `{title}` `{date}` |
| **Literature export** | Preset: GOST, APA 7, MLA 9, Chicago |
| **Morphology** | Depth: basic or extended |
| **Dictionary** | Entry management |
| **Search scope** | Iframes, Shadow DOM |
| **Exclusions** | Tags and CSS selectors for search |
| **Offline archive** | Journal, save by URL, open ZIP |
| **About** | Version, license, mission (RU / EN / UK) |

Reset restores defaults from `lib/defaults.js`.

---

## Keyboard shortcuts

There are no global `commands` in `manifest.json` — shortcuts work on the page when search is active and in the reader (not in editable fields or over extension UI).

| Keys | Action |
|------|--------|
| **Enter** | Run search (input field) |
| **F3** | Next match |
| **Shift+F3** | Previous match |
| **Ctrl+G** / **Cmd+G** | Next match |
| **Ctrl+Shift+G** / **Cmd+Shift+G** | Previous match |

---

## Export

### Quotes (clipper)

- Formats: `.txt`, `.md`
- Template with placeholders; dates use the `ru-RU` locale by default
- Filename: `{quote-slug}_{YYYY-MM-DD}.{ext}`

### Literature

Presets for web sources (no author field from the page):

- **gost** — GOST (electronic resource)
- **apa7** — APA 7th
- **mla9** — MLA 9th
- **chicago** — Chicago (footnote style)

Actions: copy a bibliographic citation or download `.txt`.

### Reader

- Download Markdown (Turndown + GFM)
- Copy plain text or Markdown
- Optionally include an “Annotations” section

### Archive

- ZIP with `index.html`, `README.txt`, and an `assets/` folder

---

## Russian morphology

Engine: `content/morphology.js` + dictionary `content/morphology-dict.json`.

- Offline lemma dictionary (hundreds of lemmas; thousands of basic and extended forms)
- `ё` → `е` normalization
- Reverse form → lemma index
- Depth: `basic` or `extended`
- Heuristic stemming for Russian endings when a lemma is missing
- Phrase mode `morph` expands each word (combination cap)
- Word boundaries are Cyrillic-aware (`lib/word-boundary.js`)

Morphology is used in page search and in user-dictionary lookup.

---

## Project structure

```
web-search/
├── manifest.json          # Manifest V3
├── background/            # Service worker: menus, injection, reader, archive, QR
├── content/               # In-page scripts: search, annotations, dictionary, QR, archive collect
├── popup/                 # Toolbar popup
├── settings/              # Full options + dictionary + archive journal
├── reader/                # Reader tab
├── archive/               # Offline ZIP viewer
├── offscreen/             # Blob URLs and QR decode outside the service worker
├── lib/                   # Shared modules and vendored libraries
├── icons/                 # Extension icons
├── assets/                # Extra assets
├── tests/                 # Node tests
├── scripts/               # Helper scripts (e.g. make_icons.py)
├── LICENSE                # GPLv3
├── README.md              # Russian README
└── README-EN.md           # This file
```

### Vendored libraries in `lib/` / `content/`

| Library | Role |
|---------|------|
| Mozilla Readability | Article extraction |
| DOMPurify | Reader HTML sanitization |
| Turndown (+ GFM) | HTML → Markdown |
| fflate | ZIP archives |
| qrcode | QR generation |
| jsQR | QR recognition |

npm packages are **not** required to run the extension in the browser. `node_modules` is used only when running tests (including jsdom).

---

## Permissions

| Permission | Why |
|------------|-----|
| `activeTab` | Act on the current tab when the user invokes the extension |
| `scripting` | Inject CSS/JS into pages |
| `storage` | Settings, annotations, dictionary, journal, session data |
| `contextMenus` | Right-click items: search, annotate, dictionary, QR, reader |
| `tabs` | Reader/archive tabs, wait for load |
| `offscreen` | Blob URLs for downloads and QR decode |
| `downloads` | Save ZIP files |
| `<all_urls>` | Inject and fetch resources across sites |

`web_accessible_resources`: `content/morphology-dict.json` — available to content scripts.

---

## Development and tests

### Requirements for tests

- Node.js (modern LTS)
- npm

```bash
npm install
npm test
```

`npm test` runs, in order:

1. `tests/reader-export.mjs`
2. `tests/reader-export-copy.mjs`
3. `tests/offline-archive.mjs`
4. `tests/archive-journal.mjs`
5. `tests/citation-formats.mjs`

Additional (manual):

```bash
node tests/archive-bytes.mjs
node tests/reader-images.mjs
node tests/reader-annotation-scenario.mjs
```

### Versioning

When releasing, update together:

- `version` in `manifest.json`
- the content-script version constant in `background/background.js` (so reinjection picks up changes)

Icons can be regenerated with `scripts/make_icons.py`.

---

## Limitations

- Target platform is **Chromium** (Chrome / Edge). There is no separate Firefox build.
- Does not work on restricted pages: `chrome://`, `edge://`, `about:`, or extension pages.
- Cross-origin iframe search is limited by same-origin policy.
- The morphology dictionary covers common lemmas, not all of Russian; heuristics apply for missing words.
- Archives depend on resource availability and size limits; dynamic content after DOM freeze may differ from the live page.
- There are no global extension hotkeys in Chrome settings — only in-page shortcuts.

---

## Mission

Today the largest corporations and scientific publishers erect digital walls, demanding payment for access to knowledge. Current scientific discoveries, medical research, and humanity’s most important data are becoming a luxury available only to a chosen few.

This is fundamentally wrong. Knowledge must not be a commodity. It does not belong to corporations — it belongs to all of humanity.

We firmly believe that the right to information is fundamental. Access to knowledge must be open to every person on Earth — regardless of budget, nationality, origin, or geography. Borders and wallets must not decide how educated and free a person can be.

We do not have multimillion-dollar budgets to tear these walls down alone.

But we share a common goal and the technology.

Our small extension lets you conveniently read articles on the internet — browse, annotate, read, and even save them.

The full mission text (RU / EN / UK) is also available in Settings → **About**.

---

## License

This project is released under the **GNU General Public License version 3** (GPLv3).

Full text: the [LICENSE](LICENSE) file and [gnu.org/licenses/gpl-3.0.html](https://www.gnu.org/licenses/gpl-3.0.html).

In short: you may use, study, modify, and redistribute the program under the terms of GPLv3, including keeping derivative works free under the same license.

---

## Links

- Repository: [https://github.com/ppvikentiy/web-search](https://github.com/ppvikentiy/web-search)
- GPLv3 license: [https://www.gnu.org/licenses/gpl-3.0.html](https://www.gnu.org/licenses/gpl-3.0.html)
- Russian README: [README.md](README.md)

---

### Contributing

Issues and pull requests are welcome at the [GitHub repository](https://github.com/ppvikentiy/web-search). Before opening a PR, run `npm test` and try the main flows on a real page in Chrome or Edge.

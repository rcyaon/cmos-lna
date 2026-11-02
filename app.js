// App wiring: GitHub sources, per-pane controls, shared layer panel, URL state.
(function () {
  'use strict';

  // Repos to browse. `branch` / `file` are the defaults when nothing is in the URL.
  const SOURCES = [
    { id: 'sckzor', owner: 'sckzor', repo: 'CMOS_LNB', branch: 'rf-layout', file: 'Layout/LNA/LNAMkV.klay.gds' },
    { id: 'rcyaon', owner: 'rcyaon', repo: 'cmos-lna', branch: 'master', file: 'Layout/ReferenceMkII.gds' },
  ];
  const GDS_RE = /\.(gds|gds2|gdsii)$/i;
  const SECONDARY_RE = /(backup|\/output\/|\/old\/)/i; // listed last in the file menu
  const CACHE_MS = 10 * 60 * 1000;

  const $ = (id) => document.getElementById(id);
  const visible = new Map(); // layer key -> bool (default true)
  const libCache = new Map(); // url -> parsed library
  const isVisible = (k) => visible.get(k) !== false;

  // ---------- GitHub helpers ----------
  async function ghApi(path) {
    const url = 'https://api.github.com' + path;
    const ck = 'lv:' + url;
    try {
      const hit = JSON.parse(localStorage.getItem(ck) || 'null');
      if (hit && Date.now() - hit.t < CACHE_MS) return hit.data;
    } catch (e) { /* ignore */ }
    const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
    if (r.status === 403 || r.status === 429) throw new Error('GitHub API rate limit reached — try again in a few minutes.');
    if (!r.ok) throw new Error(`GitHub API ${r.status} for ${path}`);
    const data = await r.json();
    try { localStorage.setItem(ck, JSON.stringify({ t: Date.now(), data })); } catch (e) { /* quota */ }
    return data;
  }

  const branchesOf = (s) => ghApi(`/repos/${s.owner}/${s.repo}/branches?per_page=100`).then((b) => b.map((x) => x.name));

  async function gdsFilesOf(s, branch) {
    const t = await ghApi(`/repos/${s.owner}/${s.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
    return t.tree.filter((e) => e.type === 'blob' && GDS_RE.test(e.path)).map((e) => ({ path: e.path, size: e.size }));
  }

  const rawUrl = (s, branch, path) =>
    `https://raw.githubusercontent.com/${s.owner}/${s.repo}/${branch.split('/').map(encodeURIComponent).join('/')}/${path.split('/').map(encodeURIComponent).join('/')}`;

  async function download(url, onProgress) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Download failed (${r.status})`);
    const total = +r.headers.get('content-length') || 0;
    if (!r.body || !total) return r.arrayBuffer();
    const reader = r.body.getReader(), chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      onProgress(got, total);
    }
    const buf = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { buf.set(c, o); o += c.length; }
    return buf.buffer;
  }

  const mb = (n) => (n / 1048576).toFixed(n > 1048576 ? 1 : 2) + ' MB';

  // ---------- Panes ----------
  const panes = [];
  let activePane = null;
  const paneOpts = {
    isVisible,
    layerOrder: () => layerOrder,
    showLabels: () => $('nets').checked,
    showInstances: () => $('insts').checked,
    onHover: (p) => { activePane = p.ctl; },
  };
  let layerOrder = [];

  class PaneCtl {
    constructor(id, el, defaults) {
      this.id = id;
      this.el = el;
      this.view = new Pane(el, paneOpts);
      this.view.ctl = this;
      this.state = { src: defaults.id, branch: null, file: null, cell: null };
      this.local = null; // { name, lib }
      const tpl = $('pane-controls').content.firstElementChild.cloneNode(true);
      $('pane-docks').appendChild(tpl);
      this.dock = tpl;
      const q = (c) => tpl.querySelector(c);
      this.ui = {
        src: q('.src'), branch: q('.branch'), file: q('.file'), cell: q('.cell'), meta: q('.src-meta'),
        info: q('.info'), nshapes: q('.nshapes'), ncells: q('.ncells'), ruler: q('.ruler-btn'),
      };
      for (const s of SOURCES) this.ui.src.add(new Option(`${s.owner}/${s.repo}`, s.id));
      this.ui.src.add(new Option('Local file…', 'local'));

      this.ui.src.addEventListener('change', () => {
        if (this.ui.src.value === 'local') { this.openLocal(); return; }
        this.state = { src: this.ui.src.value, branch: null, file: null, cell: null };
        this.local = null;
        this.loadSource();
      });
      this.ui.branch.addEventListener('change', () => {
        this.state.branch = this.ui.branch.value; this.state.file = null; this.state.cell = null;
        this.loadBranch();
      });
      this.ui.file.addEventListener('change', () => {
        this.state.file = this.ui.file.value; this.state.cell = null;
        this.loadFile();
      });
      this.ui.cell.addEventListener('change', () => {
        this.state.cell = this.ui.cell.value;
        this.view.setCell(this.state.cell);
        this.afterCell();
      });
      q('.fit').addEventListener('click', () => this.view.fit());
      q('.reload').addEventListener('click', () => {
        for (const k of Object.keys(localStorage)) if (k.startsWith('lv:')) localStorage.removeItem(k);
        if (!this.local) { libCache.delete(this.url()); this.loadSource(); }
      });
      q('.open').addEventListener('click', () => this.openLocal());
      this.ui.ruler.addEventListener('click', () => this.toggleRuler());
      tpl.querySelector('h2').addEventListener('click', () => tpl.classList.toggle('shut'));

      // Drag & drop a .gds onto the pane.
      el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop'); });
      el.addEventListener('dragleave', () => el.classList.remove('drop'));
      el.addEventListener('drop', (e) => {
        e.preventDefault(); el.classList.remove('drop');
        const f = e.dataTransfer.files[0];
        if (f) this.loadLocalFile(f);
      });
    }

    source() { return SOURCES.find((s) => s.id === this.state.src) || SOURCES[0]; }
    url() { return rawUrl(this.source(), this.state.branch, this.state.file); }

    toggleRuler(force) {
      const on = force ?? !this.view.rulerMode;
      this.view.setRulerMode(on);
      this.ui.ruler.classList.toggle('on', on);
    }

    openLocal() {
      const inp = $('file-input');
      inp.value = '';
      inp.onchange = () => { if (inp.files[0]) this.loadLocalFile(inp.files[0]); else this.syncSrcSelect(); };
      inp.click();
      // If the dialog is cancelled, put the source menu back.
      setTimeout(() => this.syncSrcSelect(), 0);
    }

    syncSrcSelect() { this.ui.src.value = this.local ? 'local' : this.state.src; }

    async loadLocalFile(f) {
      this.view.setMessage(`Reading ${f.name}…`);
      try {
        const lib = GDS.parse(await f.arrayBuffer());
        this.local = { name: f.name, lib };
        this.ui.src.value = 'local';
        for (const s of [this.ui.branch, this.ui.file]) { s.innerHTML = ''; s.disabled = true; }
        this.ui.file.add(new Option(f.name, f.name));
        this.ui.meta.textContent = '';
        this.showLibrary(lib, f.name, null);
      } catch (e) {
        this.view.setMessage(`Could not read ${f.name}:\n${e.message}`);
      }
      saveHash();
    }

    async loadSource() {
      const s = this.source();
      this.syncSrcSelect();
      this.ui.branch.disabled = this.ui.file.disabled = false;
      this.view.setMessage('Listing branches…');
      try {
        const branches = await branchesOf(s);
        const br = [this.state.branch, s.branch, 'main', 'master'].find((b) => b && branches.includes(b)) || branches[0];
        this.state.branch = br;
        this.ui.branch.innerHTML = '';
        for (const b of branches) this.ui.branch.add(new Option(b, b));
        this.ui.branch.value = br;
        await this.loadBranch();
      } catch (e) {
        // API unavailable (e.g. rate limit): still open the known file straight from raw.githubusercontent.
        this.state.branch = this.state.branch || s.branch;
        this.state.file = this.state.file || s.file;
        this.ui.branch.innerHTML = ''; this.ui.file.innerHTML = '';
        this.ui.branch.add(new Option(this.state.branch, this.state.branch));
        this.ui.file.add(new Option(this.state.file.split('/').pop(), this.state.file));
        this.ui.meta.textContent = 'offline list';
        await this.loadFile();
        if (!this.view.cell) this.view.setMessage(e.message);
      }
    }

    async loadBranch() {
      const s = this.source();
      this.view.setMessage('Listing layout files…');
      this.ui.file.innerHTML = '';
      try {
        const files = await gdsFilesOf(s, this.state.branch);
        this.ui.meta.textContent = `${files.length} gds`;
        if (!files.length) {
          this.view.setLibrary(null); this.view.setCell(null);
          this.ui.cell.innerHTML = '';
          this.setTitle(`${s.owner}/${s.repo} @ ${this.state.branch}`);
          this.view.setMessage(`No .gds files on branch "${this.state.branch}".\nPick another branch.`);
          this.afterCell();
          return;
        }
        // Group by folder; backups / generated output go last.
        files.sort((a, b) => (SECONDARY_RE.test(a.path) - SECONDARY_RE.test(b.path)) || a.path.localeCompare(b.path));
        const groups = new Map();
        for (const f of files) {
          const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '/';
          if (!groups.has(dir)) groups.set(dir, []);
          groups.get(dir).push(f);
        }
        for (const [dir, list] of groups) {
          const g = document.createElement('optgroup');
          g.label = dir;
          for (const f of list) g.appendChild(new Option(`${f.path.split('/').pop()}  (${mb(f.size)})`, f.path));
          this.ui.file.appendChild(g);
        }
        const paths = files.map((f) => f.path);
        this.state.file = [this.state.file, s.file].find((p) => p && paths.includes(p)) || paths[0];
        this.ui.file.value = this.state.file;
        await this.loadFile();
      } catch (e) {
        this.view.setMessage(e.message);
      }
    }

    async loadFile() {
      const url = this.url(), name = this.state.file.split('/').pop();
      try {
        let lib = libCache.get(url);
        if (!lib) {
          this.view.setMessage(`Downloading ${name}…`);
          const buf = await download(url, (got, total) =>
            this.view.setMessage(`Downloading ${name}…\n${mb(got)} / ${mb(total)}`));
          this.view.setMessage(`Parsing ${name}…`);
          await new Promise((r) => setTimeout(r, 0));
          lib = GDS.parse(buf);
          libCache.set(url, lib);
        }
        if (this.url() !== url) return; // selection changed meanwhile
        const s = this.source();
        this.showLibrary(lib, `${s.owner}/${s.repo} @ ${this.state.branch} : ${this.state.file}`, this.state.cell);
      } catch (e) {
        this.view.setMessage(`Could not load ${name}:\n${e.message}`);
      }
    }

    showLibrary(lib, title, wantCell) {
      this.view.setLibrary(lib);
      this.ui.cell.innerHTML = '';
      const tops = lib.topCells;
      const others = [...lib.cells.values()].filter((c) => !tops.includes(c) && !c.name.startsWith('$$$'))
        .sort((a, b) => a.name.localeCompare(b.name));
      const add = (label, list) => {
        if (!list.length) return;
        const g = document.createElement('optgroup');
        g.label = label;
        for (const c of list) g.appendChild(new Option(c.name, c.name));
        this.ui.cell.appendChild(g);
      };
      add('top cells', tops);
      add('sub cells', others);
      const cell = (wantCell && lib.cells.has(wantCell)) ? wantCell : (tops[0] || others[0] || {}).name;
      this.state.cell = cell || null;
      if (cell) this.ui.cell.value = cell;
      this.ui.ncells.textContent = String(tops.length + others.length);
      this.setTitle(title);
      this.view.setMessage(cell ? '' : 'No cells in this file.');
      this.view.setCell(cell);
      this.afterCell();
    }

    setTitle(t) { this.el.querySelector('.title-text').textContent = t; }

    afterCell() {
      const c = this.view.cell;
      if (c && c.bbox) {
        const [x1, y1, x2, y2] = c.bbox, u = this.view.lib.dbuUm;
        this.ui.info.textContent = `${((x2 - x1) * u).toFixed(2)} × ${((y2 - y1) * u).toFixed(2)} µm`;
        let n = 0;
        for (const v of c.layerCountDeep.values()) n += v;
        this.ui.nshapes.textContent = n.toLocaleString('en-US');
      } else {
        this.ui.info.textContent = this.ui.nshapes.textContent = '–';
      }
      rebuildLayers();
      saveHash();
    }

    hashValue() {
      if (this.local) return null;
      const s = this.state;
      return [s.src, s.branch, s.file, s.cell].map((v) => v || '').join('|');
    }
  }

  // ---------- Layer panel ----------
  function stipple(st, i) {
    const c = ViewerUtil.rgba(st.color, 0.9), bg = ViewerUtil.rgba(st.color, 0.18);
    const pats = [
      `repeating-linear-gradient(45deg, ${c} 0 1px, transparent 1px 4px)`,
      `repeating-linear-gradient(-45deg, ${c} 0 1px, transparent 1px 4px)`,
      `repeating-linear-gradient(45deg, ${c} 0 1px, transparent 1px 4px), repeating-linear-gradient(-45deg, ${c} 0 1px, transparent 1px 4px)`,
      `radial-gradient(${c} 0.8px, transparent 1px) 0 0 / 3px 3px`,
      `repeating-linear-gradient(0deg, ${c} 0 1px, transparent 1px 3px)`,
      `repeating-linear-gradient(90deg, ${c} 0 1px, transparent 1px 3px)`,
    ];
    if (st.kind === 'via') return c;
    if (st.kind === 'label') return 'transparent';
    if (st.kind === 'marker' || st.kind === 'well' || st.kind === 'implant') return 'transparent';
    return `${pats[i % pats.length]}, ${bg}`;
  }

  function rebuildLayers() {
    const keys = new Set();
    for (const p of panes) if (p.view.cell) for (const k of p.view.cell.layersDeep) keys.add(k);
    layerOrder = [...keys].sort((a, b) => Layers.style(a).order - Layers.style(b).order);
    const ul = $('layers');
    ul.innerHTML = '';
    layerOrder.forEach((key, i) => {
      const st = Layers.style(key);
      const li = document.createElement('li');
      li.dataset.key = key;
      li.classList.toggle('off', !isVisible(key));
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox'; box.checked = isVisible(key);
      box.addEventListener('change', () => setVisible(key, box.checked));
      label.addEventListener('click', (e) => {
        if (!e.altKey) return;
        e.preventDefault();
        for (const k of layerOrder) visible.set(k, k === key);
        syncLayerChecks(); redraw();
      });
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = stipple(st, i);
      sw.style.borderColor = st.color;
      if (st.kind === 'marker' || st.kind === 'well' || st.kind === 'implant') sw.style.borderStyle = 'dashed';
      if (st.kind === 'label') { sw.textContent = 'T'; sw.style.cssText += `;color:${st.color};font-size:10px;line-height:10px;text-align:center;border-style:dotted`; }
      const name = document.createElement('span');
      name.className = 'lname';
      name.textContent = st.name || `layer ${key}`;
      const gds = document.createElement('span');
      gds.className = 'gds'; gds.textContent = key;
      label.append(box, sw, name, gds);
      for (const p of panes) {
        const cnt = document.createElement('span');
        cnt.className = 'count';
        const n = p.view.cell ? (p.view.cell.layerCountDeep.get(key) || countTexts(p.view.cell, key)) : 0;
        cnt.textContent = n ? compact(n) : '';
        label.append(cnt);
      }
      li.appendChild(label);
      ul.appendChild(li);
    });
  }

  function countTexts(cell, key, memo = new Map()) {
    if (memo.has(cell)) return memo.get(cell);
    let n = cell.texts.filter((t) => t.key === key).length;
    for (const r of cell.refs) if (r.cell) n += countTexts(r.cell, key, memo) * r.cols * r.rows;
    memo.set(cell, n);
    return n;
  }

  const compact = (n) => (n >= 10000 ? Math.round(n / 1000) + 'k' : String(n));

  function setVisible(key, on) {
    visible.set(key, on);
    syncLayerChecks();
    redraw();
  }

  function syncLayerChecks() {
    for (const li of document.querySelectorAll('#layers li')) {
      const on = isVisible(li.dataset.key);
      li.querySelector('input').checked = on;
      li.classList.toggle('off', !on);
    }
  }

  function preset(fn) {
    for (const k of layerOrder) visible.set(k, fn(Layers.style(k)));
    syncLayerChecks(); redraw();
  }

  const redraw = () => panes.forEach((p) => p.view.draw());

  // ---------- URL state ----------
  function saveHash() {
    const parts = [];
    for (const p of panes) {
      const v = p.hashValue();
      if (v) parts.push(`${p.id}=${encodeURIComponent(v)}`);
    }
    try { history.replaceState(null, '', '#' + parts.join('&')); } catch (e) { /* file:// in some browsers */ }
  }

  function readHash() {
    const out = {};
    for (const kv of location.hash.slice(1).split('&')) {
      const i = kv.indexOf('=');
      if (i > 0) out[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    }
    return out;
  }

  // ---------- Startup ----------
  function start() {
    const h = readHash();
    panes.push(new PaneCtl('a', $('pane-a'), SOURCES[0]));
    activePane = panes[0];
    for (const p of panes) {
      if (h[p.id]) {
        const [src, branch, file, cell] = h[p.id].split('|');
        if (SOURCES.some((s) => s.id === src)) p.state = { src, branch: branch || null, file: file || null, cell: cell || null };
      }
      p.loadSource();
    }
    $('all').addEventListener('click', () => preset(() => true));
    $('none').addEventListener('click', () => preset(() => false));
    $('metals').addEventListener('click', () => preset((s) =>
      /^(Metal|Via|MetalTop|FuseTop)/.test(s.name) || s.kind === 'label' || s.key === '0/0'));
    $('fe').addEventListener('click', () => preset((s) =>
      ['well', 'implant'].includes(s.kind) || /^(COMP|Poly2|Contact|Metal1)/.test(s.name) || s.key === '0/0'));
    $('nets').addEventListener('change', redraw);
    $('insts').addEventListener('change', redraw);

    const toggle = $('panel-toggle');
    toggle.addEventListener('click', () => {
      const c = document.body.classList.toggle('collapsed');
      toggle.textContent = c ? '‹' : '›';
      toggle.setAttribute('aria-expanded', String(!c));
      toggle.title = toggle.ariaLabel = c ? 'Show panel' : 'Hide panel';
    });

    window.addEventListener('keydown', (e) => {
      if (e.target.closest('select, input') || e.metaKey || e.ctrlKey) return;
      const p = activePane;
      if (!p) return;
      if (e.key === 'f' || e.key === 'F') p.view.fit();
      else if (e.key === 'r' || e.key === 'R') p.toggleRuler();
      else if (e.key === 'Escape') p.toggleRuler(false);
      else if (e.key === '+' || e.key === '=') p.view.zoomAt(p.view.cw / 2, p.view.ch / 2, 1.5);
      else if (e.key === '-') p.view.zoomAt(p.view.cw / 2, p.view.ch / 2, 1 / 1.5);
    });
  }

  start();
})();

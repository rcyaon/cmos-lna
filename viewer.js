// Canvas renderer for one layout pane: hierarchical drawing, pan/zoom, ruler, labels.
(function (global) {
  'use strict';

  const ALPHA = { well: 0.07, implant: 0.05, marker: 0, fill: 0.32, via: 0.8, label: 0 };

  function rgba(color, a) {
    if (color.startsWith('hsl')) return color.replace('hsl(', 'hsla(').replace(')', `, ${a})`);
    const n = parseInt(color.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function niceStep(v) {
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= v);
  }

  function fmtUm(v) {
    const a = Math.abs(v);
    if (a >= 1000) return (v / 1000).toFixed(3) + ' mm';
    if (a >= 1) return v.toFixed(3) + ' µm';
    return (v * 1000).toFixed(1) + ' nm';
  }

  class Pane {
    constructor(root, opts) {
      this.root = root;
      this.opts = opts; // { isVisible(key), layerOrder(), showLabels(), showInstances(), onHover() }
      this.canvas = root.querySelector('canvas');
      this.ctx = this.canvas.getContext('2d');
      this.status = root.querySelector('.status');
      this.message = root.querySelector('.message');
      this.lib = null;
      this.cell = null;
      this.paths = new WeakMap();
      this.scale = 1; this.ox = 0; this.oy = 0; // screen = (x*scale+ox, -y*scale+oy), x/y in DB units
      this.ruler = null; this.rulerMode = false;
      this.mouse = null;
      this.pending = false;
      this.bindEvents();
      new ResizeObserver(() => this.resize()).observe(this.canvas);
    }

    setMessage(text) {
      this.message.textContent = text || '';
      this.message.hidden = !text;
    }

    setLibrary(lib) {
      this.lib = lib;
      this.cell = null;
      this.paths = new WeakMap();
      this.ruler = null;
    }

    setCell(name) {
      this.cell = this.lib ? this.lib.cells.get(name) || null : null;
      this.ruler = null;
      this.fit();
    }

    um(v) { return v * (this.lib ? this.lib.dbuUm : 0.001); }

    resize() {
      const r = this.canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1;
      const hadSize = this.canvas.width > 1 && this.cw > 0;
      const oldW = this.cw, oldH = this.ch;
      this.canvas.width = Math.max(1, Math.round(r.width * d));
      this.canvas.height = Math.max(1, Math.round(r.height * d));
      this.cw = r.width; this.ch = r.height;
      if (hadSize && this.cell) { // keep the view centered on resize
        this.ox += (r.width - oldW) / 2; this.oy += (r.height - oldH) / 2;
      } else if (this.cell) this.fit(true);
      this.draw(true);
    }

    fit(noDraw) {
      if (!this.cell || !this.cell.bbox || !this.cw) { this.draw(); return; }
      const [x1, y1, x2, y2] = this.cell.bbox;
      const w = Math.max(x2 - x1, 1), h = Math.max(y2 - y1, 1);
      this.scale = 0.92 * Math.min(this.cw / w, (this.ch - 24) / h);
      this.ox = this.cw / 2 - ((x1 + x2) / 2) * this.scale;
      this.oy = (this.ch - 24) / 2 + ((y1 + y2) / 2) * this.scale;
      if (!noDraw) this.draw();
    }

    toWorld(sx, sy) { return [(sx - this.ox) / this.scale, (this.oy - sy) / this.scale]; }

    zoomAt(sx, sy, f) {
      const [wx, wy] = this.toWorld(sx, sy);
      this.scale *= f;
      this.ox = sx - wx * this.scale;
      this.oy = sy + wy * this.scale;
      this.draw();
    }

    // Path2D per (cell, layer) in the cell's own coordinates, built on first use.
    path(cell, key) {
      let m = this.paths.get(cell);
      if (!m) this.paths.set(cell, (m = new Map()));
      if (m.has(key)) return m.get(key);
      const polys = cell.polys.get(key);
      let p = null;
      if (polys) {
        p = new Path2D();
        for (const q of polys) {
          p.moveTo(q[0], q[1]);
          for (let i = 2; i < q.length; i += 2) p.lineTo(q[i], q[i + 1]);
          p.closePath();
        }
      }
      m.set(key, p);
      return p;
    }

    draw(now) {
      if (now) { this.pending = false; this.render(); return; }
      if (this.pending) return;
      this.pending = true;
      requestAnimationFrame(() => { this.pending = false; this.render(); });
    }

    render() {
      const ctx = this.ctx, d = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.updateStatus();
      const cell = this.cell;
      if (!cell) return;
      this.dev = [this.canvas.width, this.canvas.height];
      const base = [this.scale * d, 0, 0, -this.scale * d, this.ox * d, this.oy * d];

      for (const key of this.opts.layerOrder()) {
        if (!this.opts.isVisible(key) || !cell.layersDeep.has(key)) continue;
        const st = Layers.style(key);
        if (st.kind === 'label') continue;
        const a = ALPHA[st.kind] ?? 0.3;
        this.fill = a > 0 ? rgba(st.color, a) : null;
        ctx.strokeStyle = rgba(st.color, st.kind === 'marker' ? 0.75 : 0.9);
        this.dashed = st.kind === 'marker' || st.kind === 'well' || st.kind === 'implant';
        this.drawLayer(cell, key, base, 0);
      }
      ctx.setLineDash([]);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      if (this.opts.showInstances()) this.drawInstances(cell, base, d);
      if (this.opts.showLabels()) this.drawLabels(cell, base, d);
      this.drawScaleBar();
      this.drawRuler();
    }

    drawLayer(c, key, M, depth) {
      const sb = GDS.bboxXform(c.bbox, M);
      if (!sb || sb[2] < 0 || sb[3] < 0 || sb[0] > this.dev[0] || sb[1] > this.dev[1]) return;
      if (depth > 0 && sb[2] - sb[0] < 0.6 && sb[3] - sb[1] < 0.6) return; // sub-pixel instance
      const p = this.path(c, key);
      if (p) {
        const ctx = this.ctx;
        ctx.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
        const sc = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])) || 1;
        ctx.lineWidth = 1 / sc;
        ctx.setLineDash(this.dashed ? [4 / sc, 3 / sc] : []);
        if (this.fill) { ctx.fillStyle = this.fill; ctx.fill(p); }
        ctx.stroke(p);
      }
      for (const r of c.refs) {
        if (!r.cell || !r.cell.layersDeep.has(key)) continue;
        for (const m of GDS.instances(r)) this.drawLayer(r.cell, key, GDS.mul(M, m), depth + 1);
      }
    }

    // Dashed outlines + names for the top cell's direct instances.
    drawInstances(cell, base, d) {
      const ctx = this.ctx;
      ctx.font = '11px ui-monospace, Menlo, monospace';
      ctx.textBaseline = 'top';
      for (const r of cell.refs) {
        if (!r.cell || !r.cell.bbox) continue;
        for (const m of GDS.instances(r)) {
          const b = GDS.bboxXform(r.cell.bbox, GDS.mul(base, m));
          const x = b[0] / d, y = b[1] / d, w = (b[2] - b[0]) / d, h = (b[3] - b[1]) / d;
          if (x > this.cw || y > this.ch || x + w < 0 || y + h < 0 || (w < 3 && h < 3)) continue;
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = 'rgba(240,180,41,.55)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, w, h);
          ctx.setLineDash([]);
          if (w > 60 && h > 18) {
            ctx.fillStyle = 'rgba(240,180,41,.9)';
            ctx.fillText(r.sname + (r.cols * r.rows > 1 ? ` [${r.cols}×${r.rows}]` : ''), x + 3, y + 3, w - 6);
          }
        }
      }
    }

    drawLabels(cell, base, d) {
      const out = [];
      const visit = (c, M, depth) => {
        if (out.length > 800) return;
        const sb = GDS.bboxXform(c.bbox, M);
        if (!sb || sb[2] < 0 || sb[3] < 0 || sb[0] > this.dev[0] || sb[1] > this.dev[1]) return;
        if (depth > 0 && sb[2] - sb[0] < 40 && sb[3] - sb[1] < 40) return; // too small to read
        for (const t of c.texts) {
          if (!this.opts.isVisible(t.key)) continue;
          const x = (M[0] * t.x + M[2] * t.y + M[4]) / d, y = (M[1] * t.x + M[3] * t.y + M[5]) / d;
          if (x < -50 || y < -10 || x > this.cw + 10 || y > this.ch + 10) continue;
          out.push([t.s, x, y, Layers.style(t.key).color]);
        }
        for (const r of c.refs) if (r.cell) for (const m of GDS.instances(r)) visit(r.cell, GDS.mul(M, m), depth + 1);
      };
      visit(cell, base, 0);
      const ctx = this.ctx;
      ctx.font = '11px ui-monospace, Menlo, monospace';
      ctx.textBaseline = 'middle';
      for (const [s, x, y] of out) {
        const tw = ctx.measureText(s).width;
        ctx.fillStyle = 'rgba(0,0,0,.65)';
        ctx.fillRect(x + 3, y - 8, tw + 6, 16);
        ctx.fillStyle = '#ffe27a';
        ctx.fillText(s, x + 6, y);
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
    }

    drawScaleBar() {
      const ctx = this.ctx, pxPerUm = this.scale / this.um(1);
      const step = niceStep(90 / pxPerUm), len = step * pxPerUm;
      const x = this.cw - len - 14, y = this.ch - 34;
      ctx.fillStyle = '#e6e9ee';
      ctx.fillRect(x, y, len, 2);
      ctx.fillRect(x, y - 4, 1, 6);
      ctx.fillRect(x + len - 1, y - 4, 1, 6);
      ctx.font = '11px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(step >= 1 ? `${step} µm` : `${Math.round(step * 1000)} nm`, this.cw - 14, y - 8);
      ctx.textAlign = 'left';
    }

    drawRuler() {
      if (!this.ruler) return;
      const [a, b] = this.ruler, end = b || (this.mouse && this.toWorld(...this.mouse));
      if (!end) return;
      const ctx = this.ctx;
      const sx = (p) => p[0] * this.scale + this.ox, sy = (p) => -p[1] * this.scale + this.oy;
      ctx.strokeStyle = '#f0b429'; ctx.fillStyle = '#f0b429'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sx(a), sy(a)); ctx.lineTo(sx(end), sy(end)); ctx.stroke();
      for (const p of [a, end]) ctx.fillRect(sx(p) - 3, sy(p) - 3, 6, 6);
      const dist = this.um(Math.hypot(end[0] - a[0], end[1] - a[1]));
      const s = fmtUm(dist);
      ctx.font = '12px ui-monospace, Menlo, monospace';
      const tx = (sx(a) + sx(end)) / 2 + 8, ty = (sy(a) + sy(end)) / 2 - 8;
      const tw = ctx.measureText(s).width;
      ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fillRect(tx - 3, ty - 12, tw + 6, 17);
      ctx.fillStyle = '#f0b429'; ctx.fillText(s, tx, ty);
    }

    updateStatus() {
      if (!this.cell) { this.status.textContent = ''; return; }
      let s = '';
      if (this.mouse) {
        const [x, y] = this.toWorld(...this.mouse);
        s += `x ${this.um(x).toFixed(3)}  y ${this.um(y).toFixed(3)} µm`;
      }
      if (this.ruler) {
        const [a, b] = this.ruler, end = b || (this.mouse && this.toWorld(...this.mouse));
        if (end) {
          const dx = this.um(end[0] - a[0]), dy = this.um(end[1] - a[1]);
          s += `   │ ruler Δx ${dx.toFixed(3)}  Δy ${dy.toFixed(3)}  d ${Math.hypot(dx, dy).toFixed(3)} µm`;
        }
      } else if (this.rulerMode) s += '   │ ruler: click two points (Esc to exit)';
      this.status.textContent = s;
    }

    setRulerMode(on) {
      this.rulerMode = on;
      this.ruler = null;
      this.canvas.classList.toggle('ruler', on);
      this.draw();
    }

    bindEvents() {
      const c = this.canvas;
      const pos = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      const pointers = new Map();
      let drag = null, pinch = null, moved = false;

      c.addEventListener('wheel', (e) => {
        e.preventDefault();
        const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
        this.zoomAt(...pos(e), f);
      }, { passive: false });

      c.addEventListener('pointerdown', (e) => {
        c.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, pos(e));
        moved = false;
        if (pointers.size === 2) {
          const [p, q] = [...pointers.values()];
          pinch = { d: Math.hypot(p[0] - q[0], p[1] - q[1]), m: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] };
          drag = null;
        } else {
          drag = { p: pos(e), ox: this.ox, oy: this.oy };
        }
      });

      c.addEventListener('pointermove', (e) => {
        const p = pos(e);
        this.mouse = p;
        this.opts.onHover(this);
        if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
        if (pinch && pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          const dd = Math.hypot(a[0] - b[0], a[1] - b[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          this.ox += m[0] - pinch.m[0]; this.oy += m[1] - pinch.m[1];
          this.zoomAt(m[0], m[1], dd / pinch.d);
          pinch = { d: dd, m };
          moved = true;
          return;
        }
        if (drag) {
          const dx = p[0] - drag.p[0], dy = p[1] - drag.p[1];
          if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
          if (moved) {
            this.ox = drag.ox + dx; this.oy = drag.oy + dy;
            c.classList.add('dragging');
          }
        }
        this.draw();
      });

      const up = (e) => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinch = null;
        c.classList.remove('dragging');
        if (drag && !moved && this.rulerMode && e.type === 'pointerup') {
          const w = this.toWorld(...pos(e));
          if (!this.ruler || this.ruler[1]) this.ruler = [w, null];
          else this.ruler[1] = w;
          this.draw();
        }
        drag = null;
      };
      c.addEventListener('pointerup', up);
      c.addEventListener('pointercancel', up);
      c.addEventListener('pointerleave', () => { this.mouse = null; this.updateStatus(); });
      c.addEventListener('dblclick', () => { if (!this.rulerMode) this.fit(); });
    }
  }

  global.Pane = Pane;
  global.ViewerUtil = { rgba, fmtUm };
})(window);

// Minimal GDSII stream parser.
// Produces a library of cells; each cell holds polygons grouped by "layer/datatype",
// text labels, and references (SREF/AREF) to other cells. Coordinates stay in DB units.
(function (global) {
  'use strict';

  const R = {
    HEADER: 0x00, BGNLIB: 0x01, LIBNAME: 0x02, UNITS: 0x03, ENDLIB: 0x04,
    BGNSTR: 0x05, STRNAME: 0x06, ENDSTR: 0x07, BOUNDARY: 0x08, PATH: 0x09,
    SREF: 0x0a, AREF: 0x0b, TEXT: 0x0c, LAYER: 0x0d, DATATYPE: 0x0e,
    WIDTH: 0x0f, XY: 0x10, ENDEL: 0x11, SNAME: 0x12, COLROW: 0x13,
    NODE: 0x15, TEXTTYPE: 0x16, STRING: 0x19, STRANS: 0x1a, MAG: 0x1b,
    ANGLE: 0x1c, PATHTYPE: 0x21, BGNEXTN: 0x30, ENDEXTN: 0x31,
    BOX: 0x2d, BOXTYPE: 0x2e,
  };

  // GDSII 8-byte excess-64 base-16 real.
  function real8(dv, o) {
    const b0 = dv.getUint8(o);
    const sign = b0 & 0x80 ? -1 : 1;
    const exp = (b0 & 0x7f) - 64;
    let mant = 0;
    for (let i = 1; i < 8; i++) mant = mant * 256 + dv.getUint8(o + i);
    return sign * (mant / 72057594037927936) * Math.pow(16, exp); // 2^56
  }

  function str(dv, o, len) {
    let s = '';
    for (let i = 0; i < len; i++) {
      const c = dv.getUint8(o + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }

  function int32s(dv, o, len) {
    const n = len >> 2, out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = dv.getInt32(o + 4 * i);
    return out;
  }

  // Convert a path centerline to polygons (one quad per segment).
  // Interior joints are extended by w/2 so Manhattan corners are filled.
  function pathToPolys(xy, width, pathtype, bgnExt, endExt) {
    const w = Math.abs(width) / 2;
    const n = xy.length / 2;
    const out = [];
    if (n < 2 || w === 0) return out;
    for (let i = 0; i < n - 1; i++) {
      let x0 = xy[2 * i], y0 = xy[2 * i + 1], x1 = xy[2 * i + 2], y1 = xy[2 * i + 3];
      const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
      if (L === 0) continue;
      const ux = dx / L, uy = dy / L;
      let e0 = i > 0 ? w : 0, e1 = i < n - 2 ? w : 0;
      if (i === 0) e0 = pathtype === 2 || pathtype === 1 ? w : pathtype === 4 ? bgnExt : 0;
      if (i === n - 2) e1 = pathtype === 2 || pathtype === 1 ? w : pathtype === 4 ? endExt : 0;
      x0 -= ux * e0; y0 -= uy * e0; x1 += ux * e1; y1 += uy * e1;
      const nx = -uy * w, ny = ux * w;
      out.push([x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny]);
    }
    return out;
  }

  function parse(buffer) {
    const dv = new DataView(buffer);
    const n = buffer.byteLength;
    const lib = { name: '', dbuUm: 0.001, cells: new Map() };
    let cell = null, el = null, p = 0;

    while (p + 4 <= n) {
      const len = dv.getUint16(p);
      const rt = dv.getUint8(p + 2);
      if (len < 4) break; // trailing zero padding
      const d = p + 4, dl = len - 4;

      switch (rt) {
        case R.LIBNAME: lib.name = str(dv, d, dl); break;
        case R.UNITS: lib.dbuUm = real8(dv, d + 8) * 1e6; break;
        case R.BGNSTR:
          cell = { name: '', polys: new Map(), texts: [], refs: [] };
          break;
        case R.STRNAME:
          cell.name = str(dv, d, dl);
          lib.cells.set(cell.name, cell);
          break;
        case R.ENDSTR: cell = null; break;
        case R.BOUNDARY: case R.BOX:
          el = { kind: 'poly', layer: 0, dt: 0 }; break;
        case R.PATH:
          el = { kind: 'path', layer: 0, dt: 0, width: 0, pathtype: 0, bgnExt: 0, endExt: 0 }; break;
        case R.SREF:
          el = { kind: 'ref', sname: '', refl: false, mag: 1, angle: 0, cols: 1, rows: 1 }; break;
        case R.AREF:
          el = { kind: 'aref', sname: '', refl: false, mag: 1, angle: 0, cols: 1, rows: 1 }; break;
        case R.TEXT:
          el = { kind: 'text', layer: 0, dt: 0, string: '' }; break;
        case R.NODE: el = { kind: 'skip' }; break;
        case R.LAYER: if (el) el.layer = dv.getInt16(d); break;
        case R.DATATYPE: case R.BOXTYPE: case R.TEXTTYPE:
          if (el) el.dt = dv.getInt16(d); break;
        case R.WIDTH: if (el) el.width = dv.getInt32(d); break;
        case R.PATHTYPE: if (el) el.pathtype = dv.getInt16(d); break;
        case R.BGNEXTN: if (el) el.bgnExt = dv.getInt32(d); break;
        case R.ENDEXTN: if (el) el.endExt = dv.getInt32(d); break;
        case R.XY: if (el) el.xy = int32s(dv, d, dl); break;
        case R.SNAME: if (el) el.sname = str(dv, d, dl); break;
        case R.COLROW: if (el) { el.cols = dv.getInt16(d); el.rows = dv.getInt16(d + 2); } break;
        case R.STRANS: if (el) el.refl = (dv.getUint16(d) & 0x8000) !== 0; break;
        case R.MAG: if (el) el.mag = real8(dv, d); break;
        case R.ANGLE: if (el) el.angle = real8(dv, d); break;
        case R.STRING: if (el) el.string = str(dv, d, dl); break;
        case R.ENDEL:
          if (cell && el) addElement(cell, el);
          el = null;
          break;
        default: break;
      }
      p += len;
    }

    // Resolve references and compute bounding boxes.
    for (const c of lib.cells.values()) {
      for (const r of c.refs) r.cell = lib.cells.get(r.sname) || null;
    }
    const used = new Set();
    for (const c of lib.cells.values()) for (const r of c.refs) used.add(r.sname);
    for (const c of lib.cells.values()) computeInfo(c);
    lib.topCells = [...lib.cells.values()]
      .filter((c) => !used.has(c.name) && !c.name.startsWith('$$$'))
      .sort((a, b) => bboxArea(b.bbox) - bboxArea(a.bbox));
    return lib;
  }

  function addElement(cell, el) {
    if (!el.xy) return;
    if (el.kind === 'poly') {
      pushPoly(cell, el.layer + '/' + el.dt, el.xy);
    } else if (el.kind === 'path') {
      const key = el.layer + '/' + el.dt;
      for (const q of pathToPolys(el.xy, el.width, el.pathtype, el.bgnExt, el.endExt)) pushPoly(cell, key, q);
    } else if (el.kind === 'text') {
      cell.texts.push({ key: el.layer + '/' + el.dt, x: el.xy[0], y: el.xy[1], s: el.string });
    } else if (el.kind === 'ref' || el.kind === 'aref') {
      const xy = el.xy;
      const ref = {
        sname: el.sname, cell: null, refl: el.refl, mag: el.mag, angle: el.angle,
        x: xy[0], y: xy[1], cols: 1, rows: 1, cdx: 0, cdy: 0, rdx: 0, rdy: 0,
      };
      if (el.kind === 'aref' && xy.length >= 6) {
        ref.cols = Math.max(1, el.cols); ref.rows = Math.max(1, el.rows);
        ref.cdx = (xy[2] - xy[0]) / ref.cols; ref.cdy = (xy[3] - xy[1]) / ref.cols;
        ref.rdx = (xy[4] - xy[0]) / ref.rows; ref.rdy = (xy[5] - xy[1]) / ref.rows;
      }
      ref.m = refMatrix(ref);
      cell.refs.push(ref);
    }
  }

  function pushPoly(cell, key, xy) {
    let arr = cell.polys.get(key);
    if (!arr) cell.polys.set(key, (arr = []));
    arr.push(xy);
  }

  // Affine matrix [a,b,c,d,e,f] (canvas convention) for one reference:
  // reflect about x axis, then magnify, rotate, translate.
  function refMatrix(r) {
    const t = (r.angle * Math.PI) / 180;
    const cs = Math.cos(t) * r.mag, sn = Math.sin(t) * r.mag, k = r.refl ? -1 : 1;
    return [cs, sn, -sn * k, cs * k, r.x, r.y];
  }

  function mul(m, n) {
    return [
      m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
    ];
  }

  function bboxXform(b, m) {
    if (!b) return null;
    const xs = [], ys = [];
    for (const [x, y] of [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]]) {
      xs.push(m[0] * x + m[2] * y + m[4]);
      ys.push(m[1] * x + m[3] * y + m[5]);
    }
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  function bboxUnion(a, b) {
    if (!a) return b; if (!b) return a;
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
  }

  function bboxArea(b) { return b ? (b[2] - b[0]) * (b[3] - b[1]) : 0; }

  // Instance offsets for an (A)REF.
  function* instances(r) {
    for (let i = 0; i < r.cols; i++) {
      for (let j = 0; j < r.rows; j++) {
        if (i === 0 && j === 0) { yield r.m; continue; }
        const m = r.m.slice();
        m[4] += i * r.cdx + j * r.rdx;
        m[5] += i * r.cdy + j * r.rdy;
        yield m;
      }
    }
  }

  // Per cell: bbox, own layer bboxes, set of layers present anywhere below, polygon counts.
  function computeInfo(c, stack = new Set()) {
    if (c.bbox !== undefined) return;
    if (stack.has(c.name)) { c.bbox = null; c.layersDeep = new Set(); return; } // cycle guard
    stack.add(c.name);
    let bb = null;
    c.layersDeep = new Set(c.polys.keys());
    for (const t of c.texts) c.layersDeep.add(t.key);
    c.layerCount = new Map();
    for (const [key, polys] of c.polys) {
      c.layerCount.set(key, polys.length);
      for (const q of polys) {
        for (let i = 0; i < q.length; i += 2) {
          if (!bb) bb = [q[i], q[i + 1], q[i], q[i + 1]];
          else {
            if (q[i] < bb[0]) bb[0] = q[i]; if (q[i] > bb[2]) bb[2] = q[i];
            if (q[i + 1] < bb[1]) bb[1] = q[i + 1]; if (q[i + 1] > bb[3]) bb[3] = q[i + 1];
          }
        }
      }
    }
    for (const t of c.texts) bb = bboxUnion(bb, [t.x, t.y, t.x, t.y]);
    for (const r of c.refs) {
      if (!r.cell) continue;
      computeInfo(r.cell, stack);
      for (const k of r.cell.layersDeep) c.layersDeep.add(k);
      const nInst = r.cols * r.rows;
      for (const [k, v] of r.cell.layerCountDeep || []) {
        c.layerCount.set(k, (c.layerCount.get(k) || 0) + v * nInst);
      }
      if (!r.cell.bbox) continue;
      // Corners of the array are enough for the bbox.
      const corners = [[0, 0], [r.cols - 1, 0], [0, r.rows - 1], [r.cols - 1, r.rows - 1]];
      for (const [i, j] of corners) {
        const m = r.m.slice();
        m[4] += i * r.cdx + j * r.rdx; m[5] += i * r.cdy + j * r.rdy;
        bb = bboxUnion(bb, bboxXform(r.cell.bbox, m));
      }
    }
    c.layerCountDeep = c.layerCount;
    c.bbox = bb;
    stack.delete(c.name);
  }

  global.GDS = { parse, mul, bboxXform, instances };
})(window);

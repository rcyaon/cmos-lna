// GF180MCU layer map. Order in this list = drawing order (bottom to top).
// kind: well/implant/marker = mostly outline, fill = solid-ish, via = dense fill, label = text only.
(function (global) {
  'use strict';
  const DEFS = [
    [0, 0, 'PR_bndry', '#9e9e9e', 'marker'],
    [12, 0, 'DNWELL', '#8d6e63', 'well'],
    [21, 0, 'Nwell', '#9ccc65', 'well'],
    [204, 0, 'LVPWELL', '#ffcc80', 'well'],
    [5, 0, 'NAT', '#bcaaa4', 'well'],
    [55, 0, 'Dualgate', '#b39ddb', 'well'],
    [22, 0, 'COMP', '#43a047', 'fill'],
    [32, 0, 'Nplus', '#26c6da', 'implant'],
    [31, 0, 'Pplus', '#ffa726', 'implant'],
    [49, 0, 'SAB', '#ce93d8', 'implant'],
    [24, 0, 'ESD', '#ef5350', 'implant'],
    [62, 0, 'Resistor', '#f48fb1', 'implant'],
    [30, 0, 'Poly2', '#e53935', 'fill'],
    [33, 0, 'Contact', '#f5f5f5', 'via'],
    [34, 0, 'Metal1', '#1e88e5', 'fill'],
    [35, 0, 'Via1', '#90caf9', 'via'],
    [36, 0, 'Metal2', '#d81b60', 'fill'],
    [38, 0, 'Via2', '#f8bbd0', 'via'],
    [42, 0, 'Metal3', '#00acc1', 'fill'],
    [40, 0, 'Via3', '#80deea', 'via'],
    [46, 0, 'Metal4', '#8e24aa', 'fill'],
    [41, 0, 'Via4', '#e1bee7', 'via'],
    [75, 0, 'FuseTop (MIM top)', '#ff7043', 'fill'],
    [81, 0, 'Metal5', '#fdd835', 'fill'],
    [82, 0, 'Via5', '#fff59d', 'via'],
    [53, 0, 'MetalTop', '#fb8c00', 'fill'],
    [37, 0, 'Pad', '#ffffff', 'marker'],
    [110, 5, 'RES_MK', '#f06292', 'marker'],
    [115, 5, 'PRES_MK', '#f06292', 'marker'],
    [117, 5, 'CAP_MK', '#ffab91', 'marker'],
    [118, 5, 'LVS_BJT', '#a5d6a7', 'marker'],
    [127, 5, 'DRC_BJT', '#a5d6a7', 'marker'],
    [166, 5, 'MOS_CAP_MK', '#ffab91', 'marker'],
    [30, 10, 'Poly2 label', '#e53935', 'label'],
    [34, 10, 'Metal1 label', '#64b5f6', 'label'],
    [36, 10, 'Metal2 label', '#f06292', 'label'],
    [42, 10, 'Metal3 label', '#4dd0e1', 'label'],
    [46, 10, 'Metal4 label', '#ba68c8', 'label'],
    [81, 10, 'Metal5 label', '#fff176', 'label'],
    [53, 10, 'MetalTop label', '#ffb74d', 'label'],
  ];

  const byKey = new Map();
  DEFS.forEach(([l, d, name, color, kind], i) => {
    byKey.set(l + '/' + d, { key: l + '/' + d, layer: l, dt: d, name, color, kind, order: i });
  });

  function hashColor(s) {
    let h = 0;
    for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `hsl(${h % 360}, 65%, 62%)`;
  }

  // Style for any key; unknown layers get a stable generated color, drawn after known ones.
  function style(key) {
    let s = byKey.get(key);
    if (!s) {
      const [l, d] = key.split('/').map(Number);
      s = { key, layer: l, dt: d, name: '', color: hashColor(key), kind: d >= 5 ? 'marker' : 'fill', order: 1000 + l + d / 1000 };
      byKey.set(key, s);
    }
    return s;
  }

  global.Layers = { style };
})(window);

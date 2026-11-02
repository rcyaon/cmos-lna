# CMOS LNB layout viewer

Browser viewer for the GF180MCU layouts in
[sckzor/CMOS_LNB](https://github.com/sckzor/CMOS_LNB) and
[rcyaon/cmos-lna](https://github.com/rcyaon/cmos-lna).

Live: https://rcyaon.github.io/cmos-lnb/

GDS files are read live from GitHub, so new layouts show up without rebuilding anything.
Pick a repo, branch, file and cell in the side panel. sckzor's layouts are on the
`rf-layout` branch; rcyaon's are on `master`.

## Run locally

```sh
cd layout_viewer
python3 -m http.server 8790
# open http://127.0.0.1:8790/
```

## Controls

- Drag to pan, scroll or pinch to zoom, double-click or `F` to fit
- `R` ruler (click two points), `Esc` to exit
- Alt-click a layer to show only that layer; All / None / Metals / FEOL presets
- Drop a local `.gds` on the canvas, or use **Open…**
- The URL keeps the current repo/branch/file/cell, so links can be shared

## Files

| File | Purpose |
|---|---|
| `index.html` | Page and styling |
| `app.js` | GitHub sources, side panel, URL state |
| `viewer.js` | Canvas rendering, pan/zoom, ruler, labels |
| `gds.js` | GDSII parser |
| `layers.js` | GF180MCU layer names, colors and draw order |

To add another repo, add an entry to `SOURCES` at the top of `app.js`.

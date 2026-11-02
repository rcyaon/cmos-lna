# Opens $LVS_GDS with GF180 layer props, shows $LVS_DB in the netlist browser,
# then enlarges the browser and expands the cross-reference tree for a screenshot.
import os, pya
app = pya.Application.instance()
mw = app.main_window()
pdk = os.environ["PDK_ROOT"] + "/gf180mcuD/libs.tech/klayout/tech/"
mw.load_layout(os.environ["LVS_GDS"], 0)
lv = mw.current_view()
lv.load_layer_props(pdk + "gf180mcu.lyp")
lv.max_hier()
mw.setGeometry(0, 24, 700, 840)

def walk(w, out):
    for c in w.children():
        out.append(c)
        walk(c, out)
    return out

n = [0]

def tidy():
    for w in pya.QApplication.topLevelWidgets():
        if w.windowTitle == "Netlist Database Browser":
            w.setGeometry(705, 24, 745, 840)
            for c in walk(w, []):
                if hasattr(c, "expandToDepth"):
                    print("tree:", type(c).__name__, c.objectName)
                    c.expandToDepth(3)
                    for col in range(4):
                        c.resizeColumnToContents(col)
    n[0] += 1
    if n[0] < 4:
        t2.start(700)
    lv.zoom_fit()

def open_browser():
    lv.zoom_fit()
    db = pya.LayoutVsSchematic()
    db.read(os.environ["LVS_DB"])
    lv.show_lvsdb(lv.add_lvsdb(db), 0)
    t2.start(1500)

t2 = pya.QTimer(mw); t2.setSingleShot(True); t2.timeout = tidy
t1 = pya.QTimer(mw); t1.setSingleShot(True); t1.timeout = open_browser
t1.start(1500)

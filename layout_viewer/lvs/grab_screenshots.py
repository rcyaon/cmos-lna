# grab.py <cell> <outdir>: capture a cell's KLayout main window + its own netlist browser, side by side.
import subprocess, sys, os, re
from PIL import Image

C = "iic-osic-tools_xvnc_uid_501"
cell, out = sys.argv[1], sys.argv[2]
X = ["docker", "exec", "-u", "1000", "-e", "DISPLAY=:1", "-e", "XAUTHORITY=/headless/.Xauthority", C]

def sh(args):
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout

def pid(w):
    m = re.search(r"= (\d+)", sh(X + ["xprop", "-id", w, "_NET_WM_PID"]))
    return m.group(1) if m else None

tree = sh(X + ["xwininfo", "-root", "-tree"]).splitlines()
main = next(l.split()[0] for l in tree
            if f'"KLayout 0.30.12 - {cell}.gds [{cell}]"' in l and " 700x840" in l)
browsers = [l.split()[0] for l in tree if '"Netlist Database Browser"' in l]
browser = next(b for b in browsers if pid(b) == pid(main))

ims = []
for i, w in enumerate([main, browser]):
    xwd, png = f"{out}/grab_{i}.xwd", f"{out}/grab_{i}.png"
    sh(X + ["xwd", "-id", w, "-silent", "-out", f"/tmp/lvs/grab_{i}.xwd"])
    sh(["docker", "cp", "-q", f"{C}:/tmp/lvs/grab_{i}.xwd", xwd])
    sh(["ffmpeg", "-loglevel", "error", "-y", "-i", xwd, png])
    ims.append(Image.open(png).convert("RGB"))
    os.remove(xwd)

W = sum(i.width for i in ims) + 6
res = Image.new("RGB", (W, max(i.height for i in ims)), (40, 40, 40))
x = 0
for im in ims:
    res.paste(im, (x, 0)); x += im.width + 6
dest = f"{out}/{cell}_LVS_pass.png"
res.save(dest)
for i in range(2):
    os.remove(f"{out}/grab_{i}.png")
print(dest, res.size)

#!/bin/bash
# Run GF180MCU KLayout LVS for LDOMkI and ReferenceMkII inside the running IIC-OSIC-TOOLS container.
# Usage: layout_viewer/lvs/run_lvs.sh   (from the repo root)
set -e
C=${CONTAINER:-iic-osic-tools_xvnc_uid_501}
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
docker exec "$C" mkdir -p /tmp/lvs
docker cp -q "$ROOT/Layout/LDOMkI.gds" "$C:/tmp/lvs/"
docker cp -q "$ROOT/Layout/ReferenceMkII.gds" "$C:/tmp/lvs/"
docker cp -q "$ROOT/Layout/ReferenceMkII_lvs.spice" "$C:/tmp/lvs/"
docker cp -q "$HERE/LDOMkI_lvs.spice" "$C:/tmp/lvs/"
for T in LDOMkI ReferenceMkII; do
  docker exec "$C" bash -lc "cd /tmp/lvs && python3 \$PDK_ROOT/gf180mcuD/libs.tech/klayout/tech/lvs/run_lvs.py \
    --layout=$T.gds --netlist=${T}_lvs.spice --variant=D --topcell=$T --lvs_sub=VSS \
    --run_dir=/tmp/lvs/$T --combine --schematic_simplify" 2>/dev/null | grep -v '^\[INFO\] Final' > "$HERE/${T}_lvs.log"
  docker cp -q "$C:/tmp/lvs/$T/$T.cir" "$HERE/${T}_extracted.cir"
  docker cp -q "$C:/tmp/lvs/$T/$T.lvsdb" "$HERE/$T.lvsdb"
  echo "$T: $(grep -o 'Netlists match\|Netlists don.t match' "$HERE/${T}_lvs.log" | head -1)"
done

# Scripts

Run from the repo root, inside the IIC-OSIC-TOOLS container unless noted.

| Script | What it does |
| --- | --- |
| `place_instances.py` | KLayout macro used by `place_layout.sh`: one gf180mcu PCell per device of a Qucs-S netlist, unrouted. |
| `xschem2qucs.py` | xschem → Qucs-S converter used to create the reference cells. It expects the original `xschem/` and `sims/tb/` folders, which are not in this repo. |

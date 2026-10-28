"""Orients the Capsule v1 parts for printing, checks overhangs / watertightness, builds one 3MF plate per colour.
Run: python capsule_v1_print.py <root>"""
import sys, math
from pathlib import Path
import numpy as np, trimesh
from trimesh.transformations import rotation_matrix as rot
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(sys.argv[1]); STL = ROOT / "STL" / "Capsule_v1"; OUT = ROOT / "Print"; PREV = OUT / "_Archive" / "Capsule_v1_layout_previews"; PREV.mkdir(parents=True, exist_ok=True)
BED = 256.0; X = [1, 0, 0]
ORIENT = {
    "tube": rot(math.pi / 2, X),          # standing, bottom end on the bed
    "lid_bot": rot(math.pi / 2, X),       # flat end face down
    "lid_top": rot(-math.pi / 2, X),      # grille face down
    "collar_bot": rot(math.pi / 2, X),    # ring down, sleeve up
    "collar_top": rot(-math.pi / 2, X),
    "spacer_top": rot(math.pi / 2, X),
    "sled": rot(math.pi / 2, X),          # standing on the power-board shelf
    "button": np.eye(4),                  # cap down
    "screen_post": rot(math.pi, X),      # insert end down, peg up
}

def load(n):
    m = trimesh.load(STL / f"Orbit_Capsule_{n}.stl")
    m.apply_transform(ORIENT[n]); m.apply_translation(-m.bounds[0]); m.metadata["name"] = f"Orbit_Capsule_{n}"
    return m

report = []
parts = {n: load(n) for n in ORIENT}
for n, m in parts.items():
    nz = m.face_normals[:, 2]; cz = m.triangles_center[:, 2]
    bad = (nz < -math.cos(math.radians(45)) - 1e-3) & (cz > 0.3)          # down-facing steeper than 45 deg, not on bed
    # ignore tiny bridge-able spans: report area only
    area = m.area_faces[bad].sum()
    report.append((n, m.is_watertight, round(float(area), 1), [round(float(v), 1) for v in m.extents]))
    if area > 20:
        sub = m.submesh([np.nonzero(bad)[0]], append=True)
        for comp in sub.split(only_watertight=False):
            if comp.area > 15:
                print("   ", n, "overhang patch", [round(float(v), 1) for v in comp.extents], "at z", round(float(comp.bounds[0][2]), 1))
for r in report:
    print("%-11s watertight=%s  steep-overhang area=%6.1f mm2  size=%s" % r)

def plate(fname, title, items):
    scene = trimesh.Scene(); fig, ax = plt.subplots(figsize=(7, 7), dpi=120)
    ax.add_patch(plt.Rectangle((0, 0), BED, BED, fill=False, lw=1.2))
    for n, (x, y) in items:
        m = parts[n].copy(); m.apply_translation([x, y, 0])
        k = sum(1 for g in scene.geometry if g.startswith(parts[n].metadata["name"]))
        if k:
            m.metadata["name"] = f'{parts[n].metadata["name"]}_{k + 1}'          # unique name per copy (else copies merge)
        assert m.bounds[1][0] <= BED and m.bounds[1][1] <= BED, n
        scene.add_geometry(m, node_name=m.metadata["name"], geom_name=m.metadata["name"])
        ax.add_patch(plt.Rectangle(m.bounds[0][:2], *(m.bounds[1][:2] - m.bounds[0][:2]), alpha=0.35))
        ax.text(*(m.bounds[0][:2] + (m.bounds[1][:2] - m.bounds[0][:2]) / 2), f"{n}\n{m.bounds[1][2]:.0f} mm tall",
                ha="center", va="center", fontsize=8)
    ax.set_xlim(-5, BED + 5); ax.set_ylim(-5, BED + 5); ax.set_aspect("equal"); ax.set_title(title, fontsize=10)
    fig.savefig(PREV / f"{fname}_layout.png"); plt.close(fig)
    scene.export(OUT / f"{fname}.3mf"); print(fname, [n for n, _ in items])

c = BED / 2
def at(n, cx, cy):
    e = parts[n].extents; return (n, (cx - e[0] / 2, cy - e[1] / 2))
plate("2_Capsule_TUBE_graphite", "Plate 1 - tube (graphite PETG)", [at("tube", c, c)])
plate("3_Capsule_LIDS_grey", "Plate 2 - top + bottom lids (cap colour)", [at("lid_top", 75, c), at("lid_bot", 181, c)])
plate("4_Capsule_COLLARS_and_button_ring_colour", "Plate 3 - collars + button (ring colour: white/clear to glow, or orange)",
      [at("collar_top", 75, 85), at("collar_bot", 181, 85), at("button", c, 200)])
plate("1_Capsule_SLED_and_spacer_any_colour", "Plate 4 - sled + speaker spacer (hidden, any colour); screen posts: see capsule_post_sheet.py",
      [at("sled", 85, c), at("spacer_top", 185, c)])

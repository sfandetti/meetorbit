"""Sheet of 20 screen posts joined by thin breakaway bars + a frame (the single posts kept lifting off the bed).
Print orientation: insert end down, peg up.  Run: python capsule_post_sheet.py <root>"""
import sys
from pathlib import Path
import cadquery as cq, trimesh

ROOT = Path(sys.argv[1])
NX, NY, PITCH = 5, 4, 14.0
H_BAR, W_BAR, W_NECK, H_NECK = 0.6, 1.8, 0.8, 0.4   # bars 3 layers tall; necks only 2 layers so posts snap off easily
POST_D, POST_H, PEG_D, PEG_H, INS_D, INS_DEPTH = 7.0, 7.0, 4.0, 2.3, 3.8, 6.0

def post(x, y):
    p = cq.Workplane("XY").center(x, y).circle(POST_D / 2).extrude(POST_H)
    p = p.union(cq.Workplane("XY").workplane(offset=POST_H - 0.01).center(x, y).circle(PEG_D / 2).extrude(PEG_H))
    return p.cut(cq.Workplane("XY").workplane(offset=-1).center(x, y).circle(INS_D / 2).extrude(INS_DEPTH + 1))

def bar(x0, y0, x1, y1):
    """Straight bar between two post centres, narrowed to a neck where it meets each post."""
    import math
    L = math.hypot(x1 - x0, y1 - y0); ang = math.degrees(math.atan2(y1 - y0, x1 - x0))
    r = POST_D / 2
    mid = cq.Workplane("XY").rect(L - 2 * r - 2.0, W_BAR).extrude(H_BAR)
    neck = cq.Workplane("XY").rect(L - 2 * r + 0.6, W_NECK).extrude(H_NECK)
    b = mid.union(neck).rotate((0, 0, 0), (0, 0, 1), ang).translate(((x0 + x1) / 2, (y0 + y1) / 2, 0))
    return b

xs = [i * PITCH for i in range(NX)]; ys = [j * PITCH for j in range(NY)]
sheet = None
for x in xs:
    for y in ys:
        p = post(x, y); sheet = p if sheet is None else sheet.union(p)
for j, y in enumerate(ys):
    for i in range(NX - 1):
        sheet = sheet.union(bar(xs[i], y, xs[i + 1], y))
for i, x in enumerate(xs):
    for j in range(NY - 1):
        sheet = sheet.union(bar(x, ys[j], x, ys[j + 1]))
# frame ("brim") around the grid, joined to the outer posts by necked bars
m = 9.0
fx0, fx1, fy0, fy1 = xs[0] - m, xs[-1] + m, ys[0] - m, ys[-1] + m
frame = (cq.Workplane("XY").center((fx0 + fx1) / 2, (fy0 + fy1) / 2).rect(fx1 - fx0, fy1 - fy0).extrude(H_BAR)
         .cut(cq.Workplane("XY").center((fx0 + fx1) / 2, (fy0 + fy1) / 2).rect(fx1 - fx0 - 8, fy1 - fy0 - 8).extrude(2).translate((0, 0, -0.5))))
sheet = sheet.union(frame)
for x in xs:
    sheet = sheet.union(bar(x, ys[0], x, fy0 + 4 - POST_D / 2 - 0.0)).union(bar(x, ys[-1], x, fy1 - 4 + POST_D / 2))
for y in ys:
    sheet = sheet.union(bar(xs[0], y, fx0 + 4 - POST_D / 2, y)).union(bar(xs[-1], y, fx1 - 4 + POST_D / 2, y))
stl = ROOT / "STL" / "Capsule_v1" / "Orbit_Capsule_screen_post_sheet_x20.stl"
cq.exporters.export(sheet, str(stl), tolerance=0.02, angularTolerance=0.1)
mesh = trimesh.load(stl); mesh.apply_translation([128 - mesh.bounds[:, 0].mean(), 128 - mesh.bounds[:, 1].mean(), -mesh.bounds[0][2]])
sc = trimesh.Scene(); sc.add_geometry(mesh, node_name="Orbit_Capsule_screen_posts_x20", geom_name="Orbit_Capsule_screen_posts_x20")
sc.export(ROOT / "Print" / "1b_Capsule_SCREEN_POSTS_x20_sheet.3mf")
print("sheet", [round(float(v), 1) for v in mesh.extents], "watertight", mesh.is_watertight, "bed contact mm2",
      round(float(mesh.area_faces[(mesh.face_normals[:, 2] < -0.99) & (mesh.triangles_center[:, 2] < 0.01)].sum()), 0))

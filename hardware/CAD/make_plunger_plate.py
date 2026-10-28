"""Three power-button plungers (tip gap 0.3 / 0.8 / 1.3 mm), notched 1 / 2 / 3 on one tab so you can tell them apart.
Printed tip-down. Same geometry as plunger() in capsule_v1.py.  python make_plunger_plate.py <out.stl>"""
import sys, math
import cadquery as cq
R, Ri, kx, ky = 41.0, 38.0, 14.0, 50.0
def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))
def cyly(y0, y1, d):
    return cq.Workplane("XZ").workplane(offset=-y1).circle(d / 2).extrude(y1 - y0)
def cylz(x, y, z0, z1, d):
    return cq.Workplane("XY").workplane(offset=z0).center(x, y).circle(d / 2).extrude(z1 - z0)
def plunger(gap, notches):
    tip = -34.25 - gap
    p = cylz(kx, ky, tip - 6.0, tip, 6.65).intersect(cyly(0, 300, 2 * (R + 1.0)))
    for y0, y1 in ((ky + 3.0, ky + 5.2), (ky - 5.2, ky - 3.0)):
        p = p.union(box(kx - 1.5, kx + 1.5, y0, y1, -40, -30).intersect(cyly(0, 300, 2 * (Ri - 0.1))).cut(cyly(0, 300, 2 * (Ri - 1.1))))
    for i in range(notches):                       # small V-ish notches on the +y tab's end (hidden inside the case)
        x = kx - 1.0 + i * 1.0
        p = p.cut(box(x - 0.25, x + 0.25, ky + 4.6, ky + 5.4, -40, -30))
    return p
out = None
for i, gap in enumerate((0.3, 0.8, 1.3)):
    p = plunger(gap, i + 1)
    p = p.rotate((kx, ky, 0), (kx + 1, ky, 0), 180).translate((i * 16.0, 0, 0))   # tip down
    out = p if out is None else out.union(p)
cq.exporters.export(out, sys.argv[1], tolerance=0.01, angularTolerance=0.1)
print("ok")

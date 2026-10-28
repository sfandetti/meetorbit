"""
ORBIT "Capsule" v1 - internal LAYOUT (2 x 18650 holder build).  Not yet print-detailed.
Frame: Y = capsule axis (up when standing), Z = toward the screen, X = right.  All mm.

Stack (bottom -> top):
  bottom cap (twist-lock, removable)  y 0..17  (+ sleeve into tube to y 25)
  tube                                y 17..153, OD 82, wall 3, flat screen face
  top cap (speaker, fixed)            y 153..170 (+ sleeve into tube down to y 145)
The SLED (spine plate + shelves) carries CYD, battery holder, power board, amp, power key;
it slides up into the tube from the bottom on two rails.  The mic sits in a pocket in the tube,
the speaker is clamped inside the top cap.
Run: python capsule_v1_layout.py <root>
"""
import sys, math, json
from pathlib import Path
import cadquery as cq
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp

ROOT = Path(sys.argv[1]); RM = ROOT / "CAD" / "_render_meshes"; RM.mkdir(parents=True, exist_ok=True)

C = dict(
    L=170.0, D=82.0, wall=3.0,
    cap_nose=7.0, cap_band=8.0, ring_t=2.0, af=84.0, af_end=72.0,
    sleeve_len=8.0, sleeve_t=1.6, sleeve_clr=0.2,
    # CYD (portrait, USB-C at the bottom). From the Halo parameters.
    pcb_w=50.0, pcb_l=86.0, pcb_t=1.6, lcd_l=71.0, lcd_h=4.1, glass_gap=0.3, skin=1.6, back_comp=4.0,
    yb=82.0,                                     # board centre height
    # battery holder (Seth: 78 x 40 x 22 overall)
    hold=(40.0, 78.0, 22.0),
    # Cermant board (Seth: 26.2 x 20.6), USB-C on a short edge
    pb=(20.6, 26.2), pb_t=1.6, pb_comp=3.9,
    # MAX98357A (Adafruit 19.4 x 17.8), allow pre-soldered header + screw terminal
    amp=(17.8, 19.4), amp_term=10.0, amp_pins=8.5,
    # INMP441 (~15 mm round)
    mic_d=15.0,
    # Dayton PC68-4: 68 OD, 64 cut-out, 37 overall depth (33 mounting depth)
    spk_od=68.0, spk_depth=35.0, spk_frame=3.0, spk_mag_d=44.0,
    plate_t=2.5,
)
L, D, R = C["L"], C["D"], C["D"] / 2
Ri = R - C["wall"]                               # tube inner radius 38
y_t0 = C["cap_nose"] + C["cap_band"] + C["ring_t"]     # 17
y_t1 = L - y_t0                                          # 153

# ---------- screen stack (z) ----------
z_lcd = math.sqrt(Ri ** 2 - (C["pcb_w"] / 2 + 0.7) ** 2)        # LCD front so 50-wide glass clears the bore
z_lcd = math.floor(z_lcd * 10) / 10                             # 28.0
z_face_in = z_lcd + C["glass_gap"]                              # 28.3
z_face = z_face_in + C["skin"]                                  # 29.9 outer flat face
z_pcbF = z_lcd - C["lcd_h"]; z_pcbB = z_pcbF - C["pcb_t"]       # 23.9 / 22.3
z_plF = z_pcbB - 5.0; z_plB = z_plF - C["plate_t"]              # plate 14.8..17.3
C.update(z_lcd=z_lcd, z_face=z_face, z_pcbF=z_pcbF, z_pcbB=z_pcbB, z_plF=z_plF, z_plB=z_plB, Ri=Ri)

def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))
def cyly(y0, y1, d, x=0.0, z=0.0):
    return cq.Workplane("XZ").workplane(offset=-y1).center(x, z).circle(d / 2).extrude(y1 - y0)
def cylz(x, y, z0, z1, d):
    return cq.Workplane("XY").workplane(offset=z0).center(x, y).circle(d / 2).extrude(z1 - z0)
def oct_pts(af):
    h = af / 2; c = h * (2 - math.sqrt(2))
    return [(h, -h + c), (h, h - c), (h - c, h), (-h + c, h), (-h, h - c), (-h, -h + c), (-h + c, -h), (h - c, -h)]
def prism(pts, y0, y1):
    return cq.Workplane("XZ").workplane(offset=-y1).polyline(pts).close().extrude(y1 - y0)

# ======================= TUBE =======================
tube = cyly(y_t0, y_t1, D).cut(cyly(y_t0 - 1, y_t1 + 1, 2 * Ri))
fy0, fy1 = 28.0, 145.0
tube = tube.cut(box(-R, R, fy0, fy1, z_face, R + 1))                       # flat screen face
# fill the flat face back to a 1.6 skin (the cut above leaves it hollow where the bore pokes through)
skin = box(-R, R, fy0, fy1, z_face_in, z_face).intersect(cyly(fy0, fy1, D))
tube = tube.union(skin)
yb = C["yb"]
win_cy = yb + (32.5 - 26.7) / 2                                            # window off-centre like the CYD
tube = tube.cut(box(-22.4, 22.4, win_cy - 29.6, win_cy + 29.6, z_face_in - 0.5, R + 1))   # 44.8 x 59.2 window
mic_y = 135.0
tube = tube.cut(cylz(0, mic_y, z_face_in - 1, R + 1, 1.2))                 # mic port
# mic pocket on the inside of the flat face (15 mm round PCB, 1.6 thick) - two side lips
pocket = box(-9.5, 9.5, mic_y - 9.5, mic_y + 9.5, z_face_in - 3.0, z_face_in).cut(
    cylz(0, mic_y, z_face_in - 3.1, z_face_in + 0.1, C["mic_d"] + 0.4)).cut(
    box(-9.6, 9.6, mic_y - 3.5, mic_y + 3.5, z_face_in - 3.1, z_face_in + 0.1))      # wire gaps
tube = tube.union(pocket)
# rails for the sled plate (both sides): ribs in front of and behind the plate edge
for sx in (-1, 1):
    for z0, z1 in ((z_plB - 1.4, z_plB - 0.3), (z_plF + 0.3, z_plF + 1.4)):
        rib = box(-R, R, 27.0, 142.0, z0, z1).intersect(cyly(27, 142, 2 * Ri + 0.5)).cut(
            box(-32.4, 32.4, 26, 143, z0 - 1, z1 + 1))
        tube = tube.union(rib.intersect(box(0, R, 26, 143, -R, R).mirror("YZ") if sx < 0 else box(0, R, 26, 143, -R, R)))
# charge USB-C (back, low), power key (back), microSD slot (left side)
usb_y = 29.0 + 2.0 + C["pb_t"] + 1.6
tube = tube.cut(box(-6.75, 6.75, usb_y - 3.75, usb_y + 3.75, -R - 1, -Ri + 1))
key_y = 50.0
tube = tube.cut(cylz(0, key_y, -R - 1, -Ri + 1, 7.0))
sd_y = yb - 4.95
tube = tube.cut(box(-R - 1, -25.0, sd_y - 7.5, sd_y + 7.5, z_pcbB - 3.0, z_pcbB + 0.8))  # SD card slot
# twist-lock L-slots at both ends (3 x, 120 deg): axial entry + 45 deg turn, 1.2 deep in the 3 mm wall
def lslots(y_end, s):
    out = None
    for k in range(3):
        a0 = 90 + 120 * k
        ent = box(-3.3, 3.3, min(y_end, y_end + s * 7.5), max(y_end, y_end + s * 7.5), 0, Ri + 1.2).translate((0, 0, 0))
        ent = ent.rotate((0, 0, 0), (0, 1, 0), a0 - 90)
        turn = None
        for t in range(0, 46, 5):
            seg = box(-3.3, 3.3, min(y_end + s * 3.8, y_end + s * 7.5), max(y_end + s * 3.8, y_end + s * 7.5), 0, Ri + 1.2)
            seg = seg.rotate((0, 0, 0), (0, 1, 0), a0 - 90 + t)
            turn = seg if turn is None else turn.union(seg)
        piece = ent.union(turn).cut(cyly(y_end - 20, y_end + 20, 2 * Ri - 0.01))
        out = piece if out is None else out.union(piece)
    return out
tube = tube.cut(lslots(y_t0, 1)).cut(lslots(y_t1, -1))

# ======================= CAPS =======================
def cap(bottom=True):
    """Built as the BOTTOM cap (end face at y=0); the top cap is mirrored."""
    n, b, rt = C["cap_nose"], C["cap_band"], C["ring_t"]
    nose = (cq.Workplane("XZ").workplane(offset=0).polyline(oct_pts(C["af_end"])).close()
            .workplane(offset=-n).polyline(oct_pts(C["af"])).close().loft(ruled=True))
    band = prism(oct_pts(C["af"]), n, n + b)
    body = nose.union(band)
    sl_od = 2 * Ri - 2 * C["sleeve_clr"]
    sleeve = cyly(n + b, y_t0 + C["sleeve_len"], sl_od).cut(cyly(0, 40, sl_od - 2 * C["sleeve_t"]))
    lugs = None
    for k in range(3):
        lug = box(-3.0, 3.0, y_t0 + 4.1, y_t0 + 7.2, Ri - 0.4, Ri + 1.0).rotate((0, 0, 0), (0, 1, 0), 120 * k + 45)
        lugs = lug if lugs is None else lugs.union(lug)
    body = body.union(sleeve).union(lugs)
    body = body.cut(cyly(2.0, n, 70.0)).cut(cyly(n - 0.01, y_t0 + 1, sl_od - 2 * C["sleeve_t"]))
    # light windows in the sleeve at the accent ring (LED glow)
    for k in range(6):
        w = box(-7, 7, n + b - 0.2, y_t0 + 0.4, 0, R).rotate((0, 0, 0), (0, 1, 0), 60 * k + 30)
        body = body.cut(w.intersect(cyly(n + b - 0.2, y_t0 + 0.4, sl_od + 0.1).cut(cyly(0, 40, sl_od - 2 * C["sleeve_t"] - 0.1))))
    if not bottom:
        holes = (cq.Workplane("XZ").workplane(offset=0.5).pushPoints(
            [(x, z) for x in range(-30, 31, 5) for z in range(-30, 31, 5) if x * x + z * z <= 29 ** 2])
            .circle(1.6).extrude(-3.0))
        body = body.cut(holes)
    return body

def ring():
    n, b, rt = C["cap_nose"], C["cap_band"], C["ring_t"]
    return prism(oct_pts(C["af"]), n + b, y_t0).cut(cyly(0, 40, 2 * Ri - 2 * C["sleeve_clr"] + 0.3))

mirror_top = lambda s: s.mirror("XZ").translate((0, L, 0))
cap_bot = cap(True)
cap_top = mirror_top(cap(False))
ring_bot = ring(); ring_top = mirror_top(ring())

# speaker in the top cap: frame against the end wall, clamp ring underneath
spk_face = L - 2.0 - 0.5
def speaker():
    fr = cyly(spk_face - C["spk_frame"], spk_face, C["spk_od"]).cut(cyly(spk_face - 4, spk_face + 1, 56))
    basket = cyly(spk_face - C["spk_depth"], spk_face - C["spk_frame"], C["spk_mag_d"])
    return fr.union(basket)
spk = speaker()
clamp = cyly(spk_face - C["spk_frame"] - 3.0, spk_face - C["spk_frame"], 70.0).cut(cyly(0, L + 1, 50.0))

# ======================= SLED =======================
pw = 2 * 32.4
plate_y0, plate_y1 = 29.0, 128.0
plate = box(-pw / 2, pw / 2, plate_y0, plate_y1, z_plB, z_plF)
for yy in (55.0, 95.0):                                                   # zip-tie slots for the holder
    for xx in (-22.5, 22.5):
        plate = plate.cut(box(xx - 1.5, xx + 1.5, yy - 3, yy + 3, z_plB - 1, z_plF + 1))
standoffs = None
for xx in (-21.0, 21.0):
    for yy in (yb - 39.0, yb + 39.0):
        so = cylz(xx, yy, z_plF, z_pcbB, 6.0).cut(cylz(xx, yy, z_plF - 3, z_pcbB + 1, 2.5))
        standoffs = so if standoffs is None else standoffs.union(so)
pb_shelf = box(-16, 16, plate_y0, plate_y0 + 2.0, -35.0, z_plB + 0.01).intersect(cyly(0, 200, 2 * Ri - 1.0))
amp_y = 112.8
amp_shelf = box(-11, 11, amp_y, amp_y + 1.5, -30.5, z_plB + 0.01).cut(box(-8.2, 8.2, amp_y - 1, amp_y + 3, -28.7, -25.2))
key_post = box(11.5, 15.5, plate_y0 + 2.0, key_y + 5.0, -31.0, -27.0).union(box(-5, 15.5, 40.0, key_y + 5.0, -31.0, -28.5))   # side post + switch plate above the power board
sled = plate.union(standoffs).union(pb_shelf).union(amp_shelf).union(key_post)

# ======================= PARTS (envelopes) =======================
P = {}
P["cyd_pcb"] = box(-25, 25, yb - 43, yb + 43, z_pcbB, z_pcbF).cut(
    cylz(-21, yb - 39, z_pcbB - 1, z_pcbF + 1, 3.2)).cut(cylz(21, yb - 39, z_pcbB - 1, z_pcbF + 1, 3.2)).cut(
    cylz(-21, yb + 39, z_pcbB - 1, z_pcbF + 1, 3.2)).cut(cylz(21, yb + 39, z_pcbB - 1, z_pcbF + 1, 3.2))
P["cyd_lcd"] = box(-25, 25, yb - 35.5, yb + 35.5, z_pcbF, z_lcd)
P["cyd_back"] = box(-17, 17, yb - 34, yb + 34, z_pcbB - C["back_comp"], z_pcbB)
P["cyd_usbc"] = box(-1.7 - 4.5, -1.7 + 4.5, yb - 43 - 0.6, yb - 43 + 7.0, z_pcbF - 3.25 - 1.6, z_pcbF - 3.25 + 1.6)
hx, hy, hz = C["hold"]
P["holder"] = box(-hx / 2, hx / 2, 34.5, 34.5 + hy, z_plB - 0.3 - hz, z_plB - 0.3)
pbx, pbl = C["pb"]
P["power_board"] = box(-pbx / 2, pbx / 2, plate_y0 + 2.0, plate_y0 + 2.0 + C["pb_t"] + C["pb_comp"], -36.2, -36.2 + pbl)
ax, al = C["amp"]
P["amp"] = box(-ax / 2, ax / 2, amp_y + 1.5, amp_y + 1.5 + 1.6 + C["amp_term"], -29.5, -29.5 + al)
P["amp_pins"] = box(-7.6, 7.6, amp_y + 1.5 - C["amp_pins"], amp_y + 1.5, -28.2, -25.7)
P["mic"] = cylz(0, mic_y, z_face_in - 1.6, z_face_in, C["mic_d"]).union(box(-3, 3, mic_y - 2, mic_y + 2, z_face_in - 2.6, z_face_in - 1.6))
P["key_switch"] = box(-3, 3, key_y - 3, key_y + 3, -36.0, -31.0)
P["speaker"] = spk
P["spk_clamp"] = clamp
# LED strip pieces behind each accent ring (inside the cap sleeves)
def led_ring(yc):
    return cyly(yc - 5, yc + 5, 2 * Ri - 2 * C["sleeve_clr"] - 2 * C["sleeve_t"] - 0.2).cut(
        cyly(yc - 6, yc + 6, 2 * Ri - 2 * C["sleeve_clr"] - 2 * C["sleeve_t"] - 3.4))
P["led_bot"] = led_ring(y_t0 - 1.0 + 0.0).intersect(box(-R, R, C["cap_nose"] + 0.3, y_t0 + 4, -R, R))
P["led_top"] = mirror_top(P["led_bot"])

STRUCT = dict(tube=tube, cap_bot=cap_bot, cap_top=cap_top, ring_bot=ring_bot, ring_top=ring_top, sled=sled)

# ======================= CHECKS =======================
def vol(s):
    g = GProp_GProps(); BRepGProp.VolumeProperties_s(s, g); return g.Mass()
def common(a, b):
    return vol(BRepAlgoAPI_Common(a.val().wrapped, b.val().wrapped).Shape())
allp = {**STRUCT, **P}
names = list(allp)
issues = []
skip = {("cap_top", "spk_clamp"), ("speaker", "spk_clamp"), ("cap_bot", "led_bot"), ("cap_top", "led_top")}
for i in range(len(names)):
    for j in range(i + 1, len(names)):
        a, b = names[i], names[j]
        if (a, b) in skip or (b, a) in skip:
            continue
        bb1, bb2 = allp[a].val().BoundingBox(), allp[b].val().BoundingBox()
        if (bb1.xmax < bb2.xmin or bb2.xmax < bb1.xmin or bb1.ymax < bb2.ymin or bb2.ymax < bb1.ymin
                or bb1.zmax < bb2.zmin or bb2.zmax < bb1.zmin):
            continue
        v = common(allp[a], allp[b])
        if v > 0.05:
            issues.append((a, b, round(v, 2)))
print("INTERFERENCE:", issues if issues else "none")
# insertion sweep: sled + everything it carries, slid down out of the tube in 4 mm steps
carried = sled
for k in ("cyd_pcb", "cyd_lcd", "cyd_back", "cyd_usbc", "holder", "power_board", "amp", "amp_pins", "key_switch"):
    carried = carried.union(P[k])
sweep_hits = []
for dy in range(4, 140, 4):
    v = common(carried.translate((0, -dy, 0)), tube)
    if v > 0.05:
        sweep_hits.append((dy, round(v, 2)))
print("SLIDE-IN SWEEP hits:", sweep_hits if sweep_hits else "none")
# twist-lock: rotate a cap 0..45 deg and check lugs only touch the slots
tw = []
for a in range(0, 46, 5):
    v = common(cap_bot.rotate((0, 0, 0), (0, 1, 0), -a), tube)
    tw.append((a, round(v, 2)))
print("TWIST bottom cap (deg, overlap mm3):", tw)

# ======================= EXPORT =======================
def exp(s, n): cq.exporters.export(s, str(RM / f"cv1_{n}.stl"), tolerance=0.03, angularTolerance=0.15)
half = box(-200, 0, -50, 250, -200, 200)                       # keep the LEFT half of shells for the cutaway
for k, s in STRUCT.items():
    exp(s, k)
    if k != "sled":
        exp(s.intersect(half), k + "_cut")
for k, s in P.items():
    exp(s, k)
    if k.startswith("led"):
        exp(s.intersect(half), k + "_cut")
w, h = 44.0, 58.4
SCR = [(-w / 2, win_cy - h / 2, z_lcd + 0.05), (w / 2, win_cy - h / 2, z_lcd + 0.05),
       (w / 2, win_cy + h / 2, z_lcd + 0.05), (-w / 2, win_cy + h / 2, z_lcd + 0.05)]
json.dump(dict(C=C, screen=SCR, y_t0=y_t0, y_t1=y_t1, issues=issues, sweep=sweep_hits, twist=tw),
          open(RM / "cv1_layout.json", "w"), indent=1)
print("z stack: face %.1f, lcd %.1f, pcb %.1f..%.1f, plate %.1f..%.1f" % (z_face, z_lcd, z_pcbB, z_pcbF, z_plB, z_plF))
print("done")

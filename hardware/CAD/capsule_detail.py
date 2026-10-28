"""
Detailed visual models of Seth's real parts (from his photos + caliper numbers) placed where capsule_v1.py
puts them, plus the wire routes, for the build-guide renders.  Visual only - fit checks live in capsule_v1.py.
Outputs CAD/_render_meshes/cvd_<part>__<material>.stl and cvd_wires.json.
Run: python capsule_detail.py <root>
"""
import sys, math, json
from pathlib import Path
import cadquery as cq

ROOT = Path(sys.argv[1]); RM = ROOT / "CAD" / "_render_meshes"
def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))
def cyly(y0, y1, d, x=0.0, z=0.0):
    return cq.Workplane("XZ").workplane(offset=-y1).center(x, z).circle(d / 2).extrude(y1 - y0)
def cylz(x, y, z0, z1, d):
    return cq.Workplane("XY").workplane(offset=z0).center(x, y).circle(d / 2).extrude(z1 - z0)
def cylx(x0, x1, y, z, d):
    return cq.Workplane("YZ").workplane(offset=x0).center(y, z).circle(d / 2).extrude(x1 - x0)
def roty(s, a):
    return s.rotate((0, 0, 0), (0, 1, 0), a)
def U(*ss):
    out = ss[0]
    for s in ss[1:]:
        out = out.union(s)
    return out

OUT = {}
def put(name, mat, shape):
    OUT.setdefault(name, []).append((mat, shape))

# ---------------- constants mirrored from capsule_v1.py
Ri = 38.0; yb = 77.0; zpB, zpF, zL = 22.2, 23.8, 27.9; zplB, zplF = 12.7, 15.2
pb_y0 = 27.5; amp_y = 108.3; amp_z0 = -12.4; key = (14.0, 50.0); mic_y = 132.0
z_seat = math.sqrt(Ri ** 2 - 7.2 ** 2) - 0.1

# ================= CYD (portrait, screen +Z, USB-C at the bottom)
pcb = box(-25, 25, yb - 43, yb + 43, zpB, zpF)
for x in (-21, 21):
    for y in (yb - 39, yb + 39):
        pcb = pcb.cut(cylz(x, y, zpB - 1, zpF + 1, 3.2))
put("cyd", "pcb_yellow", pcb)
put("cyd", "metal", box(-25, 25, yb - 35.5, yb + 35.5, zpF, zL - 0.9))            # LCD metal frame
put("cyd", "glass", box(-24.5, 24.5, yb - 35, yb + 35, zL - 0.9, zL))
put("cyd", "metal", box(-24, -6, 94.0, 113.5, zpB - 3.1, zpB))                     # ESP32 module shield
put("cyd", "pcb_black", box(-24, -6, 113.5, 119.5, zpB - 1.0, zpB))               # module antenna end
put("cyd", "plug_white", box(15, 24, 112.5, 118.5, zpB - 4.5, zpB))               # CN1
put("cyd", "plug_white", box(15, 24, 104.5, 110.5, zpB - 4.5, zpB))               # P3
put("cyd", "plug_white", box(19, 24.5, 71, 79, zpB - 5, zpB))                     # speaker plug (unused)
put("cyd", "metal", box(-25, -11, yb - 12, yb + 2, zpB - 1.8, zpB))               # microSD slot
put("cyd", "metal", box(-6.2, 2.8, 33.4, 41, 18.95, 22.15))                         # USB-C
put("cyd", "metal", box(-14, -7, 33.4, 39, 19.4, zpB))                              # micro-USB
put("cyd", "plug_white", box(12, 21, 34.5, 40.5, zpB - 4.5, zpB))                 # P1
put("cyd", "plug_white", box(14.8, 17.3, 52.2, 54.7, zpB - 1.0, zpB))             # RGB LED
for i, y in enumerate((50.8, 53.0, 55.2)):
    put("cyd", "chip", box(18.6, 20.2, y - 0.4, y + 0.4, zpB - 0.5, zpB))         # its 3 resistors
for (x0, x1, y0, y1) in ((-2, 8, 95, 103), (0, 8, 60, 67), (-14, -4, 50, 56), (4, 10, 84, 90)):
    put("cyd", "chip", box(x0, x1, y0, y1, zpB - 1.2, zpB))

# ================= power board: mounted FLIPPED (USB-C + parts underneath, USB-A on top) - see capsule_v1.py
y0 = pb_y0 + 2.0
pbB = 32.7 + 1.6; pbT = pbB + 1.6                                                    # PCB 34.3 .. 35.9
put("power", "pcb_black", box(-10.3, 10.3, pbB, pbT, -36.2, -10.0))
put("power", "metal", box(-4.5, 4.5, pbB - 3.2, pbB, -37.0, -29.7))                  # USB-C (charging) underneath
put("power", "inductor", box(3.2, 9.2, pbB - 3.5, pbB, -24.0, -18.0))
put("power", "chip", box(-6.0, -1.0, pbB - 1.5, pbB, -21.0, -15.0))
put("power", "metal", box(-7.0, 7.0, pbT, pbT + 5.8, -36.2, -26.1))                  # USB-A on top (unused)
PADS = {"B-": (-7.5, -11.6), "B+": (-1.0, -11.6), "K": (7.5, -11.6), "5V+": (9.0, -22.0), "5V-": (9.0, -27.5)}
for n, (x, z) in PADS.items():
    put("power", "solder", cyly(pbT, pbT + 0.3, 2.0, x, z))
for x, z in ((-11.4, -33.0), (11.4, -14.0)):
    put("glue", "glue", cyly(pbT - 1.2, pbT + 0.6, 2.6, x, z))                       # 2 hot-glue dots on the rim
# ================= power button on its post
kx, ky = key
put("button", "chip", box(kx - 3, kx + 3, ky - 3, ky + 3, -32.7, -27.7))
put("button", "metal", cylz(kx, ky, -34.25, -32.7, 3.5))
for dx in (-3.2, 3.2):
    for dy in (-2.2, 2.2):
        put("button", "metal", box(kx + dx - 0.3, kx + dx + 0.3, ky + dy - 0.3, ky + dy + 0.3, -29.0, -26.4))
put("glue", "glue", cylz(kx + 3.0, ky - 3.0, -28.6, -26.6, 2.4))

# ================= battery holder + 2 cells + zip ties
hz0, hz1 = zplB - 0.3 - 22.0, zplB - 0.3          # -9.6 .. 12.4 (open side faces the back)
hy0, hy1 = pb_y0 + 2.5, pb_y0 + 2.5 + 78.0
shell = box(-20, 20, hy0, hy1, hz0, hz1).cut(box(-18.8, 18.8, hy0 + 1.6, hy1 - 1.6, hz0 - 1, hz1 - 1.2))
shell = shell.cut(box(-18.8, 18.8, hy0 + 8, hy1 - 8, hz0 - 1, hz0 + 9))           # low open sides like the real one
shell = shell.union(box(-0.6, 0.6, hy0 + 1, hy1 - 1, hz1 - 6.0, hz1 - 1.1))
put("holder", "holder_black", shell)
for cx in (-9.6, 9.6):
    cz = hz1 - 1.2 - 9.25
    put("holder", "cell_blue", cyly(hy0 + 6.0, hy1 - 7.0, 18.4, cx, cz))
    put("holder", "metal", cyly(hy1 - 7.0, hy1 - 5.6, 7.0, cx, cz))                 # + button
    put("holder", "metal", box(cx - 5, cx + 5, hy0 + 1.6, hy0 + 2.4, cz - 5, cz + 5))  # springs/plates
    put("holder", "metal", box(cx - 5, cx + 5, hy1 - 2.4, hy1 - 1.6, cz - 5, cz + 5))
for yy in (50.0, 90.0):                                                               # zip ties around the holder
    tie = box(-23.3, 23.3, yy - 1.25, yy + 1.25, hz0 - 1.0, zplF + 0.8).cut(box(-21.7, 21.7, yy - 2, yy + 2, hz0 - 0.2, zplF + 0.1))
    tie = tie.union(box(21.7, 25.6, yy - 1.6, yy + 1.6, hz0 - 2.6, hz0 - 0.2))       # the buckle
    put("ziptie", "ziptie", tie)

# ================= amp (MAX98357A): purple PCB, green terminal at the front, yellow header strip hanging down
ay = amp_y + 1.5
put("amp", "pcb_purple", box(-8.9, 8.9, ay, ay + 1.6, amp_z0, amp_z0 + 19.4).cut(
    cyly(ay - 1, ay + 3, 2.6, -6.3, amp_z0 + 16.8)).cut(cyly(ay - 1, ay + 3, 2.6, 6.3, amp_z0 + 16.8)))
put("amp", "terminal_green", box(-5.1, 5.1, ay + 1.6, ay + 11.6, amp_z0 + 11.3, amp_z0 + 18.9))
for x in (-2.54, 2.54):
    put("amp", "metal", cylx(x - 1.4, x + 1.4, ay + 9.0, amp_z0 + 15.1, 2.4).translate((0, 0, 0)) if False else
        cyly(ay + 11.6, ay + 11.9, 2.6, x, amp_z0 + 15.1))
put("amp", "chip", box(-2.0, 2.0, ay + 1.6, ay + 2.4, amp_z0 + 6.0, amp_z0 + 10.0))
put("amp", "header_yellow", box(-8.9, 8.9, ay - 2.5, ay, amp_z0 + 0.03, amp_z0 + 2.57))
AMP_PINS = ["LRC", "BCLK", "DIN", "GAIN", "SD", "GND", "VIN"]
PIN_X = {n: -7.62 + 2.54 * i for i, n in enumerate(AMP_PINS)}
pz = amp_z0 + 1.3
for n, x in PIN_X.items():
    put("amp", "metal", box(x - 0.32, x + 0.32, ay - 8.5, ay - 2.5, pz - 0.32, pz + 0.32))
put("glue", "glue", cyly(ay - 0.1, ay + 1.0, 2.4, 9.6, amp_z0 + 3.0))

# ================= mic in the left-wall pocket (chip side faces into the tube)
mic = cylz(0, mic_y, z_seat - 1.6, z_seat, 14.1)
for dx in (-2.54, 0, 2.54):
    for dy in (-4.6, 4.6):
        mic = mic.cut(cylz(dx, mic_y + dy, z_seat - 2, z_seat + 1, 1.0))
put("mic", "pcb_black", roty(mic, -90))
put("mic", "metal", roty(box(-1.9, 1.9, mic_y - 1.4, mic_y + 1.4, z_seat - 2.6, z_seat - 1.6), -90))

# ================= screws on the screen (M3x6 socket heads)
for x in (-21, 21):
    for y in (yb - 39, yb + 39):
        put("screws", "steel", cylz(x, y, zpF, zpF + 3.0, 5.5).cut(cylz(x, y, zpF + 1.5, zpF + 3.1, 2.6)))

# ================= speaker (detailed) in the top cap, and its 4 screws
y_fl = 159.0; y_front = y_fl + 0.6
s2 = 68.3 / 2; rc = (s2 * math.sqrt(2) - 83.25 / 2) / (math.sqrt(2) - 1)
flange = (cq.Workplane("XZ").workplane(offset=-y_front).rect(68.3, 68.3).extrude(0.6).edges("|Y").fillet(rc))
flange = roty(flange, 22.5)
holes = []
for k in range(4):
    a = math.radians(22.5 + 45 + 90 * k)
    holes.append((37.3 * math.sin(a), 37.3 * math.cos(a)))
for x, z in holes:
    flange = flange.cut(cyly(y_fl - 1, y_fl + 2, 5.0, x, z))
put("speaker", "speaker_black", flange)
put("speaker", "rubber", cyly(y_front, y_front + 2.6, 64.0).cut(cyly(y_front - 1, y_front + 4, 54.0)))
put("speaker", "cone", cq.Workplane("XZ").workplane(offset=-(y_front + 0.5)).circle(27.5).workplane(offset=10).circle(12).loft().translate((0, 0, 0)))
put("speaker", "rubber", cyly(y_front - 2, y_front + 1.2, 22.0))
put("speaker", "speaker_black", cyly(y_fl - 9, y_fl, 58.0).cut(cyly(y_fl - 10, y_fl + 1, 52.0)))
put("speaker", "speaker_black", cyly(y_front - 36.65 + 15, y_fl - 8.9, 40.0))
put("speaker", "magnet", cyly(y_front - 36.65, y_front - 36.65 + 15, 60.0))
for sx in (-1, 1):
    put("speaker", "metal", box(sx * 26 - 1.5, sx * 26 + 1.5, y_fl - 7, y_fl - 3, -12, -11.4))   # wire tabs
for x, z in holes:
    put("spk_screws", "steel", cyly(y_fl - 3.0, y_fl, 5.5, x, z))

# ================= export meshes
index = []
for name, items in OUT.items():
    by_mat = {}
    for mat, shp in items:
        by_mat[mat] = shp if mat not in by_mat else by_mat[mat].union(shp)
    for mat, shp in by_mat.items():
        fn = f"cvd_{name}__{mat}"
        cq.exporters.export(shp, str(RM / f"{fn}.stl"), tolerance=0.02, angularTolerance=0.12)
        index.append(dict(file=fn, group=name, mat=mat))

# ================= wire routes (device mm).  r = wire radius.
def arc_pts(r, a0, a1, y0_, y1_, n=8):
    pts = []
    for i in range(n + 1):
        t = i / n; a = math.radians(a0 + (a1 - a0) * t)
        pts.append((r * math.sin(a), y0_ + (y1_ - y0_) * t, r * math.cos(a)))
    return pts
P = lambda n: (PADS[n][0], pbT + 0.3, PADS[n][1])
amp_pin = lambda n, dy=0.0: (PIN_X[n], ay - 8.5 + dy, pz)
W = []
def wire(name, color, pts, r=0.55, group="wires"):
    W.append(dict(name=name, color=color, pts=[[round(c, 2) for c in p] for p in pts], r=r, group=group))
# battery leads (red from the top end, black from the bottom end)
wire("bat_red", "red", [(10, hy1, 3), (10, hy1 + 1.5, 3), (21.2, hy1 - 2, -2), (21.2, 45, -6), (6, 39, -10.4), P("B+")], 0.8)
wire("bat_black", "black", [(-10, hy0, 3), (-10, hy0 - 0.5, -2), (-12, 34, -9.8), (-9, 38, -10.4), P("B-")], 0.8)
# button: K and ground
wire("key_k", "brown", [(kx - 3.2, ky - 2.2, -26.4), (kx - 4, ky - 6, -24), (8.5, 39.5, -14), P("K")])
wire("key_gnd", "black", [(kx + 3.2, ky - 2.2, -26.4), (kx + 3, ky - 8, -22), (0, 42.5, -15), (-7, 38.5, -12.5), P("B-")])
# 5V harness: pads -> splice -> CYD P1 (front, through the lower right pass-through) and -> amp
sp5, spg = (-16, 44, -24), (-16, 44, -28.5)
wire("5v_main", "red", [P("5V+"), (9.5, 38.5, -21.5), (0, 43.5, -21.5), (-12, 44, -23), sp5], 0.75)
wire("gnd_main", "black", [P("5V-"), (9.8, 38.5, -27.5), (8, 44.5, -26.5), (-12, 45, -28.5), spg], 0.75)
wire("5v_cyd", "red", [sp5, (-14, 46, -26), (24, 45, -23), (28.6, 40.6, -8), (28.6, 40.6, 12), (28.6, 40.6, 16.2), (22.5, 38, 18.8), (18, 37, 18.6)], 0.6)
wire("gnd_cyd", "black", [spg, (-14, 46.5, -30), (26, 45.5, -25), (27.4, 39.2, -8), (27.4, 39.2, 12), (27.4, 39.2, 16.2), (21.5, 36.2, 19.4), (15, 36, 19.2)], 0.6)
wire("5v_amp", "red", [sp5, (-17.6, 60, -22), (-17.6, 100, -20), (-17.6, 103, -15.6), (-12, 102, -15.2), (8, 100.5, -11.4), amp_pin("VIN")], 0.55)
wire("gnd_amp", "black", [spg, (-18.8, 60, -26), (-18.8, 100, -24), (-18.8, 104.5, -15.4), (-12, 103.5, -15.0), (5, 99.6, -11.3), amp_pin("GND")], 0.55)
wire("5v_led", "red", [sp5, (-20, 46, -25), (-25, 46, -22), (-26, 52, -18)], 0.55, "later")
wire("gnd_led", "black", [spg, (-21, 45, -29), (-26.5, 45, -24), (-27.5, 51, -19)], 0.55, "later")
# CN1 / P3 cables from the top-right plugs, out through the upper pass-through to the back
cn1 = {"GND": 113.3, "IO22": 114.8, "IO27": 116.3, "3V3": 117.8}
p3 = {"IO35": 106.0}
def from_plug(y, z_off):
    return [(24.6, y, 19.8), (26.5, y, 19.0), (28.0 + z_off, 112.0, 16.5), (28.0 + z_off, 112.0, 11.0)]
# to the amp (BCLK, LRC, DIN) - down the right side behind the plate to the header pins
wire("bclk_amp", "blue", from_plug(cn1["IO22"], -0.6) + [(26, 104, 2), (20.6, 103, -9.8), (0, 101.5, -11.1), amp_pin("BCLK")])
wire("lrc_amp", "green", from_plug(cn1["IO27"], 0.6) + [(26.6, 103, 2), (21.2, 102, -10.2), (0, 100.6, -11.6), amp_pin("LRC")])
wire("din_amp", "purple", [(19.4, 53.0, 21.6), (19.4, 53.0, 20.2), (26.2, 56, 18.6), (27.0, 100, 17.6), (27.6, 111, 16.4),
                            (27.6, 111, 11.0), (25.6, 103.5, 2), (20.0, 102.4, -9.6), (0, 101.0, -10.6), amp_pin("DIN")], 0.45)
wire("io16_led", "grey", [(19.4, 55.2, 21.6), (19.4, 55.2, 20.2), (25.6, 52, 18.4), (27.2, 44, 17.8), (27.2, 41.5, 16.6), (26.0, 41.5, 11.0), (24, 47, 4)], 0.45, "later")
# to the mic (left wall) - up over the top of the screen, around the inside of the tube wall
def to_mic(y_plug, ang_end_off, color, name):
    pts = [(24.6, y_plug, 19.8), (27.0, y_plug, 20.5), (30.5, 121.5, 17.0)]
    pts += arc_pts(34.5, 61, -60 + ang_end_off, 124.0, 129.0, 10)[1:]
    pts += [(-33.8, mic_y - 4.6 + ang_end_off * 0.0, -2.0 + ang_end_off * 0.05)]
    wire(name, color, pts, 0.45)
to_mic(cn1["3V3"], 0, "orange", "v33_mic")
to_mic(cn1["GND"], 4, "black", "gnd_mic")
to_mic(cn1["IO22"], 8, "blue", "sck_mic")
to_mic(cn1["IO27"], 12, "green", "ws_mic")
to_mic(p3["IO35"], 16, "yellow", "sd_mic")
# speaker wires: tabs -> down beside the magnet -> amp terminal (front edge of the amp)
wire("spk_plus", "red", [(26, y_fl - 5, -11.7), (31, 150, -6), (31, 132, 0), (14, 124, 4), (2.54, ay + 11.9, amp_z0 + 15.1)], 0.55)
wire("spk_minus", "black", [(-26, y_fl - 5, -11.7), (-31, 150, -6), (-31, 132, 0), (-14, 124, 4), (-2.54, ay + 11.9, amp_z0 + 15.1)], 0.55)

ANCH = dict(
    pb_usb=(0, 32.7, -37.0), pb_glue=(11.4, pbT + 0.4, -14.0), pb_groove=(11.2, pbT - 0.8, -30.0), pb_pads=(-1.0, pbT + 0.3, -11.6), pb_5v=(9.0, pbT + 0.3, -24.8), pb_usba=(0, pbT + 5.8, -31.0),
    button=(kx, ky + 3, -30), holder=(0, 70, -9.6), ziptie=(23.5, 90, -11.5), cells=(9.6, 70, -6),
    amp_term=(0, ay + 11.6, amp_z0 + 15), amp_header=(0, ay - 5, amp_z0 + 1.3), amp_glue=(9.6, ay + 1, amp_z0 + 3),
    cyd_p1=(16.5, 37.5, 17.7), cyd_cn1=(19.5, 115.5, 17.7), cyd_p3=(19.5, 107.5, 17.7), cyd_rgb=(19.4, 53.0, 21.5),
    cyd_esp=(-15, 104, 19.1), cyd_usbc=(-1.7, 34, 20.5), cyd_sd=(-25, 72, 21.3), screws=(21, yb + 39, 26.8),
    pass_low=(28, 40, 13.9), pass_high=(28, 112, 13.9), splice=(-16, 44, -26), mic=(-36, mic_y, 0),
    spk=(0, 165, 0), magnet=(30, 130, 0),
)
json.dump(dict(parts=index, wires=W, anchors=ANCH), open(RM / "cvd_scene.json", "w"), indent=1)
print(len(index), "meshes,", len(W), "wires")

"""Build-guide renders with detailed parts + wires.  blender -b --python blender_capsule_guide.py -- <root> all <samples>
Writes Images/Capsule_guide/<scene>.png and <scene>_anchors.json (2D pixel positions of the callout points)."""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import blender_render as br
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

OUT = os.path.join(br.ROOT, "Images", "Capsule_guide"); os.makedirs(OUT, exist_ok=True)
SC = json.load(open(os.path.join(br.RM, "cvd_scene.json")))
LAY = json.load(open(os.path.join(br.RM, "cv2_layout.json")))
ONLY = br.ONLY

COL = dict(
    pcb_yellow=((0.86, 0.6, 0.06), 0.5, 0), pcb_black=((0.02, 0.02, 0.025), 0.45, 0), pcb_purple=((0.28, 0.1, 0.55), 0.45, 0),
    metal=((0.78, 0.78, 0.8), 0.25, 1), steel=((0.7, 0.7, 0.72), 0.3, 1), solder=((0.85, 0.85, 0.87), 0.2, 1),
    glass=((0.02, 0.02, 0.03), 0.06, 0), chip=((0.03, 0.03, 0.035), 0.5, 0), plug_white=((0.93, 0.92, 0.88), 0.55, 0),
    inductor=((0.42, 0.42, 0.44), 0.5, 0.3), led_orange=((1.0, 0.45, 0.1), 0.4, 0), holder_black=((0.03, 0.03, 0.03), 0.6, 0),
    cell_blue=((0.08, 0.28, 0.7), 0.35, 0), ziptie=((0.92, 0.92, 0.9), 0.5, 0), terminal_green=((0.25, 0.65, 0.3), 0.5, 0),
    header_yellow=((0.95, 0.8, 0.1), 0.5, 0), glue=((0.95, 0.95, 0.9), 0.15, 0), speaker_black=((0.04, 0.04, 0.045), 0.5, 0.2),
    rubber=((0.05, 0.05, 0.05), 0.8, 0), cone=((0.12, 0.12, 0.13), 0.6, 0), magnet=((0.55, 0.55, 0.57), 0.35, 1),
)
WCOL = dict(red=(0.8, 0.04, 0.03), black=(0.03, 0.03, 0.035), brown=(0.45, 0.25, 0.08), blue=(0.06, 0.28, 0.85),
            green=(0.05, 0.6, 0.2), purple=(0.5, 0.15, 0.85), orange=(1.0, 0.45, 0.02), yellow=(0.95, 0.8, 0.05), grey=(0.6, 0.62, 0.65))


def mats():
    M = br.materials()
    for k, (c, r, m) in COL.items():
        M[k] = br.mat("d_" + k, c, r, metal=m, trans=(0.6 if k == "glue" else 0.0))
    for k, c in WCOL.items():
        M["w_" + k] = br.mat("w_" + k, c, 0.4)
    M["satin"] = br.mat("Satin graphite", (0.06, 0.065, 0.072), 0.55)
    M["cap"] = br.mat("Cap light grey", (0.62, 0.64, 0.66), 0.55)
    M["ringc"] = br.mat("Ring orange", (1.0, 0.33, 0.06), 0.45)
    M["sledc"] = br.mat("Sled natural", (0.8, 0.82, 0.84), 0.55)
    M["ghost"] = br.mat("Ghost pcb", (0.86, 0.6, 0.06), 0.4, alpha=0.10)
    return M


def group(R, M, g, dy=0.0, override=None, skip=()):
    for p in SC["parts"]:
        if p["group"] == g and p["mat"] not in skip:
            br.imp(p["file"], M[override or p["mat"]], R, offset=(0, dy, 0))


def wires(R, M, names=None, groups=("wires", "later"), dy=0.0):
    for w in SC["wires"]:
        if w["group"] not in groups or (names and w["name"] not in names):
            continue
        cu = bpy.data.curves.new(w["name"], "CURVE"); cu.dimensions = "3D"
        sp = cu.splines.new("NURBS"); sp.points.add(len(w["pts"]) - 1)
        for i, (x, y, z) in enumerate(w["pts"]):
            sp.points[i].co = (x, y + dy, z, 1)
        sp.order_u = 3; sp.use_endpoint_u = True
        cu.bevel_depth = w["r"]; cu.bevel_resolution = 3; cu.use_fill_caps = True
        o = bpy.data.objects.new(w["name"], cu); bpy.context.scene.collection.objects.link(o)
        o.data.materials.append(M["w_" + w["color"]]); o.parent = R


def screen(R, alpha=None):
    m = br.mat("ui_portrait", (1, 1, 1), 0.2, img=os.path.join(br.RM, "screen_ui_portrait.png"))
    me = bpy.data.meshes.new("ui"); me.from_pydata([tuple(c) for c in LAY["screen"]], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new()
    for i, c in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]): uv.data[i].uv = c
    o = bpy.data.objects.new("ui", me); bpy.context.scene.collection.objects.link(o); o.data.materials.append(m); o.parent = R


def drop(R):
    bpy.context.view_layer.update()
    zmin = min((o.matrix_world @ Vector(c)).z for o in bpy.context.scene.objects
               if o.type in ("MESH", "CURVE") and o.parent == R for c in o.bound_box)
    R.location.z -= zmin
    bpy.context.view_layer.update()


def shoot(name, R, anchors):
    if ONLY and name not in ONLY:
        return
    sc = bpy.context.scene; sc.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True)
    W, H = sc.render.resolution_x, sc.render.resolution_y
    pts = {}
    for key, (txt, dev) in anchors.items():
        wpt = R.matrix_world @ Vector(dev)
        v = world_to_camera_view(sc, sc.camera, wpt)
        pts[key] = dict(text=txt, x=round(v.x * W, 1), y=round((1 - v.y) * H, 1))
    json.dump(pts, open(os.path.join(OUT, name + "_anchors.json"), "w"), indent=1)
    print("RENDERED", name)


A = SC["anchors"]
def a(k, txt):
    return (txt, A[k])

def sled_base(R, M):
    br.imp("cv2_sled", M["sledc"], R)

def start():
    br.reset(); M = mats(); R = br.root_empty("g"); return M, R

BACK = (0.20, 0.27, 0.15)   # camera from behind-right (blender +Y is the device back)

# ---------- C1 power board
M, R = start(); sled_base(R, M); group(R, M, "power"); group(R, M, "glue")
drop(R); br.floor(M); br.lights(target=(0, 0, 0.03))
br.camera((0.10, 0.15, 0.085), (0.0, 0.022, 0.006), lens=58)
shoot("C1_power_board", R, dict(usb=a("pb_usb", "USB-C underneath, lined up with the charging hole"),
      usba=a("pb_usba", "Board goes in UPSIDE DOWN: USB-A points up (not used)"),
      pads=a("pb_pads", "Battery and K pads at the sled end"), v5=a("pb_5v", "5V+ / 5V− output pads"),
      groove=a("pb_groove", "Board rests on a ledge on each side (no top lip): hot-glue its edges")))

# ---------- C2 button
M, R = start(); sled_base(R, M); group(R, M, "power"); group(R, M, "glue"); group(R, M, "button")
drop(R); br.floor(M); br.lights(target=(0, 0, 0.03))
br.camera((0.11, 0.15, 0.10), (0.004, 0.022, 0.016), lens=58)
shoot("C2_button", R, dict(btn=a("button", "Button glued to the post, plunger facing out")))

# ---------- C3 holder
M, R = start(); sled_base(R, M)
for g in ("power", "glue", "button", "holder", "ziptie"):
    group(R, M, g)
drop(R); br.floor(M); br.lights(target=(0, 0, 0.05))
br.camera(BACK, (0.0, 0.0, 0.05), lens=55)
shoot("C3_holder", R, dict(tie=a("ziptie", "2 zip ties through the slots, around the holder"),
      cells=a("cells", "Cells go in last (step D1)")))

# ---------- C4 amp
M, R = start(); sled_base(R, M)
for g in ("power", "glue", "button", "holder", "ziptie", "amp"):
    group(R, M, g)
drop(R); br.floor(M); br.lights(target=(0, 0, 0.08))
br.camera((0.12, 0.16, 0.16), (0.0, -0.005, 0.083), lens=75)
shoot("C4_amp", R, dict(term=a("amp_term", "Green terminal: speaker wires (last step)"),
      hdr=a("amp_header", "Yellow pin strip drops through the slot, hidden behind this wall"), glue=a("amp_glue", "Dab of hot glue")))

# ---------- C5 screen (front)
M, R = start(); sled_base(R, M)
for g in ("power", "glue", "button", "holder", "ziptie", "amp", "cyd", "screws"):
    group(R, M, g)
screen(R); drop(R); br.floor(M); br.lights(target=(0, 0, 0.05))
br.camera((-0.17, -0.25, 0.12), (0.0, 0.0, 0.048), lens=62)
shoot("C5_screen", R, dict(scr=a("screws", "4 × M3×6 into the inserts"), usb=a("cyd_usbc", "CYD USB-C at the bottom")))

# ---------- W1 wiring, back
M, R = start(); sled_base(R, M)
for g in ("power", "glue", "button", "holder", "ziptie", "amp", "cyd", "screws"):
    group(R, M, g)
wires(R, M, names=[w["name"] for w in SC["wires"] if not w["name"].endswith("_mic") and not w["name"].startswith("spk")])
drop(R); br.floor(M); br.lights(target=(0, 0, 0.06))
br.camera((0.21, 0.27, 0.15), (0.0, 0.0, 0.055), lens=55)
shoot("W1_wiring_back", R, dict(spl=a("splice", "5V+ / 5V−: one wire to the screen, one to the amp (LEDs added later)"),
      hi=a("pass_high", "Screen-plug wires pass through here"), lo=a("pass_low", "Screen power passes through here"),
      hdr=a("amp_header", "Solder to the amp pins: VIN GND BCLK LRC DIN"), bat=("Battery red → B+ (from the top end)", [21.2, 70, -4])))

# ---------- W2 wiring, front (screen see-through)
M, R = start(); sled_base(R, M)
for g in ("power", "glue", "button", "holder", "ziptie", "amp"):
    group(R, M, g)
group(R, M, "cyd", skip=("pcb_yellow", "metal", "glass"))
for p in SC["parts"]:
    if p["group"] == "cyd" and p["mat"] in ("pcb_yellow",):
        br.imp(p["file"], M["ghost"], R)
wires(R, M, names=[w["name"] for w in SC["wires"] if w["name"] not in ("spk_plus", "spk_minus")], groups=("wires", "later"))
drop(R); br.floor(M); br.lights(target=(0, 0, 0.06))
br.camera((0.13, -0.27, 0.13), (0.005, 0.0, 0.06), lens=55)
shoot("W2_wiring_front", R, dict(p1=a("cyd_p1", "P1 plug: 5V + GND in"), cn1=a("cyd_cn1", "CN1 plug: GND, IO22, IO27, 3.3V"),
      p3=a("cyd_p3", "P3 plug: only IO33 used"), rgb=a("cyd_rgb", "IO4 (purple) and IO16 (grey) pad wires"),
      mic=("Mic wires run up over the top to the left wall", [-20, 127, 30])))

# ---------- D in-case cutaway with all wires
M, R = start()
for n, mk in (("tube_cut", "satin"), ("lid_bot_cut", "cap"), ("lid_top_cut", "cap"), ("collar_bot_cut", "ringc"),
              ("collar_top_cut", "ringc"), ("spacer_top_cut", "sledc")):
    br.imp("cv2_" + n, M[mk], R)
sled_base(R, M)
for g in ("power", "glue", "button", "holder", "ziptie", "amp", "cyd", "screws", "mic", "speaker", "spk_screws"):
    group(R, M, g)
wires(R, M, groups=("wires",))
screen(R); drop(R); br.floor(M); br.lights(target=(0, 0, 0.085))
br.camera((0.36, 0.22, 0.20), (0.0, 0.0, 0.085), lens=55)
shoot("D_in_case", R, dict(mic=a("mic", "Mic glued in the left-wall pocket"), spk=("Speaker wires down beside the magnet to the amp", [31, 140, -2]),
      mag=a("magnet", "Speaker magnet (60 mm)"), usb=a("pb_usb", "Charging USB-C lines up with the back hole"),
      btn=a("button", "Power button behind its hole")))

# ---------- B3 top cap: speaker, screws, spacer, collar (exploded, grille down)
br.reset(); M = mats(); R = br.root_empty("cap"); R.rotation_euler = (math.radians(-90), 0, 0)
br.imp("cv2_lid_top", M["cap"], R)
group(R, M, "speaker", dy=-30); group(R, M, "spk_screws", dy=-78)
br.imp("cv2_spacer_top", M["sledc"], R, offset=(0, -95, 0)); br.imp("cv2_collar_top", M["ringc"], R, offset=(0, -122, 0))
drop(R); br.floor(M); br.lights(target=(0, 0, 0.09))
br.camera((-0.30, -0.36, 0.25), (0.0, 0.0, 0.085), lens=58)
shoot("B3_top_cap", R, dict(spk=("Speaker face DOWN into the lid; square corners into octagon corners", [37.9, 129.3, 15.7]),
      scr=("4 × M3×6 through the speaker's holes into the lid's inserts", [35.6, 81.0, 14.7]),
      spc=("Spacer: its notches sit over the screw heads", [-40, 62, 0]),
      col=("Collar: glue onto the lid, flats lined up", [-42, 32, 0])))

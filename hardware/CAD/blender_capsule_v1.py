"""blender -b --python blender_capsule_v1.py -- <root> all <samples>   (Capsule v1: hero, cutaway, exploded)"""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import blender_render as br
from mathutils import Vector

OUT = os.path.join(br.ROOT, "Images", "Capsule_v1")
os.makedirs(OUT, exist_ok=True)
LAY = json.load(open(os.path.join(br.RM, "cv2_layout.json")))


def extra(M):
    M["power"] = br.mat("Power board", (0.03, 0.03, 0.04), 0.45)
    M["amp"] = br.mat("Amp purple", (0.3, 0.08, 0.5), 0.45)
    M["mic"] = br.mat("Mic black", (0.02, 0.02, 0.03), 0.45)
    M["led"] = br.mat("LED glow", (1, 0.9, 0.8), 0.4, emit=((1.0, 0.55, 0.2), 2.5))
    M["tube"] = br.mat("Satin graphite", (0.06, 0.065, 0.072), 0.55)
    M["cap"] = br.mat("Cap light grey", (0.62, 0.64, 0.66), 0.55)
    M["ringc"] = br.mat("Ring orange", (1.0, 0.33, 0.06), 0.45)
    M["sledc"] = br.mat("Sled natural", (0.75, 0.78, 0.8), 0.5)
    M["spk"] = br.mat("Speaker black", (0.03, 0.03, 0.035), 0.5, metal=0.3)


def screen(R, dy=0.0):
    m = br.mat("ui_portrait", (1, 1, 1), 0.2, img=os.path.join(br.RM, "screen_ui_portrait.png"))
    me = bpy.data.meshes.new("ui")
    me.from_pydata([(x, y + dy, z) for x, y, z in LAY["screen"]], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new()
    for i, c in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]): uv.data[i].uv = c
    o = bpy.data.objects.new("ui", me); bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(m); o.parent = R


def put(R, M, name, mk, dy=0.0):
    return br.imp("cv2_" + name, M[mk], R, offset=(0, dy, 0))


SHELL = (("tube", "tube"), ("lid_bot", "cap"), ("lid_top", "cap"), ("collar_bot", "ringc"), ("collar_top", "ringc"),
         ("button", "ringc"))
SLED = (("sled", "sledc"), ("cyd_pcb", "pcb"), ("cyd_lcd", "lcd"), ("cyd_back", "switch"), ("cyd_usbc", "chip"),
        ("holder", "holder"), ("power_board", "power"), ("amp", "amp"), ("amp_pins", "chip"), ("key_switch", "switch"))
TOP = (("mic", "mic"), ("speaker", "spk"), ("spacer_top", "sledc"), ("led_top", "led"))


def drop(R):
    bpy.context.view_layer.update()
    zmin = min((o.matrix_world @ Vector(c)).z for o in bpy.context.scene.objects
               if o.type == "MESH" and o.parent == R for c in o.bound_box)
    R.location.z -= zmin


def render(name):
    bpy.context.scene.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True); print("RENDERED", name)


def scene_start():
    br.reset(); M = br.materials(); extra(M); return M


# 1. hero: standing
M = scene_start(); R = br.root_empty("hero")
for n, mk in SHELL + SLED + TOP:
    put(R, M, n, mk)
put(R, M, "led_bot", "led")
screen(R); drop(R); br.floor(M); br.lights(target=(0, 0, 0.085))
br.camera((-0.32, -0.52, 0.22), (0.0, 0.0, 0.08), lens=62); render("03_capsule_v1_hero")

# 2. cutaway (right half of the shells removed)
M = scene_start(); R = br.root_empty("cut")
for n, mk in SHELL:
    put(R, M, n + "_cut", mk)
put(R, M, "spacer_top_cut", "sledc"); put(R, M, "led_bot_cut", "led"); put(R, M, "led_top_cut", "led")
for n, mk in SLED + (("mic", "mic"),):
    put(R, M, n, mk)
put(R, M, "speaker_cut", "spk")
screen(R); drop(R); br.floor(M); br.lights(target=(0, 0, 0.085))
br.camera((0.36, -0.30, 0.20), (0.0, 0.0, 0.082), lens=60); render("01_cutaway_side")

# 3. exploded: top assembly lifted, tube lifted, sled in place, bottom cap dropped
M = scene_start(); R = br.root_empty("expl")
up_t, up, down = 180.0, 115.0, -40.0
put(R, M, "tube", "tube", dy=up); put(R, M, "mic", "mic", dy=up); put(R, M, "button", "ringc", dy=up)
for n, mk in (("lid_top", "cap"), ("collar_top", "ringc"), ("speaker", "spk"), ("spacer_top", "sledc"), ("led_top", "led")):
    put(R, M, n, mk, dy=up_t)
for n, mk in SLED:
    put(R, M, n, mk)
screen(R)
put(R, M, "collar_bot", "ringc", dy=down * 0.5); put(R, M, "led_bot", "led", dy=down * 0.5); put(R, M, "lid_bot", "cap", dy=down)
drop(R); br.floor(M); br.lights(target=(0, 0, 0.17), scale=1.3)
br.camera((-0.50, -0.78, 0.33), (0.0, 0.0, 0.18), lens=46); render("02_exploded_slide_in")

# 4/5. sled alone, front and back (for the build guide)
for name, cam in (("04_sled_front", (-0.16, -0.26, 0.12)), ("05_sled_back", (0.18, 0.26, 0.12))):
    M = scene_start(); R = br.root_empty("sled")
    for n, mk in SLED:
        put(R, M, n, mk)
    screen(R); drop(R); br.floor(M); br.lights(target=(0, 0, 0.05))
    br.camera(cam, (0.0, 0.0, 0.048), lens=60); render(name)

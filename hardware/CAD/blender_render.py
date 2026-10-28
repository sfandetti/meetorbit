"""
Blender (5.x) render script for Orbit Halo - renders the actual CAD meshes.
Run:
  blender -b --python blender_render.py -- <output_root> [view1,view2,...] [samples]
"""
import bpy, sys, math, json, os
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ROOT = argv[0]
ONLY = argv[1].split(",") if len(argv) > 1 and argv[1] != "all" else None
SAMPLES = int(argv[2]) if len(argv) > 2 else 160
RM = os.path.join(ROOT, "CAD", "_render_meshes")
IMG = os.path.join(ROOT, "Images", "_raw")
os.makedirs(IMG, exist_ok=True)
P = json.load(open(os.path.join(ROOT, "CAD", "params.json")))

# ---------------------------------------------------------------- scene setup
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == "OPTIX"
    sc.cycles.device = "CPU" if os.environ.get("ORBIT_CPU") else "GPU"
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 2400, 1600
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
    w = bpy.data.worlds.new("W"); sc.world = w; w.use_nodes = True
    bg = w.node_tree.nodes["Background"]; bg.inputs[0].default_value = (0.9, 0.91, 0.93, 1); bg.inputs[1].default_value = 0.12
    return sc

MATS = {}
def mat(name, rgb, rough=0.45, metal=0.0, emit=None, alpha=1.0, trans=0.0, img=None, coat=0.0):
    if name in MATS: return MATS[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if coat: b.inputs["Coat Weight"].default_value = coat
    if trans: b.inputs["Transmission Weight"].default_value = trans
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
    if emit:
        b.inputs["Emission Color"].default_value = (*emit[0], 1); b.inputs["Emission Strength"].default_value = emit[1]
    if img:
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = bpy.data.images.load(img)
        nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
        nt.links.new(t.outputs["Color"], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = 0.9
    MATS[name] = m
    return m

def materials():
    MATS.clear()
    return dict(
        graphite=mat("Graphite PETG", (0.035, 0.038, 0.045), 0.42, coat=0.15),
        lunar=mat("Lunar Grey PETG", (0.62, 0.64, 0.66), 0.5),
        orange=mat("Signal Orange", (1.0, 0.27, 0.04), 0.4),
        spine=mat("Spine natural PETG", (0.55, 0.62, 0.66), 0.35),
        pcb=mat("CYD PCB", (0.85, 0.62, 0.05), 0.5),
        lcd=mat("LCD black", (0.02, 0.02, 0.025), 0.3),
        glass=mat("Glass", (0.02, 0.02, 0.03), 0.05, coat=1.0),
        chip=mat("Shield metal", (0.7, 0.7, 0.72), 0.3, metal=1.0),
        holder=mat("Holder black", (0.03, 0.03, 0.03), 0.6),
        cell=mat("Cell wrap", (0.05, 0.25, 0.75), 0.35),
        keepout=mat("Reserved bay (unverified)", (0.1, 0.75, 0.45), 0.5, alpha=0.28),
        steel=mat("Steel", (0.75, 0.75, 0.78), 0.25, metal=1.0),
        brass=mat("Brass", (0.85, 0.62, 0.3), 0.3, metal=1.0),
        stylus=mat("Stylus placeholder", (0.12, 0.12, 0.14), 0.3, metal=0.4),
        red=mat("Wire red", (0.8, 0.04, 0.03), 0.5),
        black=mat("Wire black", (0.02, 0.02, 0.02), 0.5),
        yellow=mat("Wire yellow", (0.9, 0.7, 0.05), 0.5),
        plug=mat("Plug body", (0.08, 0.08, 0.09), 0.5),
        switch=mat("Switch", (0.2, 0.2, 0.22), 0.5),
        floor=mat("Floor", (0.72, 0.73, 0.75), 0.8),
        screen=mat("Screen UI", (1, 1, 1), 0.2, img=os.path.join(RM, "screen_ui.png")),
        massing=mat("Concept massing", (0.75, 0.77, 0.8), 0.55),
        massing_dark=mat("Concept massing dark", (0.06, 0.065, 0.075), 0.45),
    )

# default part -> material, explode offset (device mm: dx, dy, dz)
PARTS = {
    "front_shell_body": ("graphite", (0, 0, 70)), "front_shell_band": ("orange", (0, 0, 70)),
    "inserts_M3": ("brass", (0, 0, 70)),
    "cyd_glass": ("glass", (0, 0, 38)), "cyd_lcd": ("lcd", (0, 0, 38)), "cyd_pcb": ("pcb", (0, 0, 38)),
    "cyd_esp32": ("chip", (0, 0, 38)), "cyd_usb": ("chip", (0, 0, 38)), "cyd_buttons": ("switch", (0, 0, 38)),
    "cyd_backparts": ("switch", (0, 0, 38)),
    "spine": ("spine", (0, 0, 12)), "screws_M3x8": ("steel", (0, 0, -4)),
    "rod_boot": ("orange", (0, 0, -24)), "rod_rst": ("orange", (0, 0, -24)),
    "holder": ("holder", (0, 0, -48)), "cells": ("cell", (0, 0, -48)),
    "charger_bay_keepout": ("keepout", None),
    "rear_shell": ("lunar", (0, 0, -96)),
    "clip_insert_L": ("orange", (0, 66, -100)), "clip_insert_R": ("orange", (0, 66, -100)),
    "stylus_placeholder": ("stylus", (0, 92, -100)), "stylus_clip": ("orange", (0, 80, -100)),
    "key_cap": ("orange", (-22, 0, -96)), "pwr_switch": ("switch", (-12, 0, -96)),
    "wire_bat_red": ("red", None), "wire_bat_black": ("black", None), "wire_out_5v": ("yellow", None),
}

def root_empty(name="ROOT"):
    e = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(e)
    e.rotation_euler = (math.radians(90), 0, 0)
    e.scale = (0.001, 0.001, 0.001)
    e.location = (0, 0, 0.030)            # device bottom face (Y=-30) on the floor
    return e

def imp(name, material, parent, offset=(0, 0, 0)):
    path = os.path.join(RM, name + ".stl")
    if not os.path.exists(path):
        print("missing", path); return None
    bpy.ops.wm.stl_import(filepath=path)
    o = bpy.context.selected_objects[0]; o.name = name
    o.data.materials.clear(); o.data.materials.append(material)
    o.parent = parent; o.location = offset
    for f in o.data.polygons: f.use_smooth = False
    mod = o.modifiers.new("ws", "WEIGHTED_NORMAL") if hasattr(o.modifiers, "new") else None
    return o

def screen_plane(parent, M, z=None, offset=(0, 0, 0), x0=None, x1=None, ycen=0.0):
    x0 = P["window_x0"] + 0.4 if x0 is None else x0
    x1 = P["window_x1"] - 0.4 if x1 is None else x1
    hy = P["window_y"] / 2 - 0.4
    z = P["lcd_h"] + 0.03 if z is None else z
    me = bpy.data.meshes.new("screen")
    me.from_pydata([(x0, ycen - hy, z), (x1, ycen - hy, z), (x1, ycen + hy, z), (x0, ycen + hy, z)], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new();
    for i, c in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]): uv.data[i].uv = c
    o = bpy.data.objects.new("screen_ui", me); bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(M["screen"]); o.parent = parent; o.location = offset
    return o

def floor(M):
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, 0))
    f = bpy.context.object; f.name = "floor"; f.data.materials.append(M["floor"])
    return f

def lights(target=(0, 0, 0.03), scale=1.0):
    def area(name, loc, power, size, color=(1, 1, 1)):
        d = bpy.data.lights.new(name, "AREA"); d.energy = power * scale; d.size = size; d.color = color
        o = bpy.data.objects.new(name, d); bpy.context.scene.collection.objects.link(o)
        o.location = loc
        look(o, target)
    area("key", (-0.45, -0.55, 0.65), 9, 0.45)
    area("fill", (0.6, -0.35, 0.25), 2.5, 0.6, (0.92, 0.95, 1.0))
    area("rim", (0.25, 0.65, 0.55), 7, 0.35, (1.0, 0.96, 0.9))
    area("top", (0, 0, 1.0), 2.5, 1.2)

def look(o, target):
    d = Vector(target) - o.location
    o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()

def camera(loc, target, lens=100, ortho=None):
    c = bpy.data.cameras.new("cam"); c.lens = lens; c.clip_start = 0.005; c.clip_end = 20
    if ortho:
        c.type = "ORTHO"; c.ortho_scale = ortho
    o = bpy.data.objects.new("cam", c); bpy.context.scene.collection.objects.link(o)
    o.location = loc; look(o, target); bpy.context.scene.camera = o
    c.dof.use_dof = False
    return o

def render(name):
    bpy.context.scene.render.filepath = os.path.join(IMG, name + ".png")
    bpy.ops.render.render(write_still=True)
    print("RENDERED", name)

def boolean_cut(objs, x0, x1, y0, y1, z0, z1, parent):
    """Remove the given device-frame box region from objs (Boolean difference)."""
    bpy.ops.mesh.primitive_cube_add(size=1)
    c = bpy.context.object; c.name = "cutter"
    c.scale = (x1 - x0, y1 - y0, z1 - z0); c.location = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    c.parent = parent; c.hide_render = True; c.display_type = "WIRE"
    for o in objs:
        if o is None: continue
        m = o.modifiers.new("cut", "BOOLEAN"); m.operation = "DIFFERENCE"; m.object = c; m.solver = "EXACT"
    return c

# ---------------------------------------------------------------- builders
def build_halo(explode=False, skip=(), extra=(), hide_wires=False):
    sc = reset(); M = materials(); R = root_empty()
    objs = {}
    for name, (mk, off) in PARTS.items():
        if name in skip: continue
        if off is None and (explode or hide_wires): continue
        o = imp(name, M[mk], R, off if (explode and off) else (0, 0, 0))
        objs[name] = o
    for name, mk in extra:
        objs[name] = imp(name, M[mk], R)
    if "cyd_glass" not in skip:
        objs["screen_ui"] = screen_plane(R, M, offset=(0, 0, 38) if explode else (0, 0, 0))
    return sc, M, R, objs

C = (0, 0, 0.03)
VIEWS = {}
def view(fn): VIEWS[fn.__name__] = fn; return fn

@view
def v01_hero_three_quarter():
    sc, M, R, o = build_halo(hide_wires=True); floor(M); lights()
    camera((-0.30, -0.40, 0.17), (0.004, 0, 0.027), lens=85); render("01_hero_three_quarter")

@view
def v02_front():
    sc, M, R, o = build_halo(hide_wires=True); floor(M); lights()
    camera((0, -0.62, 0.03), C, lens=100); render("02_front")

@view
def v03_rear():
    sc, M, R, o = build_halo(hide_wires=True); floor(M); lights()
    camera((0, 0.62, 0.03), C, lens=100); render("03_rear")

@view
def v04_left_side():
    sc, M, R, o = build_halo(hide_wires=True); floor(M); lights()
    camera((-0.62, -0.0, 0.03), (0, 0.0, 0.03), lens=100); render("04_left_side")

@view
def v05_right_side():
    sc, M, R, o = build_halo(hide_wires=True); floor(M); lights()
    camera((0.62, 0.0, 0.03), (0, 0.0, 0.03), lens=100); render("05_right_side")

@view
def v06_top():
    sc, M, R, o = build_halo(hide_wires=True); floor(M); lights()
    camera((0, 0.0137, 0.66), (0, 0.0137, 0.03), lens=100); render("06_top")

@view
def v07_bottom():
    sc, M, R, o = build_halo(hide_wires=True); lights(scale=1.2)
    # light from below too
    d = bpy.data.lights.new("under", "AREA"); d.energy = 6; d.size = 0.8
    u = bpy.data.objects.new("under", d); bpy.context.scene.collection.objects.link(u); u.location = (0.2, -0.2, -0.5); look(u, C)
    camera((0, 0.0137, -0.6), (0, 0.0137, 0.03), lens=100); render("07_bottom")

@view
def v08_rear_three_quarter():
    sc, M, R, o = build_halo(hide_wires=True); floor(M); lights()
    camera((0.32, 0.40, 0.17), (0.0, 0.0, 0.027), lens=85); render("08_rear_three_quarter")

@view
def v09_exploded():
    sc, M, R, o = build_halo(explode=True); floor(M); lights(target=(0, 0.01, 0.03))
    sc.render.resolution_x, sc.render.resolution_y = 2400, 1800
    camera((-0.62, -0.42, 0.40), (0.0, 0.012, 0.025), lens=70); render("09_exploded_assembly")

@view
def v10_cutaway_rear_open():
    sc, M, R, o = build_halo()
    boolean_cut([o["rear_shell"]], -60, 60, -26.0, 40, -45, -13.0, R)
    boolean_cut([o["holder"]], -12, 60, -40, 40, -45, -29.6, R)
    floor(M); lights(target=(0, 0.0, 0.03))
    camera((0.20, 0.42, 0.30), (-0.004, 0.0, 0.032), lens=80); render("10_cutaway_rear_open")

@view
def v11_section_side():
    sc, M, R, o = build_halo(hide_wires=True)
    cut = [v for k, v in o.items() if k not in ("screen_ui",)]
    boolean_cut(cut, -70, P["btn_x"][0], -40, 40, -45, 20, R)
    floor(M); lights(target=(0, 0.0, 0.03))
    camera((-0.42, -0.12, 0.10), (-0.03, 0.012, 0.03), lens=85); render("11_section_through_BOOT_rod")

@view
def v12_closeup_usb_access():
    sc, M, R, o = build_halo(hide_wires=True, extra=(("plug_usbc", "plug"),))
    floor(M); lights(target=(0.05, 0.0, 0.03))
    camera((0.21, -0.16, 0.11), (0.052, 0.004, 0.028), lens=90); render("12_closeup_USB_access_with_plugs")

@view
def v13_closeup_snap_release():
    sc, M, R, o = build_halo(hide_wires=True)
    cut = [o[k] for k in ("front_shell_body", "front_shell_band", "rear_shell", "clip_insert_R", "spine", "cyd_pcb", "cyd_lcd", "cyd_glass")]
    boolean_cut(cut, P["clip_x"][1], 70, -40, 40, -45, 20, R)
    lights(target=(0.025, 0, 0.0))
    d = bpy.data.lights.new("under", "AREA"); d.energy = 3; d.size = 0.3
    u = bpy.data.objects.new("under", d); bpy.context.scene.collection.objects.link(u); u.location = (0.3, -0.1, -0.2); look(u, (0.025, 0, 0))
    camera((0.20, -0.06, -0.035), (0.025, -0.002, 0.003), lens=160); render("13_closeup_snap_section_and_release_window")

@view
def v14_closeup_bottom_release():
    sc, M, R, o = build_halo(hide_wires=True); lights(scale=1.2)
    d = bpy.data.lights.new("under", "AREA"); d.energy = 6; d.size = 0.8
    u = bpy.data.objects.new("under", d); bpy.context.scene.collection.objects.link(u); u.location = (0.1, -0.3, -0.4); look(u, C)
    camera((0.06, -0.20, -0.16), (0.008, 0.004, 0.0), lens=85); render("14_closeup_bottom_release_windows_stylus")

def concept_scene(body, screen, dark=True, loc=(0, 0, 0)):
    M = materials(); R = root_empty("R_" + body); R.location = (loc[0], loc[1], loc[2] + R.location[2])
    imp(body, M["massing_dark"] if dark else M["massing"], R)
    s = imp(screen, M["screen"], R)
    return M, R

@view
def v15_concepts():
    # A
    sc, M, R, o = build_halo(hide_wires=True); floor(M); lights()
    camera((-0.30, -0.40, 0.17), (0.004, 0, 0.027), lens=85); render("15_conceptA_halo")
    # B lander
    reset(); M = materials(); R = root_empty(); R.location = (0, 0, 0.03)
    imp("conceptB_lander_body", M["massing"], R)
    sp = screen_plane(R, M, z=0.05, x0=P["window_x0"] + 0.4, x1=P["window_x1"] - 0.4)
    sp.parent = None; bpy.data.objects.remove(sp)
    imp("conceptB_lander_screen", M["screen"], R)
    for ob in bpy.context.scene.objects:
        if ob.name.startswith("conceptB_lander_screen"):
            _uv_box(ob)
    floor(M); lights()
    camera((-0.34, -0.46, 0.22), (0.0, -0.01, 0.05), lens=85); render("16_conceptB_lander_massing")
    # C capsule
    reset(); M = materials(); R = root_empty(); R.location = (0, 0, 0.0)
    R.rotation_euler = (math.radians(90 - 12), 0, 0); R.location = (0, 0, 0.083)
    imp("conceptC_capsule_body", M["graphite"], R)
    s = imp("conceptC_capsule_screen", M["screen"], R); _uv_box(s)
    floor(M); lights()
    camera((-0.32, -0.46, 0.20), (0.0, 0.0, 0.06), lens=85); render("17_conceptC_capsule_massing")

def _uv_box(o):
    """Planar UV on the screen slab's largest faces."""
    me = o.data
    if not me.uv_layers: me.uv_layers.new()
    uv = me.uv_layers.active
    xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]; zs = [v.co.z for v in me.vertices]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    # project on the plane perpendicular to the thinnest axis
    for poly in me.polygons:
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = ((v.x - x0) / (x1 - x0 + 1e-9), (v.y - y0) / (y1 - y0 + 1e-9))

@view
def v18_coupons():
    reset(); M = materials()
    names = [("coupon_C1_snap_front", "graphite"), ("coupon_C1_snap_rear", "lunar"), ("coupon_C1_snap_clip", "orange"),
             ("coupon_C2_bezel_fit_frame", "graphite"), ("coupon_C3_usbc_access", "graphite"), ("coupon_C7_sd_access", "graphite"),
             ("coupon_C4_holder_bay_floor", "lunar"),
             ("coupon_C5_stylus_groove", "lunar"), ("coupon_C5_stylus_clip", "orange"),
             ("coupon_C6_tolerance_comb", "spine"), ("coupon_C6_test_pin_3mm", "orange")]
    layout = {"coupon_C2_bezel_fit_frame": (-0.058, 0.0), "coupon_C4_holder_bay_floor": (0.058, 0.0),
              "coupon_C1_snap_front": (-0.09, 0.07), "coupon_C1_snap_rear": (-0.06, 0.07), "coupon_C1_snap_clip": (-0.035, 0.07),
              "coupon_C3_usbc_access": (0.0, 0.072), "coupon_C7_sd_access": (0.035, 0.072), "coupon_C5_stylus_groove": (-0.06, -0.068),
              "coupon_C5_stylus_clip": (-0.025, -0.068), "coupon_C6_tolerance_comb": (0.03, -0.07), "coupon_C6_test_pin_3mm": (0.075, -0.068)}
    for n, mk in names:
        o = imp(n, M[mk], None)
        if o is None: continue
        o.scale = (0.001, 0.001, 0.001)
        bpy.context.view_layer.update()
        # drop to floor and place at layout spot
        bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
        cx = sum(v.x for v in bb) / 8; cy = sum(v.y for v in bb) / 8; zmin = min(v.z for v in bb)
        lx, ly = layout[n]
        o.location = (o.location.x - cx + lx, o.location.y - cy + ly, o.location.z - zmin)
    floor(M); lights(target=(0, 0, 0))
    camera((-0.0, -0.32, 0.46), (0.0, 0.0, 0.0), lens=50); render("18_test_coupons")

if __name__ == "__main__":
    for k, fn in VIEWS.items():
        if ONLY and not any(k.startswith(s) for s in ONLY): continue
        fn()

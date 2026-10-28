"""Preview render of the 20-post sheet.  blender -b --python blender_post_sheet.py -- <root> all <samples>"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import blender_render as br
from mathutils import Vector

br.reset(); M = br.materials()
bpy.ops.wm.stl_import(filepath=os.path.join(br.ROOT, "STL", "Capsule_v1", "Orbit_Capsule_screen_post_sheet_x20.stl"))
o = bpy.context.selected_objects[0]; o.scale = (0.001,) * 3
o.data.materials.append(br.mat("Sheet blue", (0.1, 0.4, 0.85), 0.4))
bpy.context.view_layer.update()
pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
o.location.x -= sum(p.x for p in pts) / 8; o.location.y -= sum(p.y for p in pts) / 8
br.floor(M); br.lights(target=(0, 0, 0.005))
br.camera((0.06, -0.09, 0.08), (0, 0, 0.003), lens=55)
bpy.context.scene.render.filepath = os.path.join(br.ROOT, "Images", "Capsule_v1", "06_screen_post_sheet.png")
bpy.ops.render.render(write_still=True); print("RENDERED")

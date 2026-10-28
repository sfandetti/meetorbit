"""
ORBIT "Capsule" v1 - 2 x 18650 build.  Printable parts + fit checks + render meshes + print plates.
Frame: Y = capsule axis (up when standing), Z = toward the screen, X = right.  All mm.

Measured by Seth (2026-10-16): speaker square frame 68.3, 83.25 corner-to-corner, 36.65 deep,
holes ~5 mm on ~54.5 mm centres; holder (parallel) 78 x 40 x 22; power board 26.2 x 20.6 x 10.7 tall;
amp 18.7 x 19.4, 20.2 tall with pins; mic 14.1 round; insert M3x5x4 = 5.0 long x 4.0 OD.
Seth also measured: magnet dia 60, frame flange 0.6 thick at the screw holes.

Stack (bottom -> top), L = 170:
  bottom LID (grey)  y 0..15   + bottom COLLAR (ring colour) ring y 15..17, twist-lock sleeve into tube y 17..27
  TUBE (graphite)    y 17..153
  top COLLAR ring y 153..155 (+ sleeve y 143..153), SPACER y 155..158, speaker flange y 158..160,
  top LID y 155..170 (speaker pocket + grille).  Lid and collar are glued; the pair twist-locks.
The SLED carries CYD, battery holder, power board, amp, power key and slides in from the bottom.
Run: python capsule_v1.py <root>
"""
import sys, math, json
from pathlib import Path
import cadquery as cq
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp

ROOT = Path(sys.argv[1]); RM = ROOT / "CAD" / "_render_meshes"; RM.mkdir(parents=True, exist_ok=True)
STL = ROOT / "STL" / "Capsule_v1"; STL.mkdir(parents=True, exist_ok=True)

C = dict(
    L=170.0, D=82.0, wall=3.0, nose=7.0, band=8.0, ring=2.0, af=84.0, af_end=72.0,
    sleeve_len=10.0, sleeve_t=1.6, sleeve_clr=0.2,
    pcb_w=50.0, pcb_l=86.0, pcb_t=1.6, lcd_h=4.1, glass_gap=0.3, skin=1.6, back_comp=4.0, standoff=7.0,
    yb=77.0,
    hold=(40.0, 78.0, 22.0), pb=(20.6, 25.2),   # length 25.2 from Seth ruler photo 10-18 (was 26.2)
    pb_h=10.7, pb_t=1.6,
    amp=(17.8, 19.4), amp_above=11.6, amp_pins=8.5,
    mic_d=14.1, mic_ang=-90.0, mic_y=132.0, spacer_t=4.0, spacer_print_t=3.0,   # Seth: printed spacer 3 mm for fit (lid pocket unchanged)
    spk_side=68.3, spk_diag=83.25, spk_depth=36.65, spk_flange=0.6, spk_mag_d=60.0, spk_hole_r=37.3,
    spk_rot=22.5, insert_d=3.8, insert_depth=6.5, plate_t=2.5,
    lugs=(90.0, 210.0, 330.0),
)
L, D, R = C["L"], C["D"], C["D"] / 2
Ri = R - C["wall"]
y_t0 = C["nose"] + C["band"] + C["ring"]          # 17
y_t1 = L - y_t0                                     # 153

# ---------------------------------------------------------------- helpers
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
def roty(s, a):
    return s.rotate((0, 0, 0), (0, 1, 0), a)
def polar(r, a):                                    # angle measured from +Z toward +X (matches roty)
    return r * math.sin(math.radians(a)), r * math.cos(math.radians(a))
mirror_top = lambda s: s.mirror("XZ").translate((0, L, 0))

# ---------------------------------------------------------------- screen stack (z)
z_lcd = math.floor(math.sqrt(Ri ** 2 - (C["pcb_w"] / 2 + 0.7) ** 2) * 10) / 10
z_face_in = z_lcd + C["glass_gap"]; z_face = z_face_in + C["skin"]
z_pcbF = z_lcd - C["lcd_h"]; z_pcbB = z_pcbF - C["pcb_t"]
z_plF = z_pcbB - C["standoff"]; z_plB = z_plF - C["plate_t"]
yb = C["yb"]; win_cy = yb + (32.5 - 26.7) / 2

# ================================================================ TUBE
tube = cyly(y_t0, y_t1, D).cut(cyly(y_t0 - 1, y_t1 + 1, 2 * Ri))
fy0, fy1 = 29.0, 120.5
facet_cut = (cq.Workplane("YZ").workplane(offset=-R - 1)
             .polyline([(fy0, z_face), (fy1, z_face), (fy1 + 16, z_face + 16), (fy0, z_face + 16)]).close()
             .extrude(D + 2))                                       # flat face, 45 deg ends (no overhang)
tube = tube.cut(facet_cut)
skin = (cq.Workplane("YZ").workplane(offset=-R - 1)
        .polyline([(fy0, z_face_in), (fy1, z_face_in), (fy1 + 16, z_face_in + 16), (fy0, z_face_in + 16)]).close()
        .extrude(D + 2)).intersect(cyly(y_t0, y_t1, D)).cut(facet_cut)
tube = tube.union(skin)
# floor that closes the bottom step of the flat face (otherwise you can see into the bore there)
wedge = box(-R, R, fy0 - 1.6, fy0 + 0.01, z_face_in, R + 1).intersect(cyly(y_t0, y_t1, D))
tube = tube.union(wedge)
tube = tube.cut(box(-22.4, 22.4, win_cy - 29.6, win_cy + 29.6, z_face_in - 0.5, R + 1))      # 44.8 x 59.2 window
# ORBIT logo ENGRAVED (recessed 0.6 mm, nothing sticks out) into the flat face under the window (Seth 2026-10-18)
logo_y, logo_h, logo_pitch, logo_depth = 39.5, 12.0, 10.0, 0.6     # Century Gothic Bold, caps ~8.5 mm
for k, ch in enumerate("ORBIT"):
    g = (cq.Workplane("XY").workplane(offset=z_face - logo_depth).center((k - 2) * logo_pitch, logo_y)
         .text(ch, logo_h, logo_depth + 1.0, fontPath="C:/Windows/Fonts/GOTHICB.TTF", halign="center", valign="center"))
    tube = tube.cut(g)
# mic: on the LEFT side wall near the top (the 60 mm magnet fills the middle), pinhole through the side
my = C["mic_y"]; z_seat = math.sqrt(Ri ** 2 - 7.2 ** 2) - 0.1          # flat seat just inside the curved wall
def to_side(s_):
    return roty(s_, C["mic_ang"])
# Seth 2026-10-18: the old boss had a 0.8 mm cover on the INSIDE, so the mic could not get in. Now an open ring:
# the mic drops in from inside the tube (flat side to the wall) and gets a drop of glue.
boss = box(-8.5, 8.5, my - 8.5, my + 8.5, z_seat - 1.6, Ri + 0.5).intersect(cyly(0, 300, 2 * Ri + 0.02))
boss = boss.cut(cylz(0, my, z_seat - 1.7, Ri + 1, C["mic_d"] + 0.4))
tube = tube.union(to_side(boss)).cut(to_side(cylz(0, my, z_seat - 1, R + 1, 3.0)))   # mic sound hole 3.0 mm (Seth 2026-10-24: 2x the old 1.5)
for sx in (-1, 1):                                                  # sled rails
    for z0, z1 in ((z_plB - 1.4, z_plB - 0.3), (z_plF + 0.3, z_plF + 1.4)):
        rib = box(32.6, R, 30.0, 140.0, z0, z1).intersect(cyly(30, 140, 2 * Ri + 0.5))
        tube = tube.union(rib if sx > 0 else rib.mirror("YZ"))
pb_y0 = 27.5                                                        # power shelf bottom
usb_y = pb_y0 + 2.0 + C["pb_t"] + 1.6
# Charging opening (Seth 2026-10-24): his power board sits USB-C UP, so the old hole (centred y 32.7) only showed
# the USB-A. USB-C centre = USB-A centre + 2.9 (half USB-A) + 1.6 (PCB) + 1.6 (half USB-C) = ~38.8.
# New opening fits a USB-C plug's moulded end (12 x 6.5 + 0.5 clearance), centred 38.6, rounded corners;
# the old opening below it is closed.
usbc_cy, usbc_w, usbc_h = 41.7, 13.0, 9.0      # Seth spec: old opening shifted up by its own height (old 28.2-37.2 -> new 37.2-46.2)
tube = tube.cut(cq.Workplane("XY").box(usbc_w, usbc_h, R, centered=(True, True, False)).edges("|Z").fillet(2.0)
                .translate((0, usbc_cy, -R - 1)))
key_x, key_y = 14.0, 50.0
tube = tube.cut(cylz(key_x, key_y, -R - 1, -32.8, 7.0))                                 # power key
sd_y = yb - 4.95
tube = tube.cut(box(-R - 1, -25.0, sd_y - 7.5, sd_y + 7.5, z_pcbB - 3.0, z_pcbB + 0.8))  # microSD

def lslots(y_end, s):
    out = None
    for a in C["lugs"]:
        a0 = a - 45.0
        segs = [roty(box(-3.4, 3.4, min(y_end, y_end + s * 8.2), max(y_end, y_end + s * 8.2), 0, Ri + 1.2), a0)]
        for t in range(0, 46, 3):
            segs.append(roty(box(-3.4, 3.4, min(y_end + s * 3.9, y_end + s * 8.2), max(y_end + s * 3.9, y_end + s * 8.2),
                                 0, Ri + 1.2), a0 + t))
        piece = segs[0]
        for g in segs[1:]:
            piece = piece.union(g)
        piece = piece.cut(cyly(y_end - 20, y_end + 20, 2 * Ri - 0.01))
        out = piece if out is None else out.union(piece)
    return out
tube = tube.cut(lslots(y_t0, 1)).cut(lslots(y_t1, -1))

# ================================================================ CAPS
sl_od = 2 * Ri - 2 * C["sleeve_clr"]; sl_id = sl_od - 2 * C["sleeve_t"]
def collar():
    """Bottom collar (ring on y 15..17, sleeve up into the tube). Top collar = mirror."""
    n, b = C["nose"], C["band"]
    ring = prism(oct_pts(C["af"]), n + b, y_t0).cut(cyly(0, 60, sl_id))
    sleeve = cyly(y_t0 - 0.01, y_t0 + C["sleeve_len"], sl_od).cut(cyly(0, 60, sl_id))
    c = ring.union(sleeve)
    for a in C["lugs"]:                                             # lugs: chamfered both ends (no overhang)
        lug = (cq.Workplane("YZ").workplane(offset=-3.0)
               .polyline([(y_t0 + 4.0, Ri - 0.4), (y_t0 + 4.0, Ri - 0.2), (y_t0 + 5.1, Ri + 0.9),
                          (y_t0 + 6.9, Ri + 0.9), (y_t0 + 8.0, Ri - 0.2), (y_t0 + 8.0, Ri - 0.4)]).close().extrude(6.0))
        c = c.union(roty(lug, a))
    return c
def lid(top):
    n, b = C["nose"], C["band"]
    nose = (cq.Workplane("XZ").workplane(offset=0).polyline(oct_pts(C["af_end"])).close()
            .workplane(offset=-n).polyline(oct_pts(C["af"])).close().loft(ruled=True))
    body = nose.union(prism(oct_pts(C["af"]), n, n + b))
    if not top:
        return body.cut(cyly(2.0, n + b + 1, 70.0))
    # top lid built with its end face at y=0 too, mirrored afterwards
    pocket_d = C["spk_flange"] + C["spacer_t"] + 0.2                # spacer + flange + gap (from the open side)
    body = body.cut(prism(oct_pts(80.4), n + b - pocket_d, n + b + 1))
    body = body.cut(cyly(2.0, n + b - pocket_d + 0.01, 66.0))      # chamber in front of the cone
    for k in range(4):                                              # speaker inserts (through its own holes)
        x, z = polar(C["spk_hole_r"], C["spk_rot"] + 45 + 90 * k)
        body = body.cut(cylz(0, 0, 0, 1, 1).translate((0, 0, 0)) if False else
                        cyly(n + b - pocket_d - C["insert_depth"], n + b - pocket_d + 0.1, C["insert_d"], x, z))
    # OPEN top (Seth 2026-10-20): no grille - the speaker cone shows through a 66 mm opening with a 1 mm chamfer.
    # (Ring-slot grille version kept in Print/_Archive/3_Capsule_LIDS_ring_grille.3mf.)
    opening = cyly(-1.0, 2.5, 66.0)
    chamfer = cq.Workplane().add(cq.Solid.makeCone(34.0 + 0.01, 33.0, 1.0, cq.Vector(0, -0.01, 0), cq.Vector(0, 1, 0)))
    return body.cut(opening).cut(chamfer)
lid_bot = lid(False); lid_top = mirror_top(lid(True))
collar_bot = collar(); collar_top = mirror_top(collar())
y_sp0 = y_t1 + C["ring"]                                           # 155
spacer = prism(oct_pts(80.0), y_sp0, y_sp0 + C["spacer_print_t"]).cut(cyly(0, L + 1, 65.0))
for k in range(4):
    x, z = polar(C["spk_hole_r"], C["spk_rot"] + 45 + 90 * k)
    spacer = spacer.cut(cyly(y_sp0 - 1, y_sp0 + C["spacer_t"] + 1, 6.6, x, z))       # screw-head pockets

# ================================================================ SLED
pw = 2 * 34.3                                                      # edges reach 1.7 mm into the rail slots (ribs start at 32.6)
plate_y1 = 121.0
plate = box(-pw / 2, pw / 2, pb_y0, plate_y1, z_plB, z_plF).intersect(cyly(0, 300, 2 * Ri - 0.9))
for sx in (-1, 1):                                                 # thicker edge strips: 2.8 mm in the 3.1 mm rail slot
    e = box(31.8, pw / 2, pb_y0, plate_y1, z_plB - 0.15, z_plF + 0.15).intersect(cyly(0, 300, 2 * Ri - 0.9))
    plate = plate.union(e if sx > 0 else e.mirror("YZ"))
for yy in (50.0, 90.0):                                            # zip-tie slots (holder)
    for xx in (-22.5, 22.5):
        plate = plate.cut(box(xx - 1.5, xx + 1.5, yy - 3, yy + 3, z_plB - 1, z_plF + 1))
for yy in (40.0, 112.0):                                           # wire pass-throughs
    for xx in (-28.0, 28.0):
        plate = plate.cut(box(xx - 2.5, xx + 2.5, yy - 5, yy + 5, z_plB - 1, z_plF + 1))
# screen posts are SEPARATE parts (printed upright, no supports): a 7 mm post with an insert hole on top and a
# 4 mm peg underneath that pushes into a hole in the sled plate (+ a drop of super glue)
POSTS = [(xx, yy) for xx in (-21.0, 21.0) for yy in (yb - 39.0, yb + 39.0)]
for xx, yy in POSTS:
    plate = plate.cut(cylz(xx, yy, z_plB - 1, z_plF + 1, 4.2))
post = cylz(0, 0, z_plF, z_pcbB, 7.0).cut(cylz(0, 0, z_pcbB - C["insert_depth"] + 0.5, z_pcbB + 1, C["insert_d"]))
post = post.union(cylz(0, 0, z_plB + 0.2, z_plF + 0.01, 4.0))
stand = None
for xx, yy in POSTS:
    p_ = post.translate((xx, yy, 0))
    stand = p_ if stand is None else stand.union(p_)
pb_shelf = box(-16, 16, pb_y0, pb_y0 + 2.0, -35.0, z_plB + 0.01).intersect(cyly(0, 300, 2 * Ri - 1.2))
pbx, pbl = C["pb"]
# The power board has a USB-A port underneath (14 wide, 5.8 deep). To keep the printed tube's charging hole,
# the board is mounted FLIPPED: USB-C (and the other parts) hang underneath at the same height as before,
# the USB-A points up.  The board rests on two pads (under the USB-C and under the coil) inside a low side rim.
pb_bot = usb_y + 1.6                                               # PCB underside (old top face) = 34.3
# Seth 2026-10-18 (photos + ruler): parts under the board hit the old support pads, and 3 pads sit ~1.2 mm in from
# one LONG edge (at ~2.7, 15.4 and 20.8 mm from the inner end), so nothing may cover the top of the edges.
# The board now DROPS IN from above onto two 1.0 mm side ledges (no top lip), with a notch in each ledge under
# those pads (both sides, so it works either way round). The floor under the board is open: nothing else touches it.
lip = 1.0
wall_top = pb_bot + C["pb_t"] + 1.2
rim = box(-pbx / 2 - 2.1, pbx / 2 + 2.1, pb_y0 + 1.99, wall_top, -34.0, -12.0)
rim = rim.cut(box(-pbx / 2 + lip, pbx / 2 - lip, pb_y0, wall_top + 1, -40, 0))                 # channel between ledges
rim = rim.cut(box(-pbx / 2 - 0.35, pbx / 2 + 0.35, pb_bot - 0.01, wall_top + 1, -40, 0))         # board pocket above ledges
z_in = -36.2 + pbl                                                  # board inner end (-11.0)
for zc in (z_in - 2.7, z_in - 15.4, z_in - 20.8):                                         # notches under the edge pads
    rim = rim.cut(box(-pbx / 2 - 0.45, pbx / 2 + 0.45, pb_bot - 2.0, wall_top + 1, zc - 1.7, zc + 1.7))
# two BACKSTOPS behind the board's inner end (Seth 10-18): a USB-C plug pushed in can't shove the board back.
# One by each long edge, leaving the middle (the two big B+/B- pads) open. Battery holder starts at z -9.6.
for sx in (-1, 1):
    bs = box(5.6, pbx / 2 + 2.1, pb_y0 + 1.99, pb_bot + C["pb_t"] + 1.5, z_in + 0.15, -9.75)
    rim = rim.union(bs if sx > 0 else bs.mirror("YZ"))
pb_shelf = pb_shelf.union(rim.intersect(cyly(0, 300, 2 * Ri - 1.2)))
pb_shelf = pb_shelf.cut(box(-pbx / 2 + lip, pbx / 2 - lip, pb_y0 - 1, pb_y0 + 2.5, -33.5, -11.5))  # open floor
amp_y = 108.3
# amp shelf bridges between the plate and two back posts (prints without supports); header pins drop through
# a slot into the 2.4 mm gap between the battery holder and the posts
amp_z0 = -12.4                                   # header strip (2.54 wide) hangs between holder and posts
amp_shelf = box(-16.0, 16.0, amp_y, amp_y + 1.5, -18.5, z_plB + 0.01).cut(box(-9.2, 9.2, amp_y - 1, amp_y + 3, amp_z0 - 0.2, amp_z0 + 2.75))
for sx in (-1, 1):
    amp_shelf = amp_shelf.union(box(12.0 if sx > 0 else -16.0, 16.0 if sx > 0 else -12.0, pb_y0 + 1.99, amp_y + 0.01, -18.5, -12.5))   # 4 x 6 mm posts
amp_shelf = amp_shelf.union(box(-16.0, 16.0, 42.0, amp_y + 0.01, -18.5, -16.9))   # back wall between the posts (its bottom edge bridges above the power board)
key_post = box(key_x - 2.0, key_x + 2.0, pb_y0 + 1.99, key_y + 5.0, -27.7, -23.7)
key_post = key_post.union(box(key_x - 3.5, key_x + 3.5, key_y - 4.0, key_y + 4.0, -27.7, -26.7))
sled = plate.union(pb_shelf).union(amp_shelf).union(key_post)

# Power-button PLUNGER (Seth 2026-10-24): replaces the loose cap. Shaft 6.65 in the 7.0 hole, outer end follows the
# tube surface 1 mm proud, two curved tabs inside the wall (above/below the switch body, so they never hit it) keep
# it captive. Fit it from INSIDE before sliding the sled in. tip_gap = gap to the switch top at rest.
def plunger(tip_gap=0.3):
    sw_top = -34.25                                            # switch plunger top (z)
    shaft = cylz(key_x, key_y, sw_top - tip_gap - 6.0, sw_top - tip_gap, 6.65)
    shaft = shaft.intersect(cyly(0, 300, 2 * (R + 1.0)))       # outer end = tube surface + 1 mm
    tabs = None
    for s in (-1, 1):
        tb = box(key_x - 1.5, key_x + 1.5, key_y + s * 3.0, key_y + s * 5.2, -40, -30) if s > 0 else              box(key_x - 1.5, key_x + 1.5, key_y - 5.2, key_y - 3.0, -40, -30)
        tb = tb.intersect(cyly(0, 300, 2 * (Ri - 0.1))).cut(cyly(0, 300, 2 * (Ri - 1.1)))
        tabs = tb if tabs is None else tabs.union(tb)
    return shaft.union(tabs)
button = plunger(0.3)

# ================================================================ PART ENVELOPES (for checks / renders)
P = {}
P["cyd_pcb"] = box(-25, 25, yb - 43, yb + 43, z_pcbB, z_pcbF)
for xx in (-21, 21):
    for yy in (yb - 39, yb + 39):
        P["cyd_pcb"] = P["cyd_pcb"].cut(cylz(xx, yy, z_pcbB - 1, z_pcbF + 1, 3.2))
P["cyd_lcd"] = box(-25, 25, yb - 35.5, yb + 35.5, z_pcbF, z_lcd)
P["cyd_back"] = box(-17, 17, yb - 34, yb + 34, z_pcbB - C["back_comp"], z_pcbB)
P["cyd_usbc"] = box(-6.2, 2.8, yb - 43 - 0.6, yb - 43 + 7.0, z_pcbF - 4.85, z_pcbF - 1.65)
hx, hy, hz = C["hold"]
P["holder"] = box(-hx / 2, hx / 2, pb_y0 + 2.5, pb_y0 + 2.5 + hy, z_plB - 0.3 - hz, z_plB - 0.3)
P["power_board"] = box(-pbx / 2, pbx / 2, pb_bot, pb_bot + C["pb_t"], -36.2, -36.2 + pbl).union(           # board
    box(-pbx / 2 + 1.1, pbx / 2 - 1.1, pb_bot - 1.5, pb_bot, -35.5, -36.2 + pbl - 0.5)).union(                          # small parts underneath (edge strips are bare pads, Seth photo 10-18)
    box(3.2, 9.2, pb_bot - 3.5, pb_bot, -24.0, -18.0)).union(                                                # coil (flipped side)
    box(-4.5, 4.5, usb_y - 1.6, usb_y + 1.6, -37.0, -29.7)).union(                                      # USB-C (charging)
    box(-7.0, 7.0, pb_bot + C["pb_t"], pb_bot + C["pb_t"] + 5.8, -36.2, -26.1))                          # USB-A, pointing up
ax_, al = C["amp"]
P["amp"] = box(-ax_ / 2, ax_ / 2, amp_y + 1.5, amp_y + 1.5 + C["amp_above"], amp_z0, amp_z0 + al)
P["amp_pins"] = box(-8.9, 8.9, amp_y + 1.5 - C["amp_pins"], amp_y + 1.5, amp_z0 + 0.03, amp_z0 + 2.57)   # yellow header strip + pins
P["mic"] = to_side(cylz(0, my, z_seat - 1.6, z_seat, C["mic_d"]).union(box(-3, 3, my - 2, my + 2, z_seat - 2.6, z_seat - 1.6)))
P["key_switch"] = box(key_x - 3, key_x + 3, key_y - 3, key_y + 3, -32.7, -27.7).union(cylz(key_x, key_y, -34.25, -32.69, 3.5))
# speaker: rounded-square flange (corner radius from 68.3 side / 83.25 diagonal), cone dome, basket, magnet
s2 = C["spk_side"] / 2
rc = (s2 * math.sqrt(2) - C["spk_diag"] / 2) / (math.sqrt(2) - 1)
y_fl = y_sp0 + C["spacer_t"]                                        # flange bottom
flange = (cq.Workplane("XZ").workplane(offset=-(y_fl + C["spk_flange"])).rect(C["spk_side"], C["spk_side"])
          .extrude(C["spk_flange"]).edges("|Y").fillet(rc))
flange = roty(flange, C["spk_rot"])
for k in range(4):
    x, z = polar(C["spk_hole_r"], C["spk_rot"] + 45 + 90 * k)
    flange = flange.cut(cyly(y_fl - 1, y_fl + 3, 5.0, x, z))
y_front = y_fl + C["spk_flange"]
spk = flange.union(cyly(y_front - 0.01, y_front + 3.0, 64.0)).union(cyly(y_fl - 8.0, y_fl + 0.01, 60.0)).union(
    cyly(y_front - C["spk_depth"] + 15.0, y_fl - 7.99, 44.0)).union(cyly(y_front - C["spk_depth"], y_front - C["spk_depth"] + 15.0, C["spk_mag_d"]))
P["speaker"] = spk
def led(y_lo, y_hi):
    return cyly(y_lo, y_hi, sl_id - 0.4).cut(cyly(y_lo - 1, y_hi + 1, sl_id - 3.6))
P["led_bot"] = led(y_t0 + 0.0, y_t0 + C["sleeve_len"])
P["led_top"] = led(y_t1 - C["sleeve_len"], y_t1)

PRINT = dict(tube=tube, lid_bot=lid_bot, lid_top=lid_top, collar_bot=collar_bot, collar_top=collar_top,
             spacer_top=spacer, sled=sled, button=button, screen_post=post.translate((0, 0, 0)),
             plunger_gap03=plunger(0.3), plunger_gap08=plunger(0.8), plunger_gap13=plunger(1.3))

# ================================================================ CHECKS
def vol(s):
    g = GProp_GProps(); BRepGProp.VolumeProperties_s(s, g); return g.Mass()
def common(a, b):
    return vol(BRepAlgoAPI_Common(a.val().wrapped, b.val().wrapped).Shape())
P["screen_posts"] = stand
allp = {k: v for k, v in {**PRINT, **P}.items() if k != "screen_post"}
names = list(allp); issues = []
for i in range(len(names)):
    for j in range(i + 1, len(names)):
        a, b = names[i], names[j]
        b1, b2 = allp[a].val().BoundingBox(), allp[b].val().BoundingBox()
        if (b1.xmax < b2.xmin or b2.xmax < b1.xmin or b1.ymax < b2.ymin or b2.ymax < b1.ymin
                or b1.zmax < b2.zmin or b2.zmax < b1.zmin):
            continue
        v = common(allp[a], allp[b])
        if v > 0.05:
            issues.append((a, b, round(v, 2)))
print("INTERFERENCE:", issues if issues else "none")
carried = sled.union(stand)
for k in ("cyd_pcb", "cyd_lcd", "cyd_back", "cyd_usbc", "holder", "power_board", "amp", "amp_pins", "key_switch"):
    carried = carried.union(P[k])
hits = [(dy, round(v, 2)) for dy in range(3, 130, 3) if (v := common(carried.translate((0, -dy, 0)), tube)) > 0.05]
print("SLED SLIDE-IN hits:", hits if hits else "none")
tw_b = [(a, round(common(roty(collar_bot, -a), tube), 2)) for a in range(0, 46, 5)]
tw_t = [(a, round(common(roty(collar_top, -a), tube), 2)) for a in range(0, 46, 5)]
print("TWIST bottom:", tw_b); print("TWIST top:", tw_t)
# speaker drops into the lid pocket from below (straight up) without touching
spk_hits = [(dy, round(v, 2)) for dy in range(2, 30, 2) if (v := common(P["speaker"].translate((0, -dy, 0)), lid_top)) > 0.05]
print("SPEAKER INTO LID hits:", spk_hits if spk_hits else "none")
print("mic boss to magnet radial gap (mm): %.2f" % (math.hypot(8.5, z_seat - 2.4) - C["spk_mag_d"] / 2))
print("magnet back y %.2f, amp top y %.2f, plate top y %.2f" % (y_front - C["spk_depth"], amp_y + 1.5 + C["amp_above"], plate_y1))
print("z stack: face %.1f lcd %.1f pcb %.1f..%.1f plate %.1f..%.1f" % (z_face, z_lcd, z_pcbB, z_pcbF, z_plB, z_plF))

# ================================================================ EXPORT
def exp(s, p): cq.exporters.export(s, str(p), tolerance=0.02, angularTolerance=0.12)
for k, s in PRINT.items():
    exp(s, STL / f"Orbit_Capsule_{k}.stl")
half = box(-200, 0, -50, 250, -200, 200)
for k, s in {**PRINT, **P}.items():
    exp(s, RM / f"cv2_{k}.stl")
    if k in PRINT or k.startswith("led") or k == "speaker":
        exp(s.intersect(half), RM / f"cv2_{k}_cut.stl")
w, h = 44.0, 58.4
SCR = [(-w / 2, win_cy - h / 2, z_lcd + 0.05), (w / 2, win_cy - h / 2, z_lcd + 0.05),
       (w / 2, win_cy + h / 2, z_lcd + 0.05), (-w / 2, win_cy + h / 2, z_lcd + 0.05)]
json.dump(dict(C=C, screen=SCR, issues=issues, sweep=hits, twist_bot=tw_b, twist_top=tw_t, spk=spk_hits),
          open(RM / "cv2_layout.json", "w"), indent=1)
print("done")

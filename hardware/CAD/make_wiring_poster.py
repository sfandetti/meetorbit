"""Orbit wiring poster drawn on Seth's real part photos.
python make_wiring_poster.py <folder with the Originals JPEGs> <output.jpg>"""
from PIL import Image, ImageOps, ImageDraw, ImageFont
import sys
SRC = sys.argv[1]; OUT = sys.argv[2]
def load(n): return ImageOps.exif_transpose(Image.open(f"{SRC}\\{n}.JPEG")).convert("RGB")
W, H = 3900, 2900
cv = Image.new("RGB", (W, H), (246, 247, 249)); d = ImageDraw.Draw(cv)
FB = lambda s: ImageFont.truetype("arialbd.ttf", s); FR = lambda s: ImageFont.truetype("arial.ttf", s)

PL = {}
def place(key, img, box, pos, scale):
    x0, y0, x1, y1 = box
    im = img.crop(box).resize((int((x1 - x0) * scale), int((y1 - y0) * scale)))
    cv.paste(im, pos); PL[key] = (box, pos, scale)
    d.rectangle((pos[0] - 3, pos[1] - 3, pos[0] + im.width + 3, pos[1] + im.height + 3), outline=(150, 156, 166), width=3)
    return im.size
def P(key, x, y):
    (x0, y0, _, _), (px, py), s = PL[key]; return (px + (x - x0) * s, py + (y - y0) * s)

disp = load("Display-clean-IMG_1480"); mic = load("Microphone-IMG_1499"); amp = load("Amplifier-IMG_1498"); pb = load("Power-board-IMG_1433")
place("disp", disp, (170, 20, 1400, 2000), (1250, 330), 1.08)
place("mic", mic, (470, 960, 910, 1460), (3050, 330), 1.25)
place("amp", amp, (300, 940, 1060, 1790), (3170, 1520), 0.82)
place("pb", pb, (380, 1060, 780, 1560), (420, 1560), 1.35)

d.text((60, 40), "ORBIT  ·  COMPLETE WIRING", fill=(20, 24, 32), font=FB(64))
d.text((60, 120), "Real photos of your parts. Every line is one wire, in the colour you'll use.   ○ = splice your 22 AWG wire onto the short plug-cable wire.   ● = two wires join here.", fill=(70, 78, 90), font=FR(32))
def title(x, y, t):
    d.text((x, y), t, fill=(20, 24, 32), font=FB(42))
title(1250, 260, "SCREEN (back side)")
title(3050, 260, "MICROPHONE (pin side)")
title(3170, 1450, "AMP")
title(420, 1490, "POWER BOARD (USB-C side)")

def battery(x, y):
    d.rounded_rectangle((x, y, x + 520, y + 300), 18, fill=(40, 42, 46), outline=(20, 20, 20), width=4)
    for i in range(2):
        cx = x + 40 + i * 240; d.rounded_rectangle((cx, y + 40, cx + 200, y + 260), 30, fill=(40, 100, 200))
        d.text((cx + 100, y + 150), "18650", fill="white", font=FB(34), anchor="mm")
    d.text((x, y - 56), "BATTERY HOLDER (parallel)", fill=(20, 24, 32), font=FB(42))
    return (x, y + 70), (x, y + 230)
bat_p, bat_n = battery(180, 420)
d.text((bat_p[0] - 40, bat_p[1] - 60), "+", fill=(200, 30, 30), font=FB(48)); d.text((bat_n[0] - 40, bat_n[1] + 4), "−", fill=(20, 20, 20), font=FB(48))
def button(x, y):
    d.rounded_rectangle((x, y, x + 150, y + 150), 10, fill=(30, 30, 32)); d.ellipse((x + 40, y + 40, x + 110, y + 110), fill=(80, 80, 85))
    d.text((x - 10, y - 58), "PUSH BUTTON", fill=(20, 24, 32), font=FB(40))
    return (x + 150, y + 30), (x + 150, y + 120)
btn_a, btn_b = button(240, 2560)
def speaker(x, y):
    d.ellipse((x, y, x + 300, y + 300), fill=(30, 30, 34)); d.ellipse((x + 70, y + 70, x + 230, y + 230), fill=(70, 70, 76)); d.ellipse((x + 125, y + 125, x + 175, y + 175), fill=(120, 120, 128))
    d.text((x, y - 58), "SPEAKER", fill=(20, 24, 32), font=FB(42))
    return (x + 210, y + 290), (x + 120, y + 290)
spk_p, spk_n = speaker(3560, 1030)
d.text((spk_p[0] + 14, spk_p[1] - 60), "+", fill=(200, 30, 30), font=FB(44)); d.text((spk_n[0] - 50, spk_n[1] - 60), "−", fill=(20, 20, 20), font=FB(44))

pb_5vn = P("pb", 715, 1204); pb_5vp = P("pb", 715, 1299); pb_bn = P("pb", 521, 1513); pb_bp = P("pb", 620, 1513); pb_k = P("pb", 721, 1504)
m_sck = P("mic", 649, 1125); m_ws = P("mic", 732, 1112); m_lr = P("mic", 813, 1098); m_sd = P("mic", 688, 1399); m_vdd = P("mic", 773, 1381); m_gnd = P("mic", 861, 1365)
k = 1536 / 900
a_pin = {n: P("amp", x * k, y * k) for n, (x, y) in dict(LRC=(243, 975), BCLK=(300, 962), DIN=(358, 948), GAIN=(413, 935), SD=(468, 920), GND=(522, 903), VIN=(575, 895)).items()}
a_tm = P("amp", 338 * k, 632 * k); a_tp = P("amp", 423 * k, 632 * k)
cn1 = [P("disp", 1385, y) for y in (640, 668, 698, 725)]       # GND IO22 IO27 3.3V
p3 = [P("disp", 1385, y) for y in (265, 295, 325, 355)]         # GND GPIO35 IO22 IO21
p1 = [P("disp", x, 1965) for x in (461, 491, 522, 553)]         # VIN TX RX GND
led = P("disp", 1010, 681)

COL = dict(red=(214, 40, 40), black=(25, 25, 28), blue=(37, 99, 235), green=(22, 150, 75), orange=(240, 135, 20), yellow=(240, 190, 0), white=(250, 250, 250))
def wire(pts, col, w=12):
    pts = [tuple(map(float, p)) for p in pts]
    d.line(pts, fill=(15, 15, 18), width=w + 6, joint="curve"); d.line(pts, fill=COL[col], width=w, joint="curve")
def splice(p): d.ellipse((p[0] - 13, p[1] - 13, p[0] + 13, p[1] + 13), fill="white", outline=(15, 15, 18), width=5)
def dot(p, col): d.ellipse((p[0] - 15, p[1] - 15, p[0] + 15, p[1] + 15), fill=COL[col], outline=(15, 15, 18), width=4)
def pad(p): d.ellipse((p[0] - 9, p[1] - 9, p[0] + 9, p[1] + 9), fill=(255, 220, 60), outline=(15, 15, 18), width=3)
def tag(p, txt, col=(20, 24, 32), dx=16, dy=-46, size=30):
    f = FB(size); bb = d.textbbox((p[0] + dx, p[1] + dy), txt, font=f)
    d.rounded_rectangle((bb[0] - 8, bb[1] - 6, bb[2] + 8, bb[3] + 6), 8, fill=(255, 255, 255), outline=col, width=3); d.text((p[0] + dx, p[1] + dy), txt, fill=col, font=f)

# ===== POWER =====
wire([bat_p, (60, bat_p[1]), (60, 2390), (pb_bp[0], 2390), pb_bp], "red")
wire([bat_n, (110, bat_n[1]), (110, 2300), (pb_bn[0], 2300), pb_bn], "black")
wire([btn_a, (pb_k[0], btn_a[1]), pb_k], "yellow"); tag((600, btn_a[1]), "button wire → K  (yellow + tape)", dx=0, dy=14, size=24)
wire([btn_b, (565, btn_b[1]), (565, 2300)], "black"); dot((565, 2300), "black")
sp_y = p1[0][1] + 150
wire([pb_5vp, (1080, pb_5vp[1]), (1080, sp_y + 60), (p1[0][0], sp_y + 60)], "red")
wire([pb_5vn, (1140, pb_5vn[1]), (1140, sp_y + 130), (p1[3][0] + 70, sp_y + 130), (p1[3][0] + 70, sp_y), (p1[3][0], sp_y)], "black")
wire([p1[0], (p1[0][0], sp_y + 60)], "yellow", 9); splice((p1[0][0], sp_y + 60))
wire([p1[3], (p1[3][0], sp_y)], "black", 9); splice((p1[3][0], sp_y))
wire([p1[1], (p1[1][0], p1[1][1] + 70)], "white", 9); wire([p1[2], (p1[2][0], p1[2][1] + 70)], "red", 9)
tag((p1[1][0], p1[1][1] + 70), "TX/RX: insulate", dx=40, dy=-10, size=22)
bus_r, bus_k = H - 120, H - 70
wire([(1080, sp_y + 60), (1080, bus_r), (a_pin["VIN"][0], bus_r), a_pin["VIN"]], "red")
wire([(1140, sp_y + 130), (1140, bus_k), (a_pin["GND"][0] - 0, bus_k), a_pin["GND"]], "black")
dot((1080, sp_y + 60), "red"); dot((1140, sp_y + 130), "black")
for p in (pb_5vp, pb_5vn, pb_bp, pb_bn, pb_k): pad(p)
tag(pb_5vp, "5V+", (200, 30, 30), dx=-110, dy=-16); tag(pb_5vn, "5V−", dx=-110, dy=-16)
tag(pb_bp, "B+", (200, 30, 30), dx=-24, dy=-70); tag(pb_bn, "B−", dx=-24, dy=-70); tag(pb_k, "K", dx=-12, dy=-70)
tag(p1[0], "P1:  VIN · TX · RX · GND", dx=-60, dy=-110, size=24)
tag((p1[0][0], sp_y + 60), "yellow = +5V (do the P1 beep check)", (200, 30, 30), dx=-520, dy=-20, size=24)

# ===== AUDIO =====
spx = cn1[0][0] + 110
for (p, cc) in zip(cn1, ("black", "red", "white", "yellow")): wire([p, (spx, p[1])], cc, 9)
for p in cn1: splice((spx, p[1]))
for (p, cc) in zip(p3, ("black", "red", "white", "yellow")): wire([p, (p[0] + (110 if cc == "red" else 55), p[1])], cc, 9)
splice((p3[1][0] + 110, p3[1][1]))
tag((p3[0][0], p3[0][1]), "P3", dx=-10, dy=-80, size=30)
tag((p3[3][0] + 55, p3[3][1]), "unused: insulate (yellow = IO21!)", dx=-260, dy=36, size=22)
tag((cn1[0][0], cn1[0][1]), "CN1", dx=-10, dy=-80, size=30)
cx1, cx2, cx3, jx22, jx27, cxd = spx + 120, spx + 175, spx + 230, spx + 300, spx + 360, spx + 420
wire([(spx, cn1[3][1]), (cx1, cn1[3][1]), (cx1, m_vdd[1] + 230), (m_vdd[0], m_vdd[1] + 230), m_vdd], "orange")
wire([(spx, cn1[0][1]), (cx2, cn1[0][1]), (cx2, m_gnd[1] + 170), (m_gnd[0], m_gnd[1] + 170), m_gnd], "black")
wire([(p3[1][0] + 110, p3[1][1]), (cx3, p3[1][1]), (cx3, m_sd[1] + 290), (m_sd[0], m_sd[1] + 290), m_sd], "yellow")
j22 = (jx22, cn1[1][1]); j27 = (jx27, cn1[2][1])
wire([(spx, cn1[1][1]), j22], "blue"); wire([(spx, cn1[2][1]), j27], "green")
top = m_sck[1] - 150
wire([j22, (j22[0], top - 50), (m_sck[0], top - 50), m_sck], "blue")
wire([j27, (j27[0], top), (m_ws[0], top), m_ws], "green")
wire([j22, (j22[0], a_pin["BCLK"][1] + 260), (a_pin["BCLK"][0], a_pin["BCLK"][1] + 260), a_pin["BCLK"]], "blue")
wire([j27, (j27[0], a_pin["LRC"][1] + 200), (a_pin["LRC"][0], a_pin["LRC"][1] + 200), a_pin["LRC"]], "green")
dot(j22, "blue"); dot(j27, "green")
wire([m_lr, (m_lr[0] + 160, m_lr[1]), (m_lr[0] + 160, m_gnd[1]), m_gnd], "black", 9)
tag((m_lr[0] + 160, (m_lr[1] + m_gnd[1]) / 2), "L/R → GND jumper", dx=16, dy=-14, size=24)
for p in (m_sck, m_ws, m_lr, m_sd, m_vdd, m_gnd): pad(p)
for n, p, dy in (("SCK", m_sck, -64), ("WS", m_ws, -64), ("L/R", m_lr, -64), ("SD", m_sd, 24), ("VDD", m_vdd, 24), ("GND", m_gnd, 24)):
    tag(p, n, dx=-30, dy=dy, size=26)
dn_y = P("disp", 0, 905)[1]
# GPIO4 CONFIRMED 2026-10-22: test firmware drove GPIO4 LOW; LED1 left-middle pad read 0.044 V (others ~3.3 V)
wire([led, (led[0], dn_y), (cxd, dn_y), (cxd, a_pin["DIN"][1] + 140), (a_pin["DIN"][0], a_pin["DIN"][1] + 140), a_pin["DIN"]], "white")
d.ellipse((led[0] - 26, led[1] - 26, led[0] + 26, led[1] + 26), outline=(22, 150, 75), width=7)
tag((led[0], dn_y), "GPIO4 = LED1 left-middle pad (CONFIRMED by your 0.04 V test)", (22, 150, 75), dx=-720, dy=20, size=24)
for n in ("LRC", "BCLK", "DIN", "GND", "VIN"): pad(a_pin[n])
for n in ("LRC", "BCLK", "DIN", "GND", "VIN"): tag(a_pin[n], n, dx=-30, dy=36, size=22)
for n in ("GAIN", "SD"): tag(a_pin[n], "empty", (110, 110, 110), dx=-30, dy=36, size=20)
wire([a_tp, (a_tp[0], 1440), (spk_p[0], 1440), spk_p], "red")
wire([a_tm, (a_tm[0], 1395), (spk_n[0], 1395), spk_n], "black")
tag(a_tp, "+", (200, 30, 30), dx=24, dy=-20); tag(a_tm, "−", dx=-60, dy=30)

lx, ly = 200, 900
d.text((lx, ly), "Wire colours (your 22 AWG)", fill=(20, 24, 32), font=FB(38))
for i, (c, t) in enumerate([("red", "5V+ / battery +"), ("black", "GND / battery −"), ("orange", "3.3V → mic VDD"), ("blue", "IO22 clock (mic + amp)"),
                            ("green", "IO27 clock (mic + amp)"), ("yellow", "GPIO35 mic data"), ("white", "GPIO4 → amp DIN")]):
    y = ly + 60 + i * 50; wire([(lx, y + 18), (lx + 90, y + 18)], c); d.text((lx + 110, y), t, fill=(30, 34, 42), font=FR(32))
d.text((200, 1330), "Thin wires = the short plug cables, up to the ○ splice.", fill=(70, 78, 90), font=FR(28))
d.text((200, 1370), "Lines crossing WITHOUT a dot are not connected.", fill=(70, 78, 90), font=FR(28))
cv.save(OUT, quality=92); print("saved", cv.size)

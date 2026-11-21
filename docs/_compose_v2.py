# -*- coding: utf-8 -*-
"""
Pet-machine theme previews, composed from INDIVIDUAL furniture PNGs (not the
art AI's pre-arranged room previews — those layouts are rejected).
Cream uses the blessed assemble-test.html positions; the other 5 are hand-placed.
Placement model = assemble-test.html: each 256-canvas piece scaled to width=w*SW,
square, top-left at (left*SW, top*SH) in the screen rect.
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont
import numpy as np

SRC = r"C:\Users\liu35\Desktop\pet-machine-assets"
TH  = os.path.join(SRC, "themes")
OUT = r"C:\Users\liu35\Desktop\phone-app\docs\theme-previews"
os.makedirs(OUT, exist_ok=True)

D = 600
SX, SY = round(.196 * D), round(.228 * D)
SW, SH = round(.607 * D), round(.487 * D)
OVER = (40, 48, 92, 87)
GLOW_RGB, GLOW_A, GLOW_R = (255, 226, 165), .55, .40
BG_Y = {"cream-bedroom": 0.80}   # cover-crop bias: fraction of vertical excess cropped from TOP (default .5=center)

shell = Image.open(os.path.join(SRC, "shells", "shell_square.png")).convert("RGBA").resize((D, D), Image.LANCZOS)
PET = Image.open(os.path.join(SRC, "pets", "pet_cat.png")).convert("RGBA")

# items: (name, left, top, w)  drawn in order (later = on top). 'furn_window' auto day/night.
# lamp: (name, left, top, w) redrawn ABOVE the night overlay so it stays lit (None = none).
# glow: (gx, gy) warm-light center on screen.  pet: (w, cx, bottom).
LAYOUTS = {
 "cream-bedroom": dict(
    items=[("furn_window",.05,.09,.27),("furn_picture",.44,.11,.12),("furn_shelf",.63,.10,.33),
           ("furn_plant",.04,.49,.18),("furn_rug",.17,.71,.38),("furn_bed",.60,.39,.36),
           ("furn_lamp_off",.19,.52,.15)],
    lamp=("furn_lamp_on",.19,.52,.15), glow=(.26,.60), pet=(.32,.50,.19)),

 "forest-cabin": dict(
    items=[("furn_window",.05,.11,.28),("furn_log_shelf",.64,.14,.30),
           ("furn_hanging_lamp",.50,.05,.12),
           ("furn_plant",.02,.55,.16),("furn_table",.40,.50,.27),
           ("furn_chair",.66,.49,.20),("furn_mushroom_stool",.84,.60,.17)],
    lamp=("furn_hanging_lamp",.50,.05,.12), glow=(.54,.52), pet=(.32,.31,.12)),

 "seaside": dict(
    items=[("furn_window",.04,.11,.29),("furn_shell_shelf",.66,.14,.30),("furn_shell",.71,.20,.09),
           ("furn_swim_ring",.02,.64,.18),("furn_surfboard",.82,.56,.26),
           ("furn_umbrella",.44,.40,.28),("furn_beach_chair",.64,.50,.26)],
    lamp=None, glow=(.15,.22), pet=(.32,.30,.10)),

 "sakura-room": dict(
    items=[("furn_window",.05,.11,.29),("furn_hanging_scroll",.75,.12,.12),
           ("furn_bonsai",.02,.52,.16),("furn_cushion",.17,.64,.22),
           ("furn_low_table",.35,.56,.30),("furn_vase",.43,.46,.10),
           ("furn_paper_lantern",.82,.64,.16)],
    lamp=("furn_paper_lantern",.82,.64,.16), glow=(.90,.70), pet=(.32,.70,.10)),

 "starry-room": dict(
    items=[("furn_window",.04,.11,.28),("furn_moon_wall",.40,.08,.16),("furn_planet_shelf",.66,.12,.30),
           ("furn_planet_rug",.34,.66,.30),("furn_cloud_cushion",.03,.62,.20),
           ("furn_star_lamp",.24,.42,.15),("furn_rocket_bed",.64,.40,.30)],
    lamp=("furn_star_lamp",.24,.42,.15), glow=(.32,.56), pet=(.32,.48,.12)),

 "sweets-shop": dict(
    items=[("furn_window",.04,.11,.28),("furn_hanging_sign",.42,.06,.14),("furn_dessert_rack",.70,.12,.26),
           ("furn_milk_tea",.07,.58,.12),("furn_cupcake_stand",.28,.54,.20),
           ("furn_high_stool",.49,.56,.14),("furn_cake_cabinet",.64,.40,.30)],
    lamp=("furn_cake_cabinet",.64,.40,.30), glow=(.78,.58), pet=(.32,.30,.10)),
}

def load(theme, name):
    return Image.open(os.path.join(TH, theme, name + ".png")).convert("RGBA")

def place(screen, img, left, top, w):
    side = max(1, round(w * SW))
    im = img.resize((side, max(1, round(side * img.height / img.width))), Image.LANCZOS)
    screen.alpha_composite(im, (round(left * SW), round(top * SH)))

def make_glow(gx, gy):
    cx, cy = gx * SW, gy * SH
    ys, xs = np.ogrid[0:SH, 0:SW]
    dist = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2)
    far = max(((cx - px) ** 2 + (cy - py) ** 2) ** .5 for px, py in [(0, 0), (SW, 0), (0, SH), (SW, SH)])
    a = np.clip(1 - dist / (GLOW_R * far), 0, 1) * GLOW_A
    arr = np.zeros((SH, SW, 4), np.uint8)
    arr[..., 0], arr[..., 1], arr[..., 2] = GLOW_RGB
    arr[..., 3] = (a * 255).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")

def device(theme, night):
    L = LAYOUTS[theme]
    dev = Image.new("RGBA", (D, D), (0, 0, 0, 0))
    screen = Image.new("RGBA", (SW, SH), (255, 255, 255, 255))
    bg = load(theme, "bg")                                   # cover: fill screen + crop excess (assemble-test 风格)
    s = max(SW / bg.width, SH / bg.height)
    bg = bg.resize((round(bg.width * s), round(bg.height * s)), Image.LANCZOS)
    cy = round((bg.height - SH) * BG_Y.get(theme, 0.5)); cx = (bg.width - SW) // 2
    screen.alpha_composite(bg.crop((cx, cy, cx + SW, cy + SH)))
    for name, left, top, w in L["items"]:
        fn = name + ("_night" if (name == "furn_window" and night) else ("_day" if name == "furn_window" else ""))
        place(screen, load(theme, fn), left, top, w)
    if night:
        screen.alpha_composite(Image.new("RGBA", (SW, SH), OVER))
        if L["glow"]:
            screen.alpha_composite(make_glow(*L["glow"]))
        if L["lamp"]:
            nm, lf, tp, w = L["lamp"]
            place(screen, load(theme, nm), lf, tp, w)
    pw, pcx, pb = L["pet"]
    side = max(1, round(pw * SW))
    pim = PET.resize((side, round(side * PET.height / PET.width)), Image.LANCZOS)
    screen.alpha_composite(pim, (round(pcx * SW - side / 2), round(SH * (1 - pb)) - pim.height))
    dev.alpha_composite(screen, (SX, SY))
    dev.alpha_composite(shell)
    return dev

def font(p, s):
    try: return ImageFont.truetype(p, s)
    except Exception: return ImageFont.load_default()
F = font(r"C:\Windows\Fonts\msyhbd.ttc", 26)

ZH = {"cream-bedroom":"奶油卧室","forest-cabin":"森林木屋","seaside":"海边小屋",
      "sakura-room":"樱花和室","starry-room":"星空小屋","sweets-shop":"甜品店"}
ORDER = ["cream-bedroom","forest-cabin","seaside","sakura-room","starry-room","sweets-shop"]

def sheet(mode):
    """mode 'day' or 'night' — 2 cols x 3 rows grid of all themes."""
    night = mode == "night"
    cols, pad, lab = 2, 24, 34
    cw, ch = D, D + lab
    W = pad + cols * cw + (cols - 1) * pad + pad
    rows = (len(ORDER) + cols - 1) // cols
    H = pad + rows * ch + (rows - 1) * pad + pad
    cv = Image.new("RGB", (W, H), (242, 236, 233))
    dr = ImageDraw.Draw(cv)
    for i, key in enumerate(ORDER):
        r, c = divmod(i, cols)
        x = pad + c * (cw + pad)
        y = pad + r * (ch + pad)
        dr.text((x + 4, y), ZH[key] + ("  夜" if night else "  日"), font=F, fill=(108, 100, 120))
        dev = device(key, night)
        cv.paste(dev, (x, y + lab), dev)
    out = os.path.join(OUT, f"sheet_{mode}.png")
    cv.save(out); print("saved", out, cv.size)

def pair(key):
    """One theme: day | night devices side by side, labeled."""
    PAD, GAP, NAME_H, CAP_H = 30, 34, 52, 38
    W = PAD + D + GAP + D + PAD
    H = NAME_H + D + CAP_H + PAD
    cv = Image.new("RGB", (W, H), (240, 233, 235))
    dr = ImageDraw.Draw(cv)
    dr.text((PAD + 2, 12), ZH[key], font=F, fill=(108, 100, 120))
    x0, x1 = PAD, PAD + D + GAP
    cv.paste(device(key, False), (x0, NAME_H), device(key, False))
    cv.paste(device(key, True),  (x1, NAME_H), device(key, True))
    fc = font(r"C:\Windows\Fonts\msyh.ttc", 22)
    for x, t in ((x0, "日间"), (x1, "夜间")):
        w = dr.textlength(t, font=fc)
        dr.text((x + D / 2 - w / 2, NAME_H + D + 4), t, font=fc, fill=(140, 133, 152))
    out = os.path.join(OUT, f"pair_{key}.png"); cv.save(out); print("saved", out)

if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else "day"
    if arg == "pairs":
        for k in ORDER: pair(k)
    else:
        sheet(arg)

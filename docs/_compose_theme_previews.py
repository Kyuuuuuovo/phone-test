# -*- coding: utf-8 -*-
"""
Compose pet-machine theme day/night previews to the "cream-bedroom standard":
  device shell + room (cover) + [night: uniform dim overlay + warm radial glow] + pet on top.
Geometry & filter params mirror docs/assemble-test.html exactly.
Outputs one day|night pair PNG per theme into docs/theme-previews/.
"""
import os
from PIL import Image, ImageDraw, ImageFont
import numpy as np

SRC = r"C:\Users\liu35\Desktop\pet-machine-assets"
OUT = r"C:\Users\liu35\Desktop\phone-app\docs\theme-previews"
os.makedirs(OUT, exist_ok=True)

# --- device geometry (from assemble-test.html: screen left19.6% top22.8% w60.7% h48.7%) ---
D  = 600
SX, SY = round(0.196 * D), round(0.228 * D)
SW, SH = round(0.607 * D), round(0.487 * D)

# --- night filter params (from assemble-test.html) ---
OVERLAY  = (40, 48, 92, 87)        # rgba(40,48,92,.34)
GLOW_RGB = (255, 226, 165)         # warm
GLOW_PEAK = 0.55                   # alpha at center
GLOW_RADIUS_FRAC = 0.40            # transparent at 40% of farthest-corner

# key, zh, en, (glow x%, glow y%) on the screen
THEMES = [
    ("cream-bedroom", "奶油卧室", "cream bedroom", (0.26, 0.58)),  # bedside lamp
    ("forest-cabin",  "森林木屋", "forest cabin",  (0.50, 0.40)),  # hanging lamp
    ("seaside",       "海边小屋", "seaside",       (0.24, 0.30)),  # window moonlight
    ("sakura-room",   "樱花和室", "sakura room",   (0.50, 0.50)),  # paper lantern
    ("starry-room",   "星空小屋", "starry room",   (0.42, 0.52)),  # star lamp
    ("sweets-shop",   "甜品店",   "sweets shop",   (0.76, 0.50)),  # lit cake cabinet
]

shell = Image.open(os.path.join(SRC, "shells", "shell_square.png")).convert("RGBA").resize((D, D), Image.LANCZOS)
pet = Image.open(os.path.join(SRC, "pets", "pet_cat.png")).convert("RGBA")
_pw = round(0.30 * SW); _ph = round(pet.height * _pw / pet.width)
pet = pet.resize((_pw, _ph), Image.LANCZOS)
PET_X = (SW - _pw) // 2
PET_Y = round(SH * 0.82) - _ph


def make_glow(gx, gy):
    cx, cy = gx * SW, gy * SH
    ys, xs = np.ogrid[0:SH, 0:SW]
    dist = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2)
    far = max(((cx - px) ** 2 + (cy - py) ** 2) ** 0.5 for px, py in [(0, 0), (SW, 0), (0, SH), (SW, SH)])
    R = GLOW_RADIUS_FRAC * far
    a = np.clip(1 - dist / R, 0, 1) * GLOW_PEAK
    arr = np.zeros((SH, SW, 4), dtype=np.uint8)
    arr[..., 0], arr[..., 1], arr[..., 2] = GLOW_RGB
    arr[..., 3] = (a * 255).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def room_cover(path):
    im = Image.open(path).convert("RGBA")
    rw, rh = im.size
    scale = max(SW / rw, SH / rh)
    im = im.resize((round(rw * scale), round(rh * scale)), Image.LANCZOS)
    l, t = (im.width - SW) // 2, (im.height - SH) // 2
    return im.crop((l, t, l + SW, t + SH))


def device(theme_key, night, glow):
    dev = Image.new("RGBA", (D, D), (0, 0, 0, 0))
    room = room_cover(os.path.join(SRC, "themes", theme_key, f"preview_room_{'night' if night else 'day'}.png"))
    screen = Image.new("RGBA", (SW, SH), (255, 255, 255, 255))
    screen.alpha_composite(room)
    if night:
        screen.alpha_composite(Image.new("RGBA", (SW, SH), OVERLAY))
        screen.alpha_composite(make_glow(*glow))
    screen.alpha_composite(pet, (PET_X, PET_Y))
    dev.alpha_composite(screen, (SX, SY))
    dev.alpha_composite(shell)
    return dev


# fonts (Microsoft YaHei for CJK; fall back to default)
def load_font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()

F_NAME = load_font(r"C:\Windows\Fonts\msyhbd.ttc", 30)
F_EN   = load_font(r"C:\Windows\Fonts\msyh.ttc", 18)
F_CAP  = load_font(r"C:\Windows\Fonts\msyh.ttc", 22)

BG = (242, 236, 233)
PAD, GAP, NAME_H, CAP_H = 34, 38, 58, 42


def centered(draw, text, font, cx, y, fill):
    w = draw.textlength(text, font=font)
    draw.text((cx - w / 2, y), text, font=font, fill=fill)


def pair(theme):
    key, zh, en, glow = theme
    W = PAD + D + GAP + D + PAD
    H = NAME_H + D + CAP_H + PAD
    cv = Image.new("RGB", (W, H), BG)
    dr = ImageDraw.Draw(cv)
    dr.text((PAD + 4, 12), zh, font=F_NAME, fill=(108, 100, 120))
    nw = dr.textlength(zh, font=F_NAME)
    dr.text((PAD + 4 + nw + 12, 24), en, font=F_EN, fill=(176, 168, 186))
    day = device(key, False, glow)
    night = device(key, True, glow)
    x0, x1 = PAD, PAD + D + GAP
    cv.paste(day, (x0, NAME_H), day)
    cv.paste(night, (x1, NAME_H), night)
    centered(dr, "日间", F_CAP, x0 + D / 2, NAME_H + D + 6, (140, 133, 152))
    centered(dr, "夜间", F_CAP, x1 + D / 2, NAME_H + D + 6, (140, 133, 152))
    out = os.path.join(OUT, f"pair_{key}.png")
    cv.save(out)
    return out, (W, H)


print("screen rect:", (SX, SY, SW, SH), "pet:", (PET_X, PET_Y, _pw, _ph))
for t in THEMES:
    p, size = pair(t)
    print("saved", p, size)
print("done")

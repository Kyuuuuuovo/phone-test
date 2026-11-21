# -*- coding: utf-8 -*-
"""量每种外壳的屏幕洞:扫中心列/行,取「被外壳包住的最大透明段」。按钮位置由屏幕几何推算。"""
import numpy as np
from PIL import Image

SHELLS = {
    'square': r'C:\Users\liu35\Desktop\pet-machine-assets\shells\shell_square.png',
    'egg':    r'C:\Users\liu35\Desktop\pet-machine-assets\transparent\cream-oval-transparent.png',
    'cloud':  r'C:\Users\liu35\Desktop\pet-machine-assets\transparent\cream-cloud-transparent.png',
    'house':  r'C:\Users\liu35\Desktop\pet-machine-assets\transparent\cream-house-transparent.png',
}

def interior_runs(line, thresh=30):
    """返回被不透明像素两侧夹住的透明段 [(start,end,len)],按 len 排序。"""
    op = line > thresh
    if not op.any():
        return []
    n = len(op); i = int(np.argmax(op))   # 从第一个不透明开始(跳过外侧透明)
    runs = []
    while i < n:
        while i < n and op[i]: i += 1      # 跳过不透明
        if i >= n: break
        start = i
        while i < n and not op[i]: i += 1  # 透明段
        if i < n:                          # 右侧也被不透明夹住 = 内孔
            runs.append((start, i-1, i-start))
    runs.sort(key=lambda r: -r[2])
    return runs

def screen_hole(path):
    im = Image.open(path).convert('RGBA')
    W, H = im.size
    a = np.array(im)[:, :, 3]
    col = interior_runs(a[:, W // 2])      # 中心列 → 屏幕上下
    if not col: return None
    s_top, s_bot = col[0][0], col[0][1]
    cy = (s_top + s_bot) // 2
    row = interior_runs(a[cy, :])          # 屏幕中线行 → 屏幕左右
    if not row: return None
    s_left, s_right = row[0][0], row[0][1]
    return W, H, s_left, s_top, s_right, s_bot

print(f"{'shell':7s} {'canvas':11s} {'left%':>6}{'top%':>7}{'w%':>7}{'h%':>7}    buttons x(%): a,b,c  @ y(%)")
geom = {}
for name, path in SHELLS.items():
    r = screen_hole(path)
    if not r:
        print(name, 'FAIL'); continue
    W, H, l, t, rt, b = r
    L, T, Wp, Hp = l/W*100, t/H*100, (rt-l)/W*100, (b-t)/H*100
    cx = L + Wp/2
    by = (T + Hp) + (100 - (T + Hp)) * 0.36
    bx = (cx - Wp*0.24, cx, cx + Wp*0.24)
    geom[name] = (round(L,1), round(T,1), round(Wp,1), round(Hp,1), round(bx[0],1), round(bx[1],1), round(bx[2],1), round(by,1))
    print(f"{name:7s} {W}x{H:<6} {L:6.1f} {T:6.1f} {Wp:6.1f} {Hp:6.1f}    {bx[0]:5.1f},{bx[1]:5.1f},{bx[2]:5.1f}  @ {by:5.1f}")
print("\nJS:", {k: list(v) for k,v in geom.items()})

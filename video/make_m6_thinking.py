#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate M6 "thinking process" clip for the TT_ChatChoice demo video.

Renders 1920x1080 30fps frames with PIL and encodes them with ffmpeg.
No external assets besides the real screenshots in ../shots/.
"""
import math
import os
import shutil
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.normpath(os.path.join(HERE, "..", "shots"))
ASSETS = os.path.join(HERE, "assets")
FRAMES = os.path.join(ASSETS, "frames_m6")
OUT = os.path.join(ASSETS, "m6_thinking.mp4")

W, H, FPS = 1920, 1080, 30
DURATION = 10.6

BG0 = (13, 17, 23)
BG1 = (7, 10, 14)
ACCENT = (46, 230, 168)
TEXT = (230, 237, 243)
MUTED = (139, 148, 158)
DIM = (110, 118, 129)
LINE = (48, 54, 61)
CARD = (22, 27, 34)
WHITE = (255, 255, 255)

FONT_DIR = "C:/Windows/Fonts"
F_TITLE = ImageFont.truetype(os.path.join(FONT_DIR, "msyhbd.ttc"), 30)
F_STEP = ImageFont.truetype(os.path.join(FONT_DIR, "msyhbd.ttc"), 34)
F_BODY = ImageFont.truetype(os.path.join(FONT_DIR, "msyh.ttc"), 21)
F_BODY_BIG = ImageFont.truetype(os.path.join(FONT_DIR, "msyh.ttc"), 26)
F_NUM = ImageFont.truetype(os.path.join(FONT_DIR, "consola.ttf"), 26)
F_MONO = ImageFont.truetype(os.path.join(FONT_DIR, "consola.ttf"), 18)
F_BADGE = ImageFont.truetype(os.path.join(FONT_DIR, "msyhbd.ttc"), 20)
F_END_BIG = ImageFont.truetype(os.path.join(FONT_DIR, "msyhbd.ttc"), 58)
F_END_SUB = ImageFont.truetype(os.path.join(FONT_DIR, "msyh.ttc"), 26)

STEPS = [
    ("01", "现象", "OMORI 真机里选项窗弹出来了，聊天框也注入了，屏幕上却什么都看不见。", None),
    ("02", "对照", "往 body 里加一个纯色 div → 能显示；插件自己的节点 → 不显示。", "omori-domtest.png"),
    ("03", "关键实验", "把插件根节点 cloneNode(true) 复制一份追加到 body → 完整显示。", "omori-clone.png"),
    ("04", "结论", "同一份 DOM、同一套内联样式：新建的能画，原来的不参与合成。", None),
    ("05", "修法", "每次弹出前销毁并重建 UI 根节点 → 真机通过，游戏继续。", "omori-chat2.png"),
]

STEP_START = [0.9 + i * 1.7 for i in range(len(STEPS))]
OUTRO_AT = 9.35


def ease(x):
    x = max(0.0, min(1.0, x))
    return 1 - (1 - x) ** 3


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded(draw, box, radius, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def text(draw, xy, s, font, fill):
    draw.text(xy, s, font=font, fill=fill)


def background():
    img = Image.new("RGB", (W, H), BG0)
    d = ImageDraw.Draw(img)
    for y in range(H):
        d.line([(0, y), (W, y)], fill=lerp(BG0, BG1, y / H))
    # faint dot grid
    for gx in range(60, W, 60):
        for gy in range(60, H, 60):
            d.point((gx, gy), fill=(20, 26, 34))
    return img


def dim_card(img, box, alpha):
    if alpha <= 0:
        return
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    rounded(d, box, 14, fill=CARD + (int(alpha * 0.55),))
    img.alpha_composite(layer)


def step_row(img, idx, t):
    start = STEP_START[idx]
    local = t - start
    if local < 0:
        return
    appear = ease(local / 0.4)
    slide = int(16 * (1 - appear))
    next_start = STEP_START[idx + 1] if idx + 1 < len(STEPS) else OUTRO_AT
    is_current = t < next_start
    alpha = int(255 * appear)
    x = 340
    y = 178 + idx * 152 + slide
    num, title, body, thumb = STEPS[idx]

    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    # active accent bar
    if is_current:
        d.rounded_rectangle([x - 22, y + 2, x - 14, y + 74], 4, fill=ACCENT + (alpha,))

    title_color = TEXT + (alpha,) if is_current else DIM + (int(alpha * 0.75),)
    body_color = (201, 209, 217, alpha) if is_current else (130, 138, 148, int(alpha * 0.7))
    d.text((x, y - 6), num, font=F_NUM, fill=(ACCENT if is_current else DIM) + (alpha,))
    d.text((x + 62, y - 12), title, font=F_STEP, fill=title_color)
    d.text((x + 62, y + 38), body, font=F_BODY_BIG if is_current else F_BODY, fill=body_color)

    # evidence screenshot for the current step only, fixed slot on the right
    if is_current and thumb:
        path = os.path.join(SHOTS, thumb)
        if os.path.exists(path):
            tw, th = 500, 280
            card_x, card_y = 1300, 230
            rounded(d, [card_x, card_y, card_x + tw, card_y + th], 14, fill=(24, 29, 36, alpha),
                    outline=(52, 61, 72, alpha), width=2)
            im = Image.open(path).convert("RGB")
            im.thumbnail((tw - 20, th - 20))
            px = card_x + (tw - im.width) // 2
            py = card_y + (th - im.height) // 2
            layer.paste(im, (px, py))
            d.text((card_x, card_y + th + 12), "真机截图 · " + thumb.replace(".png", ""),
                   font=F_BODY, fill=MUTED + (alpha,))
    img.alpha_composite(layer)


def header(img, t):
    a = int(255 * ease(t / 0.5))
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle([80, 62, 94, 76], 3, fill=ACCENT + (a,))
    d.text((112, 50), "TT_ChatChoice · 一次真实调试的思考过程", font=F_TITLE, fill=TEXT + (a,))
    d.text((W - 560, 58), "OMORI 真机 · 2026-11-10", font=F_BADGE, fill=MUTED + (a,))
    d.line([(80, 116), (W - 80, 116)], fill=LINE + (a,), width=1)
    img.alpha_composite(layer)


def timeline(img, t):
    a = int(255 * ease(t / 0.6))
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    top, bottom = 210, 178 + 4 * 152 + 40
    d.line([(150, top), (150, bottom)], fill=LINE + (a,), width=2)
    progress = 0.0
    for i, st in enumerate(STEP_START):
        if t >= st:
            progress = (i + 1) / len(STEPS)
    done_h = int((bottom - top) * min(1.0, max(0.02, progress)))
    if done_h > 2:
        d.line([(150, top), (150, top + done_h)], fill=ACCENT + (a,), width=3)
    for i, st in enumerate(STEP_START):
        y = 178 + i * 152 + 34
        on = t >= st
        r = 9 if on else 6
        fill = (ACCENT if on else LINE) + (a,)
        d.ellipse([150 - r, y - r, 150 + r, y + r], fill=fill)
    img.alpha_composite(layer)


def footer(img, t):
    a = int(255 * ease((t - 0.4) / 0.5))
    if a <= 0:
        return
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    pct = min(1.0, t / OUTRO_AT)
    d.rounded_rectangle([80, 1006, W - 80, 1012], 3, fill=LINE + (a,))
    w = int((W - 160) * pct)
    if w > 4:
        d.rounded_rectangle([80, 1006, 80 + w, 1012], 3, fill=ACCENT + (a,))
    d.text((80, 1026), "不是玄学：旧节点不参与合成 → 每次显示前重建", font=F_BODY, fill=MUTED + (a,))
    d.text((W - 300, 1026), "49 项测试 · 真机验证", font=F_BODY, fill=MUTED + (a,))
    img.alpha_composite(layer)


def outro(img, t):
    if t < OUTRO_AT:
        return
    local = t - OUTRO_AT
    a = ease(local / 0.5)
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rectangle([0, 0, W, H], fill=(7, 10, 14, int(240 * a)))
    cx, cy = W // 2, H // 2 - 40
    r = 64
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=ACCENT + (int(255 * a),), width=6)
    # check mark
    pts = [(cx - 30, cy + 2), (cx - 8, cy + 26), (cx + 34, cy - 24)]
    d.line(pts, fill=ACCENT + (int(255 * a),), width=9, joint="curve")
    d.text((cx, cy + 110), "修好了：每次弹出重建 UI 根节点", font=F_END_BIG, fill=TEXT + (int(255 * a),), anchor="mm")
    d.text((cx, cy + 180), "OMORI 实机：选项被替代、游戏继续推进", font=F_END_SUB, fill=MUTED + (int(255 * a),), anchor="mm")
    img.alpha_composite(layer)


def render(t):
    img = background().convert("RGBA")
    header(img, t)
    timeline(img, t)
    for i in range(len(STEPS)):
        step_row(img, i, t)
    footer(img, t)
    outro(img, t)
    return img.convert("RGB")


def main():
    os.makedirs(FRAMES, exist_ok=True)
    for f in os.listdir(FRAMES):
        os.remove(os.path.join(FRAMES, f))
    n = int(DURATION * FPS)
    for i in range(n):
        t = i / FPS
        render(t).save(os.path.join(FRAMES, "f%04d.jpg" % i), quality=92)
        if i % 60 == 0:
            print("frame", i, "/", n, flush=True)

    ffmpeg = os.path.normpath(os.path.join(HERE, "..", "..", "tools", "ffmpeg.exe"))
    if not os.path.exists(ffmpeg):
        ffmpeg = "ffmpeg"
    cmd = [
        ffmpeg, "-y", "-framerate", str(FPS), "-i", os.path.join(FRAMES, "f%04d.jpg"),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "19", "-preset", "slow",
        "-movflags", "+faststart", OUT,
    ]
    print(" ".join(cmd), flush=True)
    subprocess.check_call(cmd)
    shutil.rmtree(FRAMES, ignore_errors=True)
    print("done:", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""TT_ChatChoice 封面 · 4:3 版（1600×1200）

16:9 用 make_cover.py；这个版本给需要 4:3 的平台/答辩 PPT 用。
用法：python make_cover_43.py
输出：assets/cover_4x3.png + assets/cover_4x3.jpg
"""
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 1600, 1200
BG = (13, 17, 23)
ACCENT = (46, 230, 168)
TXT = (230, 237, 243)
DIM = (139, 148, 158)
FAINT = (72, 81, 91)
CARD = (22, 27, 34)
LINE = (48, 54, 61)
SHADOW = (4, 6, 9)

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")
SHOTS = os.path.join(os.path.dirname(HERE), "shots")

F_CN = "C:/Windows/Fonts/msyh.ttc"
F_CNB = "C:/Windows/Fonts/msyhbd.ttc"
F_MONO = "C:/Windows/Fonts/consola.ttf"
_font = {}


def font(size, bold=False, mono=False):
    key = (size, bold, mono)
    if key not in _font:
        _font[key] = ImageFont.truetype(F_MONO if mono else (F_CNB if bold else F_CN), size)
    return _font[key]


def bg():
    a = np.linspace(0.0, 1.0, H)[:, None]
    top = np.array(BG, dtype=np.float32)
    bot = np.array((9, 12, 18), dtype=np.float32)
    rows = (top[None, None, :] * (1 - a[:, :, None]) + bot[None, None, :] * a[:, :, None])
    rows = np.repeat(rows, W, axis=1).astype(np.uint8)
    img = Image.fromarray(rows, "RGB")
    d = ImageDraw.Draw(img)
    for y in range(0, H, 32):
        for x in range(0, W, 32):
            d.point((x, y), fill=(30, 37, 46))

    # 暗角
    mask = Image.new("L", (W, H), 0)
    md = ImageDraw.Draw(mask)
    for i in range(120):
        v = int(200 * (i / 120) ** 2.2)
        md.ellipse([-W * 0.3 + i * 8, -H * 0.3 + i * 7, W * 1.3 - i * 8, H * 1.3 - i * 7], outline=v)
    mask = mask.filter(ImageFilter.GaussianBlur(22))
    img = Image.composite(Image.new("RGB", (W, H), SHADOW), img, mask)

    # 右侧冷光
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.ellipse([1150 - 460, 520 - 400, 1150 + 460, 520 + 400], fill=(*ACCENT, 46))
    layer = layer.filter(ImageFilter.GaussianBlur(150))
    img = Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")
    return img


def paste_contain(img, path, box, radius=14, pad=CARD):
    x0, y0, x1, y1 = box
    tw, th = x1 - x0, y1 - y0
    src = Image.open(path).convert("RGB")
    sw, sh = src.size
    scale = min(tw / sw, th / sh)
    src = src.resize((int(sw * scale), int(sh * scale)), Image.LANCZOS)
    nw, nh = src.size
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(box, radius, fill=pad, outline=LINE, width=2)
    px = x0 + (tw - nw) // 2
    py = y0 + (th - nh) // 2
    mask = Image.new("L", (nw, nh), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, nw, nh], max(2, radius - 4), fill=255)
    img.paste(src, (px, py), mask)


def main():
    img = bg()
    d = ImageDraw.Draw(img)

    # ── 品牌 ──
    d.ellipse([80, 88, 102, 110], fill=ACCENT)
    d.text((118, 78), "TT_ChatChoice", font=font(32, bold=True), fill=TXT)
    d.text((122, 128), "RPG Maker MV / MZ · 开源 · MIT", font=font(23), fill=DIM)

    # ── 标题 ──
    d.text((80, 230), "把对话选项", font=font(92, bold=True), fill=TXT)
    d.text((80, 344), "换成", font=font(92, bold=True), fill=TXT)
    tw = d.textlength("换成", font=font(92, bold=True))
    d.text((80 + tw + 12, 344), "聊天框", font=font(92, bold=True), fill=ACCENT)
    tw2 = d.textlength("聊天框", font=font(92, bold=True))
    d.rounded_rectangle([80 + tw + 14, 344 + 104, 80 + tw + 14 + tw2, 344 + 114], 5, fill=ACCENT)

    # ── 价值两行 ──
    d.text((84, 512), "自由输入 → 语义匹配回原选项 → 自动注入", font=font(29), fill=TXT)
    d.text((84, 558), "剧情照常推进，不用背选项编号", font=font(29), fill=DIM)

    # ── 徽章两行 ──
    rows = [
        [("OMORI 实机验证", 330), ("49 项测试 · CI 全绿", 250)],
        [("一句命令安装", 196), ("MV / MZ 通用", 196)],
    ]
    y = 630
    for row in rows:
        x = 84
        for text, w in row:
            d.rounded_rectangle([x, y, x + w, y + 54], 10, fill=(20, 42, 36), outline=(38, 92, 74), width=2)
            d.text((x + 20, y + 12), text, font=font(23), fill=ACCENT)
            x += w + 16
        y += 66

    # ── GitHub / 标语 ──
    d.line([84, 866, 760, 866], fill=(38, 44, 52), width=1)
    d.text((84, 892), "github.com/silversystem04-coder/rpgmaker-chatbox",
           font=font(21, mono=True), fill=DIM)
    d.text((84, 960), "让每一句想说的话，都有得选。", font=font(30, bold=True), fill=TXT)

    # ── 右侧实机截图 ──
    box = (806, 230, 1530, 880)
    d.rounded_rectangle([box[0] - 10, box[1] - 10, box[2] + 10, box[3] + 10], 22,
                        fill=(10, 14, 19), outline=(40, 48, 58), width=2)
    paste_contain(img, os.path.join(SHOTS, "omori-chat2.png"), box, radius=16, pad=(8, 10, 14))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([box[0] + 24, box[1] + 70, box[0] + 186, box[1] + 112], 8,
                        fill=(12, 16, 22), outline=(44, 52, 62), width=1)
    d.text((box[0] + 40, box[1] + 78), "OMORI 实机", font=font(21), fill=ACCENT)
    d.text((box[0], box[3] + 24), "聊天框接管原生选项，选完游戏继续", font=font(24), fill=DIM)

    # ── 页脚 ──
    d.line([80, H - 84, 1520, H - 84], fill=(38, 44, 52), width=1)
    d.text((80, H - 68), "TT_ChatChoice · 演示视频 86s", font=font(23), fill=FAINT)
    right = "2026-11-10"
    t = d.textlength(right, font=font(23))
    d.text((1520 - t, H - 68), right, font=font(23), fill=FAINT)

    out_png = os.path.join(ASSETS, "cover_4x3.png")
    out_jpg = os.path.join(ASSETS, "cover_4x3.jpg")
    img.save(out_png)
    img.save(out_jpg, quality=92)
    print("COVER 4:3:", out_png)


if __name__ == "__main__":
    from PIL import ImageFont

    main()

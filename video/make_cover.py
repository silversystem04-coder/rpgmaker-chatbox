#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""TT_ChatChoice 封面（1920x1080）

复用 make_film.py 的配色/字体/卡片函数，出一张和成片同一套设计语言的封面。
用法：
    python make_cover.py              # 出 assets/cover.png + assets/cover.jpg
    python make_cover.py alt          # 出第二版（对话气泡版）
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import make_film as mf

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")
SHOTS = os.path.join(os.path.dirname(HERE), "shots")
W, H = 1920, 1080
ACCENT = mf.ACCENT
TXT = mf.TXT
DIM = mf.DIM
FAINT = mf.FAINT
CARD = mf.CARD
LINE = mf.LINE
BG = mf.BG


def glow(img, cx, cy, rx, ry, color, alpha=70, blur=120):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=(*color, alpha))
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    img.alpha_composite(layer) if img.mode == "RGBA" else img.paste(
        Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB"), (0, 0))


def main():
    img = mf.bg().convert("RGBA")

    # 右侧冷光
    glow(img, 1430, 470, 520, 420, ACCENT, 46, 160)

    d = ImageDraw.Draw(img)

    # ── 左上角品牌 ──
    d.ellipse([110, 96, 130, 116], fill=ACCENT)
    d.text((146, 88), "TT_ChatChoice", font=mf.font(34, bold=True), fill=TXT)
    d.text((150, 140), "RPG Maker MV / MZ · 开源 · MIT",
           font=mf.font(24), fill=DIM)

    # ── 主标题 ──
    d.text((110, 250), "把对话选项", font=mf.font(96, bold=True), fill=TXT)
    d.text((110, 372), "换成", font=mf.font(96, bold=True), fill=TXT)
    tw = d.textlength("换成", font=mf.font(96, bold=True))
    d.text((110 + tw + 14, 372), "聊天框", font=mf.font(96, bold=True), fill=ACCENT)
    tw2 = d.textlength("聊天框", font=mf.font(96, bold=True))
    d.rounded_rectangle([110 + tw + 16, 372 + 108, 110 + tw + 16 + tw2, 372 + 118],
                        5, fill=ACCENT)

    # ── 一句话价值 ──
    d.text((114, 540), "自由输入 → 语义匹配回原选项 → 自动注入", font=mf.font(32), fill=TXT)
    d.text((114, 590), "剧情照常推进，不用背选项编号", font=mf.font(32), fill=DIM)

    # ── 三个徽章 ──
    badges = [("OMORI 实机验证", 380), ("49 项测试 · CI 全绿", 250), ("一句命令安装", 210)]
    x = 114
    for text, w in badges:
        d.rounded_rectangle([x, 668, x + w, 724], 10, fill=(20, 42, 36), outline=(38, 92, 74), width=2)
        d.text((x + 22, 680), text, font=mf.font(25), fill=ACCENT)
        x += w + 18

    # ── GitHub ──
    d.line([114, 820, 940, 820], fill=(38, 44, 52), width=1)
    d.text((114, 846), "github.com/silversystem04-coder/rpgmaker-chatbox",
           font=mf.font(28, mono=True), fill=DIM)
    d.text((114, 892), "让每一句想说的话，都有得选。", font=mf.font(30, bold=True), fill=TXT)

    # ── 右侧：OMORI 真机截图卡 ──
    shot = os.path.join(SHOTS, "omori-chat2.png")
    box = (1010, 200, 1810, 830)
    d.rounded_rectangle([box[0] - 10, box[1] - 10, box[2] + 10, box[3] + 10], 22,
                        fill=(10, 14, 19), outline=(40, 48, 58), width=2)
    mf.paste_contain(img, shot, box, radius=16, pad=(8, 10, 14))
    d = ImageDraw.Draw(img)
    # 卡片上的小标
    d.rounded_rectangle([box[0] + 26, box[1] + 74, box[0] + 198, box[1] + 118], 8,
                        fill=(12, 16, 22), outline=(44, 52, 62), width=1)
    d.text((box[0] + 42, box[1] + 82), "OMORI 实机", font=mf.font(22), fill=ACCENT)
    d.text((box[0] + 26, box[3] + 26), "聊天框接管原生选项，选完游戏继续",
           font=mf.font(25), fill=DIM)

    # ── 页脚 ──
    d.line([110, H - 92, 1810, H - 92], fill=(38, 44, 52), width=1)
    d.text((110, H - 74), "TT_ChatChoice · 演示视频 86s", font=mf.font(24), fill=FAINT)
    right = "2026-11-10"
    t = d.textlength(right, font=mf.font(24))
    d.text((1810 - t, H - 74), right, font=mf.font(24), fill=FAINT)

    out_png = os.path.join(ASSETS, "cover.png")
    out_jpg = os.path.join(ASSETS, "cover.jpg")
    img.convert("RGB").save(out_png)
    img.convert("RGB").save(out_jpg, quality=92)
    print("COVER:", out_png)


if __name__ == "__main__":
    main()

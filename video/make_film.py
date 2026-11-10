#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""TT_ChatChoice 演示成片生成器（1920x1080 @30fps）

画面：M1 痛点 / M2 聊天框接管 / M3 OMORI 实机 / M4 兜底 / M5 安装 / M6 思考 / M7 CI+片尾
声音：assets/narration/n1..n7.wav（Windows SAPI 合成，Microsoft Huihui Desktop）
输出：assets/tt_chatchoice_film.mp4

用法：
    python make_film.py            # 全片
    python make_film.py m1 m2      # 只重出某几段（调试用）

性能：静态图层（背景/卡片/终端框）只画一次缓存复用，动态层每帧只画变化的字和截图。
"""
import json
import os
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
WORKSPACE = os.path.dirname(PROJ)
ASSETS = os.path.join(HERE, "assets")
SHOTS = os.path.join(PROJ, "shots")
TMP = os.path.join(ASSETS, "_film")
FF = os.path.join(WORKSPACE, "tools", "ffmpeg.exe")
FP = os.path.join(WORKSPACE, "tools", "ffprobe.exe")

W, H, FPS = 1920, 1080, 30
BG = (13, 17, 23)
ACCENT = (46, 230, 168)
TXT = (230, 237, 243)
DIM = (139, 148, 158)
FAINT = (72, 81, 91)
CARD = (22, 27, 34)
LINE = (48, 54, 61)

F_CN = "C:/Windows/Fonts/msyh.ttc"
F_CNB = "C:/Windows/Fonts/msyhbd.ttc"
F_MONO = "C:/Windows/Fonts/consola.ttf"

_font = {}
_C = {}


def font(size, bold=False, mono=False):
    key = (size, bold, mono)
    if key not in _font:
        _font[key] = ImageFont.truetype(F_MONO if mono else (F_CNB if bold else F_CN), size)
    return _font[key]


def static(key, fn):
    if key not in _C:
        _C[key] = fn()
    return _C[key]


def base_bg():
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
    return img


def bg_vignette():
    """背景 + 一次性暗角（全片共用，避免每帧模糊）。"""
    img = base_bg()
    mask = Image.new("L", (W, H), 0)
    md = ImageDraw.Draw(mask)
    for i in range(140):
        v = int(200 * (i / 140) ** 2.2)
        md.ellipse([-W * 0.3 + i * 9, -H * 0.3 + i * 6, W * 1.3 - i * 9, H * 1.3 - i * 6], outline=v)
    mask = mask.filter(ImageFilter.GaussianBlur(24))
    dark = Image.new("RGB", (W, H), (4, 6, 9))
    return Image.composite(dark, img, mask)


def bg():
    return static("bg", bg_vignette).copy()


def label(d, xy, text, size=26, fill=DIM, bold=False, mono=False):
    d.text(xy, text, font=font(size, bold, mono), fill=fill)


def header(d, text):
    d.ellipse([88, 84, 104, 100], fill=ACCENT)
    label(d, (120, 74), text, 28, DIM)
    d.line([88, 130, 1832, 130], fill=(38, 44, 52), width=1)


def footer(d, text, right=""):
    d.line([88, H - 92, 1832, H - 92], fill=(38, 44, 52), width=1)
    label(d, (88, H - 76), text, 24, FAINT)
    if right:
        tw = d.textlength(right, font=font(24))
        label(d, (1832 - tw, H - 76), right, 24, FAINT)


def caption(d, title, sub=None):
    d.rounded_rectangle([92, H - 218, 100, H - 160], 3, fill=ACCENT)
    label(d, (122, H - 222), title, 40, TXT, bold=True)
    if sub:
        label(d, (122, H - 166), sub, 26, DIM)


def card_image(path, box, radius=14, zoom=1.0, focus=(0.5, 0.5)):
    """返回 (rgb, mask)，可直接 paste；同时画好描边由调用方负责。"""
    x0, y0, x1, y1 = box
    tw, th = x1 - x0, y1 - y0
    src = Image.open(path).convert("RGB")
    sw, sh = src.size
    scale = max(tw / sw, th / sh) * zoom
    src = src.resize((int(sw * scale), int(sh * scale)), Image.LANCZOS)
    nw, nh = src.size
    src = src.crop((int((nw - tw) * focus[0]), int((nh - th) * focus[1]),
                    int((nw - tw) * focus[0]) + tw, int((nh - th) * focus[1]) + th))
    mask = Image.new("L", (tw, th), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, tw, th], radius, fill=255)
    return src, mask


def paste_card(img, path, box, radius=14, zoom=1.0, focus=(0.5, 0.5), outline=LINE):
    key = ("card", path, box, radius, zoom, focus)
    src, mask = static(key, lambda: card_image(path, box, radius, zoom, focus))
    img.paste(src, (box[0], box[1]), mask)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(box, radius, outline=outline, width=2)


def paste_contain(img, path, box, radius=14, pad=CARD):
    """截图按 contain 放进 box：完整显示，不裁边。"""
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


def paste_strip(img, path, box, crop=(0, 700, 1280, 940), radius=14):
    """把 mock 截图底部一条（对话框 + 聊天框）放大成整幅卡。"""
    src = Image.open(path).convert("RGB").crop(crop)
    sw, sh = src.size
    x0, y0, x1, y1 = box
    tw, th = x1 - x0, y1 - y0
    scale = min(tw / sw, th / sh)
    src = src.resize((int(sw * scale), int(sh * scale)), Image.LANCZOS)
    nw, nh = src.size
    px = x0 + (tw - nw) // 2
    py = y0 + (th - nh) // 2
    mask = Image.new("L", (nw, nh), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, nw, nh], max(2, radius - 4), fill=255)
    img.paste(src, (px, py), mask)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(box, radius, fill=None, outline=LINE, width=2)


def ease(t, a, b):
    if t <= a:
        return 0.0
    if t >= b:
        return 1.0
    k = (t - a) / (b - a)
    return k * k * (3 - 2 * k)


# ───────────────────────── M1 痛点 ─────────────────────────
M1_PANEL = (240, 150, 1680, 830)


def m1_static():
    img = bg()
    d = ImageDraw.Draw(img)
    header(d, "RPG Maker · 对话选项")
    gx0, gy0, gx1, gy1 = M1_PANEL
    tw, th = gx1 - gx0, gy1 - gy0
    # 游戏画面：暗房间 + 一点暖光
    scene = Image.new("RGB", (tw, th), (11, 14, 19))
    warm = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    wd = ImageDraw.Draw(warm)
    for i in range(46):
        a = i / 46
        wd.ellipse([560 - i * 5, 60 - i * 3, 1020 + i * 5, 500 + i * 3],
                   fill=(120, 92, 56, int(4 + 6 * (1 - a))))
    warm = warm.filter(ImageFilter.GaussianBlur(40))
    scene.paste(warm, (0, 0), warm)
    mask = Image.new("L", (tw, th), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, tw, th], 18, fill=255)
    img.paste(scene, (gx0, gy0), mask)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(M1_PANEL, 18, outline=(44, 51, 60), width=2)
    # 对话框
    d.rounded_rectangle([330, 540, 1590, 800], 12, fill=(11, 14, 19), outline=(74, 82, 92), width=2)
    label(d, (370, 570), "？？？", 28, (200, 208, 216))
    label(d, (370, 616), "「你想怎么回答他？」", 38, (232, 238, 245))
    label(d, (370, 684), "· 只能从他给的选项里挑一个", 24, (120, 130, 142))
    label(d, (370, 722), "· 想说的那句，永远不会出现", 24, (120, 130, 142))
    return img


def m1(t, dur):
    img = static("m1", m1_static).copy()
    d = ImageDraw.Draw(img)
    opts = ["1.  答应他", "2.  拒绝他", "3.  什么都不说", "4.  再想一想"]
    ox, oy = 1110, 540
    for i, o in enumerate(opts):
        off = t > [99, 4.0, 2.6, 3.2][i]
        col = FAINT if off else (TXT if i == 0 else (196, 205, 214))
        d.rounded_rectangle([ox, oy + i * 62, ox + 430, oy + i * 62 + 50], 8,
                            fill=(26, 31, 39) if off else (32, 39, 48),
                            outline=(44, 50, 58) if off else (60, 68, 78), width=1)
        label(d, (ox + 18, oy + i * 62 + 11), o, 26, col)
    caption(d, "游戏里，你只能选", "想说的那句话，永远不在里面。" if t > 4.2 else None)
    footer(d, "RPG Maker MV / MZ · 对话系统")
    return img


# ───────────────────────── M2 聊天框接管 ─────────────────────────
M2_STRIP = (150, 250, 1770, 560)


def m2(t, dur):
    img = bg()
    d = ImageDraw.Draw(img)
    header(d, "把选项换成聊天框 · mock 演示")

    if t < 3.5:
        shot = "chat-open.png"
    elif t < 7.0:
        shot = "chat-confirm.png"
    else:
        shot = "chat-applied.png"
    paste_strip(img, os.path.join(SHOTS, shot), M2_STRIP)

    # 右上角：正在输入
    typed = "答应他吧"
    n = min(len(typed), max(0, int((t - 0.6) * 6)))
    label(d, (1400, 82), "你输入：", 24, DIM)
    label(d, (1520, 78), typed[:n] + ("▌" if int(t * 2) % 2 == 0 else " "), 28, TXT, bold=True)

    # 三步走
    steps = [("1", "聊天框接管原选项"), ("2", "你说人话，它找最接近的"), ("3", "确认后才替你去点")]
    active = 0 if t < 3.5 else (1 if t < 7.0 else 2)
    for i, (num, text) in enumerate(steps):
        x = 170 + i * 540
        on = t > 0.8 + i * 1.1
        if not on:
            continue
        d.ellipse([x, 640, x + 34, 674], fill=(23, 58, 47) if i == active else (30, 37, 46))
        label(d, (x + 11, 643), num, 22, ACCENT if i == active else DIM)
        label(d, (x + 52, 638), text, 27, TXT if i == active else DIM)

    caption(d, "把选项换成聊天框",
            "你随便说，它理解成最接近的那个选项，确认后才替你去点。" if t > 1.2 else None)
    footer(d, "TT_ChatChoice · 语义匹配 + 确认后注入", "mock · 4 个选项")
    return img


# ───────────────────────── M3 OMORI 实机 ─────────────────────────
M3_BOX = (330, 150, 1590, 820)


def m3_static():
    img = bg()
    d = ImageDraw.Draw(img)
    header(d, "OMORI 实机 · 4 选 1 · 真机接管")
    d.rounded_rectangle(M3_BOX, 14, fill=(9, 12, 17), outline=(48, 54, 62), width=2)
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.rounded_rectangle([M3_BOX[0] - 16, M3_BOX[1] - 16, M3_BOX[2] + 16, M3_BOX[3] + 16],
                         24, outline=(46, 230, 168, 40), width=10)
    glow = glow.filter(ImageFilter.GaussianBlur(18))
    img.paste(glow, (0, 0), glow)
    return img


def m3_frame(t, dur, src_img):
    img = static("m3", m3_static).copy()
    tw = M3_BOX[2] - M3_BOX[0] - 24
    th = M3_BOX[3] - M3_BOX[1] - 24
    w, h = src_img.size
    scale = min(tw / w, th / h)
    sw, sh = int(w * scale), int(h * scale)
    scaled = src_img.resize((sw, sh), Image.BILINEAR)
    img.paste(scaled, (M3_BOX[0] + (M3_BOX[2] - M3_BOX[0] - sw) // 2,
                       M3_BOX[1] + (M3_BOX[3] - M3_BOX[1] - sh) // 2))
    d = ImageDraw.Draw(img)
    caption(d, "真实游戏里跑通了", "一句人话 → 命中第 2 个 → 游戏自己往下走" if t > 1.0 else None)
    footer(d, "OMORI · RPG Maker MV · 640×480 实机", "词面匹配 52%")
    return img


def m3(ctx):
    dur3 = ctx["dur"]["m3"]
    clip = os.path.join(ASSETS, "m3_omori.mp4")
    srcdir = os.path.join(TMP, "m3src")
    if not os.path.isdir(srcdir) or len(os.listdir(srcdir)) < 300:
        shutil.rmtree(srcdir, ignore_errors=True)
        os.makedirs(srcdir)
        subprocess.run([FF, "-y", "-loglevel", "error", "-i", clip, "-q:v", "2",
                        os.path.join(srcdir, "%04d.jpg")], check=True)
    frames = sorted(os.listdir(srcdir))
    clip_dur = len(frames) / FPS
    hold_start = clip_dur

    def draw(t, dur):
        if t < hold_start:
            idx = min(len(frames) - 1, int(t * FPS))
            im = Image.open(os.path.join(srcdir, frames[idx])).convert("RGB")
            return m3_frame(t, dur, im)
        img = bg()
        d = ImageDraw.Draw(img)
        header(d, "OMORI 实机 · 还能拖、能缩放、能停靠")
        im = Image.open(os.path.join(srcdir, frames[-1])).convert("RGB").resize((900, 675), Image.BILINEAR)
        im = Image.blend(im, Image.new("RGB", im.size, (8, 10, 14)), 0.55)
        mask = Image.new("L", im.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.size[0], im.size[1]], 12, fill=255)
        img.paste(im, (330, 190), mask)
        d.rounded_rectangle([330, 190, 1230, 865], 12, outline=(52, 60, 70), width=2)
        bx0, by0 = 1300, 250
        d.rounded_rectangle([bx0, by0, 1780, by0 + 400], 14, fill=CARD, outline=LINE, width=2)
        label(d, (bx0 + 36, by0 + 34), "聊天框不挡原对话框", 30, TXT, bold=True)
        for i, s in enumerate(["拖 header 移动", "拖右下角缩放", "⇅ 一键停靠顶部", "位置会记住"]):
            d.ellipse([bx0 + 40, by0 + 96 + i * 62, bx0 + 54, by0 + 110 + i * 62], fill=ACCENT)
            label(d, (bx0 + 72, by0 + 88 + i * 62), s, 26, (196, 205, 214))
        label(d, (bx0 + 36, by0 + 344), "默认停顶部（小窗口）", 22, DIM)
        inset = os.path.join(SHOTS, "omori-layout-dragged.png")
        if os.path.exists(inset):
            paste_contain(img, inset, (1300, 700, 1780, 940), 10)
        footer(d, "OMORI · 拖拽 / 缩放 / 停靠", "实机截图")
        return img

    out = os.path.join(ASSETS, "seg_m3.mp4")
    render(draw, dur3, out, "m3")
    return out


# ───────────────────────── M4 兜底 ─────────────────────────
M4_STRIP = (150, 250, 1770, 560)


def m4_static():
    img = bg()
    d = ImageDraw.Draw(img)
    header(d, "听不懂的时候 · 不乱猜")
    d.rounded_rectangle([88, 900, 1832, 964], 10, fill=(20, 25, 32), outline=(52, 60, 70), width=1)
    label(d, (118, 916), "LLM 兜底 · 8s 超时 · 失败不阻塞", 26, ACCENT)
    label(d, (900, 916), "本地词面匹配优先 —— 不联网也能用", 24, DIM)
    footer(d, "TT_ChatChoice · 无关输入四件套", "37/49 项测试覆盖")
    return img


def m4(t, dur):
    img = static("m4", m4_static).copy()
    d = ImageDraw.Draw(img)
    phase = min(2, int(t / (dur / 3)))
    if phase == 0:
        d.rounded_rectangle(M4_STRIP, 14, fill=CARD, outline=LINE, width=2)
        label(d, (190, 300), "你输入", 26, DIM)
        d.rounded_rectangle([190, 348, 900, 428], 10, fill=(20, 25, 32), outline=(52, 60, 70), width=1)
        label(d, (216, 364), "随便，你帮我选", 30, TXT)
        label(d, (190, 470), "它回答", 26, DIM)
        label(d, (190, 512), "好，不替你选。", 34, ACCENT, bold=True)
        label(d, (520, 520), "按 Esc 用原选项，或直接点原选项。", 26, (196, 205, 214))
        title, desc, accent = "① 放弃指令，不替你选", "「随便 / 你帮我选 / 跳过」都不猜", "给你原选项，一步就能回去"
    elif phase == 1:
        paste_strip(img, os.path.join(SHOTS, "chat-candidates.png"), M4_STRIP)
        title, desc, accent = "② 没把握 → 给候选", "Top-2 候选可点击，不用重说", "置信度不够就不硬猜"
    else:
        paste_strip(img, os.path.join(SHOTS, "chat-retry.png"), M4_STRIP)
        title, desc, accent = "③ 连错两次 → 升级", "chips 高亮，直接点回原选项", "不卡住，也不替你乱选"
    label(d, (122, 600), title, 36, TXT, bold=True)
    label(d, (122, 660), desc, 27, (196, 205, 214))
    label(d, (122, 710), accent, 25, ACCENT)
    return img


# ───────────────────────── M5 安装 ─────────────────────────
M5_BOX = (150, 170, 1770, 840)


def m5_static():
    img = bg()
    d = ImageDraw.Draw(img)
    header(d, "一条命令装好 · MV / MZ 通用")
    bx0, by0, bx1, by1 = M5_BOX
    d.rounded_rectangle([bx0, by0, bx1, by1], 14, fill=(9, 12, 17), outline=(52, 60, 70), width=2)
    d.rounded_rectangle([bx0, by0, bx1, by0 + 46], 14, fill=(24, 29, 36))
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        d.ellipse([bx0 + 20 + i * 26, by0 + 16, bx0 + 34 + i * 26, by0 + 30], fill=c)
    label(d, (bx0 + 120, by0 + 10), "PowerShell 5.1", 22, DIM)
    return img


def m5(t, dur):
    img = static("m5", m5_static).copy()
    d = ImageDraw.Draw(img)
    bx0, by0 = M5_BOX[0], M5_BOX[1]
    cmd = 'powershell -NoProfile -ExecutionPolicy Bypass -File tools\\install-omori.ps1 -GameDir "D:\\OMORI"'
    cmdt = min(len(cmd), max(0, int((t - 0.5) * 42)))
    label(d, (bx0 + 40, by0 + 96), "PS>", 28, ACCENT, mono=True)
    label(d, (bx0 + 118, by0 + 94), cmd[:cmdt] + ("▌" if cmdt < len(cmd) and int(t * 3) % 2 == 0 else ""), 25, TXT, mono=True)
    outs = [
        "[1/4] 扫描插件目录 ...... www/js/plugins",
        "[2/4] 检测加载器 ........ .OMORI 加密插件",
        "[3/4] 改用 index.html 注入（绕过加密加载器）",
        "[4/4] 写入 www/index.html，备份 index.html.bak-20261110",
    ]
    for i, line in enumerate(outs):
        if t <= 2.4 + i * 1.5:
            continue
        y = by0 + 190 + i * 74
        d.ellipse([bx0 + 42, y + 12, bx0 + 58, y + 28], fill=ACCENT)
        label(d, (bx0 + 78, y), line, 27, (196, 205, 214))
    if t > 8.6:
        label(d, (bx0 + 42, by0 + 520), "✔ 完成，重启游戏即可生效", 32, ACCENT, bold=True)
    caption(d, "一条命令装进游戏",
            "RPG Maker MV、MZ 通用 · 加密插件也处理了 · MIT 开源" if t > 6 else None)
    footer(d, "tools/install-omori.ps1", "Windows PowerShell")
    return img


# ───────────────────────── M7 CI + 片尾 ─────────────────────────
M7_BOX = (100, 170, 1180, 860)


def m7_static():
    img = bg()
    d = ImageDraw.Draw(img)
    header(d, "GitHub Actions · 每次提交过 CI")
    paste_contain(img, os.path.join(ASSETS, "m7_ci.png"), M7_BOX, 14)
    d.rounded_rectangle([1250, 250, 1830, 860], 16, fill=CARD, outline=LINE, width=2)
    x = 1290
    label(d, (x, 290), "TT_ChatChoice", 46, TXT, bold=True)
    d.line([x, 356, x + 90, 356], fill=ACCENT, width=4)
    label(d, (x, 380), "把 RPG Maker 的", 26, (196, 205, 214))
    label(d, (x, 418), "对话选项换成聊天框", 26, (196, 205, 214))
    for i, s in enumerate(["49 项测试 · CI 全绿", "OMORI 实机验证", "MV / MZ 通用 · MIT"]):
        d.ellipse([x, 492 + i * 46, x + 12, 504 + i * 46], fill=ACCENT)
        label(d, (x + 28, 484 + i * 46), s, 24, (196, 205, 214))
    label(d, (x, 660), "github.com/silversystem04-coder", 20, DIM, mono=True)
    label(d, (x, 690), "/rpgmaker-chatbox", 20, DIM, mono=True)
    label(d, (x, 760), "开源 · 拿去用", 28, ACCENT, bold=True)
    footer(d, "MIT License", "2026-11-10")
    return img


def m7(t, dur):
    img = static("m7", m7_static).copy()
    # 右侧整体淡入：0.4–1.4s 盖一层逐渐变薄的暗纱
    a = ease(t, 0.4, 1.4)
    if a < 1.0:
        veil = Image.new("RGBA", img.size, (0, 0, 0, 0))
        vd = ImageDraw.Draw(veil)
        vd.rounded_rectangle([1250, 250, 1830, 860], 16, fill=(13, 17, 23, int(255 * (1 - a))))
        img = Image.alpha_composite(img.convert("RGBA"), veil).convert("RGB")
    return img


# ───────────────────────── 渲染 ─────────────────────────
def render(draw_fn, dur, out, name=""):
    n = int(round(dur * FPS))
    p = subprocess.Popen([FF, "-y", "-loglevel", "error",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                          "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
                          "-r", str(FPS), out], stdin=subprocess.PIPE)
    for i in range(n):
        p.stdin.write(draw_fn(i / FPS, dur).convert("RGB").tobytes())
        if i % 90 == 0:
            print(f"  {name}: {i}/{n}", flush=True)
    p.stdin.close()
    p.wait()
    if p.returncode != 0:
        raise RuntimeError(out)


def probe(path):
    return float(subprocess.run([FP, "-v", "error", "-show_entries", "format=duration",
                                 "-of", "csv=p=0", path], capture_output=True, text=True).stdout.strip())


def assemble():
    order = ["m1", "m2", "m3", "m4", "m5", "m6", "m7"]
    segs = {k: os.path.join(ASSETS, f"seg_{k}.mp4") for k in order}
    for k, p in segs.items():
        if not os.path.exists(p) or os.path.getsize(p) < 10000:
            raise RuntimeError(f"missing segment: {p}")

    lines = json.load(open(os.path.join(ASSETS, "narration", "lines.json"), encoding="utf-8"))
    nar = {k: os.path.join(ASSETS, "narration", k + ".wav") for k in lines}
    nd = {k: probe(v) for k, v in nar.items()}
    dur = {
        "m1": nd["n1"] + 0.5,
        "m2": nd["n2"] + 0.5,
        "m3": max(16.0, nd["n3"] + 0.5),
        "m4": nd["n4"] + 0.5,
        "m5": nd["n5"] + 0.5,
        "m6": max(12.0, nd["n6"] + 0.5),
        "m7": nd["n7"] + 0.5,
    }

    listf = os.path.join(TMP, "concat.txt")
    with open(listf, "w", encoding="utf-8") as f:
        for k in order:
            f.write(f"file '{segs[k].replace(os.sep, '/')}'\n")
    video = os.path.join(TMP, "video_only.mp4")
    subprocess.run([FF, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listf,
                    "-vf", f"fade=t=in:st=0:d=0.5,fade=t=out:st={max(0, sum(dur.values()) - 0.9):.2f}:d=0.9",
                    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", video], check=True)

    starts, acc = {}, 0.0
    for k in order:
        starts[k] = acc + 0.25
        acc += dur[k]
    nk = dict(zip(order, ["n1", "n2", "n3", "n4", "n5", "n6", "n7"]))
    inputs, chains = [], []
    for i, k in enumerate(order):
        inputs += ["-i", nar[nk[k]]]
        ms = int(starts[k] * 1000)
        chains.append(f"[{i}:a]adelay={ms}|{ms}[a{i}]")
    total = sum(dur.values())
    fc = ";".join(chains + [
        "".join(f"[a{i}]" for i in range(len(order))) + f"amix=inputs={len(order)}:normalize=0:dropout_transition=0[mix]",
        "[mix]highpass=f=90,acompressor=threshold=0.1:ratio=3:attack=8:release=180,"
        f"afade=t=in:st=0:d=0.4,afade=t=out:st={max(0, total - 1.4):.2f}:d=1.4,"
        f"apad=whole_dur={total:.2f},volume=2.4[outa]",
    ])
    audio = os.path.join(TMP, "audio.m4a")
    subprocess.run([FF, "-y", "-loglevel", "error"] + inputs +
                   ["-filter_complex", fc, "-map", "[outa]", "-c:a", "aac", "-b:a", "160k",
                    "-ar", "44100", audio], check=True)

    film = os.path.join(ASSETS, "tt_chatchoice_film.mp4")
    subprocess.run([FF, "-y", "-loglevel", "error", "-i", video, "-i", audio,
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-shortest",
                    "-movflags", "+faststart", film], check=True)
    print("FILM:", film, round(probe(film), 2), "s")


def main():
    os.makedirs(TMP, exist_ok=True)
    if "assemble" in [a.lower() for a in sys.argv[1:]]:
        assemble()
        return
    lines = json.load(open(os.path.join(ASSETS, "narration", "lines.json"), encoding="utf-8"))
    nar = {k: os.path.join(ASSETS, "narration", k + ".wav") for k in lines}
    nd = {k: probe(v) for k, v in nar.items()}
    dur = {
        "m1": nd["n1"] + 0.5,
        "m2": nd["n2"] + 0.5,
        "m3": max(16.0, nd["n3"] + 0.5),
        "m4": nd["n4"] + 0.5,
        "m5": nd["n5"] + 0.5,
        "m6": max(12.0, nd["n6"] + 0.5),
        "m7": nd["n7"] + 0.5,
    }
    ctx = {"dur": dur}
    print("durations:", {k: round(v, 2) for k, v in dur.items()}, "total", round(sum(dur.values()), 2))

    want = [a.lower() for a in sys.argv[1:]]
    segs = {}
    for k in ["m1", "m2", "m3", "m4", "m5", "m6", "m7"]:
        if want and k not in want:
            continue
        out = os.path.join(ASSETS, f"seg_{k}.mp4")
        if k == "m3":
            segs[k] = m3(ctx)
        elif k == "m6":
            factor = dur["m6"] / 10.6
            subprocess.run([FF, "-y", "-loglevel", "error", "-i", os.path.join(ASSETS, "m6_thinking.mp4"),
                            "-vf", f"setpts={factor:.6f}*PTS,fps={FPS}",
                            "-c:v", "libx264", "-preset", "medium", "-crf", "18",
                            "-pix_fmt", "yuv420p", out], check=True)
            segs[k] = out
        else:
            render({"m1": m1, "m2": m2, "m4": m4, "m5": m5, "m7": m7}[k], dur[k], out, k)
            segs[k] = out
        print(f"  {k} -> {segs[k]}")

    if len(segs) < 7:
        print("partial render only")
        return
    assemble()


if __name__ == "__main__":
    main()

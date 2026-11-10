# 演示视频素材

答辩/展示用的 75 秒视频素材。分镜、旁白、录制顺序见仓库根目录的
[`演示视频_分镜脚本_v2.md`](../演示视频_分镜脚本_v2.md)。

| 文件 | 对应分镜 | 说明 |
| --- | --- | --- |
| `assets/m7_ci.png` | M7 CI 绿灯 | GitHub Actions 真实运行页截图（run #42832562665，Success 9s，Node 24） |
| `assets/m6_thinking.mp4` | M6 思考过程 | 10.6s / 1920×1080 / 30fps，由 `make_m6_thinking.py` 用 PIL 逐帧绘制 + ffmpeg 编码 |
| `assets/m3_omori.mp4` | M3 OMORI 实机 | 12.2s / 1280×960 / 30fps，真游戏窗口录制：聊天框接管 → 输入 bad advice → 拖动 → 缩放 → 确认推进 |
| `assets/m3_desktop_raw.mp4` | — | 桌面原始录制（2.5K，不提交 git），可重新裁切 |
| `assets/frames_m6/` | — | 中间帧目录，渲染完会删掉 |

## 重新生成 M6

```bash
python video/make_m6_thinking.py     # 需要 Pillow、本地字体 msyh.ttc/consola.ttf、../../tools/ffmpeg.exe
```

脚本里的分镜文字、时间线（`STEPS` / `STEP_START` / `OUTRO_AT`）都可直接改。
证据截图来自 `shots/`：`omori-domtest.png`（纯色 div 能显示）、`omori-clone.png`（克隆节点能显示）、
`omori-chat2.png`（修好后实机）。

## 重新生成 M7

GitHub Actions 运行页不是接口能截的，用 headless Edge + host-resolver 直接截：

```bash
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
  --headless=new --disable-gpu --hide-scrollbars --window-size=1600,1000 \
  --virtual-time-budget=15000 \
  --host-resolver-rules="MAP github.com 140.82.112.3, MAP *.github.com 140.82.112.3" \
  --screenshot="$PWD/video/assets/m7_ci_raw.png" \
  "https://github.com/silversystem04-coder/rpgmaker-chatbox/actions/runs/<run-id>"
```

再用 Python 裁成 16:9（`(0, 70, 1600, 970)`）存为 `m7_ci.png`。

> 本机 `github.com` 的 DNS 被投毒时，浏览器必须靠 `--host-resolver-rules` 指定可用 IP；
> Edge headless 偶发 segfault / `ERR_CONNECTION_CLOSED`，重试换 IP 即可。

## 重新生成 M3（OMORI 实机）

一条命令跑完整个录制：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File video\record_m3_omori.ps1
```

脚本做的事：

1. 把最新插件和 `m3_driver.js` 拷进 `<game>\www\`，在 `index.html` 末尾注入两个 `<script>`（备份 `.bak-m3`）
2. 启动 `OMORI.exe`，等 driver 在日志里写出 `MAP_READY`
3. 用 `SetProcessDPIAware` + `GetClientRect/ClientToScreen` 取游戏窗口的**物理**坐标，`gdigrab` 只录这块区域（整屏录会掉到 13fps，区域录稳定 30fps）
4. driver 时间线：开选项 → 输入 `bad advice` → Enter 确认 → 拖 header → 拖右下角缩放 → Enter 应用 → 写 `DONE`
5. 杀掉游戏、裁到 12.2s、放大到 1280×960，最后把 `index.html` 里的 driver 标签和文件清掉（插件本体保留）

driver 时间线在 `video/m3_driver.js` 里改，日志写在 `<game>\m3.log`。

已知坑：

- `ffmpeg -f gdigrab -i title=OMORI` 在这个 build 上直接报 `Invalid properties`，只能按窗口矩形录 `desktop`
- 窗口坐标必须 DPI-aware：不调 `SetProcessDPIAware` 会拿到 80% 的逻辑坐标（本机 125% 缩放），裁出来的画面全是偏移的
- PowerShell 5.1 里 `$ErrorActionPreference = "Stop"` 会把 ffmpeg 的 stderr 当异常抛，调 ffmpeg 前后要临时改 `Continue`
- `Set-Content -Encoding UTF8` 在 PS5.1 会写 BOM，所以 `index.html` 的备份/恢复用 `.bak-m3`，不要靠 diff 还原

## 成片（86.6 秒，7 段全合成）

```bash
python video/make_film.py            # 重渲全部分段（m1 m2 m3 m4 m5 m6 m7）
python video/make_film.py m1 m2 m4   # 只重渲指定段，其余复用 assets/seg_*.mp4
python video/make_film.py assemble   # 只做拼接 + 混音 + 封装（秒级）
```

成片：`assets/tt_chatchoice_film.mp4` —— 1920×1080 / 30fps / AAC 44.1kHz / 86.57s / 约 3.7 MB。

**段长公式**：`段长 = 该段旁白 wav 时长 + 0.5s`（M3、M6 取 `max(素材时长, 旁白 + 0.5)`）。
旁白在 `assets/narration/n1..n7.wav`，文案在 `assets/narration/lines.json`；重新生成旁白：

```powershell
# 本机可用的中文语音：Microsoft Huihui Desktop / Kangkang / Yaoyao
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('Microsoft Huihui Desktop')
$s.Rate = 0
$s.SetOutputToWaveFile('video\assets\narration\n3.wav')
$s.Speak('真实游戏里，选项弹出来的那一刻，插件就接管了。')
$s.Dispose()
```

改完某段旁白后：`python make_film.py assemble` 会自动按新时长重排（分段视频不会自动变长，
需要重渲对应段：`python make_film.py m3`）。混音链路：每段旁白按段起点 `adelay` →
`amix` → `highpass` → `compressor` → `afade` → `apad` → `volume=2.4`。

**分段与素材对照**

| 段 | 秒数 | 画面来源 |
| --- | --- | --- |
| m1 痛点 | 9.04 | PIL 自绘 RPG 对话框（4 个固定选项依次灰掉） |
| m2 接管 | 10.12 | `shots/chat-open.png` / `chat-confirm.png` / `chat-applied.png` 底部条带 |
| m3 实机 | 16.2 | `assets/m3_omori.mp4` + `shots/omori-layout-dragged.png` 尾卡 |
| m4 兜底 | 15.11 | `shots/chat-candidates.png` / `chat-retry.png` + 自绘卡 |
| m5 安装 | 11.99 | PIL 自绘 PowerShell 终端（逐行输出） |
| m6 思考 | 14.5 | `assets/m6_thinking.mp4` 拉伸铺满 |
| m7 CI+片尾 | 9.65 | `assets/m7_ci.png` + 右侧片尾卡（GitHub URL / 49 项测试 / MIT） |

分段中间文件在 `assets/seg_*.mp4`、`assets/_film/`，都不进 git。

## 封面

```bash
python video/make_cover.py     # 16:9 → assets/cover.png（1920×1080）与 cover.jpg
python video/make_cover_43.py  # 4:3  → assets/cover_4x3.png（1600×1200）与 cover_4x3.jpg
```

版式与成片同色系（深色 #0d1117 + 青绿 #2EE6A8），左侧标语 + 三个徽章 + GitHub 地址，
右侧贴 OMORI 真机截图（`shots/omori-chat2.png`）。改标题/字号/配色直接改 `make_cover.py` 顶部常量。

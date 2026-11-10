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

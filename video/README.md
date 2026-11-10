# 演示视频素材

答辩/展示用的 75 秒视频素材。分镜、旁白、录制顺序见仓库根目录的
[`演示视频_分镜脚本_v2.md`](../演示视频_分镜脚本_v2.md)。

| 文件 | 对应分镜 | 说明 |
| --- | --- | --- |
| `assets/m7_ci.png` | M7 CI 绿灯 | GitHub Actions 真实运行页截图（run #42832562665，Success 9s，Node 24） |
| `assets/m6_thinking.mp4` | M6 思考过程 | 10.6s / 1920×1080 / 30fps，由 `make_m6_thinking.py` 用 PIL 逐帧绘制 + ffmpeg 编码 |
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

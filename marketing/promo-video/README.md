# Labbai promo video

`labbai-promo.mp4` — 44 s, 1920×1080, 30 fps, H.264 + AAC, English narration over an original
background track (-16 LUFS).

| Time | Scene |
|---|---|
| 0–5 s | Logo + "The AI workspace where your business builds AI agents" |
| 5–11.4 s | Problem: customer messages from Telegram / WhatsApp / Instagram pile up |
| 11.4–19.6 s | Labbai AI chat builds a Telegram agent (Telegram → Agent + Knowledge + Cal.com → reply) |
| 19.6–24.8 s | Integrations that ship in Labbai |
| 24.8–30.8 s | Workspace modules: Chat, Workflows, Knowledge, Tables, Logs, Schedules |
| 30.8–38 s | Live run: customer books a visit in Telegram, run log traces every step |
| 38–44 s | Outro: "Build AI agents that automate real work." |

The narration text and start times live in `audio/narration.json`.

## Editing and re-rendering

The video is rendered from `promo.html`. Every animation is a CSS/Web Animation with
`fill: both`, so `window.seek(t)` shows the exact frame at `t` seconds. Animations are authored
on a 50 s timeline; `PACE` in the page maps each scene onto its slot in the 44 s video so it
lines up with the narration. Open `promo.html?t=19.5` in a browser to preview any moment.

Audio (Python 3 with `pip install kokoro-onnx soundfile numpy scipy`):

```bash
cd audio
# narration: Kokoro TTS, voice af_heart. Model files from
# https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0
python3 voice.py --model kokoro-v1.0.int8.onnx --voices voices-v1.0.bin
# background track (synthesized here, no third-party samples) + ducked mix -> build/mix.wav
python3 music.py
```

```bash
# stills for review (writes still-<t>.png)
NODE_PATH=$(npm root -g) node render.cjs --stills 2.5,19.5,42
# full video with sound (needs ffmpeg with libx264 on PATH or in $FFMPEG)
NODE_PATH=$(npm root -g) node render.cjs --audio audio/build/mix.wav --out labbai-promo.mp4
```

Fonts: Inter and JetBrains Mono (SIL Open Font License, see `fonts/LICENSE-*.txt`).

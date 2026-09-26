# Labbai promo video

`labbai-promo.mp4` — 27 s, 1920×1080, 30 fps, H.264 + AAC. Motion-graphics style: one object
per scene that morphs into the next, a tapping hand cursor, real brand icons on 3D tiles,
hard cuts between dark and light scenes, camera punches on every impact, true motion blur,
English narration, an original music track and synced sound effects (-16 LUFS).

| Time | Scene |
|---|---|
| 0–2.6 s | Green dot springs into the 3D Labbai icon, wordmark wipes in |
| 2.6–6.9 s | Telegram, WhatsApp and Instagram tiles drop in, unread badges count up |
| 6.9–10.2 s | Prompt pill: "Build a Telegram agent for my barbershop", hand taps send |
| 10.2–14.6 s | Pill morphs into the agent card, steps tick, hand flips the Go-live toggle |
| 14.6–18.2 s | Integrations orbit the Labbai hub with data pulses |
| 18.2–22.6 s | Telegram chat: customer books a visit, "Replied in 2s" / "Booking created" chips |
| 22.6–27 s | Logo hit: "AI agents that automate real work." |

Brand icons in `icons/` are exported from `apps/sim/components/icons.tsx`
(`cal-com-mark.svg` is the Cal.com wordmark cropped to "Cal" for a square tile).

## Editing and re-rendering

The whole animation is `promo.html`: `window.seek(t)` draws the exact frame at `t` seconds
from per-scene functions (springs, easing, the `IMPACTS` list that drives camera shake).
Open `promo.html?t=12.5` in a browser to preview any moment.

Audio (Python 3 with `pip install kokoro-onnx soundfile numpy scipy`):

```bash
cd audio
# narration: Kokoro TTS, voice af_heart; text and start times in narration.json. Model files:
# https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0
python3 voice.py --model kokoro-v1.0.int8.onnx --voices voices-v1.0.bin --speed 1.12
# music (128 BPM, synthesized here, no third-party samples) + whooshes, pops, taps, hits,
# ducked under the voice -> build/mix.wav
python3 music.py
```

Video (Playwright + ffmpeg with libx264 on PATH or in `$FFMPEG`):

```bash
# stills for review (writes still-<t>.png)
NODE_PATH=$(npm root -g) node render.cjs --stills 2.5,12,20
# full video; --blur is the number of motion-blur sub-frames per frame
NODE_PATH=$(npm root -g) node render.cjs --blur 8 --audio audio/build/mix.wav --out labbai-promo.mp4
```

Fonts: Inter (SIL Open Font License, see `fonts/LICENSE-inter.txt`).

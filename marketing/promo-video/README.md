# Labbai promo video

`labbai-promo.mp4` — 50 s, 1920×1080, 30 fps, H.264, English, no audio.

| Time | Scene |
|---|---|
| 0–4.6 s | Logo + "The AI workspace where your business builds AI agents" |
| 4.6–10.6 s | Problem: customer messages from Telegram / WhatsApp / Instagram pile up |
| 10.6–21 s | Labbai AI chat builds a Telegram agent (Telegram → Agent + Knowledge + Cal.com → reply) |
| 21–28 s | Integrations that ship in Labbai |
| 28–35 s | Workspace modules: Chat, Workflows, Knowledge, Tables, Logs, Schedules |
| 35–44.2 s | Live run: customer books a visit in Telegram, run log traces every step |
| 44.2–50 s | Outro: "Build AI agents that automate real work." |

## Editing and re-rendering

The video is rendered from `promo.html`. Every animation is a CSS/Web Animation with
`fill: both`, so `window.seek(t)` shows the exact frame at `t` seconds. Open
`promo.html?t=19.5` in a browser to preview any moment.

```bash
# stills for review (writes still-<t>.png)
NODE_PATH=$(npm root -g) node render.cjs --stills 2.5,19.5,42
# full video (needs ffmpeg with libx264 on PATH or in $FFMPEG)
NODE_PATH=$(npm root -g) node render.cjs --out labbai-promo.mp4
```

Fonts: Inter and JetBrains Mono (SIL Open Font License, see `fonts/LICENSE-*.txt`).

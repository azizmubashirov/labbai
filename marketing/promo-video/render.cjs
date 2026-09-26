/**
 * Renders promo.html frame by frame and encodes it to MP4.
 *
 * Usage: node render.cjs [--fps 30] [--out labbai-promo.mp4] [--audio audio/build/mix.wav] [--stills 1,12,19]
 * Requires Playwright (Chromium) and an ffmpeg binary with libx264 (FFMPEG env or PATH).
 */
const { spawn } = require('node:child_process')
const path = require('node:path')
const { chromium } = require('playwright')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const FPS = Number(arg('fps', '30'))
const OUT = path.resolve(__dirname, arg('out', 'labbai-promo.mp4'))
const STILLS = arg('stills', null)
const AUDIO = arg('audio', null)
const FFMPEG = process.env.FFMPEG || 'ffmpeg'

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  await page.goto(`file://${path.join(__dirname, 'promo.html')}`)
  await page.evaluate(() => document.fonts.ready)
  const duration = await page.evaluate(() => window.DURATION)

  if (STILLS) {
    for (const t of STILLS.split(',').map(Number)) {
      await page.evaluate((s) => window.seek(s), t)
      await page.screenshot({ path: path.join(__dirname, `still-${t}.png`) })
    }
    await browser.close()
    return
  }

  const audioArgs = AUDIO
    ? ['-i', path.resolve(__dirname, AUDIO), '-map', '0:v', '-map', '1:a',
        '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest']
    : []
  const ff = spawn(
    FFMPEG,
    ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', ...audioArgs,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT],
    { stdio: ['pipe', 'inherit', 'inherit'] }
  )
  const done = new Promise((resolve, reject) => {
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))))
  })

  const frames = Math.round(duration * FPS)
  for (let f = 0; f < frames; f++) {
    await page.evaluate((s) => window.seek(s), f / FPS)
    const buf = await page.screenshot({ type: 'jpeg', quality: 95 })
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r))
    if (f % 150 === 0) process.stdout.write(`frame ${f}/${frames}\n`)
  }
  ff.stdin.end()
  await done
  await browser.close()
  process.stdout.write(`wrote ${OUT}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`)
  process.exit(1)
})

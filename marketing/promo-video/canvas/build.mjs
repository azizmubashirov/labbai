/**
 * Builds canvas/dist/{canvas.js,canvas.css,season.woff2} for promo.html.
 * Usage (from the repo root, after `bun install`): bun marketing/promo-video/canvas/build.mjs
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const here = path.dirname(new URL(import.meta.url).pathname)
const dist = path.join(here, 'dist')
mkdirSync(dist, { recursive: true })

const js = await Bun.build({
  entrypoints: [path.join(here, 'canvas.tsx')],
  target: 'browser',
  format: 'iife',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
})
if (!js.success) throw new AggregateError(js.logs, 'bundle failed')
for (const output of js.outputs) {
  if (output.path.endsWith('.js')) {
    // zustand reads import.meta.env, which a classic (file://) script cannot parse.
    const code = (await output.text()).replaceAll('import.meta.env', '({MODE:"production"})')
    writeFileSync(path.join(dist, 'canvas.js'), `var process = { env: { NODE_ENV: 'production' } };\n${code}`)
  }
}

const cssIn = path.join(here, 'canvas.css')
const result = await postcss([tailwind({ base: path.resolve(here, '../../../apps/sim') })]).process(
  readFileSync(cssIn, 'utf8'),
  { from: cssIn, to: path.join(dist, 'canvas.css') }
)
const fontSrc = path.resolve(here, '../../../apps/sim/app/_styles/fonts/season/SeasonSansUprightsVF.woff2')
copyFileSync(fontSrc, path.join(dist, 'season.woff2'))
writeFileSync(
  path.join(dist, 'canvas.css'),
  result.css.replace(/url\([^)]*SeasonSansUprightsVF\.woff2[^)]*\)/g, "url('season.woff2')")
)
console.log('built canvas/dist')

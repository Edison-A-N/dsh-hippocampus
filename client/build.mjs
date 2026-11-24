/**
 * Client-bundle build for the hippocampus Web panel.
 *
 * Emits `lib/client.js` in the DSH closure-factory wire format:
 *
 *     window.__ModuleLoader__.load({ id, factory: (require) => { ... } })
 *
 * The factory is CJS; every platform-module specifier (react, cordis,
 * ui-slots, ui-primitives, dsh-client-runtime/client) stays an external
 * `require` answered by the loader's module table, and everything else
 * (our component, locales, CSS) inlines into the bundle.
 *
 * This mirrors the upstream `clientBundle` tsdown preset
 * (packages/client/tsdown.client.ts in deepseek-harness) for a standalone
 * package: same banner/footer, same externals policy, plus a small CSS
 * Modules transform so the component's `.module.css` ships hashed classes
 * and an injected <style> tag inside the factory closure.
 */
import { build } from 'esbuild'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/+$/, '')
const PLUGIN_ID = 'dsh-hippocampus'

/** Specifiers the loader's module table answers (keep as require, never inline). */
const EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  // The runtime's client contract layer: preloaded by the boot manifest and
  // answerable from the module table (requested via dsh.client.inject).
  '@deepseek-ai/dsh-client-runtime/client',
]

/** Hashed class name for one local CSS class (stable, djb2; per file). */
function className(id, file, local) {
  let hash = 5381
  const input = `${id}/${file}/${local}`
  for (let i = 0; i < input.length; i += 1) hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0
  return `hippo_${hash.toString(36)}_${local}`
}

/**
 * Minimal CSS Modules loader: resolves `*.module.css` imports to a generated
 * module exporting the class map; the stylesheet text ships as an injected
 * <style> tag at factory execution (dedup by tag id, like upstream).
 */
function cssModulesPlugin(id) {
  const styleTag = (fileId, css) => {
    const tagId = `${id}/${basename(fileId)}`
    return [
      `const css = ${JSON.stringify(css)};`,
      `const tagId = ${JSON.stringify(tagId)};`,
      "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
      "  const tag = document.createElement('style');",
      `  tag.dataset.plugin = ${JSON.stringify(id)};`,
      '  tag.dataset.pluginCss = tagId;',
      '  tag.textContent = css;',
      '  document.head.appendChild(tag);',
      '}',
    ].join('\n')
  }

  /** Rewrite `.foo` selectors to hashed names; keep everything else verbatim. */
  const transformCss = (css, map) => css
    .replace(/\.([A-Za-z_][A-Za-z0-9_-]*)/g, (match, local) =>
      map[local] === undefined ? match : `.${map[local]}`)

  return {
    name: 'hippocampus-css-modules',
    setup(build) {
      build.onResolve({ filter: /\.module\.css$/ }, args => ({
        path: join(args.resolveDir, args.path),
        namespace: 'css-module',
      }))
      build.onLoad({ filter: /.*/, namespace: 'css-module' }, async args => {
        const source = await readFile(args.path, 'utf8')
        const locals = [...source.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)].map(m => m[1])
        const map = {}
        for (const local of new Set(locals)) map[local] = className(PLUGIN_ID, basename(args.path), local)
        const css = transformCss(source, map)
        const exportLines = Object.entries(map)
          .map(([local, hashed]) => `export default ${JSON.stringify(map)};`)
        const sourceText = `${styleTag(args.path, css)}\n${exportLines[0]}`
        return {
          contents: sourceText,
          loader: 'js',
          watchFiles: [args.path],
        }
      })
    },
  }
}

const css = cssModulesPlugin(PLUGIN_ID)

const result = await build({
  entryPoints: [join(ROOT, 'client/src/index.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  sourcemap: true,
  outfile: join(ROOT, 'lib/client.js'),
  external: EXTERNALS,
  plugins: [css],
  // Fail loudly rather than emit a bundle the module table cannot answer.
  logLevel: 'warning',
  metafile: true,
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {
var module = { exports: {} }; var exports = module.exports;`,
  },
  footer: {
    js: 'return module.exports; } });',
  },
})

// Purity check: nothing under @deepseek-ai/ may have inlined (the module
// table must answer every cross-plugin require; an inline means a duplicate
// runtime instance or an unanswerable require).
const inlined = Object.keys(result.metafile.inputs)
  .filter(input => input.includes('node_modules/@deepseek-ai/'))
if (inlined.length > 0) {
  console.error(`client bundle purity violation: @deepseek-ai/ inputs inlined: ${inlined.join(', ')}`)
  process.exit(1)
}

// The CJS wrapper: esbuild's cjs output defines its own module.exports. Wrap
// the factory body so the outer closure returns it (banner/footer already
// carry the load() handoff; here we only report success).
await mkdir(join(ROOT, 'lib'), { recursive: true })

// Scrub machine-local absolute paths from the published artifacts: esbuild
// renders the css-module virtual ids (and the sourceMappingURL comment) with
// the absolute path of this checkout. Rewrite every absolute occurrence of
// ROOT in both the bundle and its map to a repo-relative form before commit.
const bundlePath = join(ROOT, 'lib/client.js')
const mapPath = join(ROOT, 'lib/client.js.map')
for (const artifact of [bundlePath, mapPath]) {
  const text = await readFile(artifact, 'utf8')
  const scrubbed = text.split(ROOT + '/').join('')
  if (scrubbed !== text) await writeFile(artifact, scrubbed)
}
if ((await readFile(bundlePath, 'utf8')).includes(ROOT)) {
  console.error('client bundle still references the local checkout path after scrub')
  process.exit(1)
}

const outputs = Object.entries(result.metafile.outputs)
  .filter(([, info]) => info.entryPoint !== undefined)
  .map(([path]) => path)
console.log(`client bundle: ${outputs.join(', ')} (${Object.keys(result.metafile.inputs).length} inputs, externals preserved)`)

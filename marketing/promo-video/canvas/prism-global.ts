/**
 * emcn's code view loads Prism language packs that expect a global `Prism`, which
 * Next provides implicitly; this bundle has to set it before they evaluate.
 */
import Prism from 'prismjs'

;(globalThis as { Prism?: typeof Prism }).Prism = Prism

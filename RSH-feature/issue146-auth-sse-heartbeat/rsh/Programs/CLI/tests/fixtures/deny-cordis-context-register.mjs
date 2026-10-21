import { register } from 'node:module'

register(new URL('./deny-cordis-context-loader.mjs', import.meta.url), import.meta.url)

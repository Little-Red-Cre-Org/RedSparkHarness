#!/usr/bin/env node

import { Context } from '@redspark/cordis'
import { pathToFileURL } from 'node:url'
import Loader from '@redspark/cordis-plugin-loader'

const ctx = new Context()
ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'

await ctx.plugin(Loader)
await ctx.loader.create({
  name: '@redspark/cordis-plugin-include',
  config: {
    path: './cordis.yml',
  },
})

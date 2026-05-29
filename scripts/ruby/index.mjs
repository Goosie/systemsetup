#!/usr/bin/env node
/**
 * Ruby — Chief Reality Officer van Goosie Labs
 *
 * Ruby stelt de kritische vragen die anderen vergeten te stellen,
 * vóórdat iets live gaat. Ze blokkeert geen voortgang — ze zorgt
 * dat iemand nagedacht heeft.
 *
 * Gebruik:
 *   node scripts/ruby/index.mjs                       → review huidige branch
 *   node scripts/ruby/index.mjs review                → review huidige branch
 *   node scripts/ruby/index.mjs review --branch <x>   → specifieke branch
 *   node scripts/ruby/index.mjs review --save         → schrijft RUBY-REVIEW.md
 *   node scripts/ruby/index.mjs review --base <x>     → andere basisbranch
 */

import { runReview } from './skills/review.mjs'

const args    = process.argv.slice(2)
const command = args.find(a => !a.startsWith('-')) || 'review'

console.log('\n💎 Ruby — Chief Reality Officer')
console.log('─'.repeat(44))

switch (command) {
  case 'review':
    await runReview(args)
    break

  default:
    console.log(`Onbekend commando: "${command}"`)
    console.log('Gebruik: review | review --branch <naam> | review --save')
    process.exit(1)
}

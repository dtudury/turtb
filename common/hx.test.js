import { globalTestRunner, urlToName } from '../lib/utils/TestRunner.js'
import { hx } from './hx.js'

globalTestRunner.describe(urlToName(import.meta.url), suite => {
  const asdf = hx`<div>asdf</div>`
  console.log(asdf)
})

import { globalTestRunner, urlToName } from '../lib/utils/TestRunner.js'
import { BouncelessTurtle } from './BouncelessTurtle.js'

globalTestRunner.skip.describe(urlToName(import.meta.url), suite => {
  suite.it('get and set without address use the last value', async ({ assert }) => {
    const t = new BouncelessTurtle()
    t.set({ a: 1, b: 2 })
    await assert.equal(t.get(), { a: 1, b: 2 })
    await assert.equal(t.get('a'), 1)
    await assert.equal(t.get('b'), 2)
  })

  suite.it('set with path updates a nested value', async ({ assert }) => {
    const t = new BouncelessTurtle()
    t.set({ a: { b: 42 } })
    t.set('a', 'b', 99)
    await assert.equal(t.get('a', 'b'), 99)
  })

  suite.it('set with explicit address reads from that address', async ({ assert }) => {
    const t = new BouncelessTurtle()
    const addr = t.set({ a: 1 })
    t.set('a', 2)
    await assert.equal(t.get(addr, 'a'), 1)
    await assert.equal(t.get('a'), 2)
  })

  suite.it('set is append-only — old addresses are unchanged', async ({ assert }) => {
    const t = new BouncelessTurtle()
    const addr = t.set({ a: { b: 42 } })
    t.set('a', 'b', 99)
    await assert.equal(t.get(addr, 'a', 'b'), 42)
    await assert.equal(t.get('a', 'b'), 99)
  })

  suite.it('get with explicit address does not register a watch dependency', async ({ assert }) => {
    const t = new BouncelessTurtle()
    const addr = t.set({ a: 1 })
    let callCount = 0
    t.watch('test', () => {
      callCount++
      t.get(addr, 'a') // explicit address — should not re-trigger
    })
    await assert.equal(callCount, 1)
    t.set('a', 2)
    await new Promise(resolve => setTimeout(resolve, 0))
    await assert.equal(callCount, 1)
  })

  suite.it('watch re-runs when an accessed path changes', async ({ assert }) => {
    const t = new BouncelessTurtle()
    t.set({ a: 1, b: 2 })
    const seen = []
    t.watch('test', () => seen.push(t.get('a')))
    await assert.equal(seen, [1])
    t.set('a', 99)
    await new Promise(resolve => setTimeout(resolve, 0))
    await assert.equal(seen, [1, 99])
  })

  suite.it('watch does not re-run when an unrelated path changes', async ({ assert }) => {
    const t = new BouncelessTurtle()
    t.set({ a: 1, b: 2 })
    const seen = []
    t.watch('test', () => seen.push(t.get('a')))
    await assert.equal(seen, [1])
    t.set('b', 99)
    await new Promise(resolve => setTimeout(resolve, 0))
    await assert.equal(seen, [1])
  })

  suite.it('watch re-runs with fresh dependencies each time', async ({ assert }) => {
    const t = new BouncelessTurtle()
    t.set({ a: 1, b: 1 })
    const seen = []
    t.watch('test', () => {
      const val = t.get('a')
      seen.push(val)
      if (seen.length === 1) t.get('b') // only watch b on first run
    })
    await assert.equal(seen, [1])
    t.set('b', 99)
    await new Promise(resolve => setTimeout(resolve, 0))
    await assert.equal(seen, [1, 1]) // re-ran because b was watched on first run
    t.set('b', 100)
    await new Promise(resolve => setTimeout(resolve, 0))
    await assert.equal(seen, [1, 1]) // b no longer watched after second run
  })
})

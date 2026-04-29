import { Recaller, IGNORE_ACCESS, IGNORE_MUTATE, IGNORE } from './Recaller.js'
import { globalTestRunner, urlToName } from './TestRunner.js'
import { handleNextTick } from './nextTick.js'

globalTestRunner.skip.describe(urlToName(import.meta.url), suite => {
  suite.it('calls watched functions when accessed values change', ({ assert }) => {
    const recaller = new Recaller('calls watched functions')
    const a = {}
    const b = {}
    let counter = 0
    recaller.watch('count on access', function () {
      ++counter
      recaller.reportKeyAccess(a, 'x')
      recaller.reportKeyAccess(b, 'y')
    })
    assert.equal(counter, 1, 'function should get called at start')

    recaller.reportKeyMutation(a, 'x')
    recaller.reportKeyMutation(a, 'x')
    recaller.reportKeyMutation(b, 'y')
    handleNextTick()
    assert.equal(counter, 2, 'function should get called once per tic')

    recaller.reportKeyMutation(a, 'y')
    recaller.reportKeyMutation(a, 'y')
    recaller.reportKeyMutation(b, 'x')
    handleNextTick()
    assert.equal(counter, 2, 'function should not get called when unaccessed values change')
  })

  suite.it('calls beforeNextUpdate and afterNextUpdate functions in order', ({ assert }) => {
    const recaller = new Recaller('calls beforeNextUpdate and afterNextUpdate')
    const o = {}
    let output = ''
    recaller.beforeNextUpdate(() => {
      output = output + 'b'
    })
    recaller.afterNextUpdate(() => {
      output = output + 'a'
    })
    recaller.watch('o.x', () => {
      recaller.reportKeyAccess(o, 'x')
      output = output + 'w'
    })
    assert.equal(output, 'w', 'called at start')
    handleNextTick()
    assert.equal(output, 'w', 'nothing triggered')
    recaller.reportKeyMutation(o, 'x')
    assert.equal(output, 'w', 'still nothing triggered')
    handleNextTick()
    assert.equal(output, 'wbwa', 'everything triggered in order')
  })

  suite.it('call with IGNORE_ACCESS prevents dependency tracking', ({ assert }) => {
    const recaller = new Recaller('IGNORE_ACCESS test')
    const o = {}
    let callCount = 0
    recaller.watch('watcher', () => {
      recaller.reportKeyAccess(o, 'tracked')
      recaller.call(() => recaller.reportKeyAccess(o, 'untracked'), IGNORE_ACCESS)
      ++callCount
    })
    assert.equal(callCount, 1)
    recaller.reportKeyMutation(o, 'untracked')
    handleNextTick()
    assert.equal(callCount, 1, 'ignored access should not create dependency')
    recaller.reportKeyMutation(o, 'tracked')
    handleNextTick()
    assert.equal(callCount, 2, 'normal access should still create dependency')
  })

  suite.it('call with IGNORE_MUTATE prevents watchers being triggered', ({ assert }) => {
    const recaller = new Recaller('IGNORE_MUTATE test')
    const o = {}
    let callCount = 0
    recaller.watch('watcher', () => {
      recaller.reportKeyAccess(o, 'x')
      ++callCount
    })
    assert.equal(callCount, 1)
    recaller.call(() => recaller.reportKeyMutation(o, 'x'), IGNORE_MUTATE)
    handleNextTick()
    assert.equal(callCount, 1, 'ignored mutation should not trigger watcher')
    recaller.reportKeyMutation(o, 'x')
    handleNextTick()
    assert.equal(callCount, 2, 'normal mutation should still trigger watcher')
  })

  suite.it('call with IGNORE suppresses both access tracking and mutation triggering', ({ assert }) => {
    const recaller = new Recaller('IGNORE test')
    const o = {}
    let callCount = 0
    recaller.watch('watcher', () => {
      recaller.call(() => recaller.reportKeyAccess(o, 'x'), IGNORE)
      ++callCount
    })
    assert.equal(callCount, 1)
    recaller.reportKeyMutation(o, 'x')
    handleNextTick()
    assert.equal(callCount, 1, 'ignored access means mutation has no effect')

    const p = {}
    let otherCount = 0
    recaller.watch('other', () => {
      recaller.reportKeyAccess(p, 'y')
      ++otherCount
    })
    otherCount = 0
    recaller.call(() => recaller.reportKeyMutation(p, 'y'), IGNORE)
    handleNextTick()
    assert.equal(otherCount, 0, 'ignored mutation should not trigger watcher')
  })

  suite.it('call returns the value from f', ({ assert }) => {
    const recaller = new Recaller('call return value')
    const result = recaller.call(() => 42)
    assert.equal(result, 42)
  })

  suite.it('skips replaced triggers', ({ assert }) => {
    const recaller = new Recaller('skips replaced triggers')
    let callCount = 0
    const watchedFunction = () => {
      recaller.reportKeyMutation(recaller, 'key', 'test', 'test')
      recaller.reportKeyAccess(recaller, 'key', 'test', 'test')
      ++callCount
    }
    recaller.watch('watchedFunction', watchedFunction)
    assert.equal(callCount, 1)
    handleNextTick()
    assert.equal(callCount, 1)
    recaller.reportKeyMutation(recaller, 'key', 'test', 'test')
    assert.equal(callCount, 1)
    handleNextTick()
    assert.equal(callCount, 2)
    recaller.watch('watchedFunction', watchedFunction)
    assert.equal(callCount, 3)
    handleNextTick()
    assert.equal(callCount, 3)
  })
})

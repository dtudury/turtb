import { describe } from './utils/testing.js'
import { Repository } from './Repository.js'

describe(import.meta.url, ({ test }) => {
  test('commit stores message, date, and a reference to the data', ({ assert }) => {
    const repo = new Repository()
    repo.working.set({ a: 1 })
    const commitAddr = repo.commit('first commit')
    const commit = repo.committed.decode(commitAddr)
    assert.equal(commit.message, 'first commit')
    assert.ok(commit.date instanceof Date)
    assert.equal(typeof commit.dataAddress, 'number')
    assert.deepEqual(repo.committed.decode(commit.dataAddress), { a: 1 })
  })

  test('multiple commits produce separate records with correct data', ({ assert }) => {
    const repo = new Repository()
    repo.working.set({ v: 1 })
    const addr1 = repo.commit('first')
    repo.working.set('v', 2)
    const addr2 = repo.commit('second')
    assert.notEqual(addr1, addr2)
    const c1 = repo.committed.decode(addr1)
    const c2 = repo.committed.decode(addr2)
    assert.deepEqual(repo.committed.decode(c1.dataAddress), { v: 1 })
    assert.deepEqual(repo.committed.decode(c2.dataAddress), { v: 2 })
  })

  test('unchanged data reuses the same address across commits', ({ assert }) => {
    const repo = new Repository()
    repo.working.set({ x: 42 })
    const addr1 = repo.commit('first')
    const addr2 = repo.commit('second')
    const c1 = repo.committed.decode(addr1)
    const c2 = repo.committed.decode(addr2)
    assert.equal(c1.dataAddress, c2.dataAddress, 'same data reuses the same address')
  })

  test('throws when working stream is empty', ({ assert }) => {
    const repo = new Repository()
    assert.throws(() => repo.commit('nothing here'))
  })
})

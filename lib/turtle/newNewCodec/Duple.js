export class Duple {
  /**
   * @param {Array.<any>} v
   */
  constructor (v) {
    if (v.length === 2) {
      this.v = v
    } else if (v.length > 2) {
      const leftLength = 2 ** (31 - Math.clz32(v.length - 1))
      this.v = []
      this.v.push(new Duple(v.slice(0, leftLength)))
      if (leftLength === v.length - 1) this.v.push(v[v.length - 1])
      else this.v.push(new Duple(v.slice(leftLength)))
    } else {
      throw new Error('unhandled array length')
    }
  }

  flat () {
    return [
      (this.v[0] instanceof Duple) ? this.v[0].flat() : this.v[0],
      (this.v[1] instanceof Duple) ? this.v[1].flat() : this.v[1]
    ].flat()
  }

  flatDuples () {
    if (this.v.every(v => (v instanceof Duple))) {
      return [this.v[0].flatDuples(), this.v[1].flatDuples()].flat()
    } else if (this.v.every(v => !(v instanceof Duple))) {
      return [this]
    } else {
      throw new Error('non flattable duple')
    }
  }

  toString () {
    return '[object Duple]'
  }
}

/**
 * @typedef {import('../U8aTurtle.js').U8aTurtle} U8aTurtle
 * @typedef {import('../TurtleDictionary.js').TurtleDictionary} TurtleDictionary
 * @typedef {import('./CodecType.js').CodecType} CodecType
 * @typedef {import('./CodecType.js').CodecOptions} CodecOptions
 */
/**
 * @typedef RefsOptions
 * @property {boolean} keysAsRefs
 * @property {boolean} valuesAsRefs
 */
export const DEREFERENCE = { keysAsRefs: false, valuesAsRefs: false }
export const VALUE_REFS = { keysAsRefs: false, valuesAsRefs: true }
export const KEY_VALUE_REFS = { keysAsRefs: true, valuesAsRefs: true }

export class Codec {
  /**
   * @param {Uint8Array} uint8Array
   * @param {U8aTurtle} u8aTurtle
   * @param {RefsOptions} refsOptions
   * @returns {any}
   */
  decode (uint8Array, u8aTurtle, refsOptions) {
    throw new Error('implement decode')
  }

  /**
   * @param {any} value
   * @param {TurtleDictionary} turtleDictionary
   * @param {RefsOptions} refsOptions
   * @returns {Uint8Array | Array.<Uint8Array>}
   */
  encode (value, turtleDictionary, refsOptions) {
    throw new Error('implement encode')
  }

  /**
   * @param {Uint8Array} uint8Array
   * @param {U8aTurtle} u8aTurtle
   * @param {RefsOptions} refsOptions
   * @returns {any}
   */
  describe (uint8Array, u8aTurtle, refsOptions) {
    throw new Error('implement describe')
  }
}

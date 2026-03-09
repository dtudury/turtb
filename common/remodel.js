/**
 * @typedef Attribute
 * @property {string} type
 * @property {string} name
 * @property {any} value
 */

/**
 * @typedef Description
 * @property {string} tag
 * @property {Array.<Description>} children
 * @property {Array.<Attribute|() => Attribute>} attributes
 * @property {null|string|function} tag
 * @property {string} type
 * @property {string} value
 */

/**
 * @param {HTMLElement} element
 * @param {Array.<Description>} descriptions
 * @param {import('../../utils/Recaller.js').Recaller} recaller
 * @param {string} debugString
 * @param {string} xmlns
 */
export function remodel (element, descriptions, recaller, debugString, xmlns = 'http://www.w3.org/1999/xhtml') {
  console.log(element, descriptions)
}

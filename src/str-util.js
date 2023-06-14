/**
 * Function to convert a string to lowerCamelCase
 * @param {String} str
 * @returns {String}
 */

export function lowerCamelCase(str) {
  return str
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]+(.)/g, (m, chr) => chr.toUpperCase());
}

/**
 * Function to convert a string to UpperCamelCase
 * @param {String} str
 * @returns {String}
 */
export function upperCamelCase(str) {
  if (str.startsWith(0)) {
    str = str.slice(3);
  }
  return lowerCamelCase(str).replace(/^[a-z]/, (m) => m.toUpperCase());
}

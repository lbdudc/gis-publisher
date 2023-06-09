// Move this functions to utils.js
export function upperCamelCase(str) {
  str = str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  return str.replace(/([-_][a-z])/gi, ($1) => {
    return $1.toUpperCase().replace("-", "").replace("_", "");
  });
}

// Move this functions to utils.js
export function lowerCamelCase(str) {
  str = str.charAt(0).toLowerCase() + str.slice(1).toLowerCase();
  return str.replace(/([-_][a-z])/gi, ($1) => {
    return $1.toUpperCase().replace("-", "").replace("_", "");
  });
}

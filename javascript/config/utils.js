// config/utils.js

/**
 * Parse environment variable as a boolean.
 * @param {string | undefined} value - The environment variable value.
 * @param {boolean} defaultValue - The default value if the environment variable is undefined.
 * @returns {boolean} Parsed boolean value.
 */
function parseBooleanEnv(value, defaultValue) {
  if (typeof value === 'undefined') {
    return defaultValue;
  }
  return value.toLowerCase() === 'true';
}

/**
 * Parse environment variable as a number.
 * @param {string | undefined} value - The environment variable value.
 * @param {number} defaultValue - The default value if the environment variable is undefined or cannot be parsed as a number.
 * @returns {number} Parsed number value.
 */
function parseNumberEnv(value, defaultValue) {
  if (typeof value === 'undefined') {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

module.exports = {
  parseBooleanEnv,
  parseNumberEnv,
};

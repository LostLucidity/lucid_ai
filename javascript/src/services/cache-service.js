//@ts-check
"use strict";

/** Cache for storing the results of getAlive function calls */
const cache = {};
const DEFAULT_KEY = 'default';

/**
 * Retrieves alive units from the cache or by calling the getAlive function if not already cached.
 * Invalidates the cache if the first unit is not current.
 * 
 * @param {UnitResource} units - The units object containing the getAlive function.
 * @param {UnitFilter} [filter] - Optional filter criteria to be applied when retrieving alive units.
 * @returns {Unit[]} - An array of alive units.
 */
function getCachedAlive(units, filter) {
  /** @type {string} The key used to store and retrieve results from the cache. */
  const key = filter ? JSON.stringify(filter) : DEFAULT_KEY;

  if (cache[key]) {
    const firstUnitIsNotCurrent = cache[key].data[0] && !cache[key].data[0].isCurrent();
    if (firstUnitIsNotCurrent) {
      invalidateCache(key);
    } else {
      return cache[key].data;
    }
  }

  const result = units.getAlive(filter);
  cache[key] = {
    data: result,
    timestamp: Date.now() // for potential expiry implementation
  };

  return result;
}

/**
 * Invalidates the entire cache or specific cached items based on provided key.
 * 
 * @param {string} [key] - Optional specific key to invalidate, if not provided, the entire cache is cleared.
 */
function invalidateCache(key) {
  if (key) {
    delete cache[key];
  } else {
    Object.keys(cache).forEach(k => delete cache[k]);
  }
}

module.exports = {
  getCachedAlive,
  invalidateCache
};

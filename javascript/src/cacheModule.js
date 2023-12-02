//@ts-check
"use strict"

/**
 * Module for caching functionalities in the application.
 */

/** @type {Map<string, number[][]>} */
const pathCache = new Map();
const gasGeysersCache = new Map();

/**
 * Gets the cached path data.
 * @param {string} key - The key to retrieve the path data.
 * @returns {number[][] | undefined} - The cached path data or undefined if not found.
 */
function getPathCache(key) {
  return pathCache.get(key);
}

/**
 * Sets the path data in the cache.
 * @param {string} key - The key to store the path data.
 * @param {number[][]} data - The path data to cache.
 */
function setPathCache(key, data) {
  pathCache.set(key, data);
}

/**
 * Clears a specific path from the path cache or the entire cache if no key is provided.
 * @param {string} [key] - The key of the path to clear. If not provided, the entire cache is cleared.
 */
function clearPathCache(key) {
  if (key) {
    pathCache.delete(key);
  } else {
    pathCache.clear();
  }
}

/**
 * Gets the cached gas geyser data.
 * @param {string} key - The key to retrieve the gas geyser data.
 * @returns {any} - The cached gas geyser data or undefined if not found.
 */
function getGasGeysersCache(key) {
  return gasGeysersCache.get(key);
}

/**
 * Sets the gas geyser data in the cache.
 * @param {string} key - The key to store the gas geyser data.
 * @param {any} data - The gas geyser data to cache.
 */
function setGasGeysersCache(key, data) {
  gasGeysersCache.set(key, data);
}

/**
 * Clears the gas geysers cache.
 */
function clearGasGeysersCache() {
  gasGeysersCache.clear();
}

module.exports = {
  getPathCache,
  setPathCache,
  clearPathCache,
  getGasGeysersCache,
  setGasGeysersCache,
  clearGasGeysersCache
};

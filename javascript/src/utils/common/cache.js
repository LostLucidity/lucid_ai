"use strict";

/**
 * Class managing various caches used in the application.
 */
class CacheManager {
  constructor() {
    this.cachedData = new Map();
    this.unitTypeAbilityCache = new Map(); // Cache for unit type abilities
    this.pathCache = new Map(); // Cache for path data
    this.gasGeysersCache = new Map(); // Cache for gas geyser data
  }

  /**
   * Caches unit type ability data.
   * @param {number} abilityId - The ability ID.
   * @param {any} data - The data to cache.
   */
  cacheUnitTypeAbilityData(abilityId, data) {
    this.unitTypeAbilityCache.set(abilityId, data);
  }

  /**
   * Clears the gas geysers cache.
   */
  clearGasGeysersCache = () => {
    this.gasGeysersCache.clear();
  }  

  /**
   * Clears a specific path from the path cache or the entire cache if no key is provided.
   * @param {string} [key] - The key of the path to clear. If not provided, the entire cache is cleared.
   */
  clearPathCache = (key) => {
    if (key) {
      this.pathCache.delete(key);
    } else {
      this.pathCache.clear();
    }
  }  

  /**
   * Retrieves data for a given key, if it's current for the specified frame.
   * @param {number} key - The key representing the data (e.g., unit type ID).
   * @param {number} currentFrame - The current game loop frame.
   * @returns {any | undefined} - The cached data or undefined if not current.
   */
  getDataIfCurrent(key, currentFrame) {
    const dataEntry = this.cachedData.get(key);
    if (dataEntry && dataEntry.frame === currentFrame) {
      return dataEntry.data;
    }
    return undefined;
  }

  /**
   * Gets the cached gas geyser data.
   * @param {string} key - The key to retrieve the gas geyser data.
   * @returns {any} - The cached gas geyser data or undefined if not found.
   */
  getGasGeysersCache = (key) => {
    return this.gasGeysersCache.get(key);
  } 

  /**
   * Gets the cached path data.
   * @param {string} key - The key to retrieve the path data.
   * @returns {number[][] | undefined} - The cached path data or undefined if not found.
   */
  getPathCache = (key) => {
    return this.pathCache.get(key); // Corrected to use this.pathCache
  }

  /**
   * Retrieves unit type ability data from the cache.
   * @param {number} abilityId - The ability ID.
   * @returns {any | undefined} - The cached data or undefined if not available.
   */
  getUnitTypeAbilityData(abilityId) {
    return this.unitTypeAbilityCache.get(abilityId);
  }

  /**
   * Sets the gas geyser data in the cache.
   * @param {string} key - The key to store the gas geyser data.
   * @param {any} data - The gas geyser data to cache.
   */
  setGasGeysersCache = (key, data) => {
    this.gasGeysersCache.set(key, data);
  }

  /**
   * Sets the path data in the cache.
   * @param {string} key - The key to store the path data.
   * @param {number[][]} data - The path data to cache.
   */
  setPathCache = (key, data) => {
    this.pathCache.set(key, data); // Corrected to use this.pathCache
  }

  /**
   * Updates the cache with new data.
   * @param {number} key - The key representing the data.
   * @param {Unit[]} data - The data to cache.
   * @param {number} frame - The game loop frame when this data is relevant.
   */
  updateCache = (key, data, frame) => {
    this.cachedData.set(key, { data, frame });
  }
}

const cacheManager = new CacheManager();

module.exports = cacheManager;

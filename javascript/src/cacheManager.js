"use strict";

class CacheManager {
  constructor() {
    this.cachedData = new Map();
    this.unitTypeAbilityCache = new Map(); // New cache for unit type abilities
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
   * Retrieves unit type ability data from the cache.
   * @param {number} abilityId - The ability ID.
   * @returns {any | undefined} - The cached data or undefined if not available.
   */
  getUnitTypeAbilityData(abilityId) {
    return this.unitTypeAbilityCache.get(abilityId);
  }  

  /**
   * Updates the cache with new data.
   * @param {number} key - The key representing the data.
   * @param {Unit[]} data - The data to cache.
   * @param {number} frame - The game loop frame when this data is relevant.
   */
  updateCache(key, data, frame) {
    this.cachedData.set(key, { data, frame });
  }
}

module.exports = new CacheManager();

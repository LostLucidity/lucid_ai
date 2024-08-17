"use strict";

/**
 * Class managing various caches used in the application.
 */
class CacheManager {
  constructor() {
    this.cachedData = new Map();
    this.completedBasesCache = null;
    this.unitTypeAbilityCache = new Map();
    this.pathCache = new Map();
    this.gasGeysersCache = new Map();
  }

  /**
   * Caches pathable positions data based on a unique key.
   * @param {string} key - The cache key.
   * @param {Point2D[]} data - The pathable positions data to cache.
   */
  cachePathablePositions(key, data) {
    this.pathCache.set(key, data);
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
   * Clears the completed bases cache.
   */
  clearCompletedBasesCache() {
    this.completedBasesCache = null;
  }

  /**
   * Clears the gas geysers cache.
   */
  clearGasGeysersCache() {
    this.gasGeysersCache.clear();
  }

  /**
   * Clears a specific path from the path cache or the entire cache if no key is provided.
   * @param {string} [key] - The key of the path to clear. If not provided, the entire cache is cleared.
   */
  clearPathCache(key) {
    if (key) {
      this.pathCache.delete(key);
    } else {
      this.pathCache.clear();
    }
  }

  /**
   * Retrieves cached pathable positions data if available.
   * @param {string} key - The cache key.
   * @returns {Point2D[] | undefined} - The cached pathable positions or undefined if not found.
   */
  getCachedPathablePositions(key) {
    return this.pathCache.get(key);
  }  

  /**
   * Gets the cached completed bases.
   * @returns {Unit[] | null} - The cached completed bases or null if not cached.
   */
  getCompletedBases() {
    return this.completedBasesCache;
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
  getGasGeysersCache(key) {
    return this.gasGeysersCache.get(key);
  } 

  /**
   * Gets the cached path data.
   * @param {string} key - The key to retrieve the path data.
   * @returns {number[][] | undefined} - The cached path data or undefined if not found.
   */
  getPathCache(key) {
    return this.pathCache.get(key);
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
  setGasGeysersCache(key, data) {
    this.gasGeysersCache.set(key, data);
  }

  /**
   * Sets the path data in the cache.
   * @param {string} key - The key to store the path data.
   * @param {number[][]} data - The path data to cache.
   */
  setPathCache(key, data) {
    this.pathCache.set(key, data);
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

  /**
   * Updates the cache with completed bases.
   * @param {Unit[]} bases - The bases to cache.
   */
  updateCompletedBasesCache(bases) {
    this.completedBasesCache = bases;
  }
}

const cacheManager = new CacheManager();

module.exports = cacheManager;

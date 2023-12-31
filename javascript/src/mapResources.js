//@ts-check
"use strict"

// mapResources.js
const { cellsInFootprint } = require('@node-sc2/core/utils/geometry/plane');
const { createPoint2D } = require('@node-sc2/core/utils/geometry/point');
const { getFootprint, Townhall } = require('@node-sc2/core/utils/geometry/units');

class MapResources {
  static freeGasGeysersCache = new Map();

  /**
   * Finds unoccupied gas geysers on the map.
   * @param {MapResource} map - The game map context.
   * @param {number} currentGameLoop - The current game loop.
   * @returns {Unit[]} - Array of unoccupied gas geysers.
   */
  static getFreeGasGeysers(map, currentGameLoop) {
    if (!this.isCacheValid(currentGameLoop)) {
      this.updateCache(map, currentGameLoop);
    }
    return this.freeGasGeysersCache.get('freeGasGeysers') || [];
  }

  static invalidateCache() {
    this.freeGasGeysersCache.clear();
  }  

  /**
  * Checks if the cache is valid based on the current game loop.
  * @param {number} currentGameLoop - The current game loop.
  * @returns {boolean} - True if the cache is valid, false otherwise.
  */
  static isCacheValid(currentGameLoop) {
    // Make sure to retrieve a number here
    const lastUpdatedLoop = this.freeGasGeysersCache.get('lastUpdatedLoop');
    return lastUpdatedLoop === currentGameLoop;
  }

  /**
   * Sets the pathable grid for a structure.
   * @param {MapResource} map
   * @param {Unit} structure
   * @param {boolean} isPathable
   * @returns {void}
   */
  static setPathableGrids(map, structure, isPathable) {
    const { pos, unitType } = structure;
    if (!pos || !unitType) return;

    const footprint = getFootprint(unitType);
    if (!footprint) return;

    cellsInFootprint(createPoint2D(pos), footprint).forEach(cell => {
      map.setPathable(cell, isPathable);
    });
  }

  /**
   * Retrieves available expansion locations.
   * @param {ResourceManager} resources - The game resources.
   * @returns {Expansion[]} - An array of available expansions.
   */
  static getAvailableExpansions(resources) {
    const { map } = resources.get();
    const availableExpansions = map.getExpansions().filter(expansion => {
      const { townhallPosition } = expansion;
      const townhall = Townhall(townhallPosition);
      return cellsInFootprint(townhallPosition, townhall).every(cell => map.isPlaceable(cell));
    });
    return availableExpansions;
  } 

  /**
   * @param {MapResource} map
   * @param {number} currentGameLoop - The current game loop.
   */
  static updateCache(map, currentGameLoop) {
    const freeGeysers = map.freeGasGeysers();
    this.freeGasGeysersCache.set('freeGasGeysers', freeGeysers);
    this.freeGasGeysersCache.set('lastUpdatedLoop', currentGameLoop); // Ensure this is a number
  }
}

module.exports = MapResources;

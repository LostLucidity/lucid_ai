//@ts-check
"use strict"

// mapResources.js
const { cellsInFootprint } = require('@node-sc2/core/utils/geometry/plane');
const { createPoint2D } = require('@node-sc2/core/utils/geometry/point');
const { getFootprint, Townhall } = require('@node-sc2/core/utils/geometry/units');

class MapResources {
  static freeGasGeysersCache = new Map();

  /**
   * Gets the enemy's main base location.
   * @param {MapResource} map - The map resource from the world state.
   * @returns {Point2D | null} The enemy's main base location, or null if not available.
   */
  static getEnemyBaseLocation(map) {
    // Use the getEnemyMain method from MapResource to get the enemy's main base location
    const enemyMainBase = map.getEnemyMain();

    if (enemyMainBase && enemyMainBase.townhallPosition) {
      // Use the townhallPosition property, which is a Point2D representing the main building's location
      return enemyMainBase.townhallPosition;
    }

    // If the main base location isn't available, return null
    return null;
  }

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

  /**
   * Gets potential expansion sites on the map.
   * @param {MapResource} map - The map resource from the world state.
   * @returns {Point2D[]} An array of potential expansion site locations.
   */
  static getPotentialExpansionSites(map) {
    // Get a list of all available expansions
    const availableExpansions = map.getAvailableExpansions();

    // Extract the townhall positions of these expansions
    let potentialSites = availableExpansions.map(expansion => expansion.townhallPosition);

    return potentialSites;
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

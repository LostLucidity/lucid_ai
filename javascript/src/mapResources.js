//@ts-check
"use strict"

// mapResources.js
const { cellsInFootprint } = require('@node-sc2/core/utils/geometry/plane');
const { createPoint2D } = require('@node-sc2/core/utils/geometry/point');

const { getFootprint, Townhall } = require('@node-sc2/core/utils/geometry/units');

class MapResources {
  /** @type {Map<string, Unit[]>} */
  static freeGasGeysersCache = new Map();

  /**
   * Finds unoccupied gas geysers on the map.
   * @param {MapResource} map - The game map context.
   * @returns {Unit[]} - Array of unoccupied gas geysers.
   */
  static getFreeGasGeysers(map) {
    // Use the static property for caching
    if (!MapResources.freeGasGeysersCache.has('freeGasGeysers')) {
      MapResources.freeGasGeysersCache.set('freeGasGeysers', map.freeGasGeysers());
    }
    return MapResources.freeGasGeysersCache.get('freeGasGeysers') || [];
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
}

module.exports = MapResources;

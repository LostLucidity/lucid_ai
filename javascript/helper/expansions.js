//@ts-check
"use strict"

const { distance } = require("@node-sc2/core/utils/geometry/point");
const { Alliance } = require('@node-sc2/core/constants/enums');
const { TownhallRace } = require("@node-sc2/core/constants/race-map");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint, Townhall } = require("@node-sc2/core/utils/geometry/units");
const { pointsOverlap } = require("./utilities");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");

module.exports = {
  /**
   * @param {ResourceManager} resources 
   */
  getAvailableExpansions: (resources) => {
    const { map } = resources.get();
    const availableExpansions = map.getExpansions().filter(expansion => {
      const { townhallPosition } = expansion;
      const townhall = Townhall(townhallPosition);
      return cellsInFootprint(townhallPosition, townhall).every(cell => map.isPlaceable(cell));
    });
    return availableExpansions;
  },
  getBase: (resources, expansion) => {
    const {
      units
    } = resources.get();
    // get closest base that is
    const bases = units.getBases();
    const [ closestBase ] = units.getClosest(expansion.townhallPosition, bases);
    return closestBase;
  },
  getOccupiedExpansions: (resources) => {
    const {
      map,
      units
    } = resources.get();
    // get Expansion and filter by bases near townhall position.
    const bases = units.getBases();
    const occupiedExpansions = map.getExpansions().filter(expansion => {
      const [ closestBase ] = units.getClosest(expansion.townhallPosition, bases);
      if (closestBase) {
        return distance(expansion.townhallPosition, closestBase.pos) < 1;
      }
    });
    return occupiedExpansions;
  },
  /**
   * @param {World} world
   * @param {Expansion[]} expansions
   * @returns {Point2D[]}
   */
  getNextSafeExpansions: (world, expansions) => {
    const { agent, resources } = world;
    const { map, units } = resources.get();
    const enemyUnits = units.getAlive(Alliance.ENEMY);
    const townhallType = TownhallRace[agent.race][0];
    const placeableExpansions = expansions.filter(expansion => {
      const { townhallPosition } = expansion;
      const footprint = getFootprint(townhallType);
      if (footprint === undefined) return false;
      const enemyUnitCoverage = enemyUnits
        .filter(enemyUnit => enemyUnit.pos && distance(enemyUnit.pos, townhallPosition) < 16)
        .map(enemyUnit => {
          const { pos, radius, unitType } = enemyUnit;
          if (pos === undefined || radius === undefined) return [];
          if (!enemyUnit.isStructure()) {
            return [pos, ...gridsInCircle(pos, radius)];
          } else {
            const footprint = getFootprint(unitType);
            if (footprint === undefined) return [];
            return cellsInFootprint(pos, footprint);
          }
        }).flat();
      return map.isPlaceableAt(townhallType, townhallPosition) && !pointsOverlap(enemyUnitCoverage, cellsInFootprint(townhallPosition, footprint));
    });
    return placeableExpansions.map(expansion => expansion.townhallPosition);
  }
}
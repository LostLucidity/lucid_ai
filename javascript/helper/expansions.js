//@ts-check
"use strict"

const { townhallTypes } = require("@node-sc2/core/constants/groups");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { Alliance } = require('@node-sc2/core/constants/enums');

module.exports = {
  getAvailableExpansions: (resources) => {
    const {
      map,
      units
    } = resources.get();
    // get Expansion and filter by bases near townhall position.
    const allBases = units.getById(townhallTypes);
    const availableExpansions = map.getExpansions().filter(expansion => {
      const [ closestBase ] = units.getClosest(expansion.townhallPosition, allBases);
      if (closestBase) {
        return distance(expansion.townhallPosition, closestBase.pos) > 1;
      }
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
  getNextSafeExpansion: (units, expansions) => {
    // sort expansions by closest to enemy units
    if (units.getAlive(Alliance.ENEMY).length > 0) {
      expansions.sort((a, b) => {
        const [ closestEnemyToA ] = units.getClosest(a.townhallPosition, units.getAlive(Alliance.ENEMY));
        const [ closestEnemyToB ] = units.getClosest(b.townhallPosition, units.getAlive(Alliance.ENEMY));
        return distance(b.townhallPosition, closestEnemyToB.pos) - distance(a.townhallPosition, closestEnemyToA.pos);
      });
    }
    return expansions.shift();
  }
}
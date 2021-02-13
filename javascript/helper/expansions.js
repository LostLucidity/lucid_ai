//@ts-check
"use strict"

const { townhallTypes } = require("@node-sc2/core/constants/groups");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { Alliance } = require('@node-sc2/core/constants/enums');
const { getCombatRally } = require("./location");
const { TownhallRace } = require("@node-sc2/core/constants/race-map");

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
  getNextSafeExpansion: async (agent, resources, expansions) => {
    const { actions, map, units } = resources.get();
    const enemyStructures = units.getStructures(Alliance.ENEMY);
    if (enemyStructures.length > 0) {
      expansions.sort((a, b) => {
        const rallyPoint = getCombatRally(map, units);
        const [ closestEnemyToA ] = units.getClosest(a.townhallPosition, enemyStructures);
        const calculatedDistanceA = distance(a.townhallPosition, closestEnemyToA.pos) - distance(a.townhallPosition, rallyPoint);
        const [ closestEnemyToB ] = units.getClosest(b.townhallPosition, enemyStructures);
        const calculatedDistanceB = distance(b.townhallPosition, closestEnemyToB.pos) - distance(b.townhallPosition, rallyPoint);
        return calculatedDistanceB - calculatedDistanceA;
      });
    }
    const foundExpansion = expansions.find(async expansion => !!(await actions.canPlace(TownhallRace[agent.race][0], [expansion.townhallPosition])));
    return foundExpansion.townhallPosition;
  }
}
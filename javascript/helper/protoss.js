//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { PYLON, NEXUS, ASSIMILATOR } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const getRandom = require("@node-sc2/core/utils/get-random");
const { getCombatRally } = require("../services/resource-manager-service");
const { assignAndSendWorkerToBuild } = require("../services/world-service");
const { getOccupiedExpansions } = require("./expansions");
const { findPosition } = require("./placement/placement-helper");

module.exports = {
  /**
   * @param {World} world 
   * @returns 
   */
  restorePower: async (world) => {
    const { resources } = world;
    const { units } = resources.get();
    const collectedActions = [];
    const selfPowered = [NEXUS, PYLON, ASSIMILATOR];
    const unpoweredStructure = getRandom(units.getStructures().filter(structure => {
      const [closestPylon] = units.getClosest(structure.pos, units.getById(PYLON));
      return [
        !structure.isPowered,
        !selfPowered.includes(structure.unitType),
        structure.buildProgress >= 1,
        !closestPylon || distance(structure.pos, closestPylon.pos) > 6.5,
      ].every(condition => condition);
    }));
    if (unpoweredStructure) {
      const candidatePositions = gridsInCircle(unpoweredStructure.pos, 6.5 - unpoweredStructure.radius);
      const foundPosition = await findPosition(resources, unpoweredStructure.unitType, candidatePositions);
      if (foundPosition) {
        collectedActions.push(...assignAndSendWorkerToBuild(world, PYLON, foundPosition));
      }
    }
    return collectedActions;
  }
}
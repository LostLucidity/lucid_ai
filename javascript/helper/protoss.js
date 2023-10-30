//@ts-check
"use strict"

const { PYLON, NEXUS, ASSIMILATOR } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const getRandom = require("@node-sc2/core/utils/get-random");
const { PlacementService } = require("../src/services/placement");
const { prepareBuilderForConstruction } = require("../src/services/resource-management");
const { commandBuilderToConstruct } = require("../src/services/unit-commands/builder-commands");

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
      if (!structure.pos || !structure.unitType || !structure.buildProgress) return false;

      const [closestPylon] = units.getClosest(structure.pos, units.getById(PYLON));

      // Ensure closestPylon has a defined position
      if (!closestPylon || !closestPylon.pos) return true;

      return [
        !structure.isPowered,
        !selfPowered.includes(structure.unitType),
        structure.buildProgress >= 1,
        distance(structure.pos, closestPylon.pos) > 6.5,
      ].every(condition => condition);
    }));

    if (unpoweredStructure && unpoweredStructure.pos && unpoweredStructure.unitType !== undefined) {
      const candidateRadius = 6.5 - (unpoweredStructure.radius || 0);
      const candidatePositions = gridsInCircle(unpoweredStructure.pos, candidateRadius);

      const foundPosition = PlacementService.findPosition(world, unpoweredStructure.unitType, candidatePositions);

      if (foundPosition) {
        const builder = prepareBuilderForConstruction(world, PYLON, foundPosition);

        if (builder) {
          collectedActions.push(...commandBuilderToConstruct(world, builder, PYLON, foundPosition));
        }
      }
    }

    return collectedActions;
  }
}
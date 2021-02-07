//@ts-check
"use strict"

const { PYLON } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const getRandom = require("@node-sc2/core/utils/get-random");
const { workerSendOrBuild } = require("../helper");
const { findPosition } = require("./placement-helper");

module.exports = {
  restorePower: ({ data, resources }) => {
    const { actions, units } = resources.get();
    const collectedActions = [];
    const unpoweredStructure = getRandom(units.getStructures().filter(structure => !structure.isPowered));
    const candidatePositions = gridsInCircle(unpoweredStructure.pos, 6.5 - unpoweredStructure.radius);
    const foundPosition = findPosition(actions, unpoweredStructure.unitType, candidatePositions);
    collectedActions.push(...workerSendOrBuild(units, data.getUnitTypeData(PYLON).abilityId, foundPosition));
    return collectedActions;
  }
}
//@ts-check
"use strict"

const { structureTypes, twoByTwoUnits } = require("@node-sc2/core/utils/geometry/units");
const { addOnTypesMapping } = require("../../helper/groups");

const wallOffRampService = {
  /** @type {Point2D[]} */
  addOnPositions: [],
  /** @type {Point2D[]} */
  adjacentToRampGrids: [],
  /** @type {Point2D[]} */
  threeByThreePositions: [],
  /** @type {Point2D[]} */
  twoByTwoPositions: [],
  /**
   * @param {UnitTypeId} unitType
   * @returns {Point2D[]}
   */
  findWallOffPlacement: (unitType) => {
    const { threeByThreePositions, twoByTwoPositions, addOnPositions } = wallOffRampService;
    if (twoByTwoUnits.includes(unitType)) {
      return twoByTwoPositions;
    } else if (addOnTypesMapping.has(unitType)) {
      return addOnPositions;
    } else if (structureTypes.includes(unitType)) {
      return threeByThreePositions;
    } else {
      return [];
    }
  },
}

module.exports = wallOffRampService;
//@ts-check
"use strict"

/**
 * Placement Service
 * Contains functions related to unit and building placements, 
 * map interactions, and related utilities.
 */

const groupTypes = require("@node-sc2/core/constants/groups");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { Race } = require("@node-sc2/core/constants/enums");
const { UnitType } = require("@node-sc2/core/constants");
const getRandom = require("@node-sc2/core/utils/get-random");
const { createPoint2D } = require("@node-sc2/core/utils/geometry/point");
const expansionManagementService = require("../expansion-management/expansion-management-service");

class PlacementService {
  /**
   * Determines a valid position for a given unit type.
   * @param {World} world
   * @param {UnitTypeId} unitType
   * @param {Point3D[]} candidatePositions
   * @returns {false | Point2D}
   */
  static findPosition(world, unitType, candidatePositions) {
    const { gasMineTypes } = groupTypes;
    if (candidatePositions.length === 0) {
      candidatePositions = this.findPlacements(world, unitType);
    }
    const { agent, resources } = world;
    const { map } = resources.get();
    if (flyingTypesMapping.has(unitType)) {
      const baseUnitType = flyingTypesMapping.get(unitType);
      unitType = baseUnitType === undefined ? unitType : baseUnitType;
    }
    candidatePositions = candidatePositions.filter(position => {
      const footprint = getFootprint(unitType); if (footprint === undefined) return false;
      const unitTypeCells = cellsInFootprint(position, footprint);
      if (gasMineTypes.includes(unitType)) return isPlaceableAtGasGeyser(map, unitType, position);
      const isPlaceable = unitTypeCells.every(cell => {
        const isPlaceable = map.isPlaceable(cell);
        const needsCreep = agent.race === Race.ZERG && unitType !== UnitType.HATCHERY;
        const hasCreep = map.hasCreep(cell);
        return isPlaceable && (!needsCreep || hasCreep);
      });
      return isPlaceable;
    });
    const randomPositions = candidatePositions
      .map(pos => ({ pos, rand: Math.random() }))
      .sort((a, b) => a.rand - b.rand)
      .map(a => a.pos)
      .slice(0, 20);
    let foundPosition = getRandom(randomPositions);
    const unitTypeName = Object.keys(UnitType).find(type => UnitType[type] === unitType);
    if (foundPosition) console.log(`Found position for ${unitTypeName}`, foundPosition);
    else console.log(`Could not find position for ${unitTypeName}`);
    return foundPosition;
  }
}

module.exports = PlacementService;
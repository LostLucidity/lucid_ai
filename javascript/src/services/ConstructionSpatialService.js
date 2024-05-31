// src/core/services/ConstructionSpatialService.js

const { UnitType } = require("@node-sc2/core/constants");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");

const { getAddOnPlacement, getAddOnBuildingPlacement, existsInMap, pointsOverlap } = require("../gameLogic/pathfinding");
const spatialUtils = require('../gameLogic/spatialUtils');
const { canUnitBuildAddOn, flyingTypesMapping } = require("../units/management/unitConfig");
const { getStringNameOfConstant } = require("../utils/common");
const { getCurrentlyEnrouteConstructionGrids } = require("../utils/constructionDataUtils");
const { seigeTanksSiegedGrids } = require("../utils/sharedUnitPlacement");

/**
 * Service to manage spatial and construction-related functionalities.
 */
class ConstructionSpatialService {
  /**
   * Creates an instance of ConstructionSpatialService.
   * @param {typeof import("../gameLogic/spatialUtils")} spatialUtils Module with spatial utilities.
   */
  constructor(spatialUtils) {
    this.spatialUtils = spatialUtils;
  }

  /**
   * @param {World} world 
   * @param {Unit} building 
   * @param {UnitTypeId} addOnType 
   * @returns {Point2D | undefined}
   */
  checkAddOnPlacement(world, building, addOnType = UnitType.REACTOR) {
    const { REACTOR, TECHLAB } = UnitType;
    const { resources } = world;
    const { map, units } = resources.get();
    const { unitType, pos } = building;

    // Ensure unitType and pos are defined
    if (unitType === undefined || pos === undefined) {
      console.error("checkAddOnPlacement: Missing unit type or position.");
      return;
    }

    if (canUnitBuildAddOn(unitType)) {
      let position = null;
      let addOnPosition = null;
      let range = 1;

      do {
        const nearPoints = gridsInCircle(getAddOnPlacement(pos), range).filter(grid => {
          const addOnFootprint = getFootprint(addOnType);
          if (!addOnFootprint) return false; // Ensure addOnFootprint is defined

          const addOnBuildingPlacementsForOrphanAddOns = units.getStructures(Alliance.SELF).reduce((/** @type {Point2D[]} */acc, structure) => {
            if (typeof structure.unitType === 'number' && [REACTOR, TECHLAB].includes(structure.unitType) && structure.pos) {
              return [...acc, ...cellsInFootprint(getAddOnBuildingPlacement(structure.pos), { h: 3, w: 3 })];
            }
            return acc;
          }, []);

          const getBuildingAndAddOnPlacement = [
            ...cellsInFootprint(grid, addOnFootprint),
            ...cellsInFootprint(getAddOnBuildingPlacement(grid), { h: 3, w: 3 })
          ];

          return [
            existsInMap(map, grid) && map.isPlaceableAt(addOnType, grid) && map.isPlaceableAt(flyingTypesMapping.get(unitType) || unitType, getAddOnBuildingPlacement(grid)),
            !pointsOverlap(getBuildingAndAddOnPlacement, [...seigeTanksSiegedGrids, ...addOnBuildingPlacementsForOrphanAddOns]),
          ].every(condition => condition);
        });
        if (nearPoints.length > 0) {
          if (Math.random() < (1 / 2)) {
            addOnPosition = nearPoints[Math.floor(Math.random() * nearPoints.length)];
            console.log(`isPlaceableAt for ${getStringNameOfConstant(UnitType, addOnType)}`, addOnPosition);
            position = getAddOnBuildingPlacement(addOnPosition);
            console.log(`isPlaceableAt for ${getStringNameOfConstant(UnitType, building.unitType)}`, position);
          } else {
            addOnPosition = this.findPosition(world, addOnType, nearPoints);
            if (addOnPosition) {
              if (typeof building.unitType === 'number') {
                position = this.findPosition(world, building.unitType, [getAddOnBuildingPlacement(addOnPosition)]);
              } else {
                console.error('checkAddOnPlacement: building.unitType is undefined');
              }
            }
          }
        }
        range++
      } while (!position || !addOnPosition);
      return position;
    } else {
      return;
    }
  }

  /**
   * Finds the position for a unit based on construction grids.
   * @param {World} world - The world context.
   * @param {UnitTypeId} unitType - The type of unit.
   * @param {Point3D[]} candidatePositions - List of candidate positions.
   * @returns {false | Point2D} The calculated position.
   */
  findPosition(world, unitType, candidatePositions) {
    // Use spatialUtils with additional logic if needed
    return this.spatialUtils.findPosition(world, unitType, candidatePositions);
  }

  /**
   * Retrieves currently en route construction grids.
   * @param {World} world The game world context.
   * @returns {any} The currently en route construction grids.
   */
  static getConstructionGrids(world) {
    // Directly access construction grids data
    return getCurrentlyEnrouteConstructionGrids(world);
  }
}

const service = new ConstructionSpatialService(spatialUtils);
module.exports = service;

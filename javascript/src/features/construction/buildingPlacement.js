//@ts-check
"use strict";

// buildingPlacement.js

// External library imports

/** @type {import('../../core/utils/common').UnitTypeMap} */
const UnitType = require('@node-sc2/core/constants').UnitType;
const groupTypes = require('@node-sc2/core/constants/groups');
const { gridsInCircle } = require('@node-sc2/core/utils/geometry/angle');
const { cellsInFootprint } = require('@node-sc2/core/utils/geometry/plane');
const { createPoint2D, getNeighbors, avgPoints } = require('@node-sc2/core/utils/geometry/point');
const { getFootprint, twoByTwoUnits } = require('@node-sc2/core/utils/geometry/units');
const { frontOfGrid } = require('@node-sc2/core/utils/map/region');

// Internal module imports
const { calculateDistance } = require('../../gameLogic/coreUtils');
const {
  getAdjacentToRampGrids,
  intersectionOfPoints,
  getBuildingAndAddonGrids,
  isBuildingAndAddonPlaceable,
  getAddOnPlacement,
  getAddOnBuildingPlacement,
} = require('../../gameLogic/pathfinding');
const { getClosestPosition } = require('../../gameLogic/pathfindingCommon');
const { getDistance } = require('../../gameLogic/spatialCoreUtils');
const { buildingPositions } = require('../../gameState');
const { addOnTypesMapping } = require('../../units/management/unitConfig');
const StrategyContext = require('../strategy/strategyContext');

const PYLON_POWER_RANGE = 6.5;

class BuildingPlacement {
  /** @type {Point2D[]} */
  static addOnPositions = [];

  static functionMappings = {
    "getAddOnBuildingPosition": BuildingPlacement.getAddOnBuildingPosition,
    "setAddOnWallOffPosition": BuildingPlacement.setAddOnWallOffPosition,
    // ... other mappings
  };

  /** @type {Point2D[]} */
  static wall = [];

  /** @type {Point2D | null} */
  static pylonPlacement = null;

  /** @type {Point2D[]} */
  static threeByThreePositions = [];

  /** @type {Point2D[]} */
  static twoByTwoPositions = [];

  /**
   * Private static property to hold the found position.
   * @type {Point2D | null}
   */
  static #foundPosition = null;

  /** @type {false | Point2D | undefined} */
  static get buildingPosition() {
    const position = buildingPositions.get(StrategyContext.getInstance().getCurrentStep());
    return position !== undefined ? position : undefined;
  }

  /**
   * Sets the building position for the current step.
   * @param {false | Point2D} value
   */
  static set buildingPosition(value) {
    const strategyContext = StrategyContext.getInstance();
    if (value) {
      buildingPositions.set(strategyContext.getCurrentStep(), value);
    } else {
      buildingPositions.delete(strategyContext.getCurrentStep());
    }
  }

  /**
   * Calculates and sets the wall-off positions.
   * @param {World} world - The world context containing map and other game info.
   */
  static calculateWallOffPositions(world) {
    const map = world.resources.get().map;
    BuildingPlacement.setWallOffRampPlacements(map);
  }

  /**
   * @type {{ [key: string]: (...args: any[]) => any }}
   */
  static get functionMappingsWithSignature() {
    return {
      "getNaturalWallPylon": BuildingPlacement.getNaturalWallPylon,
      "getAddOnBuildingPosition": BuildingPlacement.getAddOnBuildingPosition,
      "setAddOnWallOffPosition": BuildingPlacement.setAddOnWallOffPosition,
    };
  }

  /**
   * Calculates the building position for an add-on.
   * @param {Point2D} position - The position to calculate from.
   * @returns {Point2D | undefined} - The calculated position for the add-on building, or undefined if input is invalid.
   */
  static getAddOnBuildingPosition(position) {
    if (typeof position.x === 'number' && typeof position.y === 'number') {
      return { x: position.x - 2.5, y: position.y + 0.5 };
    } else {
      console.error("Invalid position provided to getAddOnBuildingPosition:", position);
      return undefined;
    }
  }

  /**
   * Retrieves candidate positions for building based on provided criteria.
   * @param {ResourceManager} resources
   * @param {Point2D[] | string} positions
   * @param {UnitTypeId | null} [unitType=null]
   * @returns {Point2D[]}
   */
  static getCandidatePositions(resources, positions, unitType = null) {
    if (typeof positions === 'string') {
      const functionName = `get${positions}`;
      const mappedFunction = BuildingPlacement.functionMappingsWithSignature[functionName];
      if (typeof mappedFunction === 'function') {
        return mappedFunction(resources, unitType);
      } else {
        throw new Error(`Function "${functionName}" does not exist in BuildingPlacement`);
      }
    } else {
      return positions;
    }
  }

  /**
   * Checks if the Pylon is in range and powered for the given positions.
   * @param {Unit} pylon The Pylon unit to check.
   * @param {Point2D[]} candidatePositions The positions to check against.
   * @returns {boolean} True if the Pylon is in range and powered, false otherwise.
   */
  static isPylonInRangeAndPowered(pylon, candidatePositions) {
    if (!pylon.pos) return false;

    const { pos } = pylon;
    if (pos.x === undefined || pos.y === undefined) return false;

    return candidatePositions.some(position => {
      const distance = calculateDistance(pos, position);
      return distance <= PYLON_POWER_RANGE && pylon.isPowered;
    });
  }

  /**
   * Sets the add-on wall-off position based on the map layout.
   * @param {MapResource} map - The map resource for analyzing placement.
   */
  static setAddOnWallOffPosition(map) {
    const middleOfAdjacentGrids = avgPoints(getAdjacentToRampGrids());
    const footprint = getFootprint(UnitType.SUPPLYDEPOT);
    if (!footprint) return;
    const twoByTwoPlacements = BuildingPlacement.twoByTwoPositions
      .flatMap(grid => cellsInFootprint(grid, footprint));
    const middleOfAdjacentGridCircle = gridsInCircle(middleOfAdjacentGrids, 3)
      .filter(grid => !twoByTwoPlacements.some(placement => placement.x === grid.x && placement.y === grid.y));
    let closestPlaceableGrids = getClosestPosition(middleOfAdjacentGrids, middleOfAdjacentGridCircle)
      .filter(grid => intersectionOfPoints(twoByTwoPlacements, getBuildingAndAddonGrids(grid, UnitType.BARRACKS)).length === 0 && isBuildingAndAddonPlaceable(map, UnitType.BARRACKS, grid));
    const [closestRamp] = getClosestPosition(middleOfAdjacentGrids, middleOfAdjacentGridCircle.filter(grid => map.isRamp(grid)));
    if (closestRamp) {
      closestPlaceableGrids = closestPlaceableGrids.map(grid => {
        return getDistance(grid, closestRamp) < getDistance(getAddOnPlacement(grid), closestRamp)
          ? grid
          : getAddOnPlacement(grid);
      });
      const [closestPlaceableToRamp] = getClosestPosition(closestRamp, closestPlaceableGrids);
      if (closestPlaceableToRamp) {
        const position = intersectionOfPoints(BuildingPlacement.twoByTwoPositions, getBuildingAndAddonGrids(closestPlaceableToRamp, UnitType.BARRACKS)).length === 0 && isBuildingAndAddonPlaceable(map, UnitType.BARRACKS, closestPlaceableToRamp)
          ? closestPlaceableToRamp
          : getAddOnBuildingPlacement(closestPlaceableToRamp);
        BuildingPlacement.addOnPositions = [position];
      }
    }
  }

  /**
   * Sets three-by-three building placements based on the map.
   * @param {MapResource} map - The map resource for analyzing placement.
   */
  static setThreeByThreePlacements(map) {
    BuildingPlacement.setAddOnWallOffPosition(map);
    BuildingPlacement.setThreeByThreePosition(map);
  }

  /**
   * Sets specific three-by-three building placements on the map.
   * @param {MapResource} map - The map resource for analysis and placement.
   */
  static setThreeByThreePosition(map) {
    const middleOfAdjacentGrids = avgPoints(getAdjacentToRampGrids());
    const footprint = getFootprint(UnitType.SUPPLYDEPOT);
    if (!footprint) return;
    const twoByTwoPlacements = BuildingPlacement.twoByTwoPositions
      .flatMap(grid => cellsInFootprint(grid, footprint));
    const middleOfAdjacentGridCircle = gridsInCircle(middleOfAdjacentGrids, 3)
      .filter(grid => !twoByTwoPlacements.some(placement => placement.x === grid.x && placement.y === grid.y));
    let closestPlaceableGrids = getClosestPosition(middleOfAdjacentGrids, middleOfAdjacentGridCircle)
      .filter(grid => {
        const footprint = getFootprint(UnitType.ENGINEERINGBAY);
        if (!footprint) return false;
        return intersectionOfPoints(twoByTwoPlacements, cellsInFootprint(grid, footprint)).length === 0 && map.isPlaceableAt(UnitType.ENGINEERINGBAY, grid);
      });
    const [closestRamp] = getClosestPosition(middleOfAdjacentGrids, middleOfAdjacentGridCircle.filter(grid => map.isRamp(grid)));
    if (closestRamp) {
      const [closestPlaceableToRamp] = getClosestPosition(closestRamp, closestPlaceableGrids);
      if (closestPlaceableToRamp) {
        BuildingPlacement.threeByThreePositions = [closestPlaceableToRamp];
      }
    }
  }

  /**
   * Sets two-by-two building placements based on the map.
   * @param {MapResource} map - The map resource for analyzing placement.
   */
  static setTwoByTwoPlacements(map) {
    const placeableGrids = getAdjacentToRampGrids().filter(grid => map.isPlaceable(grid));
    const cornerGrids = placeableGrids.filter(grid => intersectionOfPoints(gridsInCircle(grid, 1).filter(point => getDistance(point, grid) <= 1), placeableGrids).length === 2);
    cornerGrids.forEach(cornerGrid => {
      const cornerGridCircle = gridsInCircle(cornerGrid, 3);
      let closestPlaceableGrids = getClosestPosition(cornerGrid, cornerGridCircle)
        .filter(grid => map.isPlaceableAt(UnitType.SUPPLYDEPOT, grid));
      const [closestRamp] = getClosestPosition(cornerGrid, cornerGridCircle.filter(grid => map.isRamp(grid)));
      if (closestRamp) {
        const [closestPlaceableToRamp] = getClosestPosition(closestRamp, closestPlaceableGrids);
        if (closestPlaceableToRamp) {
          BuildingPlacement.twoByTwoPositions.push(closestPlaceableToRamp);
        }
      }
    });
  }

  /**
   * Sets wall-off placements on the map.
   * @param {MapResource} map - The map resource to analyze for wall-off placements.
   */
  static setWallOffRampPlacements(map) {
    BuildingPlacement.setTwoByTwoPlacements(map);
    BuildingPlacement.setThreeByThreePlacements(map);
  }

  /**
   * Updates the found position.
   * @param {Point2D | null} newPosition - The new position to set.
   */
  static updateFoundPosition(newPosition) {
    BuildingPlacement.#foundPosition = newPosition;
  }

  /**
   * Retrieves the currently found position.
   * @returns {Point2D | null} - The found position.
   */
  static getFoundPosition() {
    return BuildingPlacement.#foundPosition;
  }

  /**
   * @param {ResourceManager} resources
   * @returns {Promise<Point2D[]>}
   */
  static async getByMainRamp(resources) {
    const { map } = resources.get();
    const main = map.getMain();

    if (!main || !main.areas) {
      return [];
    }

    const getMainPositionsByRamp = main.areas.areaFill.filter(point =>
      getNeighbors(point).some(neighbor => map.isRamp(neighbor))
    );

    const pathableMainAreas = main.areas.areaFill.filter(point =>
      map.isPathable(point) && getDistance(avgPoints(getMainPositionsByRamp), point) <= 8
    );

    return pathableMainAreas;
  }

  /**
   * Finds positions where a given unit type can be placed.
   * @param {Point2D[]} candidates - Candidate positions for placement.
   * @param {MapResource} map - The map resource.
   * @param {UnitTypeId} unitType - The type of unit to place.
   * @returns {Point2D[]} - An array of placeable positions.
   */
  static getPlaceableAtPositions(candidates, map, unitType) {
    const filteredCandidates = candidates.filter(position => map.isPlaceableAt(unitType, position));

    if (filteredCandidates.length === 0) {
      const expandedCandidates = candidates.flatMap(candidate => [candidate, ...getNeighbors(candidate)])
        .filter((candidate, index, self) =>
          self.findIndex(selfCandidate => selfCandidate.x === candidate.x && selfCandidate.y === candidate.y) === index
        );

      return expandedCandidates.length > 0
        ? BuildingPlacement.getPlaceableAtPositions(expandedCandidates, map, unitType)
        : [];
    } else {
      return filteredCandidates;
    }
  }

  /**
   * Retrieves middle positions of a natural wall for a specific unit type.
   * @param {ResourceManager} resources 
   * @param {UnitTypeId} unitType 
   * @returns {Point2D[]}
   */
  static getMiddleOfNaturalWall(resources, unitType) {
    const { map } = resources.get();
    const naturalWall = map.getNatural().getWall() || BuildingPlacement.wall;
    /** @type {Point2D[]} */
    let candidates = [];

    if (naturalWall) {
      let wallPositions = BuildingPlacement.getPlaceableAtPositions(naturalWall, map, unitType)
        .filter(point => map.isPlaceableAt(unitType, point));
      candidates = getClosestPosition(avgPoints(wallPositions), wallPositions, 2);
    }

    return candidates;
  }

  /**
   * @typedef {Object} ExtendedPoint2D
   * @property {number} x - The x-coordinate.
   * @property {number} y - The y-coordinate.
   * @property {number} coverage - Coverage property, always a number.
   */

  /**
   * Retrieves natural wall pylon positions.
   * @param {ResourceManager} resources
   * @returns {ExtendedPoint2D[]}
   */
  static getNaturalWallPylon(resources) {
    const { map } = resources.get();
    const naturalExpansion = map.getNatural();

    if (!naturalExpansion || !naturalExpansion.areas) {
      return [];
    }

    const naturalWall = BuildingPlacement.wall.length > 0 ? BuildingPlacement.wall : naturalExpansion.getWall();
    if (!naturalWall) {
      return BuildingPlacement.pylonPlacement ? [{ x: BuildingPlacement.pylonPlacement.x || 0, y: BuildingPlacement.pylonPlacement.y || 0, coverage: 0 }] : [];
    }

    const naturalTownhallPosition = naturalExpansion.townhallPosition;

    const possiblePlacements = frontOfGrid(resources, naturalExpansion.areas.areaFill)
      .map(point => {
        const coverage = naturalWall.filter(wallCell =>
          getDistance(wallCell, point) <= 6.5 &&
          getDistance(wallCell, point) >= 1 &&
          getDistance(wallCell, naturalTownhallPosition) > getDistance(point, naturalTownhallPosition)
        ).length;

        return { x: point.x || 0, y: point.y || 0, coverage };
      });

    return possiblePlacements
      .sort((a, b) => b.coverage - a.coverage)
      .filter((cell, i, arr) => cell.coverage === arr[0].coverage);
  }

  /**
   * Retrieves positions near mineral lines.
   * @param {ResourceManager} resources
   * @returns {Point2D[]}
   */
  static getMineralLines(resources) {
    const { map, units } = resources.get();
    const occupiedExpansions = map.getOccupiedExpansions();
    /** @type {Point2D[]} */
    const mineralLineCandidates = [];

    occupiedExpansions.forEach(expansion => {
      const [base] = units.getClosest(expansion.townhallPosition, units.getBases());
      if (base) {
        mineralLineCandidates.push(...gridsInCircle(avgPoints([...expansion.cluster.mineralFields.map(field => field.pos), base.pos]), 0.6));
      }
    });

    return mineralLineCandidates;
  }

  /**
   * Extracts the unit type from the action property.
   * @param {string} action - The action string from the plan step.
   * @returns {number | null} The extracted unit type ID or null if not found.
   */
  static extractUnitTypeFromAction(action) {
    if (!action || typeof action !== 'string') return null;

    const actionSegments = action.split(',');
    for (const segment of actionSegments) {
      const cleanedSegment = segment.trim().replace(/\s+\(.*?\)|\sx\d+/g, '').toUpperCase().replace(/\s+/g, '');
      if (cleanedSegment in UnitType) {
        return UnitType[cleanedSegment];
      }
    }
    return null;
  }

  /**
   * Finds placement for wall-off structures based on the unit type.
   * @param {UnitTypeId} unitType
   * @returns {Point2D[]}
   */
  static findWallOffPlacement(unitType) {
    if (twoByTwoUnits.includes(unitType)) {
      return BuildingPlacement.twoByTwoPositions;
    } else if (addOnTypesMapping.has(unitType)) {
      return BuildingPlacement.addOnPositions;
    } else if (groupTypes.structureTypes.includes(unitType)) {
      return BuildingPlacement.threeByThreePositions;
    } else {
      return [];
    }
  }

  /**
   * Calculates the middle position of a structure's footprint.
   * @param {Point2D} position - The starting position for the building.
   * @param {UnitTypeId} unitType - The type of the building.
   * @returns {Point2D} - The middle position of the structure's footprint.
   */
  static getMiddleOfStructure(position, unitType) {
    const { gasMineTypes } = groupTypes;
    if (gasMineTypes.includes(unitType)) return position;

    const point2D = createPoint2D(position);
    let { x, y } = point2D;
    if (x === undefined || y === undefined) return position;

    const footprint = getFootprint(unitType);
    if (!footprint) return position;

    if (footprint.h % 2 === 1) {
      x += 0.5;
      y += 0.5;
    }
    return { x, y };
  }

  /**
   * Sets the building position for a specific unit type.
   * @param {UnitTypeId} unitType
   * @param {Point2D | false} position
   */
  static setBuildingPosition(unitType, position) {
    const strategyContext = StrategyContext.getInstance();
    const currentStep = strategyContext.getCurrentStep();
    const currentStrategy = strategyContext.getCurrentStrategy();

    if (!currentStrategy) {
      console.error('Current strategy is undefined.');
      return;
    }

    const currentPlan = currentStrategy.steps;
    if (currentPlan.length === 0) return;

    const planUnitType = BuildingPlacement.extractUnitTypeFromAction(currentPlan[currentStep].action);
    if (planUnitType !== unitType) {
      BuildingPlacement.buildingPosition = BuildingPlacement.buildingPosition || false;
    } else if (!BuildingPlacement.buildingPosition || !position || !deepEqual(BuildingPlacement.buildingPosition, position)) {
      BuildingPlacement.buildingPosition = position;
    }
  }
}

module.exports = BuildingPlacement;

/**
 * Deep compares two objects.
 * @param {Object} obj1 
 * @param {Object} obj2 
 * @returns {boolean} - True if objects are equal, false otherwise.
 */
function deepEqual(obj1, obj2) {
  return JSON.stringify(obj1) === JSON.stringify(obj2);
}

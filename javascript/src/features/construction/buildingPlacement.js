//@ts-check
"use strict";

// External library imports
const UnitType = require('@node-sc2/core/constants').UnitType;
const groupTypes = require('@node-sc2/core/constants/groups');
const { gridsInCircle } = require('@node-sc2/core/utils/geometry/angle');
const { cellsInFootprint } = require('@node-sc2/core/utils/geometry/plane');
const { createPoint2D, getNeighbors, avgPoints } = require('@node-sc2/core/utils/geometry/point');
const { getFootprint, twoByTwoUnits } = require('@node-sc2/core/utils/geometry/units');
const { frontOfGrid } = require('@node-sc2/core/utils/map/region');

// Internal module imports
const { buildingPositions } = require('../../state');
const { addOnTypesMapping } = require('../../units/management/unitConfig');
const { calculateDistance } = require('../../utils/coreUtils');
const { getDistance } = require('../../utils/spatialCoreUtils');
const {
  getAdjacentToRampGrids,
  intersectionOfPoints,
  getBuildingAndAddonGrids,
  isBuildingAndAddonPlaceable,
  getAddOnPlacement,
  getAddOnBuildingPlacement,
} = require('../shared/pathfinding/pathfinding');
const { getClosestPosition } = require('../shared/pathfinding/pathfindingCommonUtils');
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
   * Retrieves the unitType and the stored position for the current step.
   * @returns {{ unitType: UnitTypeId | null, position: Point2D | null }} - The unitType and position for the current step.
   */
  static getCurrentStepUnitTypeAndPosition() {
    const strategyContext = StrategyContext.getInstance();
    const currentStep = strategyContext.getCurrentStep();
    const currentStrategy = strategyContext.getCurrentStrategy();

    if (!currentStrategy) {
      console.error('Current strategy is undefined.');
      return { unitType: null, position: null };
    }

    const currentPlan = currentStrategy.steps;
    if (currentPlan.length === 0) {
      console.error('Current plan is empty.');
      return { unitType: null, position: null };
    }

    const currentAction = currentPlan[currentStep]?.action;
    if (!currentAction) {
      console.error(`No action found for step ${currentStep}.`);
      return { unitType: null, position: null };
    }

    const unitType = BuildingPlacement.extractUnitTypeFromAction(currentAction);
    const position = BuildingPlacement.buildingPosition || null;

    return { unitType, position };
  }

  /**
   * Calculates and sets the wall-off positions.
   * @param {World} world - The world context containing map and other game info.
   */
  static calculateWallOffPositions(world) {
    if (!world || !world.resources) {
      console.error("Invalid world object provided to calculateWallOffPositions:", world);
      return;
    }
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
    if (position && typeof position.x === 'number' && typeof position.y === 'number') {
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
    } else if (Array.isArray(positions)) {
      return positions;
    } else {
      console.error("Invalid positions provided to getCandidatePositions:", positions);
      return [];
    }
  }

  /**
   * Checks if the Pylon Unit is in range for the given position.
   * @param {Unit} pylon The Pylon unit to check.
   * @param {Point2D} position The position to check against.
   * @returns {boolean} True if the Pylon is in range, false otherwise.
   */
  static isPylonUnitInRange(pylon, position) {
    if (!pylon || !pylon.pos || typeof pylon.pos.x !== 'number' || typeof pylon.pos.y !== 'number' ||
      !position || typeof position.x !== 'number' || typeof position.y !== 'number') {
      console.error("Invalid Pylon Unit or position provided to isPylonUnitInRange:", pylon, position);
      return false;
    }

    const distance = calculateDistance(pylon.pos, position);
    return distance <= PYLON_POWER_RANGE;
  }

  /**
   * Checks if the Pylon Point2D is in range for the given position.
   * @param {Point2D} pylon The Pylon position (Point2D) to check.
   * @param {Point2D} position The position to check against.
   * @returns {boolean} True if the Pylon is in range, false otherwise.
   */
  static isPylonPointInRange(pylon, position) {
    if (!pylon || typeof pylon.x !== 'number' || typeof pylon.y !== 'number' ||
      !position || typeof position.x !== 'number' || typeof position.y !== 'number') {
      console.error("Invalid Pylon Point2D or position provided to isPylonPointInRange:", pylon, position);
      return false;
    }

    const distance = calculateDistance(pylon, position);
    return distance <= PYLON_POWER_RANGE;
  }

  /**
   * Sets the add-on wall-off position based on the map layout.
   * @param {MapResource} map - The map resource for analyzing placement.
   */
  static setAddOnWallOffPosition(map) {
    if (!map) {
      console.error("Invalid map provided to setAddOnWallOffPosition:", map);
      return;
    }

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
    if (!map) {
      console.error("Invalid map provided to setThreeByThreePlacements:", map);
      return;
    }

    BuildingPlacement.setAddOnWallOffPosition(map);
    BuildingPlacement.setThreeByThreePosition(map);
  }

  /**
   * Sets specific three-by-three building placements on the map.
   * @param {MapResource} map - The map resource for analysis and placement.
   */
  static setThreeByThreePosition(map) {
    if (!map) {
      console.error("Invalid map provided to setThreeByThreePosition:", map);
      return;
    }

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
    if (!map) {
      console.error("Invalid map provided to setTwoByTwoPlacements:", map);
      return;
    }

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
    if (!map) {
      console.error("Invalid map provided to setWallOffRampPlacements:", map);
      return;
    }

    BuildingPlacement.setTwoByTwoPlacements(map);
    BuildingPlacement.setThreeByThreePlacements(map);
  }

  /**
   * Updates the found position.
   * @param {Point2D | null} newPosition - The new position to set.
   */
  static updateFoundPosition(newPosition) {
    if (newPosition && typeof newPosition.x === 'number' && typeof newPosition.y === 'number') {
      BuildingPlacement.#foundPosition = newPosition;
    } else {
      console.error("Invalid newPosition provided to updateFoundPosition:", newPosition);
    }
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
    if (!resources || !resources.get) {
      console.error("Invalid resources provided to getByMainRamp:", resources);
      return [];
    }

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
    if (!Array.isArray(candidates) || !map || !unitType) {
      console.error("Invalid input provided to getPlaceableAtPositions:", candidates, map, unitType);
      return [];
    }

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
    if (!resources || !unitType) {
      console.error("Invalid input provided to getMiddleOfNaturalWall:", resources, unitType);
      return [];
    }

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
    if (!resources || !resources.get) {
      console.error("Invalid resources provided to getNaturalWallPylon:", resources);
      return [];
    }

    const { map } = resources.get();
    const naturalExpansion = map.getNatural();

    if (!naturalExpansion || !naturalExpansion.areas) {
      return [];
    }

    // Check for the wall placement first
    const naturalWall = BuildingPlacement.wall.length > 0 ? BuildingPlacement.wall : naturalExpansion.getWall();

    // If we have a wall, check for pylon placement
    if (BuildingPlacement.pylonPlacement) {
      return [{
        x: BuildingPlacement.pylonPlacement.x || 0,
        y: BuildingPlacement.pylonPlacement.y || 0,
        coverage: 0
      }];
    }

    // If there's no wall or pylon placement, return calculated pylon positions based on the wall
    if (naturalWall) {
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

    // Fallback: if no wall or pylon placement, return empty array
    return [];
  }

  /**
   * Retrieves positions near mineral lines.
   * @param {ResourceManager} resources
   * @returns {Point2D[]}
   */
  static getMineralLines(resources) {
    if (!resources || !resources.get) {
      console.error("Invalid resources provided to getMineralLines:", resources);
      return [];
    }

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
    if (!action || typeof action !== 'string') {
      console.error("Invalid action provided to extractUnitTypeFromAction:", action);
      return null;
    }

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
    if (!unitType) {
      console.error("Invalid unitType provided to findWallOffPlacement:", unitType);
      return [];
    }

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
    if (!position || typeof position.x !== 'number' || typeof position.y !== 'number' || !unitType) {
      console.error("Invalid input provided to getMiddleOfStructure:", position, unitType);
      return position;
    }

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
    if (!unitType) {
      console.error("Invalid unitType provided to setBuildingPosition:", unitType);
      return;
    }

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

  /**
   * Retrieves the planned PYLON positions.
   * This function will extract positions of planned PYLONs from the building plan or similar source.
   * @returns {Point2D[]} - Array of planned PYLON positions.
   */
  static getPlannedPylonPositions() {
    const strategyContext = StrategyContext.getInstance();
    const currentStrategy = strategyContext.getCurrentStrategy();

    if (!currentStrategy) {
      console.error('Current strategy is undefined or null.');
      return [];
    }

    const currentPlan = currentStrategy.steps;

    return Array.from(buildingPositions.entries()).reduce(
      /**
       * @param {Point2D[]} acc - The accumulator that collects planned PYLON positions.
       * @param {[number, Point2D]} entry - The step (key as number) and position (value as Point2D) from buildingPositions.
       * @returns {Point2D[]} - The updated accumulator with PYLON positions.
       */
      (acc, [step, position]) => {
        const currentAction = currentPlan[step]?.action;
        const unitType = BuildingPlacement.extractUnitTypeFromAction(currentAction);

        if (unitType === UnitType.PYLON) {
          acc.push(position);
        }

        return acc;
      },
    /** @type {Point2D[]} */[]
    );
  }
}

module.exports = BuildingPlacement;

/**
 * Deep compares two objects.
 * @param {{ [key: string]: any }} obj1 - The first object to compare.
 * @param {{ [key: string]: any }} obj2 - The second object to compare.
 * @returns {boolean} - True if objects are equal, false otherwise.
 */
function deepEqual(obj1, obj2) {
  if (obj1 === obj2) return true;
  if (typeof obj1 !== 'object' || typeof obj2 !== 'object' || obj1 === null || obj2 === null) return false;

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) return false;

  for (const key of keys1) {
    if (!keys2.includes(key) || !deepEqual(obj1[key], obj2[key])) return false;
  }

  return true;
}

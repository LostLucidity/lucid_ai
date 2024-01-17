//@ts-check
"use strict"

// buildingPlacement.js


// External library imports

/** @type {import('../common').UnitTypeMap} */
const UnitType = require('@node-sc2/core/constants').UnitType;
const { Race, Alliance } = require('@node-sc2/core/constants/enums');
const groupTypes = require('@node-sc2/core/constants/groups');
const { gridsInCircle } = require('@node-sc2/core/utils/geometry/angle');
const { cellsInFootprint } = require('@node-sc2/core/utils/geometry/plane');
const { createPoint2D, getNeighbors, avgPoints } = require('@node-sc2/core/utils/geometry/point');
const { getFootprint, twoByTwoUnits } = require('@node-sc2/core/utils/geometry/units');
const getRandom = require('@node-sc2/core/utils/get-random');
const { frontOfGrid } = require('@node-sc2/core/utils/map/region');

// Internal module imports
const { getCurrentlyEnrouteConstructionGrids } = require('./buildingCommons');
const config = require('../../config/config');
const StrategyManager = require('../buildOrders/strategy/strategyManager');
const GameState = require('../gameState');
const { buildingPositions } = require('../gameStateResources');
const { getDistance, getClosestPosition, intersectionOfPoints } = require('../geometryUtils');
const MapResources = require('../mapResources');
const { getOccupiedExpansions, existsInMap, pointsOverlap, getAdjacentToRampGrids } = require('../mapUtils');
const { getAddOnPlacement, getAddOnBuildingPlacement, getBuildingFootprintOfOrphanAddons, findZergPlacements, getBuildingAndAddonGrids, isBuildingAndAddonPlaceable } = require('../placementUtils');
const { getBuildTimeLeft } = require('../sharedUtils');
const { flyingTypesMapping, canUnitBuildAddOn, addOnTypesMapping } = require('../unitConfig');
const { getTimeInSeconds, isPlaceableAtGasGeyser } = require('../utils');
const { calculateDistance } = require('../utils/coreUtils');

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
    // Attempt to retrieve the position for the current step
    const strategyManager = StrategyManager.getInstance();
    const position = buildingPositions.get(strategyManager.getCurrentStep());
    // Return the position if it exists, or undefined otherwise
    return position !== undefined ? position : undefined;
  }

  /**
   * Sets the building position for the current step.
   * @param {false | Point2D} value
   */
  static set buildingPosition(value) {
    const strategyManager = StrategyManager.getInstance();
    if (value) {
      // If value is a valid position, set it for the current step
      buildingPositions.set(strategyManager.getCurrentStep(), value);
    } else {
      // If value is false, remove the entry for the current step
      buildingPositions.delete(strategyManager.getCurrentStep());
    }
  }

  /**
   * Calculates and sets the wall-off positions.
   * @param {World} world - The world context containing map and other game info.
   */
  static calculateWallOffPositions(world) {
    // Assuming setWallOffRampPlacements requires map as an argument
    const map = world.resources.get().map;

    // Call existing logic to set wall-off placements
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
    // Check if both x and y coordinates are defined
    if (typeof position.x === 'number' && typeof position.y === 'number') {
      // Adjust the x and y coordinates as needed
      return { x: position.x - 2.5, y: position.y + 0.5 };
    } else {
      // Handle the case where x or y is undefined
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
    if (!pylon.pos) {
      // If pylon position is undefined, return false as we cannot calculate distance
      return false;
    }

    for (const position of candidatePositions) {
      const distance = calculateDistance(pylon.pos, position);
      if (distance <= PYLON_POWER_RANGE && pylon.isPowered) {
        return true; // Pylon is in range and powered for this position
      }
    }
    return false; // No candidate positions are in range of a powered Pylon
  }  

  /**
   * Sets the add-on wall-off position based on the map layout.
   * @param {MapResource} map - The map resource for analyzing placement.
   */
  static setAddOnWallOffPosition(map) {
    const middleOfAdjacentGrids = avgPoints(getAdjacentToRampGrids());
    const footprint = getFootprint(UnitType.SUPPLYDEPOT);
    if (footprint === undefined) return;
    const twoByTwoPlacements = BuildingPlacement.twoByTwoPositions.map(grid => cellsInFootprint(grid, footprint)).flat();
    const middleOfAdjacentGridCircle = gridsInCircle(middleOfAdjacentGrids, 3).filter(grid => ![...twoByTwoPlacements].some(placement => placement.x === grid.x && placement.y === grid.y));
    let closestPlaceableGrids = getClosestPosition(middleOfAdjacentGrids, middleOfAdjacentGridCircle, middleOfAdjacentGridCircle.length).filter(grid => {
      return intersectionOfPoints(twoByTwoPlacements, getBuildingAndAddonGrids(grid, UnitType.BARRACKS)).length === 0 && isBuildingAndAddonPlaceable(map, UnitType.BARRACKS, grid);
    });
    const [closestRamp] = getClosestPosition(middleOfAdjacentGrids, middleOfAdjacentGridCircle.filter(grid => map.isRamp(grid)));
    if (closestRamp) {
      closestPlaceableGrids = closestPlaceableGrids.map(grid => {
        if (getDistance(grid, closestRamp) < getDistance(getAddOnPlacement(grid), closestRamp)) {
          return grid;
        } else {
          return getAddOnPlacement(grid);
        }
      });
      const [closestPlaceableToRamp] = getClosestPosition(closestRamp, closestPlaceableGrids)
      if (closestPlaceableToRamp) {
        let position = null;
        if (intersectionOfPoints(BuildingPlacement.twoByTwoPositions, getBuildingAndAddonGrids(closestPlaceableToRamp, UnitType.BARRACKS)).length === 0 && isBuildingAndAddonPlaceable(map, UnitType.BARRACKS, closestPlaceableToRamp)) {
          position = closestPlaceableToRamp;
        } else {
          position = getAddOnBuildingPlacement(closestPlaceableToRamp);
        }
        BuildingPlacement.addOnPositions = [position];
      }
    }
  }

  /**
   * Sets three-by-three building placements based on the map.
   * @param {MapResource} map - The map resource for analyzing placement.
   */
  static setThreeByThreePlacements(map) {
    // Implement the logic for setting three-by-three placements
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
    if (footprint === undefined) return;
    const twoByTwoPlacements = BuildingPlacement.twoByTwoPositions.map(grid => cellsInFootprint(grid, footprint)).flat();
    const middleOfAdjacentGridCircle = gridsInCircle(middleOfAdjacentGrids, 3).filter(grid => ![...twoByTwoPlacements].some(placement => placement.x === grid.x && placement.y === grid.y));
    let closestPlaceableGrids = getClosestPosition(middleOfAdjacentGrids, middleOfAdjacentGridCircle, middleOfAdjacentGridCircle.length).filter(grid => {
      const footprint = getFootprint(UnitType.ENGINEERINGBAY);
      if (footprint === undefined) return false;
      return intersectionOfPoints(twoByTwoPlacements, cellsInFootprint(grid, footprint)).length === 0 && map.isPlaceableAt(UnitType.ENGINEERINGBAY, grid);
    });
    const [closestRamp] = getClosestPosition(middleOfAdjacentGrids, middleOfAdjacentGridCircle.filter(grid => map.isRamp(grid)));
    if (closestRamp) {
      const [closestPlaceableToRamp] = getClosestPosition(closestRamp, closestPlaceableGrids)
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
      let closestPlaceableGrids = getClosestPosition(cornerGrid, cornerGridCircle, cornerGridCircle.length).filter(grid => {
        return map.isPlaceableAt(UnitType.SUPPLYDEPOT, grid);
      });
      const [closestRamp] = getClosestPosition(cornerGrid, cornerGridCircle.filter(grid => map.isRamp(grid)));
      if (closestRamp) {
        const [closestPlaceableToRamp] = getClosestPosition(closestRamp, closestPlaceableGrids)
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
    // Implement the logic to set two-by-two and three-by-three placements based on the map
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

    // Check if 'main' and 'main.areas' are defined
    if (!main || !main.areas) {
      return []; // Return an empty array if 'main' or 'main.areas' is undefined
    }

    // get pathable main area within 8 distance of ramp
    const getMainPositionsByRamp = main.areas.areaFill.filter(point => {
      return getNeighbors(point).some(neighbor => map.isRamp(neighbor));
    });

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
      /** @type {Point2D[]} */
      let expandedCandidates = [];
      candidates.forEach(candidate => {
        expandedCandidates.push(candidate, ...getNeighbors(candidate));
      });
      expandedCandidates = expandedCandidates.filter((candidate, index, self) =>
        self.findIndex(selfCandidate => selfCandidate.x === candidate.x && selfCandidate.y === candidate.y) === index
      );

      if (expandedCandidates.length > 0) {
        return BuildingPlacement.getPlaceableAtPositions(expandedCandidates, map, unitType);
      } else {
        return [];
      }
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
      let wallPositions = BuildingPlacement.getPlaceableAtPositions(naturalWall, map, unitType);
      // Filter placeable positions first to reduce size of array
      wallPositions = wallPositions.filter(point => map.isPlaceableAt(unitType, point));
      const middleOfWall = getClosestPosition(avgPoints(wallPositions), wallPositions, 2);
      candidates = middleOfWall;
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
        const coverage = naturalWall.filter(wallCell => (
          (getDistance(wallCell, point) <= 6.5) &&
          (getDistance(wallCell, point) >= 1) &&
          getDistance(wallCell, naturalTownhallPosition) > getDistance(point, naturalTownhallPosition)
        )).length;

        /** @type {ExtendedPoint2D} */
        return {
          x: point.x !== undefined ? point.x : 0,
          y: point.y !== undefined ? point.y : 0,
          coverage: coverage // coverage is always a number, even if it's 0
        };
      });

    return possiblePlacements
      .sort((a, b) => b.coverage - a.coverage)
      .filter((cell, i, arr) => cell.coverage === arr[0].coverage);
  }

  /**
   * @typedef {Object} FootprintType
   * @property {number} h - The height of the footprint.
   * @property {number} w - The width of the footprint.
   */

  /**
   * @param {World} world
   * @param {UnitTypeId} unitType
   * @returns {Point2D[]}
   */
  static findPlacements(world, unitType) {
    const { BARRACKS, ENGINEERINGBAY, FORGE, PYLON, REACTOR, STARPORT, SUPPLYDEPOT, TECHLAB } = UnitType;
    const { gasMineTypes } = groupTypes;
    const { agent, data, resources } = world;
    const { race } = agent;
    const { map, units, frame } = resources.get();
    const currentGameLoop = frame.getGameLoop();
    const [main, natural] = map.getExpansions();

    if (!main || !main.areas || !natural || !natural.areas) {
      return [];
    }

    const mainMineralLine = main.areas.mineralLine;

    if (gasMineTypes.includes(unitType)) {
      const geyserPositions = MapResources.getFreeGasGeysers(map, currentGameLoop).map(geyser => {
        const { pos } = geyser;
        if (pos === undefined) return { pos, buildProgress: 0 };
        const [closestBase] = units.getClosest(pos, units.getBases());
        return { pos, buildProgress: closestBase.buildProgress };
      });

      const sortedGeyserPositions = geyserPositions
        .filter(geyser => {
          const { pos, buildProgress } = geyser;
          if (pos === undefined || buildProgress === undefined) return false;
          const [closestBase] = units.getClosest(pos, units.getBases());
          if (closestBase === undefined) return false;
          const { unitType: baseType } = closestBase;
          if (baseType === undefined) return false;
          const { buildTime } = data.getUnitTypeData(baseType);
          if (buildTime === undefined) return false;
          const timeLeft = getBuildTimeLeft(closestBase, buildTime, buildProgress);
          const { buildTime: geyserBuildTime } = data.getUnitTypeData(unitType);
          if (geyserBuildTime === undefined) return false;
          return getTimeInSeconds(timeLeft) <= getTimeInSeconds(geyserBuildTime);
        })
        .sort((a, b) => {
          const buildProgressA = a.buildProgress !== undefined ? a.buildProgress : 0;
          const buildProgressB = b.buildProgress !== undefined ? b.buildProgress : 0;
          return buildProgressA - buildProgressB;
        });

      const [topGeyserPosition] = sortedGeyserPositions;
      if (topGeyserPosition && topGeyserPosition.pos) {
        return [topGeyserPosition.pos];
      } else {
        return []; // Return an empty array if no suitable position is found
      }
    }
    /**
     * @type {Point2D[]}
     */
    let placements = [];
    const gameState = GameState.getInstance();
    const currentPlan = gameState.plan;
    if (race === Race.PROTOSS) {
      if (unitType === PYLON) {
        if (gameState.getUnitTypeCount(world, unitType) === 0) {
          if (config.naturalWallPylon) {
            return BuildingPlacement.getCandidatePositions(resources, 'NaturalWallPylon', unitType);
          }
        }
        const occupiedExpansions = getOccupiedExpansions(resources);
        const occupiedExpansionsPlacementGrid = occupiedExpansions.reduce((/** @type {Point2D[]} */acc, expansion) => {
          if (expansion.areas !== undefined) {
            acc.push(...expansion.areas.placementGrid);
          }
          return acc;
        }, []);

        /** @type {Point2D[]} */
        const placementGrids = [];
        occupiedExpansionsPlacementGrid.forEach(grid => placementGrids.push(grid));
        placements = placementGrids
          .filter((point) => {
            return (
              (getDistance(natural.townhallPosition, point) > 4.5) &&
              (mainMineralLine.every(mlp => getDistance(mlp, point) > 1.5)) &&
              (natural.areas?.hull.every(hp => getDistance(hp, point) > 3)) && // Safe access using optional chaining
              (units.getStructures({ alliance: Alliance.SELF })
                .map(u => u.pos)
                .every(eb => getDistance(eb, point) > 3))
            );
          });
      } else {
        let pylonsNearProduction;
        if (units.getById(PYLON).length === 1) {
          pylonsNearProduction = units.getById(PYLON);
        } else {
          pylonsNearProduction = units.getById(PYLON)
            .filter(u => (u.buildProgress ?? 0) >= 1)
            .filter(pylon => getDistance(pylon.pos, main.townhallPosition) < 50);

        }
        pylonsNearProduction.forEach(pylon => {
          if (pylon.pos) {  // Check if pylon.pos is defined
            placements.push(...gridsInCircle(pylon.pos, 6.5, { normalize: true })
              .filter(grid => existsInMap(map, grid) && getDistance(grid, pylon.pos) < 6.5));
          }
        });
        /** @type {Point2D[]} */
        const wallOffPositions = [];
        const currentlyEnrouteConstructionGrids = getCurrentlyEnrouteConstructionGrids(world);
        const threeByThreeFootprint = getFootprint(FORGE); if (threeByThreeFootprint === undefined) return [];
        // Using reduce to filter and combine currentlyEnrouteConstructionGrids and buildingPositions
        const filteredPositions = [...currentlyEnrouteConstructionGrids, ...buildingPositions].reduce((/** @type {Point2D[]} */acc, position) => {
          // Check if 'position' is a Point2D and not a tuple
          if (position && typeof position === 'object' && !Array.isArray(position)) {
            acc.push(position);
          } else if (Array.isArray(position) && position[1] && typeof position[1] === 'object') {
            // If 'position' is a tuple, extract the Point2D part
            acc.push(position[1]);
          }
          return acc;
        }, []);


        BuildingPlacement.threeByThreePositions = BuildingPlacement.threeByThreePositions.filter(position => {
          // Ensure position is a valid Point2D object before passing it to cellsInFootprint
          if (typeof position === 'object' && position) {
            return !pointsOverlap(
              filteredPositions,
              cellsInFootprint(position, threeByThreeFootprint)
            );
          }
          return false;
        });

        if (BuildingPlacement.threeByThreePositions.length > 0) {
          const threeByThreeCellsInFootprints = BuildingPlacement.threeByThreePositions.map(position => cellsInFootprint(position, threeByThreeFootprint));
          wallOffPositions.push(...threeByThreeCellsInFootprints.flat().filter(position => !pointsOverlap(currentlyEnrouteConstructionGrids, cellsInFootprint(position, threeByThreeFootprint))));
          const unitTypeFootprint = getFootprint(unitType); if (unitTypeFootprint === undefined) return [];
          if (unitTypeFootprint.h === threeByThreeFootprint.h && unitTypeFootprint.w === threeByThreeFootprint.w) {
            const canPlace = getRandom(BuildingPlacement.threeByThreePositions.filter(pos => map.isPlaceableAt(unitType, pos)));
            if (canPlace) {
              return [canPlace];
            }
          }
        }
        const unitTypeFootprint = getFootprint(unitType); if (unitTypeFootprint === undefined) return [];
        placements = placements.filter(grid => {
          const cells = [...cellsInFootprint(grid, unitTypeFootprint)];
          return cells.every(cell => map.isPlaceable(cell)) && !pointsOverlap(cells, [...wallOffPositions]);
        }).map(pos => ({ pos, rand: Math.random() }))
          .sort((a, b) => a.rand - b.rand)
          .map(a => a.pos)
          .slice(0, 20);
        return placements;

      }
    } else if (race === Race.TERRAN) {
      /** @type {Point2D[]} */
      const placementGrids = [];
      const orphanAddons = units.getById([REACTOR, TECHLAB]);

      const buildingFootprints = Array.from(buildingPositions.entries()).reduce((/** @type {Point2D[]} */positions, [step, buildingPos]) => {

        const stepData = currentPlan[step];

        const stepUnitType = stepData.unitType;

        if (unitType === undefined) return positions;

        const footprint = getFootprint(stepUnitType); if (footprint === undefined) return positions;
        const newPositions = cellsInFootprint(buildingPos, footprint);
        if (canUnitBuildAddOn(stepUnitType)) {
          const addonFootprint = getFootprint(REACTOR); if (addonFootprint === undefined) return positions;
          const addonPositions = cellsInFootprint(getAddOnPlacement(buildingPos), addonFootprint);
          return [...positions, ...newPositions, ...addonPositions];
        }
        return [...positions, ...newPositions];
      }, []);

      const orphanAddonPositions = orphanAddons.reduce((/** @type {Point2D[]} */positions, addon) => {
        const { pos } = addon; if (pos === undefined) return positions;
        const newPositions = getAddOnBuildingPlacement(pos);
        const footprint = getFootprint(addon.unitType); if (footprint === undefined) return positions;
        const cells = cellsInFootprint(newPositions, footprint);
        if (cells.length === 0) return positions;
        return [...positions, ...cells];
      }, []);

      const wallOffPositions = BuildingPlacement.findWallOffPlacement(unitType).slice();
      if (wallOffPositions.filter(position => map.isPlaceableAt(unitType, position)).length > 0) {
        // Check if the structure is one that cannot use an orphan add-on
        if (!canUnitBuildAddOn(unitType)) {
          // Exclude positions that are suitable for orphan add-ons and inside existing footprints
          const filteredWallOffPositions = wallOffPositions.filter(position =>
            !orphanAddonPositions.some(orphanPosition => getDistance(orphanPosition, position) < 1) &&
            !buildingFootprints.some(buildingFootprint => getDistance(buildingFootprint, position) < 1)
          );
          // If there are any positions left, use them
          if (filteredWallOffPositions.length > 0) {
            return filteredWallOffPositions;
          }
        }
        // If the structure can use an orphan add-on, use all wall-off positions
        if (wallOffPositions.length > 0) {
          // Filter out positions already taken by buildings
          const newWallOffPositions = wallOffPositions.filter(position =>
            !buildingFootprints.some(buildingFootprint => getDistance(buildingFootprint, position) < 1)
          );
          if (newWallOffPositions.length > 0) {
            return newWallOffPositions;
          }
        }
      }

      getOccupiedExpansions(world.resources).forEach(expansion => {
        if (expansion.areas) {
          placementGrids.push(...expansion.areas.placementGrid);
        }
      });
      if (BuildingPlacement.addOnPositions.length > 0) {
        const barracksFootprint = getFootprint(BARRACKS);
        if (barracksFootprint === undefined) return [];
        const barracksCellInFootprints = BuildingPlacement.addOnPositions.map(position => cellsInFootprint(createPoint2D(position), barracksFootprint));
        wallOffPositions.push(...barracksCellInFootprints.flat());
      }
      if (BuildingPlacement.twoByTwoPositions.length > 0) {
        const supplyFootprint = getFootprint(SUPPLYDEPOT);
        if (supplyFootprint === undefined) return [];
        const supplyCellInFootprints = BuildingPlacement.twoByTwoPositions.map(position => cellsInFootprint(position, supplyFootprint));
        wallOffPositions.push(...supplyCellInFootprints.flat());
      }
      if (BuildingPlacement.threeByThreePositions.length > 0) {
        const engineeringBayFootprint = getFootprint(ENGINEERINGBAY);
        if (engineeringBayFootprint === undefined) return [];
        const engineeringBayCellInFootprints = BuildingPlacement.threeByThreePositions.map(position => cellsInFootprint(position, engineeringBayFootprint));
        wallOffPositions.push(...engineeringBayCellInFootprints.flat());
      }
      const unitTypeFootprint = getFootprint(unitType);
      /** @type {FootprintType | undefined} */
      let addonFootprint;
      if (addOnTypesMapping.has(unitType)) {
        addonFootprint = getFootprint(REACTOR); if (addonFootprint === undefined) return [];
      }
      if (unitTypeFootprint === undefined) return [];
      // Get all existing barracks and starports
      const barracks = units.getById(BARRACKS);
      const starports = units.getById(STARPORT);
      const barracksPositions = barracks.map(b => b.pos);
      const buildingFootprintOfOrphanAddons = getBuildingFootprintOfOrphanAddons(units);

      placements = placementGrids.filter(grid => {
        const cells = [...cellsInFootprint(grid, unitTypeFootprint)];

        // Check if the unit is a STARPORT and there's a nearby BARRACKS, and it's the first STARPORT
        if (unitType === STARPORT && starports.length === 0) {
          // If there is no nearby BARRACKS within 23.6 units, return false to filter out this grid
          if (!barracksPositions.some(bPos => bPos && getDistance(bPos, grid) <= 23.6)) {
            return false;
          }
        }

        if (addonFootprint) {
          cells.push(...cellsInFootprint(getAddOnPlacement(grid), addonFootprint));
        }

        return cells.every(cell => map.isPlaceable(cell)) && !pointsOverlap(cells, [...wallOffPositions, ...buildingFootprintOfOrphanAddons, ...orphanAddonPositions]);
      }).map(pos => ({ pos, rand: Math.random() }))
        .sort((a, b) => a.rand - b.rand)
        .map(a => a.pos)
        .slice(0, 20);
    } else if (race === Race.ZERG) {
      placements.push(...findZergPlacements(world, unitType))
    }
    return placements;
  }

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
      candidatePositions = BuildingPlacement.findPlacements(world, unitType);
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
    const unitTypeName = Object.keys(UnitType).find(type => UnitType[/** @type {keyof UnitType} */(type)] === unitType);
    if (foundPosition) console.log(`Found position for ${unitTypeName}`, foundPosition);
    else console.log(`Could not find position for ${unitTypeName}`);
    return foundPosition;
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
        mineralLineCandidates.push(...gridsInCircle(avgPoints([...expansion.cluster.mineralFields.map(field => field.pos), base.pos, base.pos]), 0.6));
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
    // Early return for invalid inputs
    if (!action || typeof action !== 'string') {
      return null;
    }

    // Split the action into segments based on commas
    const actionSegments = action.split(',');

    // Process each segment
    for (let segment of actionSegments) {
      // Clean the segment
      const cleanedSegment = segment.trim().replace(/\s+\(.*?\)|\sx\d+/g, '');
      const formattedSegment = cleanedSegment.toUpperCase().replace(/\s+/g, '');

      // Check if the formatted segment is in UnitType
      if (formattedSegment in UnitType) {
        return UnitType[formattedSegment];
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
    if (footprint === undefined) return position;

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
    const strategyManager = StrategyManager.getInstance();
    const currentStep = strategyManager.getCurrentStep();
    const currentStrategy = strategyManager.getCurrentStrategy();

    // Check if currentStrategy is defined
    if (!currentStrategy) {
      console.error('Current strategy is undefined.');
      return;
    }

    const currentPlan = currentStrategy.steps;

    if (currentPlan.length > 0) {
      const planUnitType = BuildingPlacement.extractUnitTypeFromAction(currentPlan[currentStep].action);
      if (planUnitType !== unitType) {
        BuildingPlacement.buildingPosition = BuildingPlacement.buildingPosition || false;
      } else {
        BuildingPlacement.buildingPosition = position;
      }
    }
  }
}

module.exports = BuildingPlacement;
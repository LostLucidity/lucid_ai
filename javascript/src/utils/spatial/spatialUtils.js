
const { UnitType } = require("@node-sc2/core/constants");
const { Race, Alliance } = require("@node-sc2/core/constants/enums");
const groupTypes = require("@node-sc2/core/constants/groups");
const { TownhallRace } = require("@node-sc2/core/constants/race-map");
const { REACTOR, TECHLAB, BARRACKS, SUPPLYDEPOT, ENGINEERINGBAY, STARPORT } = require("@node-sc2/core/constants/unit-type");
const { PYLON } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { createPoint2D, distance } = require("@node-sc2/core/utils/geometry/point");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const getRandom = require("@node-sc2/core/utils/get-random");

const config = require("../../../config/config");
const MapResources = require("../../../data/mapResources/mapResources");
const { isPlaceableAtGasGeyser } = require("../../core/buildingUtils");
const { getCurrentlyEnrouteConstructionGrids } = require("../../core/constructionDataUtils");
const BuildingPlacement = require("../../features/construction/buildingPlacement");
const { getOccupiedExpansions, existsInMap, pointsOverlap, getAddOnPlacement, getAddOnBuildingPlacement, getBuildingFootprintOfOrphanAddons, findZergPlacements } = require("../../features/shared/pathfinding/pathfinding");
const { getTimeInSeconds } = require("../../features/shared/timeUtils");
const StrategyContext = require("../../features/strategy/strategyContext");
const { getBuildTimeLeft } = require("../../gameLogic/economy/workerService");
const { GameState } = require('../../state');
const { buildingPositions } = require("../../state");
const { flyingTypesMapping, canUnitBuildAddOn, addOnTypesMapping } = require("../../units/management/unitConfig");
const { getDistance } = require("../spatialCoreUtils");

/**
 * @typedef {Object} FootprintType
 * @property {number} h - The height of the footprint.
 * @property {number} w - The width of the footprint.
 */

/**
 * Cache for cellsInFootprint function
 */
const footprintCellsCache = new Map();

/**
 * @param {Point2D[]} points
 * @param {Point2D[]} grids
 * @returns {Boolean}
 */
function allPointsWithinGrid(points, grids) {
  return points.every(point => grids.some(second => distance(point, second) < 1))
}

/**
 * @param {Point2D} point
 * @param {{ w: number, h: number }} footprint
 * @returns {Point2D[]}
 */
function getCachedFootprintCells(point, footprint, shouldCache = true) {
  if (!shouldCache) {
    return cellsInFootprint(point, footprint);
  }

  const key = `${point.x},${point.y},${footprint.w},${footprint.h}`;
  if (!footprintCellsCache.has(key)) {
    const footprintCells = cellsInFootprint(point, footprint);
    if (footprintCells.length > 0) {
      footprintCellsCache.set(key, footprintCells);
    }
  }

  return footprintCellsCache.get(key);
}

/**
 * Extracted function to handle Protoss-specific placement logic
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @param {Point2D[]} placements
 * @param {function} isPlaceBlockedByTownhall
 * @returns {Point2D[]}
 */
function findProtossPlacements(world, unitType, placements, isPlaceBlockedByTownhall) {
  const { PYLON, FORGE } = UnitType;
  const { resources } = world;
  const { map: gameMap, units } = resources.get();
  const main = gameMap.getExpansions()[0];

  const pylonsNearProduction = getPylonsNearProduction(units, PYLON, main.townhallPosition);

  let candidatePositions = getCandidatePositionsForPylon(world, unitType, resources);

  addPylonPlacements(pylonsNearProduction, placements, gameMap);

  const filteredPositions = getFilteredPositions(world);

  const threeByThreePlacements = handleThreeByThreePositions(world, unitType, gameMap);
  if (threeByThreePlacements.length > 0) {
    return threeByThreePlacements; // Return if valid three-by-three placements are found
  }

  const wallOffPositions = getWallOffPositions(world, FORGE, filteredPositions);
  const filteredCandidatePositions = filterCandidatePositions(candidatePositions, wallOffPositions, gameMap, unitType, isPlaceBlockedByTownhall);

  if (filteredCandidatePositions.length > 0) {
    return filteredCandidatePositions.slice(0, 20);
  }

  const plannedPylonPositions = BuildingPlacement.getPlannedPylonPositions();

  return finalizePlacements(placements, plannedPylonPositions, pylonsNearProduction, gameMap, wallOffPositions, unitType, isPlaceBlockedByTownhall);
}

/**
 * Handles filtering and returning valid placements for three-by-three units.
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @param {MapResource} gameMap
 * @returns {Point2D[]}
 */
function handleThreeByThreePositions(world, unitType, gameMap) {
  const threeByThreeFootprint = getFootprint(UnitType.FORGE);
  if (!threeByThreeFootprint) return [];

  if (BuildingPlacement.threeByThreePositions.length > 0) {
    const filteredPositions = BuildingPlacement.threeByThreePositions.filter(position => {
      const footprintCells = getCachedFootprintCells(position, threeByThreeFootprint);
      return footprintCells.every(cell => gameMap.isPlaceable(cell));
    });

    const unitTypeFootprint = getFootprint(unitType);
    if (unitTypeFootprint && unitTypeFootprint.h === threeByThreeFootprint.h && unitTypeFootprint.w === threeByThreeFootprint.w) {
      const validPosition = getRandom(filteredPositions.filter(pos => gameMap.isPlaceableAt(unitType, pos)));
      if (validPosition) {
        return [validPosition];
      }
    }
  }

  return [];
}

/**
 * Gets pylons near the main townhall for production purposes.
 * @param {UnitResource} units
 * @param {UnitTypeId} PYLON
 * @param {Point2D} townhallPosition
 * @returns {Unit[]}
 */
function getPylonsNearProduction(units, PYLON, townhallPosition) {
  const pylons = units.getById(PYLON);
  if (pylons.length === 1) {
    return pylons;
  }
  return pylons
    .filter(u => (u.buildProgress ?? 0) >= 1)
    .filter(pylon => getDistance(pylon.pos, townhallPosition) < 50);
}

/**
 * Gets candidate positions for placing the first PYLON near the natural wall.
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @param {ResourceManager} resources
 * @returns {Point2D[]}
 */
function getCandidatePositionsForPylon(world, unitType, resources) {
  const gameState = GameState.getInstance();
  if (unitType === UnitType.PYLON && gameState.getUnitTypeCount(world, unitType) === 0 && config.naturalWallPylon) {
    return BuildingPlacement.getCandidatePositions(resources, 'NaturalWallPylon', unitType);
  }
  return [];
}

/**
 * Adds grid placements around pylons to the placement list.
 * @param {Unit[]} pylonsNearProduction
 * @param {Point2D[]} placements
 * @param {MapResource} gameMap
 */
function addPylonPlacements(pylonsNearProduction, placements, gameMap) {
  pylonsNearProduction.forEach(pylon => {
    if (pylon.pos) {
      placements.push(...gridsInCircle(pylon.pos, 6.5, { normalize: true })
        .filter(grid => existsInMap(gameMap, grid) && getDistance(grid, pylon.pos) < 6.5));
    }
  });
}

/**
 * Gets positions that are already occupied or under construction.
 * @param {World} world
 * @returns {Point2D[]}
 */
function getFilteredPositions(world) {
  const strategyContext = StrategyContext.getInstance();
  const currentStrategy = strategyContext.getCurrentStrategy();

  if (!currentStrategy) {
    console.error('Current strategy is undefined.');
    return [];
  }

  const currentPlan = currentStrategy.steps;
  return [...getCurrentlyEnrouteConstructionGrids(world), ...buildingPositions].reduce(
    /**
     * @param {Point2D[]} acc
     * @param {Point2D | [number, Point2D]} positionEntry - Either a Point2D or a tuple with [step, Point2D]
     * @param {number} step
     * @returns {Point2D[]}
     */  
    (acc, positionEntry, step) => {
      if (!currentPlan[step]) {
        console.error(`No plan found for step ${step}.`);
        return acc;
      }

      const currentAction = currentPlan[step].action;
      const unitType = BuildingPlacement.extractUnitTypeFromAction(currentAction);

      const position = Array.isArray(positionEntry) ? positionEntry[1] : positionEntry;
      const unitFootprint = getFootprint(unitType);

      if (unitFootprint && position && typeof position === 'object' && !Array.isArray(position)) {
        const footprintCells = getCachedFootprintCells(position, unitFootprint, false);
        acc.push(...footprintCells);
      }

      return acc;
    },
    /** @type {Point2D[]} */[]
  );
}


/**
 * Gets wall-off positions for building placement.
 * @param {World} world
 * @param {UnitTypeId} FORGE
 * @param {Point2D[]} filteredPositions
 * @returns {Point2D[]}
 */
function getWallOffPositions(world, FORGE, filteredPositions) {
  const threeByThreeFootprint = getFootprint(FORGE);
  if (!threeByThreeFootprint) return [];

  return BuildingPlacement.threeByThreePositions.filter(position => {
    return !pointsOverlap(
      filteredPositions,
      getCachedFootprintCells(position, threeByThreeFootprint)
    );
  });
}

/**
 * Filters candidate positions to remove those blocked by wall-off or townhalls.
 * @param {Point2D[]} candidatePositions
 * @param {Point2D[]} wallOffPositions
 * @param {MapResource} gameMap
 * @param {UnitTypeId} unitType
 * @param {function} isPlaceBlockedByTownhall
 * @returns {Point2D[]}
 */
function filterCandidatePositions(candidatePositions, wallOffPositions, gameMap, unitType, isPlaceBlockedByTownhall) {
  const unitTypeFootprint = getFootprint(unitType);
  if (!unitTypeFootprint) return [];

  return candidatePositions.filter(grid => {
    const cells = getCachedFootprintCells(grid, unitTypeFootprint, false);
    return cells.every(cell => gameMap.isPlaceable(cell)) &&
      !pointsOverlap(cells, wallOffPositions) &&
      !isPlaceBlockedByTownhall(grid);
  });
}

/**
 * Finalizes the placement list by filtering based on PYLON proximity.
 * @param {Point2D[]} placements
 * @param {Point2D[]} plannedPylonPositions
 * @param {Unit[]} pylonsNearProduction
 * @param {MapResource} gameMap
 * @param {Point2D[]} wallOffPositions
 * @param {UnitTypeId} unitType
 * @param {function} isPlaceBlockedByTownhall
 * @returns {Point2D[]}
 */
function finalizePlacements(placements, plannedPylonPositions, pylonsNearProduction, gameMap, wallOffPositions, unitType, isPlaceBlockedByTownhall) {
  const unitTypeFootprint = getFootprint(unitType);
  if (!unitTypeFootprint) return [];

  return placements.filter(grid => {
    const cells = getCachedFootprintCells(grid, unitTypeFootprint, false);
    const isPlaceable = cells.every(cell => gameMap.isPlaceable(cell)) &&
      !pointsOverlap(cells, wallOffPositions) &&
      !isPlaceBlockedByTownhall(grid);

    if (unitType === UnitType.PYLON) {
      return isPlaceable;
    }

    const pylonsIncludingPlanned = [
      ...pylonsNearProduction.map(pylon => pylon.pos),
      ...plannedPylonPositions
    ];

    const isNearPylon = pylonsIncludingPlanned.some(pylonPosition => getDistance(pylonPosition, grid) <= 6.5);
    return isPlaceable && isNearPylon;
  }).map(pos => ({ pos, rand: Math.random() }))
    .sort((a, b) => a.rand - b.rand)
    .map(a => a.pos)
    .slice(0, 20);
}

/**
 * Handles Terran-specific placement logic
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @returns {Point2D[]}
 */
function findTerranPlacements(world, unitType) {
  const { resources } = world;
  const { map: gameMap, units } = resources.get();  // Extract units from resources
  const gameState = GameState.getInstance();  // Retrieve the game state
  const currentPlan = gameState.plan;  // Extract the current plan
  /** @type {Point2D[]} */
  const placementGrids = [];  // Initialize placementGrids as an empty array
  /** @type {Point2D[]} */
  let placements = [];  // Initialize placements as an empty array

  const orphanAddons = units.getById([REACTOR, TECHLAB]);
  const buildingFootprints = Array.from(buildingPositions.entries()).reduce((positions, [step, buildingPos]) => {
    const stepData = currentPlan[step];
    const stepUnitType = stepData.unitType;
    if (!stepUnitType) return positions;

    const footprint = getFootprint(stepUnitType);
    if (!footprint) return positions;
    const newPositions = getCachedFootprintCells(buildingPos, footprint);
    if (canUnitBuildAddOn(stepUnitType)) {
      const addonFootprint = getFootprint(REACTOR);
      if (!addonFootprint) return positions;
      const addonPositions = getCachedFootprintCells(getAddOnPlacement(buildingPos), addonFootprint);
      return [...positions, ...newPositions, ...addonPositions];
    }
    return [...positions, ...newPositions];
  }, /** @type {Point2D[]} */([]));

  const orphanAddonPositions = orphanAddons.reduce((positions, addon) => {
    const { pos } = addon;
    if (!pos) return positions;
    const newPositions = getAddOnBuildingPlacement(pos);
    const footprint = getFootprint(addon.unitType);
    if (!footprint) return positions;
    const cells = getCachedFootprintCells(newPositions, footprint);
    if (!cells.length) return positions;
    return [...positions, ...cells];
  }, /** @type {Point2D[]} */([]));

  const wallOffPositions = BuildingPlacement.findWallOffPlacement(unitType).slice();
  if (wallOffPositions.some(position => gameMap.isPlaceableAt(unitType, position))) {
    if (!canUnitBuildAddOn(unitType)) {
      const filteredWallOffPositions = wallOffPositions.filter(position =>
        !orphanAddonPositions.some(orphanPosition => getDistance(orphanPosition, position) < 1) &&
        !buildingFootprints.some(buildingFootprint => getDistance(buildingFootprint, position) < 1)
      );
      if (filteredWallOffPositions.length > 0) {
        return filteredWallOffPositions;
      }
    }
    if (wallOffPositions.length > 0) {
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
    if (!barracksFootprint) return [];
    const barracksCellInFootprints = BuildingPlacement.addOnPositions.map(position => getCachedFootprintCells(createPoint2D(position), barracksFootprint));
    wallOffPositions.push(...barracksCellInFootprints.flat());
  }

  if (BuildingPlacement.twoByTwoPositions.length > 0) {
    const supplyFootprint = getFootprint(SUPPLYDEPOT);
    if (!supplyFootprint) return [];
    const supplyCellInFootprints = BuildingPlacement.twoByTwoPositions.map(position => getCachedFootprintCells(position, supplyFootprint));
    wallOffPositions.push(...supplyCellInFootprints.flat());
  }

  if (BuildingPlacement.threeByThreePositions.length > 0) {
    const engineeringBayFootprint = getFootprint(ENGINEERINGBAY);
    if (!engineeringBayFootprint) return [];
    const engineeringBayCellInFootprints = BuildingPlacement.threeByThreePositions.map(position => getCachedFootprintCells(position, engineeringBayFootprint));
    wallOffPositions.push(...engineeringBayCellInFootprints.flat());
  }

  const unitTypeFootprint = getFootprint(unitType);
  let addonFootprint = null;
  if (addOnTypesMapping.has(unitType)) {
    addonFootprint = getFootprint(REACTOR);
    if (!addonFootprint) return [];
  }

  if (!unitTypeFootprint) return [];

  const barracks = units.getById(BARRACKS);
  const barracksPositions = barracks.map(b => b.pos);

  if (unitType === STARPORT && (barracks.length === 0 || !barracksPositions.some(bPos => bPos && placementGrids.some(grid => getDistance(bPos, grid) <= 23.6)))) {
    return []; // Early exit for STARPORT with no valid BARRACKS within range
  }

  const buildingFootprintOfOrphanAddons = getBuildingFootprintOfOrphanAddons(units);

  placements = placementGrids.filter(grid => {
    const cells = [...getCachedFootprintCells(grid, unitTypeFootprint, false)];
    if (addonFootprint) {
      cells.push(...getCachedFootprintCells(getAddOnPlacement(grid), addonFootprint, false));
    }
    return cells.every(cell => gameMap.isPlaceable(cell)) &&
      !pointsOverlap(cells, [...wallOffPositions, ...buildingFootprintOfOrphanAddons, ...orphanAddonPositions]);
  }).map(pos => ({ pos, rand: Math.random() }))
    .sort((a, b) => a.rand - b.rand)
    .map(a => a.pos)
    .slice(0, 20);

  return placements;
}

/**
 * Determines a valid position for a given unit type.
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @param {Point3D[]} candidatePositions
 * @returns {false | Point2D}
 */
function findPosition(world, unitType, candidatePositions) {
  const { gasMineTypes } = groupTypes;

  // Get the current step from StrategyContext
  const currentStep = StrategyContext.getInstance().getCurrentStep();

  // Return false immediately if candidatePositions is empty and unit type is STARPORT
  if (unitType === UnitType.STARPORT && candidatePositions.length === 0) {
    console.log(`Step ${currentStep}: No candidate positions for STARPORT`);
    return false;
  }

  // If candidatePositions is empty, find placements for the unit type
  if (candidatePositions.length === 0) {
    candidatePositions = findUnitPlacements(world, unitType);
  }

  const { agent, resources } = world;
  const { map } = resources.get();

  // If the unitType is in flyingTypesMapping, map it to its base unit type
  const baseUnitType = flyingTypesMapping.get(unitType);
  unitType = baseUnitType !== undefined ? baseUnitType : unitType;

  // Filter candidate positions to only include valid ones
  candidatePositions = candidatePositions.filter(position => {
    const footprint = getFootprint(unitType);
    if (!footprint) return false;

    const unitTypeCells = getCachedFootprintCells(position, footprint, false);

    // Special handling for gas mine types
    if (gasMineTypes.includes(unitType)) {
      return isPlaceableAtGasGeyser(map, unitType, position);
    }

    // Check if each cell in the unit's footprint is placeable
    return unitTypeCells.every(cell => {
      const isPlaceable = map.isPlaceable(cell);
      const needsCreep = agent.race === Race.ZERG && unitType !== UnitType.HATCHERY;
      const hasCreep = map.hasCreep(cell);
      return isPlaceable && (!needsCreep || hasCreep);
    });
  });

  // Randomize and limit candidate positions to the top 20
  const randomPositions = candidatePositions
    .sort(() => Math.random() - 0.5)
    .slice(0, 20);

  // Select a random position from the filtered and randomized list
  const foundPosition = getRandom(randomPositions);
  const unitTypeName = Object.keys(UnitType).find(type => UnitType[type] === unitType);

  // Log the result with step number
  if (foundPosition) {
    console.log(`Step ${currentStep}: Found position for ${unitTypeName} at ${JSON.stringify(foundPosition)}`);
  } else {
    console.log(`Step ${currentStep}: Could not find position for ${unitTypeName}`);
  }

  return foundPosition;
}

/**
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @returns {Point2D[]}
 */
function findUnitPlacements(world, unitType) {
  const { gasMineTypes } = groupTypes;
  const { agent, data, resources } = world;
  const { race } = agent;
  const { map: gameMap, units, frame } = resources.get();
  const currentGameLoop = frame.getGameLoop();
  const [main, natural] = gameMap.getExpansions();

  if (!main || !main.areas || !natural || !natural.areas || !race) {
    return [];
  }

  const mainMineralLine = main.areas.mineralLine;
  const expansionPositions = gameMap.getExpansions().map(expansion => expansion.townhallPosition);
  const townhallTypes = TownhallRace[race];

  if (!townhallTypes) {
    return [];
  }

  const townhallFootprints = getUniqueFootprints(townhallTypes.map(type => getFootprint(type)).filter(isDefinedFootprint));

  if (townhallFootprints.length === 0) {
    return [];
  }

  const unitFootprint = getFootprint(unitType);

  if (!unitFootprint) return [];

  /**
   * @param {{ x: number, y: number, w: number, h: number }} rect1
   * @param {{ x: number, y: number, w: number, h: number }} rect2
   * @returns {boolean}
   */
  const boundingBoxIntersects = (rect1, rect2) => {
    return rect1.x < rect2.x + rect2.w &&
      rect1.x + rect1.w > rect2.x &&
      rect1.y < rect2.y + rect2.h &&
      rect1.y + rect1.h > rect2.y;
  };

  /**
   * Check if the point overlaps with any townhall locations or existing building positions
   * @param {Point2D} point
   * @returns {boolean}
   */
  const isPlaceBlockedByTownhall = (point) => {
    if (point.x === undefined || point.y === undefined) {
      return false;
    }

    const unitCells = getCachedFootprintCells(point, unitFootprint, false);
    const unitBoundingBox = {
      x: point.x - Math.floor(unitFootprint.w / 2),
      y: point.y - Math.floor(unitFootprint.h / 2),
      w: unitFootprint.w,
      h: unitFootprint.h
    };

    const blockedByTownhall = expansionPositions.some(expansion => {
      if (expansion.x === undefined || expansion.y === undefined) {
        return false;
      }

      const townhallFootprint = townhallFootprints.find(fp => fp.w && fp.h);
      if (!townhallFootprint) return false;

      const expansionBoundingBox = {
        x: expansion.x - Math.floor(townhallFootprint.w / 2),
        y: expansion.y - Math.floor(townhallFootprint.h / 2),
        w: townhallFootprint.w,
        h: townhallFootprint.h
      };

      const overlap = boundingBoxIntersects(unitBoundingBox, expansionBoundingBox);
      if (overlap) {
        const expansionCells = getCachedFootprintCells(expansion, townhallFootprint);
        return pointsOverlap(unitCells, expansionCells);
      }

      return false;
    });

    let blockedByBuilding = false;
    buildingPositions.forEach(position => {
      if (position.x === undefined || position.y === undefined) {
        return; // Skip this position if x or y is undefined
      }

      const buildingFootprint = getFootprint(unitType);
      if (!buildingFootprint) {
        return; // Skip this position if buildingFootprint is undefined
      }

      const buildingBoundingBox = {
        x: position.x - Math.floor(buildingFootprint.w / 2),
        y: position.y - Math.floor(buildingFootprint.h / 2),
        w: buildingFootprint.w,
        h: buildingFootprint.h
      };

      if (boundingBoxIntersects(unitBoundingBox, buildingBoundingBox)) {
        blockedByBuilding = true;
      }
    });

    return blockedByTownhall || blockedByBuilding;
  };

  /**
     * Check if the placement is valid
     * @param {Point2D} point
     * @returns {boolean}
     */
  const isValidPlacement = (point) => {
    const cells = getCachedFootprintCells(point, unitFootprint, false);  // Use cached footprint cells
    if (cells.some(cell => !gameMap.isPlaceable(cell))) return false;

    // Minimize redundant distance checks
    return !(
      getDistance(natural.townhallPosition, point) <= 4.5 ||
      mainMineralLine.some(mlp => getDistance(mlp, point) <= 1.5) ||
      natural.areas?.hull?.some(hp => getDistance(hp, point) <= 3) ||
      units.getStructures({ alliance: Alliance.SELF }).some(u => getDistance(u.pos, point) <= 3) ||
      isPlaceBlockedByTownhall(point)
    );
  }

  /**
   * Check if the gas mine placement is valid
   * @param {Point2D} geyserPos - Position of the gas geyser
   * @returns {boolean} - Returns true if the placement is valid
   */
  const validateGasMinePlacement = (geyserPos /** @type {Point2D} */) => {
    const minDistance = 3; // Minimum distance from existing structures
    let isValid = true;

    // Iterate over the Map using forEach
    buildingPositions.forEach(pos => {
      if (getDistance(geyserPos, pos) < minDistance) {
        isValid = false; // Mark as invalid if too close
      }
    });

    return isValid;
  };

  /**
   * @typedef {Object} GeyserPosition
   * @property {Point2D} pos - The position of the geyser
   * @property {number} buildProgress - The build progress of the closest base
   */

  if (gasMineTypes.includes(unitType)) {
    /** @type {GeyserPosition[]} */
    const geyserPositions = MapResources.getFreeGasGeysers(gameMap, currentGameLoop)
      .reduce(
        /**
         * @param {GeyserPosition[]} acc - Accumulator array of valid geyser positions
         * @param {any} geyser - Current geyser being processed
         * @returns {GeyserPosition[]}
         */
        (acc, geyser) => {
          const { pos } = geyser;
          if (!pos) return acc;

          const [closestBase] = units.getClosest(pos, units.getBases());
          if (!closestBase || closestBase.buildProgress === undefined) return acc;

          const { unitType: baseType } = closestBase;
          if (!baseType) return acc;

          const { buildTime } = data.getUnitTypeData(baseType);
          if (!buildTime) return acc;

          const timeLeft = getBuildTimeLeft(closestBase, buildTime, closestBase.buildProgress);
          const { buildTime: geyserBuildTime } = data.getUnitTypeData(unitType);
          if (!geyserBuildTime) return acc;

          if (getTimeInSeconds(timeLeft) > getTimeInSeconds(geyserBuildTime)) return acc;

          if (validateGasMinePlacement(pos)) {
            acc.push({ pos, buildProgress: closestBase.buildProgress || 0 });
          }

          return acc;
        },
      /** @type {GeyserPosition[]} */[]
      )
      .sort((a, b) => a.buildProgress - b.buildProgress);

    const [topGeyserPosition] = geyserPositions;
    return topGeyserPosition && topGeyserPosition.pos ? [topGeyserPosition.pos] : [];
  }

  /** @type {Point2D[]} */
  let placements = [];

  const occupiedExpansions = getOccupiedExpansions(resources);
  /** @type {Point2D[]} */
  const occupiedExpansionsPlacementGrid = occupiedExpansions.reduce((acc, expansion) => {
    if (expansion.areas) {
      acc.push(...expansion.areas.placementGrid);
    }
    return acc;
  }, /** @type {Point2D[]} */([]));

  /** @type {Point2D[]} */
  const placementGrids = [];
  occupiedExpansionsPlacementGrid.forEach(grid => placementGrids.push(grid));

  placements = placementGrids.filter(isValidPlacement);

  if (race === Race.PROTOSS) {
    return findProtossPlacements(world, unitType, placements, isPlaceBlockedByTownhall);
  } else if (race === Race.TERRAN) {
    return findTerranPlacements(world, unitType);
  } else if (race === Race.ZERG) {
    placements.push(...findZergPlacements(world, unitType));
  }

  return placements;
}

/**
 * Get pylon power area
 * @param {Point2D} position
 * @returns {Point2D[]}
 */
function getPylonPowerArea(position) {
  const pylonFootprint = getFootprint(PYLON);

  // Ensure the pylonFootprint is defined before proceeding
  if (!pylonFootprint) {
    console.error('Failed to retrieve the footprint for PYLON.');
    return [];
  }

  const pylonCells = cellsInFootprint(position, pylonFootprint);
  const pylonPowerCircleGrids = gridsInCircle(position, 7, { normalize: true })
    .filter(grid => distance(grid, position) <= 6.5);

  const pylonPowerCircleGridsExcludingPylonPlacements = pylonPowerCircleGrids.filter(grid => !pointsOverlap(pylonCells, [grid]));

  return pylonPowerCircleGridsExcludingPylonPlacements;
}

/**
 * Gets unique footprints from an array of footprints.
 * @param {{ w: number, h: number }[]} footprints
 * @returns {{ w: number, h: number }[]}
 */
function getUniqueFootprints(footprints) {
  /** @type {{ w: number, h: number }[]} */
  const uniqueFootprints = [];
  footprints.forEach(footprint => {
    if (!uniqueFootprints.some(fp => fp.w === footprint.w && fp.h === footprint.h)) {
      uniqueFootprints.push(footprint);
    }
  });
  return uniqueFootprints;
}

/**
 * Checks if a footprint is defined.
 * @param {{ w: number, h: number } | undefined } footprint
 * @returns {footprint is { w: number, h: number }}
 */
function isDefinedFootprint(footprint) {
  return footprint !== undefined;
}

module.exports = {
  allPointsWithinGrid,
  findPosition,
  findUnitPlacements,
  getPylonPowerArea
};


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
function getCachedFootprintCells(point, footprint) {
  // Create a string key by concatenating the values
  const key = `${point.x},${point.y},${footprint.w},${footprint.h}`;
  if (!footprintCellsCache.has(key)) {
    footprintCellsCache.set(key, cellsInFootprint(point, footprint));
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
  const gameState = GameState.getInstance();
  const main = gameMap.getExpansions()[0];
  let pylonsNearProduction;

  if (units.getById(PYLON).length === 1) {
    pylonsNearProduction = units.getById(PYLON);
  } else {
    pylonsNearProduction = units.getById(PYLON)
      .filter(u => (u.buildProgress ?? 0) >= 1)
      .filter(pylon => getDistance(pylon.pos, main.townhallPosition) < 50);
  }

  // Prioritize natural wall pylon placements if unitType is PYLON and it's the first one being placed
  /** @type {Point2D[]} */
  let candidatePositions = [];
  if (unitType === PYLON) {
    if (gameState.getUnitTypeCount(world, unitType) === 0) {
      if (config.naturalWallPylon) {
        candidatePositions = BuildingPlacement.getCandidatePositions(resources, 'NaturalWallPylon', unitType);
      }
    }
  }

  // Continue with general placement logic
  pylonsNearProduction.forEach(pylon => {
    if (pylon.pos) {  // Check if pylon.pos is defined
      placements.push(...gridsInCircle(pylon.pos, 6.5, { normalize: true })
        .filter(grid => existsInMap(gameMap, grid) && getDistance(grid, pylon.pos) < 6.5));
    }
  });

  /** @type {Point2D[]} */
  const wallOffPositions = [];
  const currentlyEnrouteConstructionGrids = getCurrentlyEnrouteConstructionGrids(world);
  const threeByThreeFootprint = getFootprint(FORGE);
  if (threeByThreeFootprint === undefined) return [];

  const filteredPositions = [...currentlyEnrouteConstructionGrids, ...buildingPositions].reduce((/** @type {Point2D[]} */acc, position) => {
    if (position && typeof position === 'object' && !Array.isArray(position)) {
      acc.push(position);
    } else if (Array.isArray(position) && position[1] && typeof position[1] === 'object') {
      acc.push(position[1]);
    }
    return acc;
  }, []);

  BuildingPlacement.threeByThreePositions = BuildingPlacement.threeByThreePositions.filter(position => {
    if (typeof position === 'object' && position) {
      return !pointsOverlap(
        filteredPositions,
        getCachedFootprintCells(position, threeByThreeFootprint)
      );
    }
    return false;
  });

  if (BuildingPlacement.threeByThreePositions.length > 0) {
    const threeByThreeCellsInFootprints = BuildingPlacement.threeByThreePositions.map(position => getCachedFootprintCells(position, threeByThreeFootprint));
    wallOffPositions.push(...threeByThreeCellsInFootprints.flat().filter(position => !pointsOverlap(currentlyEnrouteConstructionGrids, getCachedFootprintCells(position, threeByThreeFootprint))));
    const unitTypeFootprint = getFootprint(unitType);
    if (unitTypeFootprint === undefined) return [];

    if (unitTypeFootprint.h === threeByThreeFootprint.h && unitTypeFootprint.w === threeByThreeFootprint.w) {
      const canPlace = getRandom(BuildingPlacement.threeByThreePositions.filter(pos => gameMap.isPlaceableAt(unitType, pos)));
      if (canPlace) {
        return [canPlace];
      }
    }
  }

  const unitTypeFootprint = getFootprint(unitType);
  if (unitTypeFootprint === undefined) return [];

  // Filter candidate positions first, if any exist (without pylon power range filter)
  const filteredCandidatePositions = candidatePositions.filter(grid => {
    const cells = [...getCachedFootprintCells(grid, unitTypeFootprint)];
    return cells.every(cell => gameMap.isPlaceable(cell)) &&
      !pointsOverlap(cells, [...wallOffPositions]) &&
      !isPlaceBlockedByTownhall(grid);
  });

  // If there are valid candidate positions, return them
  if (filteredCandidatePositions.length > 0) {
    return filteredCandidatePositions.slice(0, 20);
  }

  // Otherwise, proceed with regular placements filtering, excluding the pylon proximity condition for PYLONs
  placements = placements.filter(grid => {
    const cells = [...getCachedFootprintCells(grid, unitTypeFootprint)];
    return cells.every(cell => gameMap.isPlaceable(cell)) &&
      !pointsOverlap(cells, [...wallOffPositions]) &&
      (unitType === PYLON || pylonsNearProduction.some(pylon => getDistance(pylon.pos, grid) <= 6.5)) &&  // Only apply proximity check if unitType is not PYLON
      !isPlaceBlockedByTownhall(grid);
  }).map(pos => ({ pos, rand: Math.random() }))
    .sort((a, b) => a.rand - b.rand)
    .map(a => a.pos)
    .slice(0, 20);

  return placements;
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
    const cells = [...getCachedFootprintCells(grid, unitTypeFootprint)];
    if (addonFootprint) {
      cells.push(...getCachedFootprintCells(getAddOnPlacement(grid), addonFootprint));
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

  // Return false immediately if candidatePositions is empty and unit type is STARPORT
  if (unitType === UnitType.STARPORT && candidatePositions.length === 0) {
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

    const unitTypeCells = getCachedFootprintCells(position, footprint);

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

  // Log the result
  if (foundPosition) {
    console.log(`Found position for ${unitTypeName}`, foundPosition);
  } else {
    console.log(`Could not find position for ${unitTypeName}`);
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

    const unitCells = getCachedFootprintCells(point, unitFootprint);
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
    const cells = getCachedFootprintCells(point, unitFootprint);
    if (cells.some(cell => !gameMap.isPlaceable(cell))) return false;
    if (getDistance(natural.townhallPosition, point) <= 4.5) return false;
    if (mainMineralLine.some(mlp => getDistance(mlp, point) <= 1.5)) return false;
    if (natural.areas?.hull?.some(hp => getDistance(hp, point) <= 3)) return false;
    if (units.getStructures({ alliance: Alliance.SELF }).some(u => getDistance(u.pos, point) <= 3)) return false;

    // Only check townhall and other building overlaps, avoiding redundant checks
    return !isPlaceBlockedByTownhall(point);
  };

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

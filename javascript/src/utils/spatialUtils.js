const { UnitType } = require("@node-sc2/core/constants");
const { Race, Alliance } = require("@node-sc2/core/constants/enums");
const groupTypes = require("@node-sc2/core/constants/groups");
const { TownhallRace } = require("@node-sc2/core/constants/race-map");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { createPoint2D } = require("@node-sc2/core/utils/geometry/point");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const getRandom = require("@node-sc2/core/utils/get-random");

const { getDistance } = require("./spatialCoreUtils");
const config = require("../../config/config");
const MapResources = require("../../data/mapResources/mapResources");
const { isPlaceableAtGasGeyser } = require("../core/buildingUtils");
const { getCurrentlyEnrouteConstructionGrids } = require("../core/constructionDataUtils");
const BuildingPlacement = require("../features/construction/buildingPlacement");
const { getOccupiedExpansions, existsInMap, pointsOverlap, getAddOnPlacement, getAddOnBuildingPlacement, getBuildingFootprintOfOrphanAddons, findZergPlacements } = require("../features/shared/pathfinding/pathfinding");
const { getTimeInSeconds } = require("../features/shared/timeUtils");
const { getBuildTimeLeft } = require("../gameLogic/economy/workerService");
const { GameState } = require('../state');
const { buildingPositions } = require("../state");
const { flyingTypesMapping, canUnitBuildAddOn, addOnTypesMapping } = require("../units/management/unitConfig");

/**
 * @typedef {Object} FootprintType
 * @property {number} h - The height of the footprint.
 * @property {number} w - The width of the footprint.
 */

/**
 * Memoize cellsInFootprint function
 */
const cellsInFootprintCache = new Map();

/**
 * @param {Point2D} point
 * @param {{ w: number, h: number }} footprint
 * @returns {Point2D[]}
 */
function memoizedCellsInFootprint(point, footprint) {
  const key = [point.x, point.y, footprint.w, footprint.h];
  if (!cellsInFootprintCache.has(key)) {
    cellsInFootprintCache.set(key, cellsInFootprint(point, footprint));
  }
  return cellsInFootprintCache.get(key);
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

  if (unitType === PYLON) {
    if (gameState.getUnitTypeCount(world, unitType) === 0) {
      if (config.naturalWallPylon) {
        return BuildingPlacement.getCandidatePositions(resources, 'NaturalWallPylon', unitType);
      }
    }
  } else {
    pylonsNearProduction.forEach(pylon => {
      if (pylon.pos) {  // Check if pylon.pos is defined
        placements.push(...gridsInCircle(pylon.pos, 6.5, { normalize: true })
          .filter(grid => existsInMap(gameMap, grid) && getDistance(grid, pylon.pos) < 6.5));
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
      // Ensure position is a valid Point2D object before passing it to memoizedCellsInFootprint
      if (typeof position === 'object' && position) {
        return !pointsOverlap(
          filteredPositions,
          memoizedCellsInFootprint(position, threeByThreeFootprint)
        );
      }
      return false;
    });

    if (BuildingPlacement.threeByThreePositions.length > 0) {
      const threeByThreeCellsInFootprints = BuildingPlacement.threeByThreePositions.map(position => memoizedCellsInFootprint(position, threeByThreeFootprint));
      wallOffPositions.push(...threeByThreeCellsInFootprints.flat().filter(position => !pointsOverlap(currentlyEnrouteConstructionGrids, memoizedCellsInFootprint(position, threeByThreeFootprint))));
      const unitTypeFootprint = getFootprint(unitType); if (unitTypeFootprint === undefined) return [];
      if (unitTypeFootprint.h === threeByThreeFootprint.h && unitTypeFootprint.w === threeByThreeFootprint.w) {
        const canPlace = getRandom(BuildingPlacement.threeByThreePositions.filter(pos => gameMap.isPlaceableAt(unitType, pos)));
        if (canPlace) {
          return [canPlace];
        }
      }
    }

    const unitTypeFootprint = getFootprint(unitType); if (unitTypeFootprint === undefined) return [];
    placements = placements.filter(grid => {
      const cells = [...memoizedCellsInFootprint(grid, unitTypeFootprint)];
      return cells.every(cell => gameMap.isPlaceable(cell)) &&
        !pointsOverlap(cells, [...wallOffPositions]) &&
        // Check if the placement is within pylon power range
        pylonsNearProduction.some(pylon => getDistance(pylon.pos, grid) <= 6.5) &&
        // Additional check to avoid blocking future expansions
        !isPlaceBlockedByTownhall(grid);
    }).map(pos => ({ pos, rand: Math.random() }))
      .sort((a, b) => a.rand - b.rand)
      .map(a => a.pos)
      .slice(0, 20);
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

    const unitTypeCells = memoizedCellsInFootprint(position, footprint);

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
  const { BARRACKS, ENGINEERINGBAY, REACTOR, STARPORT, SUPPLYDEPOT, TECHLAB } = UnitType;
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
   * @param {Point2D} point
   * @returns {boolean}
   */
  const isPlaceBlockedByTownhall = (point) => {
    if (point.x === undefined || point.y === undefined) {
      return false;
    }

    const unitCells = memoizedCellsInFootprint(point, unitFootprint);

    // Calculate the full bounding box for the unit based on its footprint
    const unitBoundingBox = {
      x: point.x - Math.floor(unitFootprint.w / 2),
      y: point.y - Math.floor(unitFootprint.h / 2),
      w: unitFootprint.w,
      h: unitFootprint.h
    };

    return expansionPositions.some(expansion => {
      if (expansion.x === undefined || expansion.y === undefined) {
        return false;
      }

      const townhallFootprint = townhallFootprints.find(fp => fp.w && fp.h);

      if (!townhallFootprint) return false;

      // Calculate the full bounding box for the townhall based on its footprint
      const expansionBoundingBox = {
        x: expansion.x - Math.floor(townhallFootprint.w / 2),
        y: expansion.y - Math.floor(townhallFootprint.h / 2),
        w: townhallFootprint.w,
        h: townhallFootprint.h
      };

      const overlap = boundingBoxIntersects(unitBoundingBox, expansionBoundingBox);

      if (overlap) {
        const expansionCells = memoizedCellsInFootprint(expansion, townhallFootprint);
        return pointsOverlap(unitCells, expansionCells);
      }

      return false;
    });
  };

  /**
   * @param {Point2D} point
   * @returns {boolean}
   */
  const isValidPlacement = (point) => {
    const cells = memoizedCellsInFootprint(point, unitFootprint);
    if (cells.some(cell => !gameMap.isPlaceable(cell))) return false;
    if (getDistance(natural.townhallPosition, point) <= 4.5) return false;
    if (mainMineralLine.some(mlp => getDistance(mlp, point) <= 1.5)) return false;
    if (natural.areas?.hull?.some(hp => getDistance(hp, point) <= 3)) return false;
    if (units.getStructures({ alliance: Alliance.SELF }).some(u => getDistance(u.pos, point) <= 3)) return false;
    return !isPlaceBlockedByTownhall(point);
  };

  if (gasMineTypes.includes(unitType)) {
    const geyserPositions = MapResources.getFreeGasGeysers(gameMap, currentGameLoop)
      .map(geyser => {
        const { pos } = geyser;
        if (!pos) return { pos, buildProgress: 0 };
        const [closestBase] = units.getClosest(pos, units.getBases());
        return { pos, buildProgress: closestBase.buildProgress };
      })
      .filter(geyser => {
        const { pos, buildProgress } = geyser;
        if (!pos || buildProgress === undefined) return false;
        const [closestBase] = units.getClosest(pos, units.getBases());
        if (!closestBase) return false;
        const { unitType: baseType } = closestBase;
        if (!baseType) return false;
        const { buildTime } = data.getUnitTypeData(baseType);
        if (!buildTime) return false;
        const timeLeft = getBuildTimeLeft(closestBase, buildTime, buildProgress);
        const { buildTime: geyserBuildTime } = data.getUnitTypeData(unitType);
        if (!geyserBuildTime) return false;
        return getTimeInSeconds(timeLeft) <= getTimeInSeconds(geyserBuildTime);
      })
      .sort((a, b) => (a.buildProgress || 0) - (b.buildProgress || 0));

    const [topGeyserPosition] = geyserPositions;
    return topGeyserPosition && topGeyserPosition.pos ? [topGeyserPosition.pos] : [];
  }

  /** @type {Point2D[]} */
  let placements = [];
  const gameState = GameState.getInstance();
  const currentPlan = gameState.plan;

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
    const orphanAddons = units.getById([REACTOR, TECHLAB]);
    const buildingFootprints = Array.from(buildingPositions.entries()).reduce((positions, [step, buildingPos]) => {
      const stepData = currentPlan[step];
      const stepUnitType = stepData.unitType;
      if (!stepUnitType) return positions;

      const footprint = getFootprint(stepUnitType);
      if (!footprint) return positions;
      const newPositions = memoizedCellsInFootprint(buildingPos, footprint);
      if (canUnitBuildAddOn(stepUnitType)) {
        const addonFootprint = getFootprint(REACTOR);
        if (!addonFootprint) return positions;
        const addonPositions = memoizedCellsInFootprint(getAddOnPlacement(buildingPos), addonFootprint);
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
      const cells = memoizedCellsInFootprint(newPositions, footprint);
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
      const barracksCellInFootprints = BuildingPlacement.addOnPositions.map(position => memoizedCellsInFootprint(createPoint2D(position), barracksFootprint));
      wallOffPositions.push(...barracksCellInFootprints.flat());
    }

    if (BuildingPlacement.twoByTwoPositions.length > 0) {
      const supplyFootprint = getFootprint(SUPPLYDEPOT);
      if (!supplyFootprint) return [];
      const supplyCellInFootprints = BuildingPlacement.twoByTwoPositions.map(position => memoizedCellsInFootprint(position, supplyFootprint));
      wallOffPositions.push(...supplyCellInFootprints.flat());
    }

    if (BuildingPlacement.threeByThreePositions.length > 0) {
      const engineeringBayFootprint = getFootprint(ENGINEERINGBAY);
      if (!engineeringBayFootprint) return [];
      const engineeringBayCellInFootprints = BuildingPlacement.threeByThreePositions.map(position => memoizedCellsInFootprint(position, engineeringBayFootprint));
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
      const cells = [...memoizedCellsInFootprint(grid, unitTypeFootprint)];
      if (addonFootprint) {
        cells.push(...memoizedCellsInFootprint(getAddOnPlacement(grid), addonFootprint));
      }
      return cells.every(cell => gameMap.isPlaceable(cell)) &&
        !pointsOverlap(cells, [...wallOffPositions, ...buildingFootprintOfOrphanAddons, ...orphanAddonPositions]);
    }).map(pos => ({ pos, rand: Math.random() }))
      .sort((a, b) => a.rand - b.rand)
      .map(a => a.pos)
      .slice(0, 20);

  } else if (race === Race.ZERG) {
    placements.push(...findZergPlacements(world, unitType));
  }

  return placements;
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
  findPosition,
  findUnitPlacements,
};

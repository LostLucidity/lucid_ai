//@ts-check
"use strict"

const { UnitType } = require("@node-sc2/core/constants");
const { Alliance } = require("@node-sc2/core/constants/enums");
const groupTypes = require("@node-sc2/core/constants/groups");
const { TownhallRace } = require("@node-sc2/core/constants/race-map");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getNeighbors, createPoint2D } = require("@node-sc2/core/utils/geometry/point");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");

const { getGasGeysersCache, setGasGeysersCache } = require("./cacheModule");
const { getTimeInSeconds } = require("./pathfindingUtils");
const { getPathCoordinates } = require("./pathUtils");
const { getDistance } = require("./spatialUtils");
const GameState = require("../../core/gameState");
const MapResources = require("../../core/mapResources");

/** @type {Point2D[]} */
let adjacentToRampGrids = [];

/** @type {Point2D[]} */
let landingGrids = [];

/**
 * Adds a new landing grid.
 * @param {Point2D} grid - The grid to add.
 */
function addLandingGrid(grid) {
  landingGrids.push(grid);
}

/**
 * Identifies grids adjacent to ramps and on the path from the main base to the natural expansion.
 * @param {MapResource} map - The map resource object.
 */
function calculateAdjacentToRampGrids(map) {
  const main = map.getMain();
  if (!main || !main.areas) return [];

  const pathFromMain = map.getNatural().pathFromMain;
  if (!pathFromMain) return [];

  const pathFromMainToNatural = getPathCoordinates(pathFromMain);
  adjacentToRampGrids = main.areas.placementGrid.filter(grid => {
    const adjacentGrids = getNeighbors(grid);
    const isAdjacentToRamp = adjacentGrids.some(adjacentGrid => map.isRamp(adjacentGrid));
    const isOnPath = pathFromMainToNatural.some(pathGrid => getDistance(pathGrid, grid) <= 4);
    return isAdjacentToRamp && isOnPath;
  });
}

/**
 * Calculates the time it will take for a unit or building to reach a certain position.
 * 
 * @param {number} baseDistanceToPosition - The base distance to the position.
 * @param {number} buildTimeLeft - The remaining build time.
 * @param {number} movementSpeedPerSecond - The movement speed per second.
 * @returns {number} - The calculated time to position.
 */
const calculateBaseTimeToPosition = (baseDistanceToPosition, buildTimeLeft, movementSpeedPerSecond) => {
  return (baseDistanceToPosition / movementSpeedPerSecond) + getTimeInSeconds(buildTimeLeft) + movementSpeedPerSecond;
};

/**
 * Performs DBSCAN clustering on a given set of points.
 * 
 * @param {Point2D[]} points - The set of points to be clustered.
 * @param {number} [eps=1.5] - The maximum distance between two points.
 * @param {number} [minPts=1] - The minimum number of points to form a dense region.
 * @returns {Point2D[]} - The center points of each detected cluster.
 */
function dbscan(points, eps = 1.5, minPts = 1) {
  /** @type {Set<Point2D>[]} */
  let clusters = [];
  let visited = new Set();

  /**
   * Returns the neighbors of a given point within the 'eps' distance.
   *
   * @param {Point2D} p - The point for which to find the neighbors.
   * @returns {Point2D[]} - The neighboring points within the 'eps' distance.
   */
  function rangeQuery(p) {
    return points.filter(point => {
      const distance = getDistance(p, point);
      return distance <= eps;
    });
  }

  points.forEach(point => {
    if (visited.has(point)) {
      return;
    }

    visited.add(point);
    const neighbors = rangeQuery(point);

    if (neighbors.length < minPts) {
      return;
    }

    let cluster = new Set();
    clusters.push(cluster);

    neighbors.forEach(neighbor => {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        const neighbors2 = rangeQuery(neighbor);
        if (neighbors2.length >= minPts) {
          neighbors2.forEach(neighbor2 => neighbors.push(neighbor2));
        }
      }
      cluster.add(neighbor);
    });
  });

  /**
   * Calculates the centroid for each cluster.
   *
   * @returns {Point2D[]} - An array containing the centroids of the clusters.
   */
  return clusters.map(cluster => {
    let xSum = 0, ySum = 0;
    let count = 0;

    cluster.forEach(point => {
      if (point.x !== undefined && point.y !== undefined) {
        xSum += point.x;
        ySum += point.y;
        count++;
      }
    });

    if (count === 0) {
      return { x: 0, y: 0 }; // Or handle this case as appropriate
    }

    return { x: xSum / count, y: ySum / count };
  });
}

/**
 * Checks if a given point exists within the playable area of the map.
 * @param {MapResource} map - The map object.
 * @param {Point2D} position - The point to check.
 * @returns {boolean} - True if the point exists in the map, false otherwise.
 */
function existsInMap(map, position) {
  const mapSize = map.getSize();

  // Ensure position.x and position.y are defined before comparing
  if (typeof position.x !== 'number' || typeof position.y !== 'number') {
    return false;
  }

  // Check if mapSize.x and mapSize.y are defined
  if (typeof mapSize.x !== 'number' || typeof mapSize.y !== 'number') {
    return false;
  }

  // Return true if the position is within the map
  return (
    position.x >= 0 &&
    position.x < mapSize.x &&
    position.y >= 0 &&
    position.y < mapSize.y
  );
}

/**
 * @param {World} world 
 * @param {UnitTypeId} unitType
 * @returns {Point2D[]}
 */
function findZergPlacements(world, unitType) {
  const gameState = GameState.getInstance();
  const { townhallTypes } = groupTypes;
  const { resources } = world;
  const { map, units } = resources.get();
  const candidatePositions = [];
  if (townhallTypes.includes(unitType)) {
    // Use the getter to fetch the available expansions (assuming you have a getter for it).
    let availableExpansions = MapResources.getAvailableExpansions(resources);

    // If the availableExpansions is empty, fetch them using getAvailableExpansions and then set them using the setter
    if (!availableExpansions || availableExpansions.length === 0) {
      availableExpansions = MapResources.getAvailableExpansions(resources);
      gameState.setAvailableExpansions(availableExpansions);
    }

    // Now use the availableExpansions in the rest of your code
    candidatePositions.push(getNextSafeExpansions(world, availableExpansions)[0]);
  } else {
    const structures = units.getStructures();
    const mineralLinePoints = map.getExpansions().flatMap(expansion => expansion.areas && expansion.areas.mineralLine || []);
    /**
     * @param {Point2D} point
     * @returns {void}
     */
    const processPoint = (point) => {
      const point2D = createPoint2D(point);
      const [closestStructure] = units.getClosest(point2D, structures);
      if (closestStructure.pos && getDistance(point2D, closestStructure.pos) <= 12.5) {
        const [closestMineralLine] = getClosestPosition(point2D, mineralLinePoints);
        if (getDistance(point2D, closestMineralLine) > 1.5 && getDistance(point2D, closestStructure.pos) > 3) {
          candidatePositions.push(point2D);
        }
      }
    };
    if (unitType !== UnitType.NYDUSCANAL) {
      const creepClusters = dbscan(map.getCreep());
      creepClusters.forEach(processPoint);
    } else {
      map.getVisibility().forEach(processPoint);
    }
  }
  return candidatePositions;
}

/**
 * Calculates the placement for an add-on building based on the main building's position.
 * @param {Point2D} position - The position of the main building.
 * @returns {Point2D} - The calculated position for the add-on building.
 */
function getAddOnBuildingPlacement(position) {
  if (typeof position.x === 'number' && typeof position.y === 'number') {
    return { x: position.x - 3, y: position.y };
  } else {
    console.error('Invalid position provided for add-on building placement');
    return { x: 0, y: 0 }; // Default Point2D
  }
}

/**
 * Calculates the placement for an add-on structure based on the main building's position.
 * @param {Point2D} position - The position of the main building.
 * @returns {Point2D} - The calculated position for the add-on.
 */
const getAddOnPlacement = (position) => {
  const { x, y } = position;
  if (x === undefined) return position;
  return { x: x + 3, y: y };
};

/**
 * Get the adjacentToRampGrids property.
 * @returns {Point2D[]}
 */
function getAdjacentToRampGrids() {
  return adjacentToRampGrids;
}

/**
 * Retrieves all landing grids.
 * @returns {Point2D[]}
 */
function getAllLandingGrids() {
  return landingGrids;
}

/**
 * Gets the combined grids of a building and its associated add-on.
 * @param {Point2D} pos - The position of the building.
 * @param {UnitTypeId} unitType - The unit type of the building.
 * @returns {Point2D[]} - An array of grid positions for the building and add-on.
 */
function getBuildingAndAddonGrids(pos, unitType) {
  const unitFootprint = getFootprint(unitType);
  const addOnFootprint = getFootprint(UnitType.REACTOR);

  if (!unitFootprint || !addOnFootprint) {
    console.error('Invalid footprint data for', unitType, 'or REACTOR');
    return []; // Or handle this scenario as appropriate for your application
  }

  return [
    ...cellsInFootprint(pos, unitFootprint),
    ...cellsInFootprint(getAddOnPlacement(pos), addOnFootprint)
  ];
}

/**
 * @param {UnitResource} units
 * @returns {Point2D[]}
 */
function getBuildingFootprintOfOrphanAddons(units) {
  const orphanAddons = units.getById([UnitType.TECHLAB, UnitType.REACTOR]);
  /** @type {Point2D[]} */
  const buildingFootprints = [];
  orphanAddons.forEach(addon => {
    if (addon.pos) {
      const addonPlacement = getAddOnBuildingPlacement(addon.pos);
      if (addonPlacement) {
        buildingFootprints.push(...cellsInFootprint(createPoint2D(addonPlacement), { w: 3, h: 3 }));
      }
    }
  });
  return buildingFootprints;
}

/**
 * Finds the closest N positions to a given reference position.
 * @param {Point2D} position - The reference position.
 * @param {Point2D[]} locations - An array of positions to compare against.
 * @param {number} n - The number of closest positions to find.
 * @returns {Point2D[]} An array of the closest N positions.
 */
function getClosestPosition(position, locations, n = 1) {
  let sortedLocations = locations.map(location => ({ location, distance: getDistance(position, location) }));
  sortedLocations.sort((a, b) => a.distance - b.distance);
  return sortedLocations.slice(0, n).map(u => u.location);
}

/**
 * Retrieves gas geyser units from the unit resource.
 * Uses a cache to store and return the gas geysers.
 * @param {UnitResource} units - The unit resource object from the bot.
 * @returns {Unit[]}
 */
function getGasGeysers(units) {
  const cacheKey = 'gasGeysers';
  let gasGeysers = getGasGeysersCache(cacheKey);

  if (!gasGeysers) {
    gasGeysers = units.getGasGeysers();
    setGasGeysersCache(cacheKey, gasGeysers);
  }

  return gasGeysers;
}

/**
 * @param {World} world
 * @param {Expansion[]} expansions
 * @returns {Point2D[]}
 */
function getNextSafeExpansions(world, expansions) {
  const { agent, resources } = world;
  const { map, units } = resources.get();
  const enemyUnits = units.getAlive(Alliance.ENEMY);
  if (agent.race === undefined) {
    // Handle the undefined case - could be an error, a default value, etc.
    // Example: return an empty array or throw an error
    return [];
  }
  const townhallType = TownhallRace[agent.race][0];
  const placeableExpansions = expansions.filter(expansion => {
    const { townhallPosition } = expansion;
    const footprint = getFootprint(townhallType);
    if (footprint === undefined) return false;
    const enemyUnitCoverage = enemyUnits
      .reduce((/** @type {Point2D[]} */ coverage, enemyUnit) => {
        const { isFlying, pos, radius, unitType } = enemyUnit;
        if (isFlying === undefined || pos === undefined || radius === undefined || unitType === undefined) {
          return coverage;
        }

        if (!enemyUnit.isStructure()) {
          return !isFlying ? coverage.concat([pos, ...gridsInCircle(pos, radius)]) : coverage;
        } else {
          const footprint = getFootprint(unitType);
          return footprint ? coverage.concat(cellsInFootprint(pos, footprint)) : coverage;
        }
      }, []);
    return map.isPlaceableAt(townhallType, townhallPosition) && !pointsOverlap(enemyUnitCoverage, cellsInFootprint(townhallPosition, footprint));
  });
  return placeableExpansions.map(expansion => expansion.townhallPosition);
}

/**
 * Identifies occupied expansions on the map.
 * @param {ResourceManager} resources - The resources object from the game world.
 * @returns {Expansion[]}
 */
function getOccupiedExpansions(resources) {
  const { map, units } = resources.get();
  // get Expansion and filter by bases near townhall position.
  const bases = units.getBases();
  const occupiedExpansions = map.getExpansions().filter(expansion => {
    const [closestBase] = units.getClosest(expansion.townhallPosition, bases);
    if (closestBase) {
      return getDistance(expansion.townhallPosition, closestBase.pos) < 1;
    }
  });
  return occupiedExpansions;
}

/**
 * @param {UnitResource} units
 * @param {Point2D} movingPosition
 * @returns {Unit | undefined}
 * @description Returns the structure at the given position.
 */
function getStructureAtPosition(units, movingPosition) {
  return units.getStructures().find(unit => {
    const { pos } = unit; if (pos === undefined) return false;
    return getDistance(pos, movingPosition) < 1;
  });
}

/**
 * Calculate a position away from a building given a unit's position.
 * @param {Point2D} buildingPosition
 * @param {Point2D} unitPosition
 * @returns {Point2D}
 */
function getAwayPosition(buildingPosition, unitPosition) {
  // Default to 0 if undefined
  const unitX = unitPosition.x || 0;
  const unitY = unitPosition.y || 0;
  const buildingX = buildingPosition.x || 0;
  const buildingY = buildingPosition.y || 0;

  const dx = unitX - buildingX;
  const dy = unitY - buildingY;
  return {
    x: unitX + dx,
    y: unitY + dy
  };
}

/**
 * Determines if two points are approximately equal within a small margin of error.
 * @param {SC2APIProtocol.Point2D} point1
 * @param {SC2APIProtocol.Point2D} point2
 * @param {number} epsilon - The margin of error for comparison.
 * @returns {boolean}
 */
const areApproximatelyEqual = (point1, point2, epsilon = 0.0002) => {
  if (point1.x === undefined || point1.y === undefined || point2.x === undefined || point2.y === undefined) {
    return false;
  }

  const dx = Math.abs(point1.x - point2.x);
  const dy = Math.abs(point1.y - point2.y);

  return dx < epsilon && dy < epsilon;
};


/**
 * Retrieves cell positions occupied by given structures.
 * @param {Point2D} position - The position to check around.
 * @param {Unit[]} structures - The structures to consider.
 * @returns {Point2D[]} - Array of cells occupied by the structures.
 */
function getStructureCells(position, structures) {
  return structures.reduce((/** @type {Point2D[]} */ acc, structure) => {
    const { pos, unitType } = structure;
    if (pos === undefined || unitType === undefined) return acc;
    if (getDistance(pos, position) <= 1) {
      const footprint = getFootprint(unitType);
      if (footprint === undefined) return acc;
      acc.push(...cellsInFootprint(createPoint2D(pos), footprint));
    }
    return acc;
  }, []);
}

/**
 * Finds the intersection of two arrays of points.
 * @param {Point2D[]} firstArray 
 * @param {Point2D[]} secondArray 
 * @returns {Point2D[]}
 */
function intersectionOfPoints(firstArray, secondArray) {
  return firstArray.filter(first =>
    secondArray.some(second => getDistance(first, second) < 1)
  );
}

/**
 * Checks if a building and its associated add-on are placeable at a given grid location.
 * @param {MapResource} map - The map resource.
 * @param {UnitTypeId} unitType - The unit type of the building.
 * @param {Point2D} grid - The grid position to check for placement.
 * @returns {boolean} - True if both the building and its add-on are placeable at the grid position.
 */
function isBuildingAndAddonPlaceable(map, unitType, grid) {
  return map.isPlaceableAt(unitType, grid) && map.isPlaceableAt(UnitType.REACTOR, getAddOnPlacement(grid));
}

/**
 * Checks if any points in two arrays are within a specified range of each other.
 * 
 * @param {Point2D[]} firstArray - The first array of points.
 * @param {Point2D[]} secondArray - The second array of points.
 * @param {number} [range=1] - The range within which points are considered to overlap.
 * @returns {boolean} - Returns true if any point in the first array is within the specified range of any point in the second array, otherwise false.
 */
function pointsOverlap(firstArray, secondArray, range = 1) {
  const cellSize = range;

  /**
   * Grid to store points, mapped to their corresponding cells.
   * Each cell is identified by a string key in the format 'x,y', 
   * and contains an array of points that fall into that cell.
   * @type {Map<string, Point2D[]>}
   */
  const grid = new Map();

  for (const point of secondArray) {
    if (point.x === undefined || point.y === undefined) {
      continue; // Skip the point if x or y is undefined
    }

    const xCell = Math.floor(point.x / cellSize);
    const yCell = Math.floor(point.y / cellSize);
    const key = `${xCell},${yCell}`;

    // Directly initialize the array if it doesn't exist, then push the point
    const cell = grid.get(key) || [];
    cell.push(point);
    grid.set(key, cell);
  }

  return firstArray.some(first => {
    if (first.x === undefined || first.y === undefined) {
      return false; // Skip the point if x or y is undefined
    }

    const xCell = Math.floor(first.x / cellSize);
    const yCell = Math.floor(first.y / cellSize);

    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const key = `${xCell + i},${yCell + j}`;
        const pointsInCell = grid.get(key);

        if (pointsInCell && pointsInCell.some(second => getDistance(first, second) < range)) {
          return true;
        }
      }
    }

    return false;
  });
}

/**
 * Set the adjacentToRampGrids property.
 * @param {Point2D[]} grids - The array of Point2D objects.
 */
function setAdjacentToRampGrids(grids) {
  adjacentToRampGrids = grids;
}

module.exports = {
  adjacentToRampGrids,
  landingGrids,
  addLandingGrid,
  calculateAdjacentToRampGrids,
  calculateBaseTimeToPosition,
  cellsInFootprint,
  dbscan,
  existsInMap,
  findZergPlacements,
  getAddOnBuildingPlacement,
  getAddOnPlacement,
  getAdjacentToRampGrids,
  getAllLandingGrids,
  getBuildingAndAddonGrids,
  getBuildingFootprintOfOrphanAddons,
  getFootprint,
  getGasGeysers,
  getNextSafeExpansions,
  getOccupiedExpansions,
  getStructureAtPosition,
  getClosestPosition,
  getAwayPosition,
  areApproximatelyEqual,
  getStructureCells,
  intersectionOfPoints,
  isBuildingAndAddonPlaceable,
  pointsOverlap,
  setAdjacentToRampGrids
};
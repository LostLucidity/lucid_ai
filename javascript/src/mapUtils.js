//@ts-check
"use strict"

// External library imports from @node-sc2/core
const { Alliance } = require('@node-sc2/core/constants/enums');
const { TownhallRace } = require('@node-sc2/core/constants/race-map');
const { gridsInCircle } = require('@node-sc2/core/utils/geometry/angle');
const { cellsInFootprint } = require('@node-sc2/core/utils/geometry/plane');
const { getNeighbors } = require('@node-sc2/core/utils/geometry/point');
const { getFootprint } = require('@node-sc2/core/utils/geometry/units');

// Internal module imports
const { getGasGeysersCache, setGasGeysersCache } = require('./cacheModule');
const { getDistance } = require('./geometryUtils');
const { getPathCoordinates } = require('./pathUtils');


/**
 * Provides utilities and functions related to map analysis and pathfinding.
 */
const mapUtils = {
  /** @type {Point2D[]} */
  adjacentToRampGrids: [],

  /**
   * Identifies grids adjacent to ramps and on the path from the main base to the natural expansion.
   * @param {MapResource} map - The map resource object.
   */
  calculateAdjacentToRampGrids(map) {
    const main = map.getMain();
    if (!main || !main.areas) return [];

    const pathFromMain = map.getNatural().pathFromMain;
    if (!pathFromMain) return [];

    const pathFromMainToNatural = getPathCoordinates(pathFromMain);
    mapUtils.adjacentToRampGrids = main.areas.placementGrid.filter(grid => {
      const adjacentGrids = getNeighbors(grid);
      const isAdjacentToRamp = adjacentGrids.some(adjacentGrid => map.isRamp(adjacentGrid));
      const isOnPath = pathFromMainToNatural.some(pathGrid => getDistance(pathGrid, grid) <= 4);
      return isAdjacentToRamp && isOnPath;
    });
  },

  /**
   * Performs DBSCAN clustering on a given set of points.
   * 
   * @param {Point2D[]} points - The set of points to be clustered.
   * @param {number} [eps=1.5] - The maximum distance between two points.
   * @param {number} [minPts=1] - The minimum number of points to form a dense region.
   * @returns {Point2D[]} - The center points of each detected cluster.
   */
  dbscan(points, eps = 1.5, minPts = 1) {
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
  },  

  /**
   * Attempts to find the enemy's base location.
   * @param {MapResource} map - The map resource object from the bot.
   * @param {Point2D} myBaseLocation - The bot's main base location.
   * @returns {Point2D | null} - The suspected enemy base location or null if not found.
   */
  findEnemyBase(map, myBaseLocation) {
    const possibleExpansions = map.getExpansions();
    let enemyBaseLocation = null;

    // Example: On a two-player map, the enemy base is typically the farthest expansion
    let maxDistance = 0;
    for (const expansion of possibleExpansions) {
      const distance = getDistance(expansion.townhallPosition, myBaseLocation);
      if (distance > maxDistance) {
        maxDistance = distance;
        enemyBaseLocation = expansion.townhallPosition;
      }
    }

    return enemyBaseLocation;
  },

  /**
   * Get the adjacentToRampGrids property.
   * @returns {Point2D[]}
   */
  getAdjacentToRampGrids() {
    return mapUtils.adjacentToRampGrids;
  },
  
  /**
   * Checks if a line between two points is traversable on the map.
   * @param {MapResource} map - The map object.
   * @param {Point2D} start - The start point of the line.
   * @param {Point2D} end - The end point of the line.
   * @returns {boolean} - True if the line is traversable, false otherwise.
   */
  isLineTraversable(map, start, end) {
    // Ensure both points have defined x and y values
    if (typeof start.x !== 'number' || typeof start.y !== 'number' ||
      typeof end.x !== 'number' || typeof end.y !== 'number') {
      throw new Error("Start or end points are not properly defined.");
    }

    let x0 = start.x;
    let y0 = start.y;
    const x1 = end.x;
    const y1 = end.y;

    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);

    const sx = (x0 < x1) ? 1 : -1;
    const sy = (y0 < y1) ? 1 : -1;

    let err = dx + dy;

    // Use the coordinates comparison as the loop condition
    while (!(x0 === x1 && y0 === y1)) {
      if (!map.isPathable({ x: x0, y: y0 })) {
        return false;
      }

      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }

    return true;
  },

  /**
   * Retrieves gas geyser units from the unit resource.
   * Uses a cache to store and return the gas geysers.
   * @param {UnitResource} units - The unit resource object from the bot.
   * @returns {Unit[]}
   */
  getGasGeysers(units) {
    const cacheKey = 'gasGeysers';
    let gasGeysers = getGasGeysersCache(cacheKey);

    if (!gasGeysers) {
      gasGeysers = units.getGasGeysers();
      setGasGeysersCache(cacheKey, gasGeysers);
    }

    return gasGeysers;
  },

  /**
   * @param {World} world
   * @param {Expansion[]} expansions
   * @returns {Point2D[]}
   */
  getNextSafeExpansions: (world, expansions) => {
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
      return map.isPlaceableAt(townhallType, townhallPosition) && !this.pointsOverlap(enemyUnitCoverage, cellsInFootprint(townhallPosition, footprint));
    });
    return placeableExpansions.map(expansion => expansion.townhallPosition);
  },

  /**
   * Checks if any points in two arrays are within a specified range of each other.
   * 
   * @param {Point2D[]} firstArray - The first array of points.
   * @param {Point2D[]} secondArray - The second array of points.
   * @param {number} [range=1] - The range within which points are considered to overlap.
   * @returns {boolean} - Returns true if any point in the first array is within the specified range of any point in the second array, otherwise false.
   */
  pointsOverlap: (firstArray, secondArray, range = 1) => {
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
  },

  /**
   * Identifies occupied expansions on the map.
   * @param {ResourceManager} resources - The resources object from the game world.
   * @returns {Expansion[]}
   */
  getOccupiedExpansions(resources) {
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
  },

  /**
   * Checks if a given point exists within the playable area of the map.
   * @param {MapResource} map - The map object.
   * @param {Point2D} position - The point to check.
   * @returns {boolean} - True if the point exists in the map, false otherwise.
   */
  existsInMap: (map, position) => {
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
  },

  /**
   * Set the adjacentToRampGrids property.
   * @param {Point2D[]} grids - The array of Point2D objects.
   */
  setAdjacentToRampGrids(grids) {
    mapUtils.adjacentToRampGrids = grids;
  },  
};

module.exports = mapUtils;

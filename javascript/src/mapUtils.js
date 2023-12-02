//@ts-check
"use strict"

// External library imports from @node-sc2/core
const { Alliance } = require('@node-sc2/core/constants/enums');
const { TownhallRace } = require('@node-sc2/core/constants/race-map');
const { gridsInCircle } = require('@node-sc2/core/utils/geometry/angle');
const { cellsInFootprint } = require('@node-sc2/core/utils/geometry/plane');
const { getFootprint } = require('@node-sc2/core/utils/geometry/units');

// Internal module imports
const { getGasGeysersCache, setGasGeysersCache } = require('./cacheModule');
const { getDistance } = require('./geometryUtils');


/**
 * Provides utilities and functions related to map analysis and pathfinding.
 */
const mapUtils = {
  /**
   * @param {MapResource} map
   * @param {Point2D[]} line - An array containing two points that define a straight line segment.
   * @returns {boolean}
   */  
  isLineTraversable(map, line) {
    const [start, end] = line;
    const { x: startX, y: startY } = start; if (startX === undefined || startY === undefined) return false;
    const { x: endX, y: endY } = end; if (endX === undefined || endY === undefined) return false;

    // Use fallback value if getDistance returns undefined
    const distance = getDistance(start, end) || 0;

    // Assume the unit width is 1
    const unitWidth = 1;

    // Calculate the number of points to check along the line, spaced at unit-width intervals
    const numPoints = distance === 0 ? 0 : Math.ceil(distance / unitWidth);

    // For each point along the line segment
    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints; // The fraction of the way from the start point to the end point

      // Calculate the coordinates of the point
      const x = startX + t * (endX - startX);
      const y = startY + t * (endY - startY);
      const point = { x, y };

      // If the point is not on walkable terrain, return false
      if (!map.isPathable(point)) {
        return false;
      }
    }

    // If all points along the line are on walkable terrain, return true
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
   * Performs DBSCAN (Density-Based Spatial Clustering of Applications with Noise) clustering
   * on a given set of points. This clustering algorithm groups together points that are close 
   * to each other based on a distance measurement (eps) and a minimum number of points. 
   * It also marks as noise the points that are in low-density regions.
   *
   * @param {Point2D[]} points - The set of points to be clustered.
   * @param {number} [eps=1.5] - The maximum distance between two points for one to be considered as in the neighborhood of the other.
   * @param {number} [minPts=1] - The minimum number of points to form a dense region.
   * 
   * @returns {Point2D[]} - The center points of each detected cluster.
   */
  dbscan(points, eps = 1.5, minPts = 1) {
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
      let x = 0, y = 0;
      cluster.forEach(point => {
        x += point.x;
        y += point.y;
      });
      return { x: x / cluster.size, y: y / cluster.size };
    });
  },  
};

module.exports = mapUtils;

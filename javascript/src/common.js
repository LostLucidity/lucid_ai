//@ts-check
"use strict"

const { getDistance } = require("./geometryUtils");

/**
 * @typedef {Object.<string, number>} UnitTypeMap
 */

/**
 * Compares two positions for equality.
 *
 * @param {SC2APIProtocol.Point} pos1 - The first position.
 * @param {SC2APIProtocol.Point} pos2 - The second position.
 * @returns {boolean} - True if the positions are equal, false otherwise.
 */
function areEqual(pos1, pos2) {
  return pos1.x === pos2.x && pos1.y === pos2.y;
}

/**
 * @param {MapResource} map
 * @param {Point2D} position 
 * @returns {Point2D[]}
 */
function getClosestPathablePositions(map, position) {
  const { x, y } = position;
  if (x === undefined || y === undefined) return [position];

  const gridCorners = [
    { x: Math.floor(x), y: Math.floor(y) },
    { x: Math.ceil(x), y: Math.floor(y) },
    { x: Math.floor(x), y: Math.ceil(y) },
    { x: Math.ceil(x), y: Math.ceil(y) },
  ].filter((grid, index, self) => {
    const mapSize = map.getSize();
    const mapEdge = { x: mapSize.x, y: mapSize.y };
    if (grid.x === mapEdge.x || grid.y === mapEdge.y) return false;
    return self.findIndex(g => areEqual(g, grid)) === index;
  });

  const placeableCorners = gridCorners.filter(corner => map.isPathable(corner));

  // Use fallback value if getDistance returns undefined
  const sortedCorners = placeableCorners.sort((a, b) => {
    const distanceA = getDistance(a, position) || Number.MAX_VALUE;
    const distanceB = getDistance(b, position) || Number.MAX_VALUE;
    return distanceA - distanceB;
  });

  // Filter out corners that have the same minimum distance
  const closestCorners = sortedCorners.filter(corner => {
    const minDistance = getDistance(sortedCorners[0], position) || Number.MAX_VALUE;
    return (getDistance(corner, position) || Number.MAX_VALUE) === minDistance;
  });

  return closestCorners;
}

/**
 * Converts an ActionRawUnitCommand to an SC2APIProtocol.Action.
 * @param {SC2APIProtocol.ActionRawUnitCommand} cmd - The command to convert.
 * @returns {SC2APIProtocol.Action} The converted action.
 */
function convertToAction(cmd) {
  const actionRaw = {
    unitCommand: cmd
  };

  return {
    actionRaw: actionRaw
  };
}

module.exports = {
  areEqual,
  getClosestPathablePositions,
  convertToAction,
};

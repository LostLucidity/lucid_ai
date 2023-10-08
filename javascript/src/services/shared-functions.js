// shared-functions.js

const { avgPoints } = require("@node-sc2/core/utils/geometry/point");
const { getDistance } = require("../../services/position-service");
const pathFindingService = require("./pathfinding/pathfinding-service");

/**
 * 
 * @param {ResourceManager} resources 
 * @param {Point2D} position
 * @param {Point2D} targetPosition
 * @returns {Unit | undefined}
 * @description returns closest safe mineral field to position
 */
module.exports.getClosestSafeMineralField = (resources, position, targetPosition) => {
  const { map, units } = resources.get();
  return map.getExpansions().reduce((/** @type {Unit | undefined} */ acc, expansion) => {
    const { areas, cluster, townhallPosition } = expansion; if (areas === undefined || cluster === undefined) return acc;
    const { mineralLine } = areas; if (mineralLine === undefined) return acc;
    const mineralFields = units.getMineralFields().filter(mineralField => mineralField.pos && getDistance(townhallPosition, mineralField.pos) < 14);
    const averageMineralLinePosition = avgPoints(mineralLine);
    const distancePositionToMineralLine = pathFindingService.getDistanceByPath(resources, position, averageMineralLinePosition);
    const distanceTargetToMineralLine = pathFindingService.getDistanceByPath(resources, targetPosition, averageMineralLinePosition);
    if (distancePositionToMineralLine < distanceTargetToMineralLine) {
      const [closestMineralField] = mineralFields;
      return closestMineralField;
    }
    return acc;
  }, undefined);
};

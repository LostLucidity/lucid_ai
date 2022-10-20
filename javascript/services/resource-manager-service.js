//@ts-check
"use strict"

const { SMART } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { distance, areEqual } = require("@node-sc2/core/utils/geometry/point");
const { getTargetedByWorkers, setPendingOrders } = require("../systems/unit-resource/unit-resource-service");
const { createUnitCommand } = require("./actions-service");
const { getPathablePositions, getPathablePositionsForStructure, getMapPath, getClosestPathablePosition } = require("./map-resource-service");
const { getPathCoordinates } = require("./path-service");
const { getDistance } = require("./position-service");

const resourceManagerService = {
  /** @type {Expansion[]} */
  availableExpansions: [],
  /** @type {Point2D} */
  combatRally: null,
  /**
   * @param {ResourceManager} resources
   * @param {Unit} unit 
   * @param {Unit | null} mineralField
   * @param {boolean} queue 
   * @returns {SC2APIProtocol.ActionRawUnitCommand | null}
   */
  gather: (resources, unit, mineralField, queue = true) => {
    const { units } = resources.get();
    const { pos: unitPos } = unit;
    if (unitPos === undefined) { return null; }
    if (unit.labels.has('command') && queue === false) {
      console.warn('WARNING! unit with command erroniously told to force gather! Forcing queue');
      queue = true;
    }
    const ownBases = units.getBases(Alliance.SELF).filter(b => b.buildProgress >= 1);
    let target;
    if (mineralField && mineralField.tag) {
      target = mineralField;
    } else {
      let targetBase;
      const needyBases = ownBases.filter(base => {
        const { assignedHarvesters, idealHarvesters } = base;
        if (assignedHarvesters === undefined || idealHarvesters === undefined) { return false; }
        return assignedHarvesters < idealHarvesters
      });
      const localMaxDistanceOfMineralFields = 9;
      const candidateBases = needyBases.length > 0 ? needyBases : ownBases;
      targetBase = resourceManagerService.getClosestUnitFromUnit(resources, unit, candidateBases);
      if (targetBase === undefined || targetBase.pos === undefined) { return null; }
      [target] = getUnitsWithinDistance(targetBase.pos, units.getMineralFields(), localMaxDistanceOfMineralFields).sort((a, b) => {
        const targetedByWorkersACount = getTargetedByWorkers(units, a).length;
        const targetedByWorkersBCount = getTargetedByWorkers(units, b).length;
        return targetedByWorkersACount - targetedByWorkersBCount;
      });
    }
    if (target) {
      const sendToGather = createUnitCommand(SMART, [unit]);
      sendToGather.targetUnitTag = target.tag;
      sendToGather.queueCommand = queue;
      setPendingOrders(unit, sendToGather);
      return sendToGather;
    }
    return null;
  },
  /**
   * @param {ResourceManager} resources
   * @param {Point2D} position
   * @param {Point2D} targetPosition
   * @returns {{pathablePosition: Point2D, pathableTargetPosition: Point2D, distance: number}}
   */
  getClosestPathablePositionsBetweenPositions: (resources, position, targetPosition) => {
    const { map } = resources.get();
    const pathablePositions = getPathablePositions(map, position);
    const pathableTargetPositions = getPathablePositions(map, targetPosition);
    const distancesAndPositions = pathablePositions.map(pathablePosition => {
      const distancesToTargetPositions = pathableTargetPositions.map(pathableTargetPosition => {
        return {
          pathablePosition,
          pathableTargetPosition,
          distance: resourceManagerService.getDistanceByPath(resources, pathablePosition, pathableTargetPosition)
        };
      });
      return distancesToTargetPositions.reduce((acc, curr) => {
        return acc.distance < curr.distance ? acc : curr;
      });
    }).sort((a, b) => a.distance - b.distance);
    return distancesAndPositions[0];
  },
  /**
   * 
   * @param {ResourceManager} resources 
   * @param {Point2D} position 
   * @param {Point2D[]} points
   * @param {number} n
   * @returns {Point2D[]}
   */
  getClosestPositionByPath: (resources, position, points, n = 1) => {
    return points.map(point => ({ point, distance: resourceManagerService.getDistanceByPath(resources, position, point) }))
      .sort((a, b) => a.distance - b.distance)
      .map(pointObject => pointObject.point)
      .slice(0, n);
  },
  /**
   *
   * @param {ResourceManager} resources
   * @param {Point2D|SC2APIProtocol.Point} position
   * @param {Unit[]} units
   * @param {number} n
   * @returns {Unit[]}
   */
  getClosestUnitByPath: (resources, position, units, n = 1) => {
    return units.map(unit => {
      const { pos } = unit;
      if (pos === undefined) return;
      const mappedUnits = { unit }
      if (unit.isFlying) {
        mappedUnits.distance = distance(position, pos);
      } else {
        const closestPathablePositionBetweenPositions = resourceManagerService.getClosestPathablePositionsBetweenPositions(resources, position, pos);
        mappedUnits.distance = closestPathablePositionBetweenPositions.distance;
      }
      return mappedUnits;
    })
      .sort((a, b) => a.distance - b.distance)
      .map(u => u.unit)
      .slice(0, n);
  },
  /**
   * @param {ResourceManager} resources
   * @param {Point2D} unitPosition
   * @param {Point2D} position
   * @returns {Point2D}
   */
  getClosestUnitPositionByPath: (resources, unitPosition, position) => {
    const { map } = resources.get();
    const pathablePositions = getPathablePositions(map, unitPosition);
    const [closestPositionByPath] = resourceManagerService.getClosestPositionByPath(resources, position, pathablePositions);
    return closestPositionByPath;
  },
  /**
   *
   * @param {ResourceManager} resources
   * @param {Unit} unit
   * @param {Unit[]} units
   * @returns {Unit | undefined}
   */
  getClosestUnitFromUnit(resources, unit, units) {
    const { map } = resources.get();
    const { pos } = unit;
    if (pos === undefined) return undefined;
    const pathablePositions = getPathablePositionsForStructure(map, unit);
    const pathablePositionsForUnits = units.map(unit => getPathablePositionsForStructure(map, unit));
    const distances = pathablePositions.map(pathablePosition => {
      const distancesToUnits = pathablePositionsForUnits.map(pathablePositionsForUnit => {
        const distancesToUnit = pathablePositionsForUnit.map(pathablePositionForUnit => {
          return resourceManagerService.getDistanceByPath(resources, pathablePosition, pathablePositionForUnit);
        });
        return Math.min(...distancesToUnit);
      });
      return Math.min(...distancesToUnits);
    });
    const closestPathablePosition = pathablePositions[distances.indexOf(Math.min(...distances))];
    return resourceManagerService.getClosestUnitByPath(resources, closestPathablePosition, units, 1)[0];
  },
  /**
  * @param {ResourceManager} resources
  * @param {Point2D} position
  * @param {Point2D|SC2APIProtocol.Point} targetPosition
  * @returns {number}
  */
  getDistanceByPath: (resources, position, targetPosition) => {
    const { map } = resources.get();
    try {
      const line = getLine(position, targetPosition);
      let distance = 0;
      if (line.every(point => map.isPathable(getClosestPathablePosition(map, point)))) {
        return getDistance(position, targetPosition);
      } else {
        let path = getMapPath(map, position, targetPosition);
        const pathCoordinates = getPathCoordinates(path);
          const straightLines = getStraightLines(map, pathCoordinates);
          const straightLineDistances = straightLines.map(straightLine => {
            const start = straightLine[0];
            const end = straightLine[straightLine.length - 1];
            if (start === undefined || end === undefined) return 0;
            return getDistance(start, end);
          });
          distance = straightLineDistances.reduce((acc, curr) => acc + curr, 0);
        const calculatedZeroPath = path.length === 0;
        const isZeroPathDistance = calculatedZeroPath && getDistance(position, targetPosition) <= 2 ? true : false;
        const isNotPathable = calculatedZeroPath && !isZeroPathDistance ? true : false;
        const pathLength = isZeroPathDistance ? 0 : isNotPathable ? Infinity : distance;
        return pathLength;
      }
    } catch (error) {
      return Infinity;
    }
  },
}

module.exports = resourceManagerService;
 
/**
 * @param {Point2D} pos 
 * @param {Unit[]} units 
 * @param {Number} maxDistance
 * @returns {Unit[]}
 */
function getUnitsWithinDistance(pos, units, maxDistance) {
  return units.filter(unit => {
    const { pos: unitPos } = unit;
    if (unitPos === undefined) { return false; }
    return distance(unitPos, pos) <= maxDistance;
  });
}

/**
 * @param {MapResource} map
 * @param {Point2D[]} pathCoordinates 
 * returns an array of array of points
 * @returns {Point2D[][]}
 */
function getStraightLines(map, pathCoordinates, calls=0) {
  const firstCoordinate = pathCoordinates[0];
  const lastCoordinate = pathCoordinates[pathCoordinates.length - 1];
  if (pathCoordinates.length > 2) {
    /** @type {Point2D[][]} */
    const straightLines = [];
    const straightLine = getLine(firstCoordinate, lastCoordinate, pathCoordinates.length);
    const straightLineIsPathableIndex = straightLine.findIndex(point => !map.isPathable(getClosestPathablePosition(map, point)));
    if (straightLineIsPathableIndex === -1) {
      straightLines.push(straightLine);
    } else {
      straightLines.push(straightLine.slice(0, straightLineIsPathableIndex));
      const newStraightLineStart = straightLine[straightLineIsPathableIndex];
      const closestPointToNewStraightLineStart = pathCoordinates.reduce((acc, curr) => {
        const accDistance = getDistance(acc, newStraightLineStart);
        const currDistance = getDistance(curr, newStraightLineStart);
        return accDistance < currDistance ? acc : curr;
      });
      const closestPointToNewStraightLineStartIndex = pathCoordinates.findIndex(point => areEqual(point, closestPointToNewStraightLineStart));
      const newStraightLine = getStraightLines(map, pathCoordinates.slice(closestPointToNewStraightLineStartIndex === 0 ? 1 : closestPointToNewStraightLineStartIndex), calls + 1);
      straightLines.push(...newStraightLine);
    }
    return straightLines;
  } else {
    return [pathCoordinates];
  }
}

/**
 * 
 * @param {Point2D} start 
 * @param {Point2D} end 
 * @param {Number} steps
 * @returns  {Point2D[]}
 */
function getLine(start, end, steps=0) {
  const points = [];
  if (areEqual(start, end)) return [start];
  const { x: startX, y: startY } = start;
  const { x: endX, y: endY } = end;
  if (startX === undefined || startY === undefined || endX === undefined || endY === undefined) return [start];
  const dx = endX - startX;
  const dy = endY - startY;
  steps = steps === 0 ? Math.max(Math.abs(dx), Math.abs(dy)) : steps;
  for (let i = 0; i < steps; i++) {
    const x = startX + (dx / steps) * i;
    const y = startY + (dy / steps) * i;
    points.push({ x, y });
  }
  return points;
}

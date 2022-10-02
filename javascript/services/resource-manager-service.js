//@ts-check
"use strict"

const { SMART } = require("@node-sc2/core/constants/ability");
const { Race, Alliance } = require("@node-sc2/core/constants/enums");
const { EGG } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getTargetedByWorkers, setPendingOrders } = require("../systems/unit-resource/unit-resource-service");
const { createUnitCommand } = require("./actions-service");
const { getPathablePositions, getPathablePositionsForStructure, getMapPath } = require("./map-resource-service");
const { getPathCoordinates } = require("./path-service");

const resourceManagerService = {
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
      if (needyBases.length > 0) {
        targetBase = resourceManagerService.getClosestUnitFromUnit(resources, unit, needyBases);
        if (targetBase === undefined || targetBase.pos === undefined) { return null; }
        [target] = getUnitsWithinDistance(targetBase.pos, units.getMineralFields(), 8).sort((a, b) => {
          const targetedByWorkersACount = getTargetedByWorkers(units, a).length;
          const targetedByWorkersBCount = getTargetedByWorkers(units, b).length;
          return targetedByWorkersACount - targetedByWorkersBCount;
        });
      } else {
        targetBase = resourceManagerService.getClosestUnitFromUnit(resources, unit, ownBases);
        [target] = getUnitsWithinDistance(unitPos, units.getMineralFields(), 8).sort((a, b) => {
          const targetedByWorkersACount = getTargetedByWorkers(units, a).length;
          const targetedByWorkersBCount = getTargetedByWorkers(units, b).length;
          return targetedByWorkersACount - targetedByWorkersBCount;
        });
      }
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
  * @returns number
  */
  getDistanceByPath: (resources, position, targetPosition) => {
    const { map } = resources.get();
    try {
      let path = getMapPath(map, position, targetPosition);
      const calculatedZeroPath = path.length === 0;
      const isZeroPathDistance = calculatedZeroPath && distance(position, targetPosition) <= 2 ? true : false;
      const isNotPathable = calculatedZeroPath && !isZeroPathDistance ? true : false;
      const { totalDistance } = getPathCoordinates(map.path(position, targetPosition)).reduce((acc, curr) => {
        return {
          totalDistance: acc.totalDistance + distance(curr, acc.previousPosition),
          previousPosition: curr
        }
      }, {
        totalDistance: 0,
        previousPosition: position
      });
      const pathLength = isZeroPathDistance ? 0 : isNotPathable ? Infinity : totalDistance;
      return pathLength;
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

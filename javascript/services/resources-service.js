//@ts-check
"use strict"

const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getBuilders } = require("../systems/unit-resource/unit-resource-service");
const { getPathCoordinates } = require("./path-service");
const { getUnitCornerPosition } = require("./unit-service");

const resourcesService = {
  /**
   * @param {ResourceManager} resources 
  * @param {
  Point2D
} position
  * @param {
  Point2D
} targetPosition
  * @returns {
  number
}
  */
  distanceByPath: (resources, position, targetPosition) => {
    const { map, units } = resources.get();
    try {
      targetPosition = map.isPathable(targetPosition) ? targetPosition : getUnitCornerPosition(units.getClosest(targetPosition, units.getAlive())[0]);
      const calculatedZeroPath = map.path(position, targetPosition).length === 0;
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
  /**
   * @param {ResourceManager} resources 
   * @param {Unit[]} units 
   * @param {Unit} targetUnit 
   * @returns {Unit}
   */
  getCombatPoint: (resources, units, targetUnit) => {
    const label = 'combatPoint';
    const combatPoint = units.find(unit => unit.labels.get(label));
    if (combatPoint) {
      let sameTarget = false;
      if (combatPoint.orders[0]) {
        const filteredOrder = combatPoint.orders.filter(order => !!order.targetWorldSpacePos)[0];
        sameTarget = filteredOrder && (Math.round(filteredOrder.targetWorldSpacePos.x * 2) / 2) === targetUnit.pos.x && (Math.round(filteredOrder.targetWorldSpacePos.y * 2) / 2) === targetUnit.pos.y;
      }
      if (sameTarget) {
        return combatPoint;
      } else {
        combatPoint.labels.delete(label);
        return resourcesService.setCombatPoint(resources, units, targetUnit);
      }
    } else {
      return resourcesService.setCombatPoint(resources, units, targetUnit);
    }
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
    return points.map(point => ({ point, distance: resourcesService.distanceByPath(resources, position, point) }))
      .sort((a, b) => a.distance - b.distance)
      .map(pointObject => pointObject.point)
      .slice(0, n);
  },
  /**
   *
   * @param {ResourceManager} resources
   * @param {Point2D} position
   * @param {Unit[]} units
   * @param {number} n
   * @returns {Unit[]}
   */
  getClosestUnitByPath: (resources, position, units, n = 1) => {
    return units.map(unit => {
      const mappedUnits = { unit }
      if (unit.isFlying) {
        mappedUnits.distance = distance(unit.pos, position);
      } else {
        mappedUnits.distance = resourcesService.distanceByPath(resources, getUnitCornerPosition(unit), position);
      }
      return mappedUnits;
    })
      .sort((a, b) => a.distance - b.distance)
      .map(u => u.unit)
      .slice(0, n);
  },
  /**
   * @param {ResourceManager} resources 
   * @param {Point2D} position 
   * @returns {Unit}
   */
  getBuilder: (resources, position) => {
    const { units } = resources.get();
    const builderCandidates = getBuilders(units);
    builderCandidates.push(...units.getWorkers().filter(worker => {
      return (
        worker.noQueue ||
        worker.isGathering() && getOrderTargetPosition(units, worker) && distance(worker.pos, getOrderTargetPosition(units, worker)) > 1.62 ||
        worker.orders.findIndex(order => order.targetWorldSpacePos && (distance(order.targetWorldSpacePos, position) < 1)) > -1
      );
    }));
    const [closestBuilder] = resourcesService.getClosestUnitByPath(resources, position, builderCandidates);
    return closestBuilder;
  },
  /**
   * @param {ResourceManager} resources 
   * @param {Unit[]} units 
   * @param {Unit} target 
   * @returns {Unit}
   */
  setCombatPoint: (resources, units, target) => {
    const [combatPoint] = resourcesService.getClosestUnitByPath(resources, target.pos, units);
    combatPoint.labels.set('combatPoint', true);
    return combatPoint;
    // let closestUnit;
    // try {
    //   [closestUnit] = getClosestUnitByPath(resources, target.pos, units);
    //   closestUnit.labels.set('combatPoint', true);
    // } catch (e) {
    //   let closestUnit;
    //   [closestUnit] = resources.get().units.getClosest(target.pos, units)
    // }
    // return closestUnit;
  },
}

module.exports = resourcesService;

/**
 * @param {UnitResource} units
 * @param {Unit} worker 
 * @returns {Point2D|undefined}
 */
function getOrderTargetPosition(units, worker) {
  return worker.orders[0].targetWorldSpacePos || units.getByTag(worker.orders[0].targetUnitTag).pos;
}
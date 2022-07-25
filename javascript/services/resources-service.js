//@ts-check
"use strict"

const { constructionAbilities } = require("@node-sc2/core/constants/groups");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getBuilders } = require("../systems/unit-resource/unit-resource-service");
const dataService = require("./data-service");
const { getTimeInSeconds } = require("./frames-service");
const { getPathablePositions, getMapPath } = require("./map-resource-service");
const { getPathCoordinates } = require("./path-service");

const resourcesService = {
  /**
  * @param {ResourceManager} resources
  * @param {Point2D} position
  * @param {Point2D} targetPosition
  * @returns number
  */
  distanceByPath: (resources, position, targetPosition) => {
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
        mappedUnits.distance = resourcesService.distanceByPath(resources, unit.pos, position);
      }
      return mappedUnits;
    })
      .sort((a, b) => a.distance - b.distance)
      .map(u => u.unit)
      .slice(0, n);
  },
  /**
   * @param {World} world 
   * @param {Point2D} position 
   * @returns {Unit|null}
   */
  getBuilder: (world, position) => {
    const { data, resources } = world;
    const { map, units } = resources.get();
    [position] = resourcesService.getClosestPositionByPath(resources, position, getPathablePositions(map, position));
    const builderCandidates = getBuilders(units);
    const workers = units.getWorkers();
    builderCandidates.push(...workers.filter(worker => {
      return (
        worker.noQueue ||
        worker.isGathering() && getOrderTargetPosition(units, worker) && distance(worker.pos, getOrderTargetPosition(units, worker)) > 1.62 ||
        worker.orders.findIndex(order => order.targetWorldSpacePos && (distance(order.targetWorldSpacePos, position) < 1)) > -1
      );
    }));
    const [closestBuilder] = resourcesService.getClosestUnitByPath(resources, position, builderCandidates);
    const constructingWorkers = units.getConstructingWorkers();
    // calculate build time left plus distance to position by path
    const mappedWorkers = constructingWorkers.map(worker => {
      // get unit type of building in construction
      const constructingOrder = worker.orders.find(order => constructionAbilities.includes(order.abilityId));
      const unitType = dataService.unitTypeTrainingAbilities.get(constructingOrder.abilityId);
      const { buildTime } = data.getUnitTypeData(unitType);
      // get closest unit type to worker position if within unit type radius
      const closestUnitType = units.getClosest(worker.pos, units.getById(unitType)).filter(unit => distance(unit.pos, worker.pos) < 3)[0];
      let timeToPosition = Infinity;
      if (closestUnitType) {
        const { buildProgress } = closestUnitType;
        const buildTimeLeft = getTimeInSeconds(buildTime - (buildTime * buildProgress));
        const distanceByPath = resourcesService.distanceByPath(resources, worker.pos, position);
        const { movementSpeed } = worker.data();
        timeToPosition = buildTimeLeft + (distanceByPath / movementSpeed);
      }
      return {
        worker,
        timeToPosition
      };
    });
    const [closestConstructingWorker] = mappedWorkers.sort((a, b) => a.timeToPosition - b.timeToPosition);
    // get timeToPosition of closestBuilder
    let closestBuilderTimeToPosition = Infinity;
    if (closestBuilder) {
      if (closestConstructingWorker) {
        const distanceByPath = resourcesService.distanceByPath(resources, closestBuilder.pos, position);
        const { movementSpeed } = closestBuilder.data();
        closestBuilderTimeToPosition = distanceByPath / movementSpeed;
        return closestBuilderTimeToPosition < closestConstructingWorker.timeToPosition ? closestBuilder : closestConstructingWorker.worker;
      } else {
        return closestBuilder;
      }
    } else if (closestConstructingWorker) {
      return closestConstructingWorker.worker;
    } else {
      return null;
    }
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
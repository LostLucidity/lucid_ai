//@ts-check
"use strict"

const { CloakState } = require("@node-sc2/core/constants/enums");
const { constructionAbilities } = require("@node-sc2/core/constants/groups");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const dataService = require("./data-service");
const { getTimeInSeconds } = require("./frames-service");
const { getPathablePositions, getMapPath, getPathablePositionsForStructure } = require("./map-resource-service");
const { getBuilders, getOrderTargetPosition } = require("../systems/unit-resource/unit-resource-service");
const { getPathCoordinates } = require("./path-service");
const { getMovementSpeed, isMoving } = require("./unit-service");

const resourcesService = {
  /**
 * Checks whether unit can attack targetUnit.
 * @param {ResourceManager} resources
 * @param {Unit} unit
 * @param {Unit} targetUnit
 * @param {boolean} requireVisible
 * @return {boolean}
 */
  canAttack(resources, unit, targetUnit, requireVisible = true) {
    const { map } = resources.get();
    const { cloak, isFlying, pos } = targetUnit;
    if (cloak === undefined || isFlying === undefined || pos === undefined) { return false; }
    const canShootAtTarget = isFlying && unit.canShootUp() || !isFlying && unit.canShootGround();
    const targetDetected = cloak !== CloakState.CLOAKED;
    const conditions = [
      canShootAtTarget,
      targetDetected,
      !requireVisible || map.isVisible(pos),
    ];
    return conditions.every(condition => condition);
  },
  /**
  * @param {ResourceManager} resources
  * @param {Point2D} position
  * @param {Point2D|SC2APIProtocol.Point} targetPosition
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
   * @param {Point2D|SC2APIProtocol.Point} position
   * @param {Unit[]} units
   * @param {number} n
   * @returns {Unit[]}
   */
  getClosestUnitByPath: (resources, position, units, n = 1) => {
    const { map } = resources.get();
    return units.map(unit => {
      const { pos } = unit;
      if (pos === undefined) return;
      const mappedUnits = { unit }
      if (unit.isFlying) {
        mappedUnits.distance = distance(position, pos);
      } else {
        const [closestPositionByPath] = resourcesService.getClosestPositionByPath(resources, position, getPathablePositions(map, pos), 1);
        mappedUnits.distance = resourcesService.distanceByPath(resources, position, closestPositionByPath);
      }
      return mappedUnits;
    })
      .sort((a, b) => a.distance - b.distance)
      .map(u => u.unit)
      .slice(0, n);
  },
  /**
   *
   * @param {ResourceManager} resources
   * @param {Unit} unit
   * @param {Unit[]} units
   */
  getClosestUnitFromUnit(resources, unit, units) {
    const { map } = resources.get();
    const pathablePositions = getPathablePositionsForStructure(map, unit);
    const closestUnitToPathables = pathablePositions.reduce((/** @type {Unit|undefined} */ closestUnitToPathable, pathablePosition) => {
      const [closestUnit] = resourcesService.getClosestUnitByPath(resources, pathablePosition, units);
      if (closestUnitToPathable === undefined) {
        return closestUnit;
      } else {
        if (closestUnitToPathable.pos === undefined || closestUnit.pos === undefined) return closestUnitToPathable;
        const closestUnitToPathableDistance = resourcesService.distanceByPath(resources, closestUnitToPathable.pos, closestUnit.pos);
        const closestUnitDistance = resourcesService.distanceByPath(resources, closestUnit.pos, pathablePosition);
        if (closestUnitToPathableDistance < closestUnitDistance) {
          return closestUnitToPathable;
        } else {
          return closestUnit;
        }
      }
    }, undefined);
    return closestUnitToPathables;
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
    builderCandidates.push(...units.getWorkers().filter(worker => {
      return (
        worker.noQueue ||
        worker.isGathering() && getOrderTargetPosition(units, worker) && distance(worker.pos, getOrderTargetPosition(units, worker)) > 1.62 ||
        worker.orders.findIndex(order => order.targetWorldSpacePos && (distance(order.targetWorldSpacePos, position) < 1)) > -1
      );
    }));
    const movingProbes = builderCandidates.filter(builder => isMoving(builder));
    builderCandidates.splice(builderCandidates.findIndex(builder => movingProbes.includes(builder)), 1);
    const movingProbesTimeToPosition = movingProbes.map(movingProbe => {
      const { orders, pos } = movingProbe;
      if (orders === undefined || pos === undefined) return;
      const movingPosition = orders[0].targetWorldSpacePos;
      const movementSpeed = getMovementSpeed(movingProbe);
      if (movingPosition === undefined || movementSpeed === undefined) return;
      const movingProbeTimeToMovePosition = resourcesService.distanceByPath(resources, pos, movingPosition) / movementSpeed;
      const targetTimeToPremovePosition = resourcesService.distanceByPath(resources, movingPosition, position) / movementSpeed;
      return { unit: movingProbe, timeToPosition: movingProbeTimeToMovePosition + targetTimeToPremovePosition };
    });
    const candidateWorkersTimeToPosition = []
    const [movingProbe] = movingProbesTimeToPosition.sort((a, b) => {
      if (a === undefined || b === undefined) return 0;
      return a.timeToPosition - b.timeToPosition;
    });
    if (movingProbe !== undefined) {
      candidateWorkersTimeToPosition.push(movingProbe);
    }
    const [closestBuilder] = resourcesService.getClosestUnitByPath(resources, position, builderCandidates);
    if (closestBuilder !== undefined) {
      const { pos } = closestBuilder;
      if (pos === undefined) return null;
      const movementSpeed = getMovementSpeed(closestBuilder);
      if (movementSpeed === undefined) return null;
      const closestBuilderWithDistance =  {
        unit: closestBuilder,
        timeToPosition: resourcesService.distanceByPath(resources, pos, position) / movementSpeed
      };
      candidateWorkersTimeToPosition.push(closestBuilderWithDistance);
    }
    const constructingWorkers = units.getConstructingWorkers();
    // calculate build time left plus distance to position by path
    const [closestConstructingWorker] = constructingWorkers.map(worker => {
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
        unit: worker,
        timeToPosition
      };
    }).sort((a, b) => a.timeToPosition - b.timeToPosition);
    if (closestConstructingWorker !== undefined) {
      candidateWorkersTimeToPosition.push(closestConstructingWorker);
    }
    const [closestWorker] = candidateWorkersTimeToPosition.sort((a, b) => {
      if (a === undefined || b === undefined) return 0;
      return a.timeToPosition - b.timeToPosition;
    });
    if (closestWorker === undefined) return null;
    return closestWorker.unit;
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
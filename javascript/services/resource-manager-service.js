//@ts-check
"use strict"

const { UnitType } = require("@node-sc2/core/constants");
const { SMART } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { combatTypes } = require("@node-sc2/core/constants/groups");
const { distance, areEqual } = require("@node-sc2/core/utils/geometry/point");
const { getTargetedByWorkers, setPendingOrders } = require("../systems/unit-resource/unit-resource-service");
const { createUnitCommand } = require("./actions-service");
const dataService = require("./data-service");
const { getPathablePositions, getPathablePositionsForStructure, getMapPath, getClosestPathablePositions } = require("./map-resource-service");
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
   * @param {Unit | undefined} mineralField
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
    const isAnyPositionCorner = checkIfPositionIsCorner(pathablePositions, position);
    const pathableTargetPositions = getPathablePositions(map, targetPosition);
    const isAnyTargetPositionCorner = checkIfPositionIsCorner(pathableTargetPositions, targetPosition);
    const distancesAndPositions = pathablePositions.map(pathablePosition => {
      const distancesToTargetPositions = pathableTargetPositions.map(pathableTargetPosition => {
        return {
          pathablePosition,
          pathableTargetPosition,
          distance: resourceManagerService.getDistanceByPath(resources, pathablePosition, pathableTargetPosition)
        };
      });
      if (isAnyPositionCorner || isAnyTargetPositionCorner) {
        const averageDistance = distancesToTargetPositions.reduce((acc, { distance }) => acc + distance, 0) / distancesToTargetPositions.length;
        return {
          pathablePosition,
          pathableTargetPosition: targetPosition,
          distance: averageDistance
        };
      } else {
        return distancesToTargetPositions.reduce((acc, curr) => acc.distance < curr.distance ? acc : curr);
      }
    }).sort((a, b) => a.distance - b.distance);
    if (isAnyPositionCorner || isAnyTargetPositionCorner) {
      const averageDistance = distancesAndPositions.reduce((acc, curr) => {
        return acc + curr.distance;
      }, 0) / distancesAndPositions.length;
      return {
        pathablePosition: position,
        pathableTargetPosition: targetPosition,
        distance: averageDistance
      };
    }
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
        mappedUnits.distance = distance(pos, position);
      } else {
        const closestPathablePositionBetweenPositions = resourceManagerService.getClosestPathablePositionsBetweenPositions(resources, pos, position);
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
      const everyLineIsPathable = line.every(point => {
        const [closestPathablePosition] = getClosestPathablePositions(map, point);
        return closestPathablePosition !== undefined && map.isPathable(closestPathablePosition);
      });
      if (everyLineIsPathable) {
        return getDistance(position, targetPosition);
      } else {
        let path = getMapPath(map, position, targetPosition);
        const pathCoordinates = getPathCoordinates(path);
        distance = pathCoordinates.reduce((acc, curr, index) => {
          if (index === 0) return acc;
          const prev = pathCoordinates[index - 1];
          return acc + getDistance(prev, curr);
        }, 0);
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
  /**
   * @param {ResourceManager} resources
   * @returns {UnitTypeId[]}
   */
  getTrainingUnitTypes: (resources) => {
    const { units } = resources.get();
    const trainingUnitTypes = new Set();
    const combatTypesPlusQueens = [...combatTypes, UnitType.QUEEN];
    const unitsWithOrders = units.getAlive(Alliance.SELF).filter(unit => unit.orders !== undefined && unit.orders.length > 0);
    unitsWithOrders.forEach(unit => {
      const { orders } = unit;
      if (orders === undefined) return false;
      const abilityIds = orders.map(order => order.abilityId);
      abilityIds.forEach(abilityId => {
        if (abilityId === undefined) return false;
        const unitType = dataService.unitTypeTrainingAbilities.get(abilityId);
        if (unitType !== undefined && combatTypesPlusQueens.includes(unitType)) {
          trainingUnitTypes.add(unitType);
        }
      });
    });
    return [...trainingUnitTypes];
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
/**
 * @param {Point2D[]} positions 
 * @param {Point2D} position 
 * @returns {Boolean}
 */
function checkIfPositionIsCorner(positions, position) {
  return positions.some(pos => {
    const { x, y } = position;
    const { x: pathableX, y: pathableY } = pos;
    if (x === undefined || y === undefined || pathableX === undefined || pathableY === undefined) { return false; }
    const halfway = Math.abs(x - pathableX) === 0.5 || Math.abs(y - pathableY) === 0.5;
    return halfway && getDistance(position, pos) <= 1;
  });
}


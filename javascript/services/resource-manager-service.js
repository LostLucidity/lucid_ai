//@ts-check
"use strict"

const { UnitType } = require("@node-sc2/core/constants");
const { SMART, MOVE } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { combatTypes, creepGenerators } = require("@node-sc2/core/constants/groups");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance, areEqual, avgPoints } = require("@node-sc2/core/utils/geometry/point");
const { getClosestPosition } = require("../helper/get-closest");
const location = require("../helper/location");
const { getTargetedByWorkers, setPendingOrders } = require("../systems/unit-resource/unit-resource-service");
const { createUnitCommand } = require("./actions-service");
const dataService = require("./data-service");
const { getPathablePositions, getPathablePositionsForStructure, getMapPath, getClosestPathablePositions, isCreepEdge } = require("./map-resource-service");
const { getPathCoordinates } = require("./path-service");
const { getDistance } = require("./position-service");

const resourceManagerService = {
  /** @type {Expansion[]} */
  availableExpansions: [],
  creepEdges: [],
  /** @type {Point2D} */
  combatRally: null,
  /**
   * @param {ResourceManager} resources
   * @param {Unit} unit 
   * @param {Unit | undefined} mineralField
   * @param {boolean} queue 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  gather: (resources, unit, mineralField, queue = true) => {
    const { units } = resources.get();
    const { pos: unitPos } = unit;
    const collectedActions = [];
    if (unitPos === undefined) { return collectedActions; }
    if (unit.labels.has('command') && queue === false) {
      console.warn('WARNING! unit with command erroniously told to force gather! Forcing queue');
      queue = true;
    }
    const ownBases = units.getBases(Alliance.SELF).filter(b => b.buildProgress >= 1);
    let target;
    const localMaxDistanceOfMineralFields = 10;
    if (mineralField && mineralField.tag) {
      target = mineralField;
    } else {
      let targetBase;
      const needyBases = ownBases.filter(base => {
        const { assignedHarvesters, idealHarvesters } = base;
        if (assignedHarvesters === undefined || idealHarvesters === undefined) { return false; }
        return assignedHarvesters < idealHarvesters
      });
      const candidateBases = needyBases.length > 0 ? needyBases : ownBases;
      targetBase = resourceManagerService.getClosestUnitFromUnit(resources, unit, candidateBases);
      if (targetBase === undefined || targetBase.pos === undefined) { return collectedActions; }
      [target] = getUnitsWithinDistance(targetBase.pos, units.getMineralFields(), localMaxDistanceOfMineralFields).sort((a, b) => {
        const targetedByWorkersACount = getTargetedByWorkers(units, a).length;
        const targetedByWorkersBCount = getTargetedByWorkers(units, b).length;
        return targetedByWorkersACount - targetedByWorkersBCount;
      });
    }
    if (target) {
      const { pos: targetPos } = target; if (targetPos === undefined) { return collectedActions; }
      const closestPathablePositionsBetweenPositions = resourceManagerService.getClosestPathablePositionsBetweenPositions(resources, unitPos, targetPos);
      const { distance, pathCoordinates } = closestPathablePositionsBetweenPositions;
      if (getDistance(unitPos, targetPos) > localMaxDistanceOfMineralFields && distance > 16 && pathCoordinates.length > 0) {
        const moveCommand = createUnitCommand(MOVE, [unit]);
        moveCommand.targetWorldSpacePos = pathCoordinates[pathCoordinates.length - 1];
        collectedActions.push(moveCommand);
        queue = true;
      }
      const sendToGather = createUnitCommand(SMART, [unit]);
      sendToGather.targetUnitTag = target.tag;
      sendToGather.queueCommand = queue;
      collectedActions.push(sendToGather);
      setPendingOrders(unit, sendToGather);
    }
    return collectedActions;
  },
  /**
   * @param {ResourceManager} resources 
   * @returns {Point2D}
   */
  getCombatRally: (resources) => {
    const { map, units } = resources.get();
    const { combatRally } = resourceManagerService;
    if (combatRally) {
      return combatRally;
    } else {
      return getNaturalWall(map).length > 0 ? map.getCombatRally() : location.getRallyPointByBases(map, units);
    }
  },
  /**
   * @param {ResourceManager} resources
   * @param {Point2D} position
   * @param {Point2D} targetPosition
   * @returns {{distance: number, pathCoordinates: Point2D[], pathablePosition: Point2D, pathableTargetPosition: Point2D}}
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
          pathCoordinates: getPathCoordinates(getMapPath(map, pathablePosition, pathableTargetPosition)),
          distance: resourceManagerService.getDistanceByPath(resources, pathablePosition, pathableTargetPosition)
        };
      });
      if (isAnyPositionCorner || isAnyTargetPositionCorner) {
        const averageDistance = distancesToTargetPositions.reduce((acc, { distance }) => acc + distance, 0) / distancesToTargetPositions.length;
        return {
          pathCoordinates: getPathCoordinates(getMapPath(map, pathablePosition, targetPosition)),
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
      const pathablePosition = isAnyPositionCorner ? avgPoints(pathablePositions) : getClosestPosition(position, pathablePositions)[0];
      const pathableTargetPosition = isAnyTargetPositionCorner ? avgPoints(pathableTargetPositions) : getClosestPosition(targetPosition, pathableTargetPositions)[0];
      return {
        pathCoordinates: getPathCoordinates(getMapPath(map, pathablePosition, pathableTargetPosition)),
        pathablePosition,
        pathableTargetPosition,
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
   * @returns {Point2D[]}
   */
  getCreepEdges: (resources, position) => {
    const { creepEdges } = resourceManagerService;
    if (creepEdges.length > 0) return creepEdges;
    const { map, units } = resources.get();
    // get Creep Edges within range with increasing range
    const creepEdgesWithinRangeI = [];
    for (let range = 0; range < 10; range++) {
      const creepEdgesWithinRangeI = getCreepEdgesWithinRange(resources, position, range);
      if (creepEdgesWithinRangeI.length > 0) {
        return creepEdgesWithinRangeI;
      }
    }
    if (creepEdgesWithinRangeI.length === 0) {
      return map.getCreep().filter(position => {
        const [closestCreepGenerator] = units.getClosest(position, units.getById(creepGenerators));
        if (closestCreepGenerator) {
          const { pos } = closestCreepGenerator; if (pos === undefined) return false;
          const distanceToCreepGenerator = getDistance(position, pos);
          // check if position is adjacent to non-creep position and is pathable
          const creepEdge = isCreepEdge(map, position);
          return distanceToCreepGenerator < 12.75 && creepEdge;
        }
      });
    }
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
      const everyLineIsPathable = line.every((point, index) => {
        if (index > 0) {
          const previousPoint = line[index - 1];
          const heightDifference = map.getHeight(point) - map.getHeight(previousPoint);
          if (heightDifference > 1) return false;
        }
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
    return getDistance(unitPos, pos) <= maxDistance;
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
/**
 * @param {ResourceManager} resources
 * @param {Point2D} position
 * @param {Number} range
 * @returns {Point2D[]}
 */
function getCreepEdgesWithinRange(resources, position, range) {
  const { map } = resources.get();
  const { getDistanceByPath } = resourceManagerService;
  return gridsInCircle(position, range).filter(grid => {
    return isCreepEdge(map, grid) && getDistanceByPath(resources, position, grid) <= 10;
  });
}

/**
 * @param {MapResource} map
 * @returns {Point2D[]}
 */
function getNaturalWall(map) {
  const natural = map.getNatural(); if (natural === undefined) return [];
  const naturalWall = natural.getWall(); if (naturalWall === undefined) return [];
  return naturalWall;
}


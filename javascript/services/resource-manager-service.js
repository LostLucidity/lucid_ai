//@ts-check
"use strict"

const { UnitType, WarpUnitAbility } = require("@node-sc2/core/constants");
const { SMART, MOVE, ATTACK_ATTACK } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { combatTypes, creepGeneratorsTypes } = require("@node-sc2/core/constants/groups");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance, areEqual, avgPoints, nClosestPoint } = require("@node-sc2/core/utils/geometry/point");
const { getClosestPosition } = require("../helper/get-closest");
const location = require("../helper/location");
const scoutService = require("../systems/scouting/scouting-service");
const { getTargetedByWorkers, getGasGeysers, isByItselfAndNotAttacking } = require("../systems/unit-resource/unit-resource-service");
const { createUnitCommand } = require("./actions-service");
const dataService = require("./data-service");
const { getPathablePositions, getPathablePositionsForStructure, getMapPath, getClosestPathablePositions, isCreepEdge, isInMineralLine } = require("./map-resource-service");
const { getPathCoordinates } = require("./path-service");
const { getDistance, getClusters, getStructureCells } = require("./position-service");
const { setPendingOrders } = require("./unit-service");
const { shuffle } = require("../helper/utilities");
const { PYLON } = require("@node-sc2/core/constants/unit-type");
const { getOccupiedExpansions } = require("../helper/expansions");

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
      return map.getCombatRally() || location.getRallyPointByBases(map, units);
    }
  },
  /**
   * @param {ResourceManager} resources
   * @param {Point2D} position
   * @param {Point2D} targetPosition
   * @returns {{distance: number, pathCoordinates: Point2D[], pathablePosition: Point2D, pathableTargetPosition: Point2D}}
   */
  getClosestPathablePositionsBetweenPositions: (resources, position, targetPosition) => {
    const { map, units } = resources.get();
    const mapFixturesToCheck = [
      ...units.getStructures({ alliance: Alliance.SELF }),
      ...units.getStructures({ alliance: Alliance.ENEMY }),
      ...getGasGeysers(units),
    ];

    const structureAtPositionCells = getStructureCells(position, mapFixturesToCheck);
    const structureAtTargetPositionCells = getStructureCells(targetPosition, mapFixturesToCheck);

    // Store the original state of each cell
    const originalCellStates = new Map();
    [...structureAtPositionCells, ...structureAtTargetPositionCells].forEach(cell => {
      originalCellStates.set(cell, map.isPathable(cell));
      map.setPathable(cell, true);
    });

    const pathablePositions = getPathablePositions(map, position);
    const isAnyPositionCorner = checkIfPositionIsCorner(pathablePositions, position);
    const filteredPathablePositions = isAnyPositionCorner && pathablePositions.length === 4
      ? pathablePositions.filter(pos => {
        const { x, y } = pos;
        if (x === undefined || y === undefined) return false;
        const { x: centerX, y: centerY } = position;
        if (centerX === undefined || centerY === undefined) return false;
        return (x > centerX && y > centerY) || (x < centerX && y < centerY);
      })
      : pathablePositions;
    const pathableTargetPositions = getPathablePositions(map, targetPosition);
    const isAnyTargetPositionCorner = checkIfPositionIsCorner(pathableTargetPositions, targetPosition);
    const filteredPathableTargetPositions = isAnyTargetPositionCorner && pathableTargetPositions.length === 4
      ? pathableTargetPositions.filter(pos => {
        const { x, y } = pos;
        if (x === undefined || y === undefined) return false;
        const { x: centerX, y: centerY } = targetPosition;
        if (centerX === undefined || centerY === undefined) return false;
        return (x > centerX && y > centerY) || (x < centerX && y < centerY);
      })
      : pathableTargetPositions;
    const distancesAndPositions = filteredPathablePositions.map(pathablePosition => {
      const distancesToTargetPositions = filteredPathableTargetPositions.map(pathableTargetPosition => {
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
    let result;
    if (isAnyPositionCorner || isAnyTargetPositionCorner) {
      const averageDistance = distancesAndPositions.reduce((acc, curr) => {
        return acc + curr.distance;
      }, 0) / distancesAndPositions.length;
      const pathablePosition = isAnyPositionCorner ? avgPoints(filteredPathablePositions) : getClosestPosition(position, filteredPathablePositions)[0];
      const pathableTargetPosition = isAnyTargetPositionCorner ? avgPoints(filteredPathableTargetPositions) : getClosestPosition(targetPosition, filteredPathableTargetPositions)[0];
      result = {
        pathCoordinates: getPathCoordinates(getMapPath(map, pathablePosition, pathableTargetPosition)),
        pathablePosition,
        pathableTargetPosition,
        distance: averageDistance
      };
    } else {
      result = distancesAndPositions[0];
    }

    // Restore each cell to its original state
    [...structureAtPositionCells, ...structureAtTargetPositionCells].forEach(cell => {
      const originalState = originalCellStates.get(cell);
      map.setPathable(cell, originalState);
    });

    // return the result after restoring unpathable cells
    return result;
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
    const { map } = resources.get();
    const { getClosestPathablePositionsBetweenPositions, getDistanceByPath } = resourceManagerService;

    const splitUnits = units.reduce((/** @type {{within16: Unit[], outside16: Unit[]}} */acc, unit) => {
      const { pos } = unit; if (pos === undefined) return acc;
      const distanceToUnit = getDistance(pos, position);
      const pathablePosData = getClosestPathablePositionsBetweenPositions(resources, pos, position);
      const distanceByPath = getDistanceByPath(resources, pathablePosData.pathablePosition, pathablePosData.pathableTargetPosition);
      const isWithin16 = distanceToUnit <= 16 && distanceByPath <= 16;
      return {
        within16: isWithin16 ? [...acc.within16, unit] : acc.within16,
        outside16: isWithin16 ? acc.outside16 : [...acc.outside16, unit]
      };
    }, { within16: [], outside16: [] });

    let closestUnits = splitUnits.within16.sort((a, b) => {
      const { pos } = a; if (pos === undefined) return 1;
      const { pos: bPos } = b; if (bPos === undefined) return -1;
      const aData = getClosestPathablePositionsBetweenPositions(resources, pos, position);
      const bData = getClosestPathablePositionsBetweenPositions(resources, bPos, position);
      return getDistanceByPath(resources, aData.pathablePosition, aData.pathableTargetPosition) - getDistanceByPath(resources, bData.pathablePosition, bData.pathableTargetPosition);
    });

    if (n === 1 && closestUnits.length > 0) return closestUnits;

    const unitsByDistance = [...closestUnits, ...splitUnits.outside16].reduce((/** @type {{unit: Unit, distance: number}[]} */acc, unit) => {
      const { pos } = unit;
      if (pos === undefined) return acc;

      const expansionWithin16 = map.getExpansions().find(expansion => {
        const { centroid: expansionPos } = expansion;
        if (expansionPos === undefined) return;
        return getDistance(expansionPos, pos) <= 16 && getClosestPathablePositionsBetweenPositions(resources, expansionPos, pos).distance <= 16;
      });

      const targetPosition = expansionWithin16 ? expansionWithin16.centroid : pos; if (targetPosition === undefined) return acc;
      const closestPathablePositionBetweenPositions = getClosestPathablePositionsBetweenPositions(resources, targetPosition, position);
      return [...acc, { unit, distance: closestPathablePositionBetweenPositions.distance }];
    }, []).sort((a, b) => {
      if (a === undefined) return 1;
      if (b === undefined) return -1;
      return a.distance - b.distance;
    });

    return unitsByDistance.slice(0, n).map(u => u.unit);
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

    const maxRange = 10;
    const creepEdgesByRange = getCreepEdgesWithinRanges(resources, position, maxRange);

    for (let range = 0; range < maxRange; range++) {
      if (creepEdgesByRange[range].length > 0) {
        return creepEdgesByRange[range];
      }
    }

    if (creepEdgesByRange.every(rangeEdges => rangeEdges.length === 0)) {
      const creepGenerators = units.getById(creepGeneratorsTypes);
      return map.getCreep().filter(position => {
        const [closestCreepGenerator] = units.getClosest(position, creepGenerators);
        if (closestCreepGenerator) {
          const { pos } = closestCreepGenerator; if (pos === undefined) return false;
          const distanceToCreepGenerator = getDistance(position, pos);
          // check if position is adjacent to non-creep position and is pathable
          const creepEdge = isCreepEdge(map, position);
          return distanceToCreepGenerator < 12.75 && creepEdge;
        }
      });
    }
    // Default return statement to handle scenarios where no condition is met
    return [];
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
          return Math.abs(heightDifference) <= 1;
        }
        const [closestPathablePosition] = getClosestPathablePositions(map, point);
        return closestPathablePosition !== undefined && map.isPathable(closestPathablePosition);
      });
      if (everyLineIsPathable) {
        return getDistance(position, targetPosition);
      } else {
        let path = getMapPath(map, position, targetPosition);
        const pathCoordinates = getPathCoordinates(path);

        let straightLineSegments = [];
        let currentSegmentStart = pathCoordinates[0];

        for (let i = 1; i < pathCoordinates.length; i++) {
          const point = pathCoordinates[i];
          const segment = [currentSegmentStart, point];

          // If the segment is not a straight line that the unit can traverse,
          // add the previous straight line segment to the list and start a new one
          if (!isLineTraversable(map, segment)) {
            straightLineSegments.push([currentSegmentStart, pathCoordinates[i - 1]]);
            currentSegmentStart = pathCoordinates[i - 1];
          }
        }

        // Add the last straight line segment
        straightLineSegments.push([currentSegmentStart, pathCoordinates[pathCoordinates.length - 1]]);

        // Now calculate the sum of distances of the straight line segments
        distance = straightLineSegments.reduce((acc, segment) => {
          return acc + getDistance(segment[0], segment[1]);
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
    const trainingUnitTypes = [];
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
          trainingUnitTypes.push(unitType);
        }
      });
    });
    return [...trainingUnitTypes];
  },
  /**
   * @param {ResourceManager} resources
   * @returns {Point2D | undefined}
   * @description Returns warp in locations for all warp gate units
   */
  getWarpInLocations: (resources) => {
    const { getCombatRally } = resourceManagerService;
    const { units } = resources.get();
    const pylonsNearProduction = units.getById(PYLON)
      .filter(pylon => pylon.buildProgress >= 1)
      .filter(pylon => {
        const [closestBase] = getOccupiedExpansions(resources).map(expansion => expansion.getBase())
        if (closestBase) {
          return distance(pylon.pos, closestBase.pos) < 6.89
        }
      })
      .filter(pylon => {
        const [closestUnitOutOfRange] = units.getClosest(pylon.pos, units.getCombatUnits(Alliance.ENEMY));
        if (closestUnitOutOfRange) {
          return distance(pylon.pos, closestUnitOutOfRange.pos) > 16
        }
      });
    let closestPylon;
    if (pylonsNearProduction.length > 0) {
      [closestPylon] = units.getClosest(getCombatRally(resources), pylonsNearProduction);
      return closestPylon.pos;
    } else {
      const pylons = units.getById(PYLON)
        .filter(pylon => pylon.buildProgress >= 1)
        .filter(pylon => {
          const [closestUnitOutOfRange] = units.getClosest(pylon.pos, units.getCombatUnits(Alliance.ENEMY));
          if (closestUnitOutOfRange) {
            return distance(pylon.pos, closestUnitOutOfRange.pos) > 16
          }
        });
      if (pylons) {
        [closestPylon] = units.getClosest(getCombatRally(resources), pylons);
        if (closestPylon) {
          return closestPylon.pos;
        }
      }
    }
  },
  /**
   * @param {ResourceManager} resources
   * @param {Unit} enemyUnit
   * @returns {boolean}
   * @description Returns true if enemy unit is a worker and is in mineral line or is by itself and not attacking
   */
  isPeacefulWorker: (resources, enemyUnit) => {
    const { map, units } = resources.get();
    const { pos: enemyPos } = enemyUnit;
    if (enemyPos === undefined) return false;
    return enemyUnit.isWorker() && (isInMineralLine(map, enemyPos) || isByItselfAndNotAttacking(units, enemyUnit));
  },
  /**
   * @param {ResourceManager} resources
   * @param {number} timeStart
   * @param {number} timeEnd
   * @returns {boolean}
  */
  isWithinTime: (resources, timeStart, timeEnd) => {
    const { frame } = resources.get();
    const timeInSeconds = frame.timeInSeconds();
    return timeInSeconds > timeStart && timeInSeconds < timeEnd;
  },
  searchAndDestroy: (resources, combatUnits, supportUnits) => {
    const { map, units } = resources.get();
    const collectedActions = [];
    const label = 'combatPoint';
    const combatPoint = combatUnits.find(unit => unit.labels.get(label));
    if (combatPoint) { combatPoint.labels.set(label, false); }
    const expansions = [...map.getAvailableExpansions(), ...map.getOccupiedExpansions(4)];
    const idleCombatUnits = units.getCombatUnits().filter(u => u.noQueue);
    const randomExpansion = expansions[Math.floor(Math.random() * expansions.length)];
    const randomPosition = randomExpansion ? randomExpansion.townhallPosition : location.getRandomPoint(map)
    if (randomPosition) {
      if (supportUnits.length > 1) {
        const supportUnitTags = supportUnits.map(unit => unit.tag);
        let unitCommand = {
          abilityId: MOVE,
          targetWorldSpacePos: randomPosition,
          unitTags: [...supportUnitTags],
        }
        collectedActions.push(unitCommand);
      }
      const idleCombatUnitTags = idleCombatUnits.map(unit => unit.tag);
      let unitCommand = {
        abilityId: ATTACK_ATTACK,
        targetWorldSpacePos: randomPosition,
        unitTags: [...idleCombatUnitTags],
      }
      collectedActions.push(unitCommand);
    }
    return collectedActions;
  },
  /**
   * @param {ResourceManager} resources
   * @param {*} assemblePlan 
   * @param {UnitTypeId} unitType
   * @returns {Promise<void>}
   */
  warpIn: async (resources, assemblePlan, unitType) => {
    const { actions } = resources.get();
    const { getCombatRally, getWarpInLocations } = resourceManagerService;
    let nearPosition;
    if (assemblePlan && assemblePlan.state && assemblePlan.state.defenseMode && scoutService.outsupplied) {
      nearPosition = getWarpInLocations(resources);
    } else {
      nearPosition = getCombatRally(resources);
      console.log('nearPosition', nearPosition);
    }
    try { await actions.warpIn(unitType, { nearPosition: nearPosition }) } catch (error) { console.log(error); }
  },
  /**
   * @param {World} world
   * @param {UnitTypeId} unitType
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  warpInSync: (world, unitType) => {
    const { resources } = world;
    const collectedActions = []
    const { getCombatRally } = resourceManagerService;
    const nearPosition = getCombatRally(resources);
    console.log('nearPosition', nearPosition);
    collectedActions.push(...warpInCommands(world, unitType, { nearPosition }));
    return collectedActions;
  }
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
 * @param {Number} maxRange
 * @returns {Point2D[][]}
 */
function getCreepEdgesWithinRanges(resources, position, maxRange) {
  const { map } = resources.get();
  const { getDistanceByPath } = resourceManagerService;
  const grids = gridsInCircle(position, maxRange);
  
  const clusters = getClusters(grids);
  // Create an array to hold creep edges for each range
  /** @type {Point2D[][]} */
  const creepEdgesByRange = Array.from({ length: maxRange }, () => []);

  clusters.forEach(grid => {
    if (isCreepEdge(map, grid)) {
      const distance = getDistanceByPath(resources, position, grid);
      if (distance <= maxRange) {
        // Ensure that index is at least 0 to avoid undefined array element
        const index = Math.floor(distance) > 0 ? Math.floor(distance) - 1 : 0;
        creepEdgesByRange[index].push(grid);
      }
    }
  });


  return creepEdgesByRange;
}

/**
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @param {Object?} opts
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function warpInCommands(world, unitType, opts = {}) {
  const { agent, resources } = world;
  const { powerSources } = agent; if (powerSources === undefined) return [];
  const { units, map } = resources.get();
  const abilityId = WarpUnitAbility[unitType];
  const n = opts.maxQty || 1;
  /** @type {Point2D} */
  const nearPosition = opts.nearPosition || map.getCombatRally();
  const qtyToWarp = world.agent.canAffordN(unitType, n);
  const selectedMatricies = units.getClosest(nearPosition, powerSources, opts.nearPosition ? 1 : 3);
  let myPoints = selectedMatricies
    .map(matrix => matrix.pos && matrix.radius ? gridsInCircle(matrix.pos, matrix.radius) : [])
    .reduce((acc, arr) => acc.concat(arr), [])
    .filter(p => map.isPathable(p) && !map.hasCreep(p));
  if (opts.highground) {
    myPoints = myPoints
      .map(p => ({ ...p, z: map.getHeight(p) }))
      .sort((a, b) => b.z - a.z)
      .filter((p, i, arr) => p.z === arr[0].z);
  }
  const myStructures = units.getStructures();
  const points = nClosestPoint(nearPosition, myPoints, 100)
    .filter((/** @type {Point2D} */ point) => myStructures.every(structure => structure.pos && distance(structure.pos, point) > 2));
  const warpGates = units.getById(UnitType.WARPGATE).filter(wg => wg.abilityAvailable(abilityId)).slice(0, qtyToWarp);
  /** @type {Point2D[]} */
  const destPoints = shuffle(points).slice(0, warpGates.length);
  return warpGates.map((warpGate, i) => {
    const unitCommand = createUnitCommand(abilityId, [warpGate]);
    unitCommand.targetWorldSpacePos = destPoints[i];
    return unitCommand;
  });
}

/**
 * @param {MapResource} map
 * @param {Point2D[]} line - An array containing two points that define a straight line segment.
 * @returns {boolean}
 */
function isLineTraversable(map, line) {
  const [start, end] = line;
  const { x: startX, y: startY } = start; if (startX === undefined || startY === undefined) return false;
  const { x: endX, y: endY } = end; if (endX === undefined || endY === undefined) return false;
  const distance = getDistance(start, end);

  // Assume the unit width is 1
  const unitWidth = 1;

  // Calculate the number of points to check along the line, spaced at unit-width intervals
  const numPoints = Math.ceil(distance / unitWidth);

  // For each point along the line segment
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;  // The fraction of the way from the start point to the end point

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
}

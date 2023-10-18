//@ts-check
"use strict"

const { UnitType, WarpUnitAbility } = require("@node-sc2/core/constants");
const { SMART, MOVE, ATTACK_ATTACK } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { combatTypes, creepGeneratorsTypes } = require("@node-sc2/core/constants/groups");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance, nClosestPoint } = require("@node-sc2/core/utils/geometry/point");
const location = require("../helper/location");
const scoutService = require("../systems/scouting/scouting-service");
const { getTargetedByWorkers } = require("../systems/unit-resource/unit-resource-service");
const { createUnitCommand } = require("./actions-service");
const dataService = require("./data-service");
const { getPathablePositions, getPathablePositionsForStructure } = require("../systems/map-resource-system/map-resource-service");
const { getDistance, getClusters } = require("./position-service");
const { setPendingOrders } = require("./unit-service");
const { shuffle } = require("../helper/utilities");
const { PYLON } = require("@node-sc2/core/constants/unit-type");
const { getOccupiedExpansions } = require("../helper/expansions");
const unitResourceService = require("../systems/unit-resource/unit-resource-service");
const pathFindingService = require("../src/services/pathfinding/pathfinding-service");
const { getGasGeysers } = require("../src/services/unit-retrieval");

const resourceManagerService = {
  /** @type {Expansion[]} */
  availableExpansions: [],
  creepEdges: [],
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
  * @param {UnitTypeId[]} unitTypes
  * @returns {Unit[]}
  */
  getById(resources, unitTypes) {
    const { isCurrent } = unitResourceService;
    const { frame, units } = resources.get();
    const currentFrame = frame.getGameLoop();
    return unitTypes.reduce((/** @type {Unit[]} */ unitsById, unitType) => {
      if (!isCurrent(unitType, frame.getGameLoop())) {
        const newUnits = units.getById(unitType);
        unitResourceService.unitsById.set(unitType, { units: newUnits, frame: currentFrame });
      }
      const entry = unitResourceService.unitsById.get(unitType);
      return [...unitsById, ...(entry ? entry.units : [])];
    }, []);
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
    const [closestPositionByPath] = pathFindingService.getClosestPositionByPath(resources, position, pathablePositions);
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
    const { map, units: unitResource } = resources.get();
    const { pos } = unit;
    if (pos === undefined) return undefined;
    const pathablePositions = getPathablePositionsForStructure(map, unit);
    const pathablePositionsForUnits = units.map(unit => getPathablePositionsForStructure(map, unit));
    const distances = pathablePositions.map(pathablePosition => {
      const distancesToUnits = pathablePositionsForUnits.map(pathablePositionsForUnit => {
        const distancesToUnit = pathablePositionsForUnit.map(pathablePositionForUnit => {
          return pathFindingService.getDistanceByPath(resources, pathablePosition, pathablePositionForUnit);
        });
        return Math.min(...distancesToUnit);
      });
      return Math.min(...distancesToUnits);
    });
    const closestPathablePosition = pathablePositions[distances.indexOf(Math.min(...distances))];
    return pathFindingService.getClosestUnitByPath(resources, closestPathablePosition, units, getGasGeysers(unitResource), 1)[0];
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
          const creepEdge = pathFindingService.isCreepEdge(map, position);
          return distanceToCreepGenerator < 12.75 && creepEdge;
        }
      });
    }
    // Default return statement to handle scenarios where no condition is met
    return [];
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
      [closestPylon] = units.getClosest(armyManagementService.getCombatRally(resources), pylonsNearProduction);
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
        [closestPylon] = units.getClosest(armyManagementService.getCombatRally(resources), pylons);
        if (closestPylon) {
          return closestPylon.pos;
        }
      }
    }
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
    const { getWarpInLocations } = resourceManagerService;
    let nearPosition;
    if (assemblePlan && assemblePlan.state && assemblePlan.state.defenseMode && scoutService.outsupplied) {
      nearPosition = getWarpInLocations(resources);
    } else {
      nearPosition = armyManagementService.getCombatRally(resources);
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
    const nearPosition = armyManagementService.getCombatRally(resources);
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
 * @param {ResourceManager} resources
 * @param {Point2D} position
 * @param {Number} maxRange
 * @returns {Point2D[][]}
 */
function getCreepEdgesWithinRanges(resources, position, maxRange) {
  const { map } = resources.get();
  const grids = gridsInCircle(position, maxRange);
  
  const clusters = getClusters(grids);
  // Create an array to hold creep edges for each range
  /** @type {Point2D[][]} */
  const creepEdgesByRange = Array.from({ length: maxRange }, () => []);

  clusters.forEach(grid => {
    if (pathFindingService.isCreepEdge(map, grid)) {
      const distance = pathFindingService.getDistanceByPath(resources, position, grid);
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


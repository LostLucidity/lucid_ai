//@ts-check
"use strict"

const { EFFECT_INJECTLARVA, BUILD_CREEPTUMOR_QUEEN } = require("@node-sc2/core/constants/ability");
const { QUEEN, CREEPTUMORBURROWED, CREEPTUMOR, HATCHERY, LAIR } = require("@node-sc2/core/constants/unit-type");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { intersectionOfPoints } = require("../../helper/utilities");
const { creepGeneratorsTypes } = require("@node-sc2/core/constants/groups");
const { canBuild } = require("../../src/world-service");
const { createUnitCommand } = require("../../src/services/command-service");
const { getPathCoordinates } = require("../../services/path-service");
const { getMapPath } = require("../../systems/map-resource-system/map-resource-service");
const unitService = require("../../services/unit-service");
const pathFindingService = require("../../src/services/pathfinding/pathfinding-service");
const { getClosestPathWithGasGeysers, getDistanceBetween } = require("../../src/services/utility-service");
const { getGasGeysers } = require("../../src/services/unit-retrieval");
const enemyTrackingService = require("../../src/services/enemy-tracking");
const armyManagementService = require("../../src/services/army-management/army-management-service");
const MapResourceService = require("../../systems/map-resource-system/map-resource-service");
const { createMoveCommand } = require("../../src/services/command-service");
const { isOnCreep } = require("../../src/services/shared-utilities/common-utilities");

module.exports = {
  /**
   * Update labels for queens based on certain conditions.
   *
   * @param {UnitResource} units - The units data object.
   */
  labelQueens: (units) => {
    const INJECTOR_LABEL = 'injector';
    const CREEPER_LABEL = 'creeper';

    const injectorCount = units.withLabel(INJECTOR_LABEL).length;
    const completedBaseCount = units.getBases().filter(base => base.buildProgress !== undefined && base.buildProgress >= 1).length;

    if (injectorCount < completedBaseCount) {
      setLabel(units, INJECTOR_LABEL);
    } else if (units.getById(QUEEN).length > units.getBases().length) {
      setLabel(units, CREEPER_LABEL);
    }
  },
  /**
   * Determines which injector queens should perform an inject action, which ones should engage in battle, 
   * and which ones should move to the nearest creep when not needed in battle.
   *
   * @param {World} world - The current state of the world.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - Array of actions that the queens should take.
   */
  inject: (world) => {
    const { units } = world.resources.get();
    const collectedActions = [];

    const allInjectorQueens = units.withLabel('injector').filter(queen => queen.pos);
    const injectableQueens = allInjectorQueens.filter(queen => queen.availableAbilities().includes(EFFECT_INJECTLARVA));

    allInjectorQueens.forEach(queen => {
      if (queen.pos) {
        const closeAllies = unitService.getUnitsInRadius(units.getAlive(Alliance.SELF), queen.pos, 16);
        const closeEnemies = unitService.getUnitsInRadius(enemyTrackingService.mappedEnemyUnits, queen.pos, 16);

        const nearbyQueens = closeAllies.filter(unit => allInjectorQueens.some(queen => queen.tag === unit.tag));
        const necessaryInjectorQueens = armyManagementService.getNecessaryUnits(world, nearbyQueens, closeAllies, closeEnemies);

        const isQueenNecessary = necessaryInjectorQueens.some(necessaryQueen => necessaryQueen.tag === queen.tag);
        const isInCombat = closeEnemies.length > 0;

        if (isQueenNecessary && isInCombat) {
          // Handle the queen engaging in battle if needed
        } else if (injectableQueens.includes(queen)) {
          // The queen can inject and is not needed in battle, proceed to inject
          collectedActions.push(...findTargetBaseAndInject(units, queen));
        } else if (!isInCombat) {
          // The queen is not in combat and not needed in battle, move it to the nearest creep
          collectedActions.push(...moveToNearestCreep(world, queen));
        }
      }
    });

    return collectedActions;
  }
,
  /**
   * @param {World} world 
   */
  maintainQueens: async (world) => {
    const { data, resources } = world;
    const { actions, units, } = resources.get();
    const queenBuildAbilityId = data.getUnitTypeData(QUEEN).abilityId;
    const queenCount = units.getById(QUEEN).length + units.withCurrentOrders(queenBuildAbilityId).length;
    const baseCount = units.getBases().length;
    if (queenCount <= baseCount) {
      if (canBuild(world, QUEEN)) {
        const trainer = units.getProductionUnits(QUEEN).find(unit => unit.noQueue && unit.buildProgress >= 1);
        if (trainer) {
          try { await actions.train(QUEEN); } catch (error) { console.log(error) }
        }
      }
    }
  },
  /**
   * @param {ResourceManager} resources
   * @returns {Promise<Array>}
   */
  spreadCreepByQueen: async (resources) => {
    const collectedActions = [];
    const { map, units } = resources.get();
    const label = 'creeper';
    const idleCreeperQueens = units.withLabel(label).filter(unit => unit.abilityAvailable(BUILD_CREEPTUMOR_QUEEN) && unit.orders.length === 0);
    if (idleCreeperQueens.length > 0) {
      if (units.getById(CREEPTUMORBURROWED).length <= 3) {
        // get own creep edges
        const creepGenerators = units.getById(creepGeneratorsTypes);
        const ownCreepEdges = map.getCreep().filter(position => {
          const [closestCreepGenerator] = units.getClosest(position, creepGenerators);
          if (closestCreepGenerator) {
            const distanceToCreepGenerator = distance(position, closestCreepGenerator.pos);
            return distanceToCreepGenerator > 9 && distanceToCreepGenerator < 12.75
          }
        });
        // get closest creep edges on path to enemy
        const occupiedTownhalls = map.getOccupiedExpansions().map(expansion => expansion.getBase());
        const { townhallPosition } = map.getEnemyNatural();
        const [closestTownhallPositionToEnemy] = pathFindingService.getClosestUnitByPath(resources, townhallPosition, occupiedTownhalls, getGasGeysers(units)).map(unit => unit.pos);
        if (closestTownhallPositionToEnemy === undefined) return collectedActions;
        const closestPathablePositionsBetweenPositions = getClosestPathWithGasGeysers(resources, closestTownhallPositionToEnemy, townhallPosition);
        const { pathablePosition, pathableTargetPosition } = closestPathablePositionsBetweenPositions;
        const pathToEnemyNatural = getMapPath(map, pathablePosition, pathableTargetPosition);
        const pathCoordinates = getPathCoordinates(pathToEnemyNatural);
        const creepEdgeAndPath = intersectionOfPoints(pathCoordinates, ownCreepEdges);
        if (creepEdgeAndPath.length > 0) {
          const outEdgeCandidate = pathFindingService.getClosestPositionByPath(resources, closestTownhallPositionToEnemy, creepEdgeAndPath, creepEdgeAndPath.length)[creepEdgeAndPath.length - 1];
          const [closestSpreader] = units.getClosest(outEdgeCandidate, idleCreeperQueens);
          const unitCommand = {
            abilityId: BUILD_CREEPTUMOR_QUEEN,
            targetWorldSpacePos: outEdgeCandidate,
            unitTags: [closestSpreader.tag]
          }
          collectedActions.push(unitCommand);
        }
      } else {
        collectedActions.push(...await findAndPlaceCreepTumor(resources, idleCreeperQueens, BUILD_CREEPTUMOR_QUEEN, map.getCreep()));
      }
    }
    return collectedActions;
  },
}

let longestTime = 0;

async function findAndPlaceCreepTumor(resources, spreaders, ability, candidates) {
  const { actions, map, units } = resources.get();
  let collectedActions = [];
  let creepPoints = []
  const pointLimit = 250;
  if (candidates.length > pointLimit) {
    creepPoints = getRandomWithLimit(candidates, pointLimit);
  } else {
    creepPoints = candidates;
  }
  const t0 = new Date().getTime();
  const creepCandidates = creepPoints.filter(point => {
    return filterPlacementsByRange(map, units, [HATCHERY, LAIR, CREEPTUMORBURROWED,], point, 9);
  });
  const t1 = new Date().getTime();
  longestTime = (t1 - t0) > longestTime ? t1 - t0 : longestTime;
  console.log(`creepPoints.filter(point${t1 - t0} milliseconds. Longest Time ${longestTime}`);
  if (creepCandidates.length > 0) {
    // for every creepCandidate filter by finding at least one spreader less than 10.5 distance
    // no test for queens.
    const spreadableCreepCandidates = creepCandidates.filter(candidate => ability === BUILD_CREEPTUMOR_QUEEN ? true : spreaders.some(spreader => distance(candidate, spreader.pos,) <= 10.5));
    const allSpreaders = [...units.getById(CREEPTUMORBURROWED)].filter(unit => unit.availableAbilities().length > 0);
    if (spreadableCreepCandidates.length > 0) {
      const foundPosition = await actions.canPlace(CREEPTUMOR, spreadableCreepCandidates);
      if (foundPosition) {
        // get closest spreader
        const [closestSpreader] = units.getClosest(foundPosition, spreaders);
        const unitCommand = {
          abilityId: ability,
          targetWorldSpacePos: foundPosition,
          unitTags: [closestSpreader.tag]
        }
        collectedActions.push(unitCommand);
        allSpreaders.forEach(spreader => spreader.labels.set('done', false));
      }
    } else {
      spreaders.forEach(spreader => spreader.labels.set('done', true));
    }
  }
  return collectedActions;
}

function filterPlacementsByRange(map, units, unitType, point, range) {
  return [...units.getById(unitType), ...map.getAvailableExpansions()]
    .map(creepGenerator => creepGenerator.pos || creepGenerator.townhallPosition)
    .every(position => {
      const [closestEnemyStructure] = units.getClosest(position, units.getStructures(Alliance.ENEMY));
      if (closestEnemyStructure) {
        return (
          distance(position, point) >= range &&
          map.getOccupiedExpansions(Alliance.ENEMY).every(expansion => distance(point, expansion.townhallPosition) > 11.5)
        )
      } else {
        return distance(position, point) >= range;
      }
    });
}

function getRandomWithLimit(array, limit) {
  let result = new Array(limit), len = array.length, taken = new Array(len);
  if (limit > len)
    throw new RangeError("getRandom: more elements taken than available");
  while (limit--) {
    var x = Math.floor(Math.random() * len);
    result[limit] = array[x in taken ? taken[x] : x];
    taken[x] = --len in taken ? taken[len] : len;
  }
  return result;
}
/**
 * Set or adjust the given label on a queen. If a queen has an 'injector' or 'creeper' label, 
 * it will be replaced by the new label. Other labels remain unaffected.
 *
 * @param {UnitResource} units - The units data object.
 * @param {string} label - The label to be set.
 */
function setLabel(units, label) {
  const foundQueen = units.getById(QUEEN).find(queen => !queen.labels.get('injector') && !queen.labels.get('creeper'));
  if (foundQueen) {
    // Remove 'injector' and 'creeper' labels, if they exist
    foundQueen.labels.delete('injector');
    foundQueen.labels.delete('creeper');

    // Set the new label
    foundQueen.labels.set(label, true);
  }
}
/**
 * @param {UnitResource} units 
 * @param {Unit} queen 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function findTargetBaseAndInject(units, queen) {
  const collectedActions = [];
  const nonInjectedBases = units.getBases().filter(base => !base.buffIds.includes(11));
  const [townhall] = units.getClosest(queen.pos, units.getClosest(queen.pos, nonInjectedBases));
  if (townhall) {
    const unitCommand = createUnitCommand(EFFECT_INJECTLARVA, [queen]);
    unitCommand.targetUnitTag = townhall.tag;
    collectedActions.push(unitCommand);
  }
  return collectedActions;
}

/**
 * Moves the specified queen to the nearest creep if not already on creep.
 * @param {World} world - The current state of the world.
 * @param {Unit} queen - The queen that should be moved.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - Array of actions to move the queen to the nearest creep.
 */
function moveToNearestCreep(world, queen) {
  if (!queen.pos || isOnCreep(queen.pos)) { // Revised this line to use your existing isCreep function
    return []; // Return an empty array if queen.pos is undefined or queen is already on creep
  }

  const creep = findNearestCreep(world, queen.pos);
  if (!creep) return []; // If no creep is found, return an empty action array

  const moveCommand = createMoveCommand(queen, creep);
  return moveCommand ? [moveCommand] : [];
}

/**
 * Finds the nearest creep to the given position.
 * @param {World} world - The current state of the world.
 * @param {Point2D} position - The position of the unit.
 * @returns {Point2D} - The position of the nearest creep or a default position if no creep is found.
 */
function findNearestCreep(world, position) {
  // Get all tiles/positions from the world where creep exists
  const creeps = Array.from(MapResourceService.creepPositionsSet).map(grid => {
    const [x, y] = grid.split(':').map(Number);
    return { x, y };
  });

  // If there are no creeps, return a default position
  if (!creeps || creeps.length === 0) return { x: -1, y: -1 }; // Adjust this as needed

  // Calculate the distance between the unit and each creep position, and find the nearest one
  let nearestCreep = creeps[0]; // Initialize with the first creep position to avoid null
  let minimumDistance = Infinity;

  creeps.forEach(creep => {
    const distance = getDistanceBetween(position, creep);

    if (distance < minimumDistance) {
      minimumDistance = distance;
      nearestCreep = creep;
    }
  });

  return nearestCreep;
}

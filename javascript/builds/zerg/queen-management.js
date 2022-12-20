//@ts-check
"use strict"

const { EFFECT_INJECTLARVA, BUILD_CREEPTUMOR_QUEEN, BUILD_CREEPTUMOR_TUMOR } = require("@node-sc2/core/constants/ability");
const { QUEEN, CREEPTUMORBURROWED, CREEPTUMOR, HATCHERY, LAIR } = require("@node-sc2/core/constants/unit-type");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { intersectionOfPoints } = require("../../helper/utilities");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { findPosition } = require("../../helper/placement/placement-helper");
const { creepGenerators } = require("@node-sc2/core/constants/groups");
const { getClosestPosition } = require("../../helper/get-closest");
const { canBuild, getDPSHealth } = require("../../services/world-service");
const { createUnitCommand } = require("../../services/actions-service");
const { getPathCoordinates } = require("../../services/path-service");
const { getMapPath } = require("../../services/map-resource-service");
const { getClosestUnitByPath, getClosestPositionByPath, getClosestPathablePositionsBetweenPositions } = require("../../services/resource-manager-service");

module.exports = {
  labelQueens: (units) => {
    let label = 'injector';
    if (units.withLabel(label).length < units.getBases().filter(base => base.buildProgress >= 1).length) {
      // get not injector queens
      setLabel(units, label);
      // label as injector
    } else if (units.getById(QUEEN).length > units.getBases().length) {
      setLabel(units, 'creeper');
    }
  },
  /**
   * @param {World} world 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  inject: (world) => {
    const { units } = world.resources.get();
    const collectedActions = [];
    // get injector queens, with injector ability
    const injectorQueens = units.withLabel('injector').filter(queen => queen.availableAbilities().includes(EFFECT_INJECTLARVA));
    // inject larva only if QUEEN leaving battle doesn't make the army weaker.
    injectorQueens.forEach(queen => {
      // subtract own DPSHealth from selfDPSHealth and compare to enemy selfDPSHealth
      const [closestEnemy] = units.getClosest(queen.pos, queen['enemyUnits']);
      if (closestEnemy) {
        const queenDPSHealth = getDPSHealth(world, queen, queen['enemyUnits'].map((/** @type {Unit} */ unit) => unit.unitType));
        const leftOverDPSHealth = queen['selfDPSHealth'] - queenDPSHealth;
        if (leftOverDPSHealth > closestEnemy['selfDPSHealth']) {
          collectedActions.push(...findTargetBaseAndInject(units, queen));
        }
      } else {
        collectedActions.push(...findTargetBaseAndInject(units, queen));
      }
    });
    return collectedActions;
  },
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
   * @returns {Promise<SC2APIProtocol.ActionRawUnitCommand[]>}
   */
  spreadCreep: async (resources) => {
    const { map, units } = resources.get();
    const collectedActions = [];
    const activeCreepTumors = units.getById(CREEPTUMORBURROWED).filter(unit => unit.availableAbilities().length > 0 && !unit.labels.get('done'));
    if (activeCreepTumors.length > 0) {
      if (units.getById(CREEPTUMORBURROWED).length <= 3) {
        const enemyNaturalTownhallPosition = map.getEnemyNatural().townhallPosition;
        activeCreepTumors.forEach(tumor => {
          // get placeable around creep tumor
          const { pos } = tumor;
          if (pos === undefined) return;
          const pathablePositions = getClosestPathablePositionsBetweenPositions(resources, pos, enemyNaturalTownhallPosition);
          const { pathablePosition, pathableTargetPosition } = pathablePositions;
          if (!pathablePosition) return;
          const pathCoordinates = getPathCoordinates(getMapPath(map, pathablePosition, pathableTargetPosition));
          const [farthestPosition] = pathCoordinates.filter(position => distance(position, pos) <= 10 && map.hasCreep(position)).sort((a, b) => distance(b, pos) - distance(a, pos));
          if (!farthestPosition) return;
          const unitCommand = createUnitCommand(BUILD_CREEPTUMOR_TUMOR, [tumor]);
          unitCommand.targetWorldSpacePos = farthestPosition;
          collectedActions.push(unitCommand);
        });
      } else {
        for (let step = 0; step < activeCreepTumors.length; step++) {
          const radius = 10;
          let lowerLimit = 9;
          let foundPosition = null;
          const tumor = activeCreepTumors[step];
          do {
            let excludedCircle = gridsInCircle(tumor.pos, lowerLimit);
            const candidatePositions = gridsInCircle(tumor.pos, radius).filter(position => {
              const [closestCreepGenerator] = units.getClosest(position, units.getById(creepGenerators));
              const [closestTownhallPosition] = getClosestPosition(position, map.getExpansions().map(expansion => expansion.townhallPosition));
              return [
                closestCreepGenerator,
                !excludedCircle.includes(position),
                distance(position, closestCreepGenerator.pos) > lowerLimit,
                distance(position, tumor.pos) <= radius,
                closestTownhallPosition ? distance(position, closestTownhallPosition) > 3 : true
              ].every(condition => condition);
            });
            foundPosition = await findPosition(resources, CREEPTUMOR, candidatePositions);
            lowerLimit -= 0.5;
          } while (!foundPosition && lowerLimit > 0);
          if (foundPosition) {
            const unitCommand = createUnitCommand(BUILD_CREEPTUMOR_TUMOR, [tumor]);
            unitCommand.targetWorldSpacePos = foundPosition;
            collectedActions.push(unitCommand);
          }
          tumor.labels.set('done', true);
        }
      }
    }
    return collectedActions;
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
        const ownCreepEdges = map.getCreep().filter(position => {
          const [closestCreepGenerator] = units.getClosest(position, units.getById(creepGenerators));
          if (closestCreepGenerator) {
            const distanceToCreepGenerator = distance(position, closestCreepGenerator.pos);
            return distanceToCreepGenerator > 9 && distanceToCreepGenerator < 12.75
          }
        });
        // get closest creep edges on path to enemy
        const occupiedTownhalls = map.getOccupiedExpansions().map(expansion => expansion.getBase());
        const { townhallPosition } = map.getEnemyNatural();
        const [closestTownhallPositionToEnemy] = getClosestUnitByPath(resources, townhallPosition, occupiedTownhalls).map(unit => unit.pos);
        if (closestTownhallPositionToEnemy === undefined) return collectedActions;
        const closestPathablePositionsBetweenPositions = getClosestPathablePositionsBetweenPositions(resources, closestTownhallPositionToEnemy, townhallPosition);
        const { pathablePosition, pathableTargetPosition } = closestPathablePositionsBetweenPositions;
        const pathToEnemyNatural = getMapPath(map, pathablePosition, pathableTargetPosition);
        const pathCoordinates = getPathCoordinates(pathToEnemyNatural);
        const creepEdgeAndPath = intersectionOfPoints(pathCoordinates, ownCreepEdges);
        if (creepEdgeAndPath.length > 0) {
          const outEdgeCandidate = getClosestPositionByPath(resources, closestTownhallPositionToEnemy, creepEdgeAndPath, creepEdgeAndPath.length)[creepEdgeAndPath.length - 1];
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

function setLabel(units, label) {
  const foundQueen = units.getById(QUEEN).find(queen => !queen.labels.get('injector'));
  if (foundQueen) {
    foundQueen.labels.clear();
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
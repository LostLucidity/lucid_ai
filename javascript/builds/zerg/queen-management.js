//@ts-check
"use strict"

const { EFFECT_INJECTLARVA, BUILD_CREEPTUMOR_QUEEN, BUILD_CREEPTUMOR_TUMOR } = require("@node-sc2/core/constants/ability");
const { QUEEN, CREEPTUMORBURROWED, CREEPTUMOR, HATCHERY, LAIR } = require("@node-sc2/core/constants/unit-type");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { distance, add } = require("@node-sc2/core/utils/geometry/point");
const canAfford = require("../../helper/can-afford");
const { getClosestPositionByPath, getClosestUnitByPath } = require("../../helper/get-closest-by-path");
const {  intersectionOfPoints } = require("../../helper/utilities");

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
  inject: (units) => {
    const collectedActions = []
    const queen = units.withLabel('injector').find(injector => injector.energy >= 25);
    if (queen) {
      const nonInjectedBases = units.getBases().filter(base => !base.buffIds.includes(11));
      const [ townhall ] = units.getClosest(queen.pos, units.getClosest(queen.pos, nonInjectedBases));
      if (townhall) {
        const unitCommand = {
          abilityId: EFFECT_INJECTLARVA,
          targetUnitTag: townhall.tag,
          unitTags: [ queen.tag ]      
        }
        collectedActions.push(unitCommand);
      }
    }
    return collectedActions;
  },
  maintainQueens: async (resources, data, agent) => {
    const { actions, units, } = resources.get();
    const queenBuildAbilityId = data.getUnitTypeData(QUEEN).abilityId;
    const queenCount = units.getById(QUEEN).length + units.withCurrentOrders(queenBuildAbilityId).length;
    const baseCount = units.getBases().length;
    if (queenCount <= baseCount) {
      if (canAfford(agent, data, QUEEN)) {
        const trainer = units.getProductionUnits(QUEEN).find(unit => unit.noQueue && unit.buildProgress >= 1);
        if (trainer) {
          try { await actions.train(QUEEN); } catch (error) { console.log(error) }
        }
      }
    }
  },
  spreadCreep: async (resources) => {
    const { map, units } = resources.get();
    const collectedActions = [];
    const label = 'creeper';
    const idleCreeperQueens = units.withLabel(label).filter(unit => unit.abilityAvailable(BUILD_CREEPTUMOR_QUEEN) && unit.orders.length === 0);
    const activeCreepTumors = [...units.getById(CREEPTUMORBURROWED) ].filter(unit => unit.availableAbilities().length > 0 && !unit.labels.get('stuck'));
    if (idleCreeperQueens.length > 0) {
      if (units.getById(CREEPTUMORBURROWED).length <= 2) {
        // get creep natural closest to enemy
        const occupiedTownhalls = map.getOccupiedExpansions().map(expansion => expansion.getBase());
        const [ closestTownhallPositionToEnemy ] = getClosestUnitByPath(resources, map.getEnemyMain().townhallPosition, occupiedTownhalls).map(unit => unit.pos);
        const pathToEnemyMain = map.path(add(closestTownhallPositionToEnemy, 3), add(map.getEnemyMain().townhallPosition, 3))
          .map(step => ({ x: step[0], y: step[1] }))
          .filter(point => map.getOccupiedExpansions(Alliance.ENEMY).every(expansion => distance(point, expansion.townhallPosition) > 11.5));
        const intersectedPoints = intersectionOfPoints(map.getCreep(), pathToEnemyMain);
        const closestCreepToEnemy = getClosestPositionByPath(resources, map.getEnemyMain().townhallPosition, intersectedPoints, 4);
        collectedActions.push(...await findAndPlaceCreepTumor(resources, idleCreeperQueens, BUILD_CREEPTUMOR_QUEEN, closestCreepToEnemy));
      } else {
        collectedActions.push(...await findAndPlaceCreepTumor(resources, idleCreeperQueens, BUILD_CREEPTUMOR_QUEEN, map.getCreep()));
      }
    }
    if (activeCreepTumors.length > 0) {
      collectedActions.push(...await findAndPlaceCreepTumor(resources, activeCreepTumors, BUILD_CREEPTUMOR_TUMOR, map.getCreep()))
    }
    return collectedActions;
  }
}

let longestTime = 0;

function findCreepPlacement(resources, candidates) {
  const { map, units } = resources.get();
  let collectedActions = [];
  let creepPoints = []
  const pointLimit = 250;
  if (candidates.length > pointLimit) {
    creepPoints = getRandomWithLimit(candidates, pointLimit);
  } else {
    creepPoints = candidates;
  }
  const creepCandidates = creepPoints.filter(point => {
    return filterPlacementsByRange(map, units, [ HATCHERY, LAIR, CREEPTUMORBURROWED, ], point, 9);
  });
}

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
    return filterPlacementsByRange(map, units, [ HATCHERY, LAIR, CREEPTUMORBURROWED, ], point, 9);
  });
  const t1 = new Date().getTime();
  longestTime = (t1 - t0) > longestTime ? t1 - t0 : longestTime;
  console.log(`creepPoints.filter(point${t1 - t0} milliseconds. Longest Time ${longestTime}`);
  if (creepCandidates.length > 0) {
    // for every creepCandidate filter by finding at least one spreader less than 10.5 distance
    // no test for queens.
    const spreadableCreepCandidates = creepCandidates.filter(candidate => ability === BUILD_CREEPTUMOR_QUEEN ? true : spreaders.some(spreader => distance( candidate, spreader.pos, ) <= 10.5));
    const allSpreaders = [...units.getById(CREEPTUMORBURROWED)].filter(unit => unit.availableAbilities().length > 0);
    if (spreadableCreepCandidates.length > 0) {
      const foundPosition = await actions.canPlace(CREEPTUMOR, spreadableCreepCandidates);
      if (foundPosition) {
        // get closest spreader
        const [ closestSpreader ] = units.getClosest(foundPosition, spreaders);
        const unitCommand = {
          abilityId: ability,
          targetWorldSpacePos: foundPosition,
          unitTags: [ closestSpreader.tag ]
        }
        collectedActions.push(unitCommand);
        allSpreaders.forEach(spreader => spreader.labels.set('stuck', false));
      }
    } else {
      spreaders.forEach(spreader => spreader.labels.set('stuck', true));
    }
  }
  return collectedActions;
}

function filterPlacementsByRange(map, units, unitType, point, range) {
  return [...units.getById(unitType), ...map.getAvailableExpansions()]
    .map(creepGenerator => creepGenerator.pos || creepGenerator.townhallPosition)
    .every(position => {
      const [ closestEnemyStructure ] = units.getClosest(position, units.getStructures(Alliance.ENEMY));
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
  var result = new Array(limit),
  len = array.length,
  taken = new Array(len);
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
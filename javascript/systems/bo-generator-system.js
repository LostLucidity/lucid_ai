//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { UnitType } = require("@node-sc2/core/constants");
const { Attribute, Race } = require("@node-sc2/core/constants/enums");
const { townhallTypes, gasMineTypes } = require("@node-sc2/core/constants/groups");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { DRONE, BUNKER } = require("@node-sc2/core/constants/unit-type");
const foodUsedService = require("../services/food-used-service");
const planService = require("../services/plan-service");
const { getUnitTypeCount, getFoodUsed, shortOnWorkers, getBuilder, assignAndSendWorkerToBuild, train } = require("../services/world-service");
const { build, upgrade, runPlan } = require("./execute-plan/plan-actions");
const scoutingService = require("./scouting/scouting-service");
const { v4: uuidv4 } = require('uuid');
const dataService = require("../services/data-service");
const { setUnitTypeTrainingAbilityMapping, getAllAvailableAbilities, setUpgradeAbilities } = require("../services/data-service");
const { supplyTypes } = require("../helper/groups");
const { getDistanceByPath } = require("../services/resource-manager-service");
const { setScout } = require("./scouting/scouting-service");
const getRandom = require("@node-sc2/core/utils/get-random");
const { getTargetLocation } = require("../services/map-resource-service");
const { getTimeInSeconds } = require("../services/frames-service");

module.exports = createSystem({
  name: 'BoGeneratorSystem',
  type: 'agent',
  async onGameStart(world) {
    const { agent, data } = world;
    const { race } = agent;
    planService.bogIsActive = true;
    // create a uuid
    planService.uuid = uuidv4();
    planService.mineralMaxThreshold = race === Race.ZERG ? 300 : 400;
    planService.mineralMinThreshold = 100;
    if (race === Race.PROTOSS) {
      planService.naturalWallPylon = true;
      console.log('planService.naturalWallPylon', planService.naturalWallPylon);
    }
    setUnitTypeTrainingAbilityMapping(data);
    setUpgradeAbilities(data);
    foodUsedService.minimumAmountToAttackWith = Math.round(Math.random() * 200);
    console.log(`Minimum amount of food to attack with: ${foodUsedService.minimumAmountToAttackWith}`);
  },
  async onStep(world) {
    const { agent, data, resources } = world;
    const { actions, units } = resources.get();
    const { mineralMaxThreshold, mineralMinThreshold } = planService;
    const collectedActions = [];
    // starting at 12 food, while at current food, 1/3 chance of action else build drone and increment food by 1
    await runPlan(world);
    const trueFoodUsed = getFoodUsed(world)
    scouting(world);
    // decide worker training when minerals greater then mineralMinThreshold and less then mineralMaxThreshold
    const decideWorkerTraining = agent.minerals > mineralMinThreshold && agent.minerals < mineralMaxThreshold;
    if (trueFoodUsed === planService.foodMark) {
      if (decideWorkerTraining) {
        if (shortOnWorkers(world) && Math.random() > (1 / 3)) {
          await train(world, WorkerRace[agent.race]);
          planService.foodMark++
        }
        return;
      }
    } else if (trueFoodUsed < planService.foodMark) {
      if (decideWorkerTraining) {
        if (shortOnWorkers(world) && Math.random() > (1 / 3)) {
          await train(world, WorkerRace[agent.race]);
        }
        data.get('earmarks').forEach((/** @type {Earmark} */ earmark) => data.settleEarmark(earmark.name));
        return;
      }
    } else if (trueFoodUsed > planService.foodMark) {
      planService.foodMark = trueFoodUsed;
      return;
    }
    if (agent.minerals > mineralMaxThreshold && planService.continueBuild) {
      const allAvailableAbilities = getAllAvailableAbilities(data, units);
      await runAction(world, allAvailableAbilities);
    }
    collectedActions.push(...optimizeBuildCommands(world));
    data.get('earmarks').forEach(earmark => data.settleEarmark(earmark.name));
    return actions.sendAction(collectedActions);
  },
  async onEnemyFirstSeen(_world, seenEnemyUnit) {
    scoutingService.opponentRace = seenEnemyUnit.data().race;
  }
});
/**
 * @param {MapResource} map
 * @param {UnitTypeId} unitType
 * @returns {Boolean}
 */
function isGasExtractorWithoutFreeGasGeyser(map, unitType) {
  // if unitType is a gas extractor, make sure there are free gas geysers
  if (unitType === UnitType.EXTRACTOR) {
    const freeGasGeysers = map.freeGasGeysers();
    return freeGasGeysers.length === 0;
  } else {
    return false;
  }
}
/**
 * 
 * @param {DataStorage} data 
 * @param {UnitTypeId} unitType 
 * * @param {number} unitTypeCount 
 * @returns {Boolean}
 */
function diminishChangeToBuild(data, unitType, unitTypeCount) {
  const { attributes } = data.getUnitTypeData(unitType);
  if (attributes === undefined) return false;
  if (attributes.includes(Attribute.STRUCTURE)) {
    const divisorToDiminish = [...gasMineTypes, ...townhallTypes].includes(unitType) ? unitTypeCount : unitTypeCount * 8;
    return (1 / ((divisorToDiminish + 1) * 8)) < Math.random();
  } else {
    const divisorToDiminish = [...supplyTypes].includes(unitType) ? unitTypeCount : 0;
    return (1 / (divisorToDiminish + 1)) < Math.random();
  }
}

/**
 * @param {World} world
 * @param {Map<number, {orderType: string, unitType: number, upgrade: number}>} allAvailableAbilities
 * @returns {Promise<void>}
 */
async function runAction(world, allAvailableAbilities) {
  const { agent, data, resources } = world;
  const { actions } = resources.get();
  const { foodUsed } = agent;
  if (foodUsed === undefined) return;
  const { map, units } = resources.get();
  const collectedActions = [];
  const allAvailableAbilitiesArray = Array.from(allAvailableAbilities.values()).filter(action => action.unitType !== BUNKER);
  let actionTaken = false;
  while (!actionTaken && allAvailableAbilitiesArray.length > 0) {
    const [action] = allAvailableAbilitiesArray.splice(Math.floor(Math.random() * allAvailableAbilitiesArray.length), 1);
    const { orderType, unitType } = action;
    if (orderType === 'UnitType') {
      const unitTypeCount = getUnitTypeCount(world, unitType) + (unitType === DRONE ? units.getStructures().length - 1 : 0);
      const conditions = [
        isGasExtractorWithoutFreeGasGeyser(map, unitType),
        diminishChangeToBuild(data, unitType, unitTypeCount),
        WorkerRace[agent.race] === unitType && !shortOnWorkers(world)
      ];
      if (conditions.some(condition => condition)) continue;
      const isMatchingPlan = planService.plan.some(step => {
        return (
          step.unitType === unitType &&
          step.targetCount === unitTypeCount
        );
      });
      actionTaken = true;
      if (!isMatchingPlan) {
        planService.plan.push({
          orderType, unitType, food: foodUsed, targetCount: getUnitTypeCount(world, unitType)
        });
        const { attributes } = data.getUnitTypeData(unitType);
        if (attributes === undefined) return;
        if (attributes.includes(Attribute.STRUCTURE)) {
          await build(world, unitType);
        } else {
          await train(world, unitType);
        }
      }
    } else if (orderType === 'Upgrade') {
      planService.plan.push({
        orderType, upgrade: action.upgrade, food: foodUsed
      });
      await upgrade(world, action.upgrade);
      actionTaken = true;
    }
  }
  if (collectedActions.length > 0) {
    await actions.sendAction(collectedActions);
  }
}
/**
 * @param {World} world 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function optimizeBuildCommands(world) {
  const { agent, data, resources } = world;
  const { units } = resources.get();
  const collectedActions = [];
  units.getWorkers().forEach(worker => {
    const { orders, pos } = worker;
    if (orders === undefined || pos === undefined) return;
    let unitType;
    const foundOrder = orders.find(order => {
      const { abilityId } = order;
      if (abilityId === undefined) return false;
      const unitTypeTrainingAbilities = dataService.unitTypeTrainingAbilities;
      unitType = unitTypeTrainingAbilities.get(abilityId);
      if (unitType === undefined) return false;
      const { attributes } = data.getUnitTypeData(unitType);
      if (attributes === undefined) return false;
      if (attributes.includes(Attribute.STRUCTURE)) {
        const { targetWorldSpacePos } = order;
        if (targetWorldSpacePos === undefined) return false;
        const { x, y } = targetWorldSpacePos;
        if (x === undefined || y === undefined) return false;
        const structure = units.getStructures().find(structure => {
          const { pos } = structure;
          if (pos === undefined) return false;
          const { x: structureX, y: structureY } = pos;
          if (structureX === undefined || structureY === undefined) return false;
          return structureX === x && structureY === y;
        });
        return structure === undefined;
      }
      return false;
    });
    if (foundOrder === undefined) return;
    const { targetWorldSpacePos } = foundOrder;
    if (targetWorldSpacePos === undefined) return;
    const closestWorker = getBuilder(world, targetWorldSpacePos);
    if (closestWorker === null) return;
    const { pos: closestWorkerPos } = closestWorker;
    if (closestWorkerPos === undefined || unitType === undefined) return;
    if (closestWorker.tag === worker.tag || (getDistanceByPath(resources, pos, targetWorldSpacePos) <= getDistanceByPath(resources, closestWorkerPos, targetWorldSpacePos))) return;
    if (agent.canAfford(unitType)) {
      collectedActions.push(...assignAndSendWorkerToBuild(world, unitType, targetWorldSpacePos, false));
    }
  });
  return collectedActions;
}
/**
 * @param {World} world
 * return {void}
 */
function scouting(world) {
  const { agent } = world;
  const { race } = agent;
  switch (race) {
    case Race.TERRAN: {
      const scoutInfo = getRandom([{
        start: { food: 17 },
        end: { time: 120 },
        unitType: 'SCV',
        targetLocation: 'EnemyMain',
        scoutType: 'earlyScout'
      }]);
      implementScout(world, scoutInfo);
      break;
    }
    case Race.PROTOSS: {
      const scoutInfo = getRandom([
        {
          start: { food: 14, unit: { type: 'PYLON', count: 1 } },
          end: { food: 19 },
          unitType: 'PROBE',
          targetLocation: 'EnemyMain',
          scoutType: 'earlyScout'
        }]);
      implementScout(world, scoutInfo);
      break;
    }
  }
}
/**
 * @param {World} world 
 * @param {import("../interfaces/scouting").ScoutInfo} scoutInfo 
 */
function implementScout(world, scoutInfo) {
  const { agent, resources } = world;
  const { foodUsed } = agent;
  const { map, units } = resources.get();
  if (foodUsed === undefined) return;
  const { unitType, targetLocation } = scoutInfo;
  const startCondition = getStartCondition(world, scoutInfo);
  const endCondition = getEndCondition(world, scoutInfo);
  if (startCondition && !endCondition) {
    if (units.withLabel(`scout${targetLocation}`).length === 0) {
      const location = getTargetLocation(map, `get${targetLocation}`);
      setScout(units, location, UnitType[unitType], `scout${targetLocation}`);
    }
  } else {
    units.withLabel('scoutEnemyMain').forEach(unit => {
      unit.removeLabel('scoutEnemyMain');
      unit.addLabel('clearFromEnemy', true);
    });
  }
}

/**
 * @param {World} world 
 * @param {import("../interfaces/scouting").ScoutInfo} scoutInfo
 * @returns {boolean}
 */
function getStartCondition(world, scoutInfo) {
  const { agent, resources } = world;
  const { start } = scoutInfo;
  const { foodUsed } = agent; if (foodUsed === undefined) return false;
  const { frame, units } = resources.get();
  const conditions = [];
  if (start.food !== undefined) {
    conditions.push(foodUsed >= start.food);
  } else if (start.time !== undefined) {
    conditions.push(getTimeInSeconds(frame.getGameLoop()) >= start.time);
  }
  if (start.unit !== undefined) {
    conditions.push(units.getById(UnitType[start.unit.type]).length >= start.unit.count);
  }
  if (scoutInfo.scoutType !== undefined) {
    conditions.push(scoutingService[scoutInfo.scoutType]);
  }
  return conditions.every(condition => condition);
}

/**
 * @param {World} world
 * @param {import("../interfaces/scouting").ScoutInfo} scoutInfo
 * @returns {boolean}
 */
function getEndCondition(world, scoutInfo) {
  const { agent, resources } = world;
  const { end } = scoutInfo;
  const { foodUsed } = agent; if (foodUsed === undefined) return false;
  const { frame } = resources.get();
  const conditions = [];
  if (end.food !== undefined) {
    conditions.push(foodUsed >= end.food);
  } else if (end.time !== undefined) {
    conditions.push(getTimeInSeconds(frame.getGameLoop()) >= end.time);
  }
  return conditions.every(condition => condition);
}
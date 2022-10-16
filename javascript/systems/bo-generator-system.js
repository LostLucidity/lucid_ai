//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Upgrade, UnitType } = require("@node-sc2/core/constants");
const { Attribute, Alliance, Race } = require("@node-sc2/core/constants/enums");
const { townhallTypes, gasMineTypes } = require("@node-sc2/core/constants/groups");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { DRONE } = require("@node-sc2/core/constants/unit-type");
const getRandom = require("@node-sc2/core/utils/get-random");
const foodUsedService = require("../services/food-used-service");
const planService = require("../services/plan-service");
const sharedService = require("../services/shared-service");
const { getUnitTypeCount, getFoodUsed, shortOnWorkers } = require("../services/world-service");
const { build, train, upgrade, runPlan } = require("./execute-plan/plan-actions");
const scoutingService = require("./scouting/scouting-service");
const { v4: uuidv4 } = require('uuid');
const dataService = require("../services/data-service");
const { setUnitTypeTrainingAbilityMapping } = require("../services/data-service");
const { supplyTypes } = require("../helper/groups");

let upgradeAbilities = [];
module.exports = createSystem({
  name: 'BoGeneratorSystem',
  type: 'agent',
  async onGameStart(world) {
    const { agent, data } = world;
    const { race } = agent;
    upgradeAbilities = [];
    planService.bogIsActive = true;
    // create a uuid
    planService.uuid = uuidv4();
    planService.mineralMaxThreshold = race === Race.ZERG ? 300 : 400;
    planService.mineralMinThreshold = 100;
    if (race === Race.PROTOSS) {
      planService.naturalWallPylon = Math.random() > (1 / 2);
      console.log('planService.naturalWallPylon', planService.naturalWallPylon);
    }
    setUnitTypeTrainingAbilityMapping(data);
    Array.from(Object.values(Upgrade)).forEach(upgrade => {
      upgradeAbilities[data.getUpgradeData(upgrade).abilityId.toString()] = upgrade;
    });
    foodUsedService.minimumAmountToAttackWith = Math.round(Math.random() * 200);
    console.log(`Minimum amount of food to attack with: ${foodUsedService.minimumAmountToAttackWith}`);
  },
  async onStep(world) {
    const { agent, data, resources } = world;
    const { units } = resources.get();
    const { mineralMaxThreshold, mineralMinThreshold } = planService;
    sharedService.removePendingOrders(units);
    // starting at 12 food, while at current food, 1/3 chance of action else build drone and increment food by 1
    await runPlan(world);
    const trueFoodUsed = getFoodUsed(world)
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
    data.get('earmarks').forEach(earmark => data.settleEarmark(earmark.name));
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
 * 
 * @param {DataStorage} data 
 * @param {UnitResource} units 
 * @returns {any}
 */
function getAllAvailableAbilities(data, units) {
  const allAvailableAbilities = new Map();
  units.getAlive(Alliance.SELF).forEach(unit => {
    if (!unit.isStructure() || unit.isIdle() || unit.hasReactor() && unit.orders.length === 1) {
      const availableAbilities = unit.availableAbilities();
      availableAbilities.forEach(ability => {
        if (!allAvailableAbilities.has(ability)) {
          const unitTypeTrainingAbilities = dataService.unitTypeTrainingAbilities;
          unitTypeTrainingAbilities.entries()
          if (Array.from(unitTypeTrainingAbilities.keys()).some(unitTypeAbility => unitTypeAbility === ability)) {
            const unitTypeData = data.getUnitTypeData(unitTypeTrainingAbilities.get(ability));
            if (unitTypeData.unitAlias === 0) {
              allAvailableAbilities.set(ability, { orderType: 'UnitType', unitType: unitTypeTrainingAbilities.get(ability) });
            } else {
              // ignore
            }
          } else if (Object.keys(upgradeAbilities).some(upgradeAbility => parseInt(upgradeAbility) === ability)) {
            allAvailableAbilities.set(ability, { orderType: 'Upgrade', upgrade: upgradeAbilities[ability] });
          }
        }
      })
    }
  });
  return allAvailableAbilities;
}

/**
 * @param {World} world
 * @param {any} allAvailableAbilities
 * @returns 
 */
async function runAction(world, allAvailableAbilities) {
  const { agent, data, resources } = world;
  const { foodUsed } = agent;
  if (foodUsed === undefined) return;
  const { map, units } = resources.get();
  const actions = Array.from(allAvailableAbilities.values());
  let actionTaken = false;
  while (!actionTaken && actions.length > 0) {
    const [action] = actions.splice(Math.floor(Math.random() * actions.length), 1);
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
}


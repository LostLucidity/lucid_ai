//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Upgrade, UnitType } = require("@node-sc2/core/constants");
const { Attribute, Alliance, Race } = require("@node-sc2/core/constants/enums");
const { townhallTypes, gasMineTypes } = require("@node-sc2/core/constants/groups");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { DRONE } = require("@node-sc2/core/constants/unit-type");
const getRandom = require("@node-sc2/core/utils/get-random");
const shortOnWorkers = require("../helper/short-on-workers");
const foodUsedService = require("../services/food-used-service");
const planService = require("../services/plan-service");
const sharedService = require("../services/shared-service");
const { getUnitTypeCount, getFoodUsed } = require("../services/world-service");
const { build, train, upgrade, runPlan } = require("./execute-plan/plan-actions");
const scoutingService = require("./scouting/scouting-service");
const { v4: uuidv4 } = require('uuid');

let unitTypeAbilities = [];
let upgradeAbilities = [];
module.exports = createSystem({
  name: 'BoGeneratorSystem',
  type: 'agent',
  async onGameStart(world) {
    const { agent, data } = world;
    const { race } = agent;
    upgradeAbilities = [];
    planService.plan = [];
    planService.bogIsActive = true;
    // create a uuid
    planService.uuid = uuidv4();
    planService.mineralMaxThreshold = race === Race.ZERG ? 300 : 400;
    planService.mineralMinThreshold = 100;
    setUnitTypeTrainingAbilityMapping(data);
    Array.from(Object.values(Upgrade)).forEach(upgrade => {
      upgradeAbilities[data.getUpgradeData(upgrade).abilityId.toString()] = upgrade;
    });
    foodUsedService.minimumAmountToAttackWith = Math.round(Math.random() * 200);
    console.log(`Minimum amount of food to attack with: ${foodUsedService.minimumAmountToAttackWith}`);
  },
  async onStep(world) {
    const { agent, data, resources } = world;
    const { map, units } = resources.get();
    const { mineralMaxThreshold, mineralMinThreshold } = planService;
    sharedService.removePendingOrders(units);
    // starting at 12 food, while at current food, 1/3 chance of action else build drone and increment food by 1
    await runPlan(world);
    const trueFoodUsed = getFoodUsed(world)
    // decide worker training when minerals greater then mineralMinThreshold and less then mineralMaxThreshold
    const decideWorkerTraining = agent.minerals > mineralMinThreshold && agent.minerals < mineralMaxThreshold;
    if (trueFoodUsed === planService.foodMark) {
      if (decideWorkerTraining) {
        if (shortOnWorkers(resources) && Math.random() > (1 / 3)) {
          await train(world, WorkerRace[agent.race]);
          planService.foodMark++
        }
        return;
      }
    } else if (trueFoodUsed < planService.foodMark) {
      if (decideWorkerTraining) {
        if (shortOnWorkers(resources) && Math.random() > (1 / 3)) {
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
      const allAvailableAbilities = new Map();
      units.getAlive(Alliance.SELF).forEach(unit => {
        // get all available abilities of non-structure units, idle structures or from reactors with only one order
        if (!unit.isStructure() || unit.isIdle() || unit.hasReactor() && unit.orders.length === 1) {
          const availableAbilities = unit.availableAbilities();
          availableAbilities.forEach(ability => {
            if (!allAvailableAbilities.has(ability)) {
              if (Object.keys(unitTypeAbilities).some(unitTypeAbility => parseInt(unitTypeAbility) === ability)) {
                // make sure unitTypeData for ability has unitAlias value of 0
                const unitTypeData = data.getUnitTypeData(unitTypeAbilities[ability]);
                if (unitTypeData.unitAlias === 0) {
                  allAvailableAbilities.set(ability, { orderType: 'UnitType', unitType: unitTypeAbilities[ability] });
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
      const randomAction = getRandom(Array.from(allAvailableAbilities.values()));
      if (randomAction) {
        const { orderType, unitType } = randomAction;
        if (orderType === 'UnitType') {
          const unitTypeCount = getUnitTypeCount(world, unitType) + (unitType === DRONE ? units.getStructures().length - 1 : 0);
          const conditions = [
            isGasExtractorWithoutFreeGasGeyser(map, unitType),
            diminishChanceToBuildStructure(data, unitType, unitTypeCount),
            WorkerRace[agent.race] === unitType && !shortOnWorkers(resources)
          ];
          if (conditions.some(condition => condition)) {
            return;
          }
          const isMatchingPlan = planService.plan.some(step => {
            return (
              step.unitType === unitType &&
              step.targetCount === unitTypeCount
            );
          });
          if (!isMatchingPlan) {
            planService.plan.push({
              orderType, unitType, food: agent.foodUsed, targetCount: getUnitTypeCount(world, unitType)
            });
            if (data.getUnitTypeData(unitType).attributes.includes(Attribute.STRUCTURE)) {
              await build(world, unitType);
            } else {
              await train(world, unitType);
            }
          }
        } else if (orderType === 'Upgrade') {
          planService.plan.push({
            orderType, upgrade: randomAction.upgrade, food: agent.foodUsed
          });
          await upgrade(world, randomAction.upgrade);
        }
      }
    } else {
      // skip step
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
 * @param {number} unitTypeCount 
 * @returns 
 */
function diminishChanceToBuildStructure(data, unitType, unitTypeCount) {
  const isStructure = data.getUnitTypeData(unitType).attributes.includes(Attribute.STRUCTURE);
  const divisorToDiminish = [...gasMineTypes, ...townhallTypes].includes(unitType) ? unitTypeCount : unitTypeCount * 2;
  return isStructure && (1 / (divisorToDiminish + 1)) < Math.random();
}
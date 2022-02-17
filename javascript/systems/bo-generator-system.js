//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Upgrade, UnitType } = require("@node-sc2/core/constants");
const { Attribute, Alliance } = require("@node-sc2/core/constants/enums");
const { DRONE } = require("@node-sc2/core/constants/unit-type");
const getRandom = require("@node-sc2/core/utils/get-random");
const planService = require("../services/plan-service");
const sharedService = require("../services/shared-service");
const { getUnitTypeCount } = require("../services/world-service");
const { build, train, upgrade, runPlan } = require("./execute-plan/plan-actions");

let unitTypeAbilities = [];
let upgradeAbilities = [];
module.exports = createSystem({
  defaultOptions: {
    stepIncrement: 64,
  },
  async onGameStart({ data }) {
    unitTypeAbilities = [];
    upgradeAbilities = [];
    planService.plan = [];
    Array.from(Object.values(UnitType)).forEach(unitTypeId => {
      unitTypeAbilities[data.getUnitTypeData(unitTypeId).abilityId.toString()] = unitTypeId;
    });
    Array.from(Object.values(Upgrade)).forEach(upgrade => {
      upgradeAbilities[data.getUpgradeData(upgrade).abilityId.toString()] = upgrade;
    });
  },
  async onStep(world) {
    const { agent, data, resources } = world;
    const { units } = resources.get();
    sharedService.removePendingOrders(units);
    await runPlan(world);
    if (getRandom([0, 1]) === 0) {
      if (planService.continueBuild) {
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
            const isMatchingPlan = planService.plan.some(step => {
              const unitTypeCount = getUnitTypeCount(world, unitType) + (unitType === DRONE ? units.getStructures().length - 1 : 0);
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
    } else {
      console.log('skip this step');
    }
    data.get('earmarks').forEach(earmark => data.settleEarmark(earmark.name));
  }
});
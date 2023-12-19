//@ts-check
"use strict"

const { Attribute } = require("@node-sc2/core/constants/enums");
const { buildSupplyOrTrain } = require("../training");
const { build } = require("../building-management");

/**
 * Execute the game plan
 * @param {World} world 
 */
async function runPlan(world) {
  const { agent, data } = world;
  const { minerals, vespene } = agent; if (minerals === undefined || vespene === undefined) return;
  if (planService.currentStep > -1) return;
  dataService.earmarks = [];
  planService.pausedThisRound = false;
  planService.pendingFood = 0;
  const { plan } = planService;
  for (let step = 0; step < plan.length; step++) {
    planService.currentStep = step;
    const setEarmark = dataService.earmarks.length === 0;
    const planStep = plan[step];
    await buildSupplyOrTrain(world, planStep);
    const { candidatePositions, orderType, unitType, targetCount, upgrade: upgradeType } = planStep;
    if (orderType === 'UnitType') {
      if (unitType === undefined || unitType === null) break;
      const { attributes } = data.getUnitTypeData(unitType); if (attributes === undefined) break;
      const isStructure = attributes.includes(Attribute.STRUCTURE);
      let { minerals } = agent; if (minerals === undefined) break;
      if (!isStructure) {
        await train(world, unitType, targetCount);
      } else if (isStructure) {
        await build(world, unitType, targetCount, candidatePositions);
      }
    } else if (orderType === 'Upgrade') {
      if (upgradeType === undefined || upgradeType === null) break;
      await upgrade(world, upgradeType);
    }
    setFoodUsed(world);
    if (setEarmark && dataService.hasEarmarks(data)) {
      const earmarkTotals = data.getEarmarkTotals('');
      const { minerals: mineralsEarmarked, vespene: vespeneEarmarked } = earmarkTotals;
      const mineralsNeeded = mineralsEarmarked - minerals > 0 ? mineralsEarmarked - minerals : 0;
      const vespeneNeeded = vespeneEarmarked - vespene > 0 ? vespeneEarmarked - vespene : 0;
      balanceResources(world, mineralsNeeded / vespeneNeeded);
    }
  }
  planService.currentStep = -1;
  if (!dataService.hasEarmarks(data)) balanceResources(world);
  if (!planService.pausedThisRound) {
    planService.pausePlan = false;
  }
}

module.exports = {
  runPlan
};

"use strict";

const { build, hasEarmarks } = require("../features/construction/buildingService");
const { balanceResources, setFoodUsed } = require("../gameLogic/economy/economyManagement");
const { earmarkResourcesIfNeeded } = require("../units/management/trainingUtils");

/**
 * Class representing the resource earmark management.
 */
class ResourceEarmarkManager {
  /**
   * Earmarks resources for a given plan step.
   * @param {World} world - The current game world context.
   * @param {import("../features/strategy/strategyManager").PlanStep} planStep - The current step in the plan to be executed.
   */
  static earmarkResourcesForPlanStep(world, planStep) {
    const { unitType } = planStep;
    if (unitType) {
      const unitTypeData = world.data.getUnitTypeData(unitType);
      earmarkResourcesIfNeeded(world, unitTypeData, true);
    }
  }

  /**
   * Balances earmarked resources for the world.
   * @param {World} world - The current game world context.
   */
  static balanceEarmarkedResources(world) {
    const { agent, data } = world;
    const { minerals = 0, vespene = 0 } = agent;
    const earmarkTotals = data.getEarmarkTotals('');
    const mineralsNeeded = Math.max(earmarkTotals.minerals - minerals, 0);
    const vespeneNeeded = Math.max(earmarkTotals.vespene - vespene, 0);
    return balanceResources(world, mineralsNeeded / vespeneNeeded, build);
  }

  /**
   * Handles earmarks and resources management.
   * @param {World} world - The current game world context.
   * @param {SC2APIProtocol.ActionRawUnitCommand[]} actionsToPerform - The array of actions to be performed.
   */
  static manageResourceEarmarks(world, actionsToPerform) {
    setFoodUsed(world);

    if (!hasEarmarks(world.data)) {
      actionsToPerform.push(...balanceResources(world, undefined, build));
    } else {
      actionsToPerform.push(...ResourceEarmarkManager.balanceEarmarkedResources(world));
    }
  }
}

module.exports = ResourceEarmarkManager;
// strategyService.js
"use strict";

// Import necessary modules and build orders
const { Upgrade } = require('@node-sc2/core/constants');
const { Attribute } = require('@node-sc2/core/constants/enums');

const { build } = require('./buildingService');
const { interpretBuildOrderAction } = require('./buildOrders/buildOrderUtils');
const { setFoodUsed, balanceResources } = require('./economyManagement');
const GameState = require('./gameState');
const { resetEarmarks } = require('./resourceData');
const { hasEarmarks } = require('./resourceManagement');
const StrategyManager = require('./strategyManager');
const { buildSupplyOrTrain, train, upgrade } = require('./unitManagement');

/**
 * @typedef {Object} PlanStep
 * @property {number} supply - The supply count at this step.
 * @property {string} time - The game time for this step.
 * @property {string} action - The action to be taken at this step.
 * @property {number} unitType - The unit type for this step.
 * @property {number} upgrade - The upgrade type for this step.
 * @property {number} count - The count of units or upgrades.
 * @property {boolean} isChronoBoosted - Whether the step is Chrono Boosted.
 * @property {number} food - The food value for this step.
 */

/**
 * Represents the strategy service responsible for managing the bot's strategy.
 */
class StrategyService {
  constructor() {  } 

  /**
   * Execute the game plan and return the actions to be performed.
   * @param {World} world 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions to be performed.
   */
  runPlan(world) {
    const { agent, data } = world;
    const { minerals, vespene } = agent;
    if (minerals === undefined || vespene === undefined) return [];

    const strategyManager = StrategyManager.getInstance();
    if (!strategyManager) {
      console.error('StrategyManager instance is undefined.');
      return [];
    }

    if (strategyManager.getCurrentStep() > -1) return [];

    resetEarmarks(); // Resetting the earmarks here
    const gameState = GameState.getInstance();
    gameState.pendingFood = 0;

    const plan = strategyManager.getCurrentStrategy();
    if (!plan || !Array.isArray(plan.steps)) {
      console.error('Invalid or undefined strategy plan');
      return [];
    }

    let actionsToPerform = [];
    let firstEarmarkSet = false;

    for (let step = 0; step < plan.steps.length; step++) {
      const rawStep = plan.steps[step];

      // Check if the conditions of the step are satisfied
      if (strategyManager.isStepSatisfied(world, rawStep)) continue;

      let interpretedAction = rawStep.interpretedAction;
      if (!interpretedAction) {
        // If interpretedAction doesn't exist, handle it according to your strategy logic
        interpretedAction = interpretBuildOrderAction(rawStep.action);
      }

      // Ensure interpretedAction is defined before proceeding
      if (!interpretedAction) {
        console.error("Interpreted action is undefined for step:", rawStep);
        continue;  // Skip to the next iteration
      }

      const planStep = {
        supply: parseInt(rawStep.supply, 10),
        time: rawStep.time,
        action: rawStep.action,
        orderType: interpretedAction.isUpgrade ? 'Upgrade' : 'UnitType',
        unitType: interpretedAction.unitType || 0,  // Using short-circuit evaluation
        targetCount: interpretedAction.count,
        upgrade: interpretedAction.isUpgrade ? (interpretedAction.unitType || 0) : Upgrade.NULL,
        isChronoBoosted: interpretedAction.isChronoBoosted,
        count: interpretedAction.count,
        candidatePositions: [],
        food: parseInt(rawStep.supply, 10)
      };

      strategyManager.setCurrentStep(step);

      // Collect actions from buildSupplyOrTrain
      actionsToPerform.push(...buildSupplyOrTrain(world, planStep));

      // Use destructured variables from planStep directly
      if (planStep.orderType === 'UnitType') {
        // Access 'unitType' from 'planStep' object
        if (planStep.unitType === undefined || planStep.unitType === null) break;
        const { attributes } = data.getUnitTypeData(planStep.unitType);
        if (attributes === undefined) break;

        const isStructure = attributes.includes(Attribute.STRUCTURE);
        let { minerals } = agent;
        if (minerals === undefined) break;

        if (!isStructure) {
          actionsToPerform.push(...train(world, planStep.unitType, planStep.targetCount));
        } else if (isStructure) {
          actionsToPerform.push(...build(world, planStep.unitType, planStep.targetCount, planStep.candidatePositions));
        }
      } else if (planStep.orderType === 'Upgrade') {
        // Ensure 'upgrade' property is used from 'planStep' object
        if (planStep.upgrade === undefined || planStep.upgrade === null) break;
        actionsToPerform.push(...upgrade(world, planStep.upgrade));
      }

      setFoodUsed(world);

      if (hasEarmarks(data) && !firstEarmarkSet) {
        firstEarmarkSet = true;
        const earmarkTotals = data.getEarmarkTotals('');
        const { minerals: mineralsEarmarked, vespene: vespeneEarmarked } = earmarkTotals;
        const mineralsNeeded = mineralsEarmarked - minerals > 0 ? mineralsEarmarked - minerals : 0;
        const vespeneNeeded = vespeneEarmarked - vespene > 0 ? vespeneEarmarked - vespene : 0;
        actionsToPerform.push(...balanceResources(world, mineralsNeeded / vespeneNeeded, build));
      }
    }

    strategyManager.setCurrentStep(-1);
    if (!hasEarmarks(data)) {
      const targetRatio = undefined;
      actionsToPerform.push(...balanceResources(world, targetRatio, build));
    }

    return actionsToPerform;
  }
}

// Export an instance of the strategy service
module.exports = new StrategyService();
// strategyService.js
"use strict";

// Import necessary modules and build orders
const { Upgrade } = require('@node-sc2/core/constants');
const { Attribute } = require('@node-sc2/core/constants/enums');

const StrategyManager = require('./strategyManager');
const GameState = require('../../core/gameState');
const { setFoodUsed, balanceResources } = require('../../utils/common/economyManagement');
const { train } = require('../../utils/common/trainingUtils');
const { performScoutingWithSCV } = require('../../utils/common/unitActions');
const { buildSupplyOrTrain, upgrade } = require('../../utils/common/unitManagement');
const { isBuildOrderStep } = require('../../utils/gameLogic/typeGuards');
const { resetEarmarks } = require('../../utils/resourceManagement/resourceData');
const { hasEarmarks } = require('../../utils/resourceManagement/resourceManagement');
const { interpretBuildOrderAction } = require('../buildOrders/buildOrderUtils');
const { build } = require('../construction/buildingService');

/**
 * @typedef {Object} PlanStep
 * @property {number} supply - The supply count for the step.
 * @property {string} time - The game time for the step.
 * @property {string} action - The action to be taken.
 * @property {string} orderType - The type of order, either 'Upgrade' or 'UnitType'.
 * @property {number} unitType - The unit type for the step.
 * @property {number} targetCount - The count of units or upgrades.
 * @property {number} upgrade - The upgrade type for the step.
 * @property {boolean} isChronoBoosted - Whether the step is Chrono Boosted.
 * @property {number} count - The count of units or upgrades.
 * @property {Point2D[]} candidatePositions - Candidate positions for the step.
 * @property {number} food - The food value for the step.
 */

/**
 * Represents the strategy service responsible for managing the bot's strategy.
 */
class StrategyService {
  /**
   * @private
   * @static
   * @type {StrategyService|null}
   */
  static instance = null;

  // Private constructor
  constructor() {
    if (StrategyService.instance) {
      return StrategyService.instance;
    }
    StrategyService.instance = this;
    // Initialize your service here
  }

  /**
   * @param {World} world
   */
  balanceEarmarkedResources(world) {
    const { agent, data } = world;
    const { minerals = 0, vespene = 0 } = agent;  // Default to 0 if undefined
    const earmarkTotals = data.getEarmarkTotals('');
    const mineralsNeeded = Math.max(earmarkTotals.minerals - minerals, 0);
    const vespeneNeeded = Math.max(earmarkTotals.vespene - vespene, 0);
    return balanceResources(world, mineralsNeeded / vespeneNeeded, build);
  }

  /**
   * @typedef {Object} RawStep
   * @property {number} supply - The supply count for the step.
   * @property {string} time - The game time for the step.
   * @property {string} action - The action to be taken.
   * // Add other properties of RawStep here as needed...
   */

  /**
   * Creates a plan step from the given raw step and interpreted action.
   * @param {import('../../utils/gameLogic/globalTypes').BuildOrderStep | StrategyManager.StrategyStep} rawStep - The raw step from the build order.
   * @param {{ specialAction?: string | null | undefined; isUpgrade?: any; unitType?: any; count?: any; isChronoBoosted?: any; }} interpretedAction - The interpreted action for the step.
   * @param {number} cumulativeCount - The cumulative count of the unitType up to this step in the plan.
   * @returns {PlanStep} The created plan step.
   */
  createPlanStep(rawStep, interpretedAction, cumulativeCount) {
    return {
      supply: parseInt(rawStep.supply, 10),
      time: rawStep.time,
      action: rawStep.action,
      orderType: interpretedAction.isUpgrade ? 'Upgrade' : 'UnitType',
      unitType: interpretedAction.unitType || 0,
      targetCount: cumulativeCount, // Directly use the cumulative count
      upgrade: interpretedAction.isUpgrade ? (interpretedAction.unitType || 0) : Upgrade.NULL,
      isChronoBoosted: interpretedAction.isChronoBoosted,
      count: interpretedAction.count,
      candidatePositions: [],
      food: parseInt(rawStep.supply, 10)
    };
  }

  /**
   * Executes the given strategy plan.
   * @param {World} world - The game world context.
   * @param {import("../../utils/gameLogic/globalTypes").BuildOrder | StrategyManager.Strategy | undefined} plan - The strategy plan to execute.
   * @param {StrategyManager} strategyManager - The strategy manager.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions to be performed.
   */
  executeStrategyPlan(world, plan, strategyManager) {
    if (!plan) {
      console.error("Strategy plan is undefined.");
      return [];
    }

    let actionsToPerform = [];
    let firstEarmarkSet = false;

    // Initialize cumulativeCounts with the starting unit counts based on the player's race
    const gameState = GameState.getInstance();
    /** @type {Object<string, number>} Keeps track of cumulative counts for each unit type */
    let cumulativeCounts = { ...gameState.startingUnitCounts };

    plan.steps.forEach((rawStep, step) => {
      const interpretedActions = this.getInterpretedActions(rawStep);
      if (!interpretedActions) return;

      interpretedActions.forEach((interpretedAction) => {
        let unitType = interpretedAction.unitType || 'default';

        if (strategyManager.isStepSatisfied(world, rawStep)) {
          // Update cumulativeCounts even if the step is satisfied to ensure accuracy
          cumulativeCounts[unitType] = (cumulativeCounts[unitType] || 0) + (interpretedAction.count || 0);
          return;
        }

        interpretedAction.specialAction = interpretedAction.specialAction || undefined;

        // Get the current cumulative count for creating the plan step
        const currentCumulativeCount = cumulativeCounts[unitType] || 0;
        const planStep = this.createPlanStep(rawStep, interpretedAction, currentCumulativeCount);

        // Now increment the cumulativeCounts after using it for the current step
        cumulativeCounts[unitType] = currentCumulativeCount + (interpretedAction.count || 0);

        if (interpretedAction.specialAction) {
          actionsToPerform.push(...this.handleSpecialAction(interpretedAction.specialAction, world));
          return;
        }

        strategyManager.setCurrentStep(step);
        actionsToPerform.push(...this.performPlanStepActions(world, planStep));

        setFoodUsed(world);
        if (!firstEarmarkSet && hasEarmarks(world.data)) {
          firstEarmarkSet = true;
          actionsToPerform.push(...this.balanceEarmarkedResources(world));
        }
      });
    });

    strategyManager.setCurrentStep(-1);
    if (!hasEarmarks(world.data)) {
      actionsToPerform.push(...balanceResources(world, undefined, build));
    }

    return actionsToPerform;
  }

  /**
   * Static method to get the singleton instance
   */
  static getInstance() {
    if (StrategyService.instance === null) {
      StrategyService.instance = new StrategyService();
    }
    return StrategyService.instance;
  }

  /**
   * @param {import("../../utils/gameLogic/globalTypes").BuildOrderStep | StrategyManager.StrategyStep} rawStep
   */
  getInterpretedActions(rawStep) {
    if (rawStep.interpretedAction) {
      return Array.isArray(rawStep.interpretedAction) ? rawStep.interpretedAction : [rawStep.interpretedAction];
    } else {
      const comment = isBuildOrderStep(rawStep) ? rawStep.comment || '' : '';
      return interpretBuildOrderAction(rawStep.action, comment);
    }
  }

  /**
   * Handles special actions identified in build order steps.
   * @param {string} specialAction - The special action to handle.
   * @param {World} world - The current world state.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions to be performed for the special action.
   */
  handleSpecialAction(specialAction, world) {
    /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
    let actions = []; // Explicitly typed as an array of SC2APIProtocol.ActionRawUnitCommand

    switch (specialAction) {
      case 'Scouting with SCV':
        // Implement the logic for the specific special action
        actions = performScoutingWithSCV(world);
        break;
      // Add more cases for other special actions

      default:
        console.warn(`Unhandled special action: ${specialAction}`);
    }

    return actions;
  }

  /**
   * @param {World} world
   * @param {{ supply?: number | undefined; time?: string | undefined; action?: string | undefined; orderType?: any; unitType: any; targetCount: any; upgrade?: any; isChronoBoosted?: any; count?: any; candidatePositions: any; food?: number | undefined; }} planStep
   */
  handleUnitTypeAction(world, planStep) {
    const { data } = world;
    if (planStep.unitType === undefined || planStep.unitType === null) return [];
    const { attributes } = data.getUnitTypeData(planStep.unitType);
    if (attributes === undefined) return [];

    const isStructure = attributes.includes(Attribute.STRUCTURE);
    return isStructure ? build(world, planStep.unitType, planStep.targetCount, planStep.candidatePositions) : train(world, planStep.unitType, planStep.targetCount);
  }

  /**
   * @param {World} world
   * @param {PlanStep} planStep
   */
  handleUpgradeAction(world, planStep) {
    if (planStep.upgrade === undefined || planStep.upgrade === null) return [];
    return upgrade(world, planStep.upgrade);
  }

  /**
  * Checks if there's an active strategy plan.
  * @returns {boolean} True if there's an active plan, false otherwise.
  */
  isActivePlan() {
    const strategyManager = StrategyManager.getInstance();
    const plan = strategyManager.getCurrentStrategy();
    // Coerce the result to a boolean to ensure the return type is strictly boolean
    return !!plan && !strategyManager.isPlanCompleted();
  } 

  /**
   * @param {import("../../utils/gameLogic/globalTypes").BuildOrder | StrategyManager.Strategy | undefined} plan
   */
  isValidPlan(plan) {
    return plan && Array.isArray(plan.steps);
  }

  /**
   * Perform the necessary actions for the current plan step based on the available resources.
   * @param {World} world - The current game world context.
   * @param {PlanStep} planStep - The current step in the plan to be executed.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} A list of actions to be performed.
   */
  performPlanStepActions(world, planStep) {
    const { agent } = world;
    let actions = [];

    // Build supply or train workers if necessary and can be afforded
    actions.push(...buildSupplyOrTrain(world, planStep));

    // Check if resources are sufficient for the current plan step
    if (!agent.canAfford(planStep.unitType)) {
      return actions; // Exit early if we cannot afford the action
    }

    // Execute actions based on the order type
    switch (planStep.orderType) {
      case 'UnitType':
        actions.push(...this.handleUnitTypeAction(world, planStep));
        break;
      case 'Upgrade':
        actions.push(...this.handleUpgradeAction(world, planStep));
        break;
      // Add cases for other order types as needed
      default:
        // Optionally handle unknown order types or log a warning
        break;
    }

    return actions;
  }

  /**
   * Execute the game plan and return the actions to be performed.
   * @param {World} world 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions to be performed.
   */
  runPlan(world) {
    const { agent, data } = world;
    if (!this.validateResources(agent)) return [];

    const strategyManager = StrategyManager.getInstance();
    if (!strategyManager) {
      console.error('StrategyManager instance is undefined.');
      return [];
    }

    resetEarmarks(data);
    GameState.getInstance().pendingFood = 0;

    const plan = strategyManager.getCurrentStrategy();
    if (!this.isValidPlan(plan)) return [];

    return this.executeStrategyPlan(world, plan, strategyManager);
  }

  /**
   * @param {Agent} agent
   */
  validateResources(agent) {
    const { minerals, vespene } = agent;
    return !(minerals === undefined || vespene === undefined);
  }

}

// Export the StrategyService class
module.exports = StrategyService;
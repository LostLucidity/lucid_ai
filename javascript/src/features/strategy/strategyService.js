// strategyService.js
"use strict";

// Import necessary modules and build orders
const { Upgrade } = require('@node-sc2/core/constants');
const { Attribute } = require('@node-sc2/core/constants/enums');

const StrategyManager = require('./strategyManager');
const GameState = require('../../core/gameState');
const { isBuildOrderStep } = require('../../gameLogic/typeGuards');
const { setFoodUsed, balanceResources } = require('../../utils/economyManagement');
const { resetEarmarks } = require('../../utils/resourceData');
const { hasEarmarks } = require('../../utils/resourceManagement');
const { train } = require('../../utils/trainingUtils');
const { performScoutingWithSCV } = require('../../utils/unitActions');
const { buildSupplyOrTrain, upgrade } = require('../../utils/unitManagement');
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
   * @type {Object<string, number>}
   */
  cumulativeCounts = {};

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
   * @param {import('../../utils/globalTypes').BuildOrderStep | StrategyManager.StrategyStep} rawStep - The raw step from the build order.
   * @param {import('../../utils/globalTypes').InterpretedAction} interpretedAction - The interpreted action for the step.
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
      targetCount: cumulativeCount,
      upgrade: interpretedAction.isUpgrade ? (interpretedAction.unitType || Upgrade.NULL) : Upgrade.NULL,
      isChronoBoosted: !!interpretedAction.isChronoBoosted,
      count: interpretedAction.count || 0,
      candidatePositions: [],
      food: parseInt(rawStep.supply, 10)
    };
  }

  /**
   * Executes the given strategy plan.
   * @param {World} world - The game world context.
   * @param {import("../../utils/globalTypes").BuildOrder | StrategyManager.Strategy | undefined} plan - The strategy plan to execute.
   * @param {StrategyManager} strategyManager - The strategy manager.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions to be performed.
   */
  executeStrategyPlan(world, plan, strategyManager) {
    if (!plan) {
      console.error("Strategy plan is undefined.");
      return [];
    }

    /**
     * @type {SC2APIProtocol.ActionRawUnitCommand[]}
     */
    const actionsToPerform = [];
    this.firstEarmarkSet = false;
    const gameState = GameState.getInstance();
    this.cumulativeCounts = { ...gameState.startingUnitCounts };

    for (const [step, rawStep] of plan.steps.entries()) {
      this.processStep(world, rawStep, step, strategyManager, actionsToPerform);
    }

    this.finalizeStrategyExecution(strategyManager, actionsToPerform, world);
    return actionsToPerform;
  }

  /**
   * Finalizes the execution of the strategy plan, handling any end-of-plan logic.
   * @param {StrategyManager} strategyManager
   * @param {SC2APIProtocol.ActionRawUnitCommand[]} actionsToPerform
   * @param {World} world
   */
  finalizeStrategyExecution(strategyManager, actionsToPerform, world) {
    strategyManager.setCurrentStep(-1);
    if (!hasEarmarks(world.data)) {
      actionsToPerform.push(...balanceResources(world, undefined, build));
    }
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
   * @param {import("../../utils/globalTypes").BuildOrderStep | StrategyManager.StrategyStep} rawStep
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
   * @param {import("../../utils/globalTypes").BuildOrder | StrategyManager.Strategy | undefined} plan
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
    // Build supply or train workers if necessary and can be afforded
    let actions = buildSupplyOrTrain(world, planStep);

    // Execute actions based on the order type
    switch (planStep.orderType) {
      case 'UnitType':
        actions = actions.concat(this.handleUnitTypeAction(world, planStep));
        break;
      case 'Upgrade':
        actions = actions.concat(this.handleUpgradeAction(world, planStep));
        break;
      // Add cases for other order types as needed
      default:
        // Optionally handle unknown order types or log a warning
        break;
    }

    return actions;
  }

  /**
   * Processes each step of the strategy plan.
   * @param {World} world
   * @param {import("../../utils/globalTypes").BuildOrderStep | StrategyManager.StrategyStep} rawStep
   * @param {number} step
   * @param {StrategyManager} strategyManager
   * @param {SC2APIProtocol.ActionRawUnitCommand[]} actionsToPerform
   */
  processStep(world, rawStep, step, strategyManager, actionsToPerform) {
    const interpretedActions = this.getInterpretedActions(rawStep);
    if (!interpretedActions) return;

    for (const interpretedAction of interpretedActions) {
      this.processInterpretedAction(world, rawStep, step, interpretedAction, strategyManager, actionsToPerform);
    }
  }

  /**
   * Processes an interpreted action from the current strategy step.
   * @param {World} world
   * @param {import("../../utils/globalTypes").BuildOrderStep | StrategyManager.StrategyStep} rawStep
   * @param {number} step
   * @param {import('../../utils/globalTypes').InterpretedAction} interpretedAction
   * @param {StrategyManager} strategyManager
   * @param {SC2APIProtocol.ActionRawUnitCommand[]} actionsToPerform
   */
  processInterpretedAction(world, rawStep, step, interpretedAction, strategyManager, actionsToPerform) {
    const unitType = interpretedAction.unitType?.toString() || 'default';

    // Now `this.cumulativeCounts` is correctly typed, and `unitType` is ensured to be a string
    const currentCumulativeCount = this.cumulativeCounts[unitType] || 0;

    if (strategyManager.isStepSatisfied(world, rawStep)) {
      this.cumulativeCounts[unitType] = currentCumulativeCount + (interpretedAction.count || 0);
      return;
    }

    const planStep = this.createPlanStep(rawStep, interpretedAction, currentCumulativeCount);
    this.cumulativeCounts[unitType] = currentCumulativeCount + (interpretedAction.count || 0);

    if (interpretedAction.specialAction) {
      actionsToPerform.push(...this.handleSpecialAction(interpretedAction.specialAction, world));
      return;
    }

    strategyManager.setCurrentStep(step);
    actionsToPerform.push(...this.performPlanStepActions(world, planStep));

    setFoodUsed(world);

    if (!this.firstEarmarkSet && hasEarmarks(world.data)) {
      this.firstEarmarkSet = true;
      actionsToPerform.push(...this.balanceEarmarkedResources(world));
    }
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
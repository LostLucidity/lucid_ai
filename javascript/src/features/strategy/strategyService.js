// strategyService.js
"use strict";

// Import necessary modules and build orders
const { Upgrade } = require('@node-sc2/core/constants');

// eslint-disable-next-line no-unused-vars
const ActionStrategy = require('./actionStrategy');
const StrategyManager = require('./strategyManager');
const UnitActionStrategy = require('./unitActionStrategy');
const { UpgradeActionStrategy } = require('./upgradeActionStrategy');
const GameState = require('../../core/gameState');
const { isBuildOrderStep } = require('../../gameLogic/typeGuards');
const { setFoodUsed, balanceResources } = require('../../utils/economy/economyManagement');
const { performScoutingWithSCV } = require('../../utils/training/training');
const { buildSupplyOrTrain } = require('../../utils/unit/unitManagement');
const { interpretBuildOrderAction } = require('../buildOrders/buildOrderUtils');
const { build } = require('../construction/buildingService');
const { hasEarmarks, resetEarmarks } = require('../construction/resourceManagement');

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
 * @property {Map} loggedDelays - Stores delays for actions based on certain conditions.
 * @property {UnitActionStrategy} actionStrategy - Handles actions related to unit management.
 * @property {UpgradeActionStrategy} upgradeStrategy - Handles actions related to upgrades.
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

  /**
   * Private constructor to enforce singleton pattern.
   */
  constructor() {
    if (!StrategyService.instance) {
      this.loggedDelays = new Map();
      /** @type {UnitActionStrategy} */
      this.actionStrategy = new UnitActionStrategy(); // default unit action strategy
      /** @type {UpgradeActionStrategy} */
      this.upgradeStrategy = new UpgradeActionStrategy(); // default upgrade action strategy
      StrategyService.instance = this;
    } else {
      // Ensure all properties are initialized
      if (!StrategyService.instance.loggedDelays) {
        StrategyService.instance.loggedDelays = new Map();
      }
      if (!StrategyService.instance.actionStrategy) {
        StrategyService.instance.actionStrategy = new UnitActionStrategy();
      }
      if (!StrategyService.instance.upgradeStrategy) {
        StrategyService.instance.upgradeStrategy = new UpgradeActionStrategy();
      }
    }
    return StrategyService.instance;
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
   * Converts a time string formatted as 'm:ss' to the total number of seconds.
   * @param {string} timeString - The time string to convert.
   * @returns {number} The total seconds.
   */
  convertTimeStringToSeconds(timeString) {
    const [minutes, seconds] = timeString.split(':').map(Number);
    return minutes * 60 + seconds;
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
   * @param {import('../../utils/core/globalTypes').BuildOrderStep | StrategyManager.StrategyStep} rawStep - The raw step from the build order.
   * @param {import('../../utils/core/globalTypes').InterpretedAction} interpretedAction - The interpreted action for the step.
   * @param {number} cumulativeCount - The cumulative count of the unitType up to this step in the plan.
   * @returns {PlanStep} The created plan step.
   */
  createPlanStep(rawStep, interpretedAction, cumulativeCount) {
    const { supply, time, action } = rawStep;
    const { isUpgrade, unitType, count } = interpretedAction;

    return {
      supply: parseInt(supply, 10),
      time,
      action,
      orderType: isUpgrade ? 'Upgrade' : 'UnitType',
      unitType: unitType || 0,
      targetCount: cumulativeCount + (count || 0),
      upgrade: isUpgrade ? (unitType || Upgrade.NULL) : Upgrade.NULL,
      isChronoBoosted: Boolean(interpretedAction.isChronoBoosted),
      count: count || 0,
      candidatePositions: [],
      food: parseInt(supply, 10)
    };
  }

  /**
   * Executes the specified special action.
   * @param {string} specialAction - The action to execute.
   * @param {World} world - The current world state.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions to be performed.
   */
  executeSpecialAction(specialAction, world) {
    switch (specialAction) {
      case 'Scouting with SCV':
        return performScoutingWithSCV(world);
      default:
        console.warn(`Unhandled special action: ${specialAction}`);
        return [];
    }
  }  

  /**
   * Executes the given strategy plan.
   * @param {World} world - The game world context.
   * @param {import("../../utils/core/globalTypes").BuildOrder | StrategyManager.Strategy | undefined} plan - The strategy plan to execute.
   * @param {StrategyManager} strategyManager - The strategy manager.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions to be performed.
   */
  executeStrategyPlan(world, plan, strategyManager) {
    if (!plan) {
      console.error("Strategy plan is undefined.");
      return [];
    }

    const actionsToPerform = this.initializeExecution();
    this.processPlanSteps(world, plan, strategyManager, actionsToPerform);
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
   * Gets the cumulative count for a given unit type.
   * @param {string} unitType The unit type identifier.
   * @returns {number} The cumulative count for the unit type.
   */
  getCumulativeCount(unitType) {
    return this.cumulativeCounts[unitType] || 0;
  }  

  /**
   * @param {import("../../utils/core/globalTypes").BuildOrderStep | StrategyManager.StrategyStep} rawStep
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
   * Handles resource earmarks if they have not been set and are necessary.
   * @param {World} world The game world context.
   * @param {SC2APIProtocol.ActionRawUnitCommand[]} actionsToPerform The array of actions to be performed.
   */
  handleEarmarksIfNeeded(world, actionsToPerform) {
    setFoodUsed(world);

    if (!this.firstEarmarkSet && hasEarmarks(world.data)) {
      this.firstEarmarkSet = true;
      actionsToPerform.push(...this.balanceEarmarkedResources(world));
    }
  }  

  /**
   * Processes the plan step, handling special actions and regular actions.
   * @param {World} world The game world context.
   * @param {import('../../utils/core/globalTypes').BuildOrderStep | import('./strategyManager').StrategyStep} rawStep The raw step data from the build order or strategy.
   * @param {number} step The current step number in the strategy.
   * @param {import('../../utils/core/globalTypes').InterpretedAction} interpretedAction The interpreted action for the current step.
   * @param {StrategyManager} strategyManager The strategy manager instance.
   * @param {SC2APIProtocol.ActionRawUnitCommand[]} actionsToPerform The array of actions to be performed.
   * @param {number} currentCumulativeCount The current cumulative count of the unit type up to this step.
   */
  handlePlanStep(world, rawStep, step, interpretedAction, strategyManager, actionsToPerform, currentCumulativeCount) {
    const effectiveUnitType = interpretedAction.unitType?.toString() || 'default';
    const planStep = this.createPlanStep(rawStep, interpretedAction, currentCumulativeCount);
    this.cumulativeCounts[effectiveUnitType] = currentCumulativeCount + (interpretedAction.count || 0);

    if (interpretedAction.specialAction) {
      actionsToPerform.push(...this.handleSpecialAction(interpretedAction.specialAction, world, rawStep));
      return;
    }

    this.processRegularAction(world, planStep, step, strategyManager, actionsToPerform);
  }

  /**
   * Handles special actions identified in build order steps.
   * @param {string} specialAction - The special action to handle.
   * @param {World} world - The current world state.
   * @param {import('../../utils/core/globalTypes').BuildOrderStep | StrategyManager.StrategyStep} rawStep - The raw step data containing timing and other contextual information.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions to be performed for the special action.
   */
  handleSpecialAction(specialAction, world, rawStep) {
    if (this.shouldDelayAction(specialAction, world, rawStep)) {
      return [];  // Return an empty array to indicate no action performed at this time
    }
    return this.executeSpecialAction(specialAction, world);
  }

  /**
   * Handles the completion of a strategy step, updating cumulative counts if necessary.
   * @param {World} world The game world context.
   * @param {import('../../utils/core/globalTypes').BuildOrderStep | import('./strategyManager').StrategyStep} rawStep The raw step data from the build order or strategy.
   * @param {string} unitType The unit type identifier.
   * @param {number} currentCumulativeCount The current cumulative count for the unit type.
   * @param {import('../../utils/core/globalTypes').InterpretedAction} interpretedAction The interpreted action for the current step.
   * @param {StrategyManager} strategyManager The strategy manager instance.
   * @returns {boolean} True if the step is completed, false otherwise.
   */
  handleStepCompletion(world, rawStep, unitType, currentCumulativeCount, interpretedAction, strategyManager) {
    if (strategyManager.isStepSatisfied(world, rawStep)) {
      this.cumulativeCounts[unitType] = currentCumulativeCount + (interpretedAction.count || 0);
      return true;
    }
    return false;
  } 

  /**
   * Initializes the execution of the strategy plan.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions to be performed.
   */
  initializeExecution() {
    this.firstEarmarkSet = false;
    const gameState = GameState.getInstance();
    this.cumulativeCounts = { ...gameState.startingUnitCounts };
    return [];
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
   * @param {import("../../utils/core/globalTypes").BuildOrder | StrategyManager.Strategy | undefined} plan
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
    let actions = buildSupplyOrTrain(world, planStep);

    switch (planStep.orderType) {
      case 'UnitType':
        actions = actions.concat(this.actionStrategy.handleUnitTypeAction(world, planStep));
        break;
      case 'Upgrade':
        // Using non-null assertion operator in TypeScript, or ensure your JSDoc/environment knows it's always initialized
        actions = actions.concat(this.upgradeStrategy.handleUpgradeAction(world, planStep));
        break;
      default:
        break;
    }

    return actions;
  }

  /**
   * Processes all steps in the strategy plan.
   * @param {World} world - The game world context.
   * @param {import("../../utils/core/globalTypes").BuildOrder | StrategyManager.Strategy} plan - The strategy plan to execute.
   * @param {StrategyManager} strategyManager - The strategy manager.
   * @param {SC2APIProtocol.ActionRawUnitCommand[]} actionsToPerform - The array of actions to be performed.
   */
  processPlanSteps(world, plan, strategyManager, actionsToPerform) {
    for (const [step, rawStep] of plan.steps.entries()) {
      this.processStep(world, rawStep, step, strategyManager, actionsToPerform);
    }
  }

  /**
   * Processes regular actions for a plan step and handles earmarks if needed.
   * @param {World} world The game world context.
   * @param {PlanStep} planStep The current plan step.
   * @param {number} step The current step number in the strategy.
   * @param {StrategyManager} strategyManager The strategy manager instance.
   * @param {SC2APIProtocol.ActionRawUnitCommand[]} actionsToPerform The array of actions to be performed.
   */
  processRegularAction(world, planStep, step, strategyManager, actionsToPerform) {
    strategyManager.setCurrentStep(step);
    actionsToPerform.push(...this.performPlanStepActions(world, planStep));
    this.handleEarmarksIfNeeded(world, actionsToPerform);
  }  
  
  /**
   * Processes each step of the strategy plan.
   * @param {World} world
   * @param {import("../../utils/core/globalTypes").BuildOrderStep | StrategyManager.StrategyStep} rawStep
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
   * @param {import("../../utils/core/globalTypes").BuildOrderStep | StrategyManager.StrategyStep} rawStep
   * @param {number} step
   * @param {import('../../utils/core/globalTypes').InterpretedAction} interpretedAction
   * @param {StrategyManager} strategyManager
   * @param {SC2APIProtocol.ActionRawUnitCommand[]} actionsToPerform
   */
  processInterpretedAction(world, rawStep, step, interpretedAction, strategyManager, actionsToPerform) {
    const unitType = interpretedAction.unitType?.toString() || 'default';
    const currentCumulativeCount = this.getCumulativeCount(unitType);

    if (this.handleStepCompletion(world, rawStep, unitType, currentCumulativeCount, interpretedAction, strategyManager)) {
      return;
    }

    this.handlePlanStep(world, rawStep, step, interpretedAction, strategyManager, actionsToPerform, currentCumulativeCount);
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
   * Sets a new action strategy.
   * @param {UnitActionStrategy} strategy - The new strategy to use for unit actions.
   */
  setActionStrategy(strategy) {
    /** @type {UnitActionStrategy} */
    this.actionStrategy = strategy;
  }

  /**
   * Checks if an action should be delayed based on the current time and target time.
   * @param {string} specialAction - The special action to check.
   * @param {World} world - The world context.
   * @param {import('../../utils/core/globalTypes').BuildOrderStep | StrategyManager.StrategyStep} rawStep - The step data.
   * @returns {boolean} True if the action should be delayed, false otherwise.
   */
  shouldDelayAction(specialAction, world, rawStep) {
    const targetTime = this.convertTimeStringToSeconds(rawStep.time);
    const currentTime = world.resources.get().frame.timeInSeconds();
    const delayKey = `${specialAction}-${rawStep.time}`;

    if (currentTime < targetTime) {
      if (this.loggedDelays && !this.loggedDelays.has(delayKey)) {
        console.log(`Delaying action: ${specialAction} until ${rawStep.time}`);
        this.loggedDelays.set(delayKey, true);
      }
      return true;
    }

    // Reset the log flag once the action is executed
    if (this.loggedDelays) {
      this.loggedDelays.delete(delayKey);
    }
    return false;
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
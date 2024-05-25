// strategyManager.js
"use strict";

const { Upgrade } = require("@node-sc2/core/constants");
const { Race } = require("@node-sc2/core/constants/enums");

// Import build orders for each race
const { executeSpecialAction } = require("./actions/SpecialActions");
const StrategyData = require("./data/strategyData");
const StrategyContext = require("./strategyContext");
const { isEqualStep } = require("./strategyUtils");
const UnitActionStrategy = require("./unitActionStrategy");
const { UpgradeActionStrategy } = require("./upgradeActionStrategy");
const { convertTimeStringToSeconds } = require("./utils/timeUtils");
const config = require("../../../config/config");
const { balanceResources, setFoodUsed } = require("../../gameLogic/utils/economy/economyManagement");
const { GameState } = require('../../gameState');
const { buildSupplyOrTrain } = require("../../units/management/unitManagement");
const buildOrders = require('../buildOrders');
const { interpretBuildOrderAction } = require("../buildOrders/buildOrderUtils");
const { build, hasEarmarks, resetEarmarks } = require("../construction/buildingService");

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
 * @typedef {Object} StrategyStep
 * @property {string} supply
 * @property {string} time
 * @property {string} action
 * @property {import("../../core/utils/globalTypes").InterpretedAction} [interpretedAction] - Optional property for interpreted action details
 */

/**
 * @typedef {Object} Strategy
 * @property {string} name - The name of the strategy.
 * @property {string} race - The race for which the strategy is designed.
 * @property {string} description - A description of the strategy.
 * @property {StrategyStep[]} steps - The steps involved in the strategy.
 */

/**
 * Class representing the strategy manager.
 * @property {Map} loggedDelays - Stores delays for actions based on certain conditions.
 * @property {UnitActionStrategy} actionStrategy - Handles actions related to unit management.
 * @property {UpgradeActionStrategy} upgradeStrategy - Handles actions related to upgrades.
 */
class StrategyManager {
  /**
   * Handles actions related to unit management.
   * @type {UnitActionStrategy}
   */
  actionStrategy = new UnitActionStrategy();

  /**
   * Stores cumulative counts of units or upgrades.
   * @private
   * @type {Object<string, number>}
   */
  cumulativeCounts = {};

  /**
   * Singleton instance of the StrategyManager.
   * @type {StrategyManager | null}
   * @private
   */
  static instance = null;

  /**
   * The race type, optional for setting up race-specific strategies.
   * @type {SC2APIProtocol.Race | undefined}
   */
  race;

  /**
   * Handles actions related to upgrades.
   * @type {UpgradeActionStrategy}
   */
  upgradeStrategy = new UpgradeActionStrategy(); 

  /**
   * Constructor for StrategyManager.
   * Access the instance through StrategyManager.getInstance().
   * @param {SC2APIProtocol.Race | undefined} race - The race type, optional.
   * @param {string | undefined} specificBuildOrderKey - Optional specific build order key for debugging.
   */
  constructor(race, specificBuildOrderKey) {
    // Always initialize strategyData, regardless of singleton instance state
    this.strategyData = new StrategyData();

    if (!StrategyManager.instance) {
      this.strategyContext = StrategyContext.getInstance();
      this.race = race;
      this.specificBuildOrderKey = specificBuildOrderKey;
      this.loggedDelays = new Map();
      this.actionStrategy = new UnitActionStrategy();
      this.upgradeStrategy = new UpgradeActionStrategy();

      if (race) {
        this.assignRaceAndInitializeStrategy(race);
      }

      this.initializeProperties();

      // Set the instance to this newly created instance
      StrategyManager.instance = this;
    } else {
      // Ensure strategyData is available even when returning an existing instance
      StrategyManager.instance.strategyData = this.strategyData;
    }

    return StrategyManager.instance;
  }

  /**
   * Assigns a race to the strategy manager and initializes the strategy.
   * @param {SC2APIProtocol.Race | undefined} race - The race to assign.
   */
  assignRaceAndInitializeStrategy(race) {
    this.race = race;
    this.initializeStrategy(race);
  }

  /**
   * @param {World} world
   */
  static balanceEarmarkedResources(world) {
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
   * @param {import('../../core/utils/globalTypes').BuildOrderStep | StrategyStep} rawStep - The raw step from the build order.
   * @param {import('../../core/utils/globalTypes').InterpretedAction} interpretedAction - The interpreted action for the step.
   * @param {number} cumulativeCount - The cumulative count of the unitType up to this step in the plan.
   * @returns {PlanStep} The created plan step.
   */
  static createPlanStep(rawStep, interpretedAction, cumulativeCount) {
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
   * Executes the given strategy plan.
   * @param {World} world - The game world context.
   * @param {import("../../core/utils/globalTypes").BuildOrder | Strategy | undefined} plan - The strategy plan to execute.
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
    this.finalizeStrategyExecution(actionsToPerform, world);

    return actionsToPerform;
  }

  /**
   * Finalizes the execution of the strategy plan, handling any end-of-plan logic.
   * @param {SC2APIProtocol.ActionRawUnitCommand[]} actionsToPerform
   * @param {World} world
   */
  finalizeStrategyExecution(actionsToPerform, world) {
    this.resetCurrentStep();
    StrategyManager.handleEarmarksAndResources(actionsToPerform, world);
  }

  /**
   * Get the current strategy's build order.
   * @returns {import('../../core/utils/globalTypes').BuildOrder}
   */
  getBuildOrderForCurrentStrategy() {
    if (!this.strategyContext) {
      throw new Error('Strategy context is undefined, which is required to get the current build order.');
    }

    const currentStrategy = this.strategyContext.getCurrentStrategy();
    if (!currentStrategy) {
      throw new Error('No current strategy found in the strategy context.');
    }

    if (StrategyManager.isBuildOrder(currentStrategy)) {
      return currentStrategy;
    }

    throw new Error('The current strategy does not conform to the expected build order structure.');
  }

  /**
   * Retrieves the build order key from the current strategy.
   * @returns {string} - The determined build order key.
   */
  static getBuildOrderKey() {
    const strategyContext = StrategyContext.getInstance();
    const currentStrategy = strategyContext.getCurrentStrategy();

    if (currentStrategy) {
      // Use 'title' or 'name' as a key, depending on the type of the strategy
      if ('title' in currentStrategy) {
        return currentStrategy.title;  // Assuming 'title' can serve as a unique key for BuildOrder
      } else if ('name' in currentStrategy) {
        return currentStrategy.name;  // Assuming 'name' can serve as a unique key for Strategy
      }
    }

    // Fallback if no strategy is set or if the strategy lacks the necessary properties
    return 'defaultKey';
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
   * Gets the singleton instance of StrategyManager, creating or updating it if necessary.
   * This method ensures the instance is never null when returned and handles updates to race or build order key.
   * @param {SC2APIProtocol.Race | undefined} race - The race for the strategy manager.
   * @param {string | undefined} specificBuildOrderKey - Optional specific build order key for debugging.
   * @returns {StrategyManager}
   */
  static getInstance(race = undefined, specificBuildOrderKey = undefined) {
    // Create a new instance if one does not exist
    if (!this.instance) {
      this.instance = new StrategyManager(race, specificBuildOrderKey);
    } else {
      // Update the instance's race and build order key if they are provided and different from the current
      if (race !== undefined && this.instance.race !== race) {
        this.instance.race = race;
        // Optionally re-initialize or update race-related configurations
        this.instance.assignRaceAndInitializeStrategy(race);
      }
      if (specificBuildOrderKey !== undefined && this.instance.specificBuildOrderKey !== specificBuildOrderKey) {
        this.instance.specificBuildOrderKey = specificBuildOrderKey;
        // Optionally re-initialize or update configurations related to the build order key
      }
    }

    return this.instance;
  }

  /**
   * Handles earmarks and balances resources if necessary.
   * @param {SC2APIProtocol.ActionRawUnitCommand[]} actionsToPerform
   * @param {World} world
   */
  static handleEarmarksAndResources(actionsToPerform, world) {
    try {
      if (!hasEarmarks(world.data)) {
        actionsToPerform.push(...balanceResources(world, undefined, build));
      }
    } catch (error) {
      console.error("Error handling earmarks and resources:", error);
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
      actionsToPerform.push(...StrategyManager.balanceEarmarkedResources(world));
    }
  }

  /**
   * Processes the plan step, handling special actions and regular actions.
   * @param {World} world The game world context.
   * @param {import('../../core/utils/globalTypes').BuildOrderStep | import('./strategyManager').StrategyStep} rawStep The raw step data from the build order or strategy.
   * @param {number} step The current step number in the strategy.
   * @param {import('../../core/utils/globalTypes').InterpretedAction} interpretedAction The interpreted action for the current step.
   * @param {StrategyManager} strategyManager The strategy manager instance.
   * @param {SC2APIProtocol.ActionRawUnitCommand[]} actionsToPerform The array of actions to be performed.
   * @param {number} currentCumulativeCount The current cumulative count of the unit type up to this step.
   */
  handlePlanStep(world, rawStep, step, interpretedAction, strategyManager, actionsToPerform, currentCumulativeCount) {
    const effectiveUnitType = interpretedAction.unitType?.toString() || 'default';
    const planStep = StrategyManager.createPlanStep(rawStep, interpretedAction, currentCumulativeCount);
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
   * @param {import('../../core/utils/globalTypes').BuildOrderStep | StrategyManager.StrategyStep} rawStep - The raw step data containing timing and other contextual information.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions to be performed for the special action.
   */
  handleSpecialAction(specialAction, world, rawStep) {
    if (this.shouldDelayAction(specialAction, world, rawStep)) {
      return [];  // Return an empty array to indicate no action performed at this time
    }
    return executeSpecialAction(specialAction, world);
  }

  /**
   * Handles the completion of a strategy step, updating cumulative counts if necessary.
   * @param {World} world The game world context.
   * @param {import('../../core/utils/globalTypes').BuildOrderStep | import('./strategyManager').StrategyStep} rawStep The raw step data from the build order or strategy.
   * @param {string} unitType The unit type identifier.
   * @param {number} currentCumulativeCount The current cumulative count for the unit type.
   * @param {import('../../core/utils/globalTypes').InterpretedAction} interpretedAction The interpreted action for the current step.
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
   * Ensures all necessary properties are initialized. Called within the constructor.
   */
  initializeProperties() {
    if (!this.strategyContext) {
      this.strategyContext = StrategyContext.getInstance();
    }
    if (!this.loggedDelays) {
      this.loggedDelays = new Map();
    }
    if (!this.actionStrategy) {
      this.actionStrategy = new UnitActionStrategy();
    }
    if (!this.upgradeStrategy) {
      this.upgradeStrategy = new UpgradeActionStrategy();
    }
  } 

  /**
   * Initializes the strategy for the given race.
   * @param {SC2APIProtocol.Race | undefined} race - The race for which to initialize the strategy.
   */
  initializeStrategy(race) {
    if (!race) {
      throw new Error("Race must be provided for strategy initialization");
    }
    this.race = race;

    if (!this.strategyContext) {
      console.error("strategyContext is undefined.");
      return; // Early return to prevent further execution if strategyContext is missing
    }

    try {
      const buildOrderKey = config.debugBuildOrderKey || StrategyManager.selectBuildOrderKey(race);
      this.strategyContext.setCurrentStrategy(StrategyManager.loadStrategy(race, buildOrderKey));
    } catch (error) {
      console.error(`Error loading strategy for ${race}:`, error);
      return; // Early return to prevent further execution if an error occurs
    }

    // Reset planning variables to their initial state
    this.resetPlanningVariables();
  }
  /**
   * Checks if there's an active strategy plan.
   * @returns {boolean} True if there's an active plan, false otherwise.
   */
  isActivePlan() {
    if (!this.strategyContext) {
      console.error('strategyContext is undefined');
      return false;
    }

    const plan = this.strategyContext.getCurrentStrategy();
    if (!plan) {
      return false; // Return false immediately if there is no current strategy
    }

    // Check if the plan is completed only if necessary
    return !this.isPlanCompleted();
  }

  /**
   * Type guard to check if a strategy conforms to the BuildOrder type.
   * @param {any} strategy - The strategy to check.
   * @returns {strategy is import('../../core/utils/globalTypes').BuildOrder}
   */
  static isBuildOrder(strategy) {
    return 'title' in strategy && 'raceMatchup' in strategy && 'steps' in strategy && 'url' in strategy;
  }
  /**
   * Determines if the current strategy plan has been completed.
   * @returns {boolean} True if the plan is completed, false otherwise.
   */
  isPlanCompleted() {
    // Utilize optional chaining to simplify null checks
    const currentStrategy = this.strategyContext?.getCurrentStrategy();
    if (!currentStrategy?.steps?.length) {
      // If there's no current strategy, or it has no steps, consider the plan not completed.
      return false;
    }

    // Use optional chaining to safely access the current step index
    const currentStep = this.strategyContext?.getCurrentStep() ?? -1;
    return currentStep >= currentStrategy.steps.length;
  }
  /**
   * Check if the step conditions are satisfied.
   * @param {World} world
   * @param {import('../../core/utils/globalTypes').BuildOrderStep | StrategyStep} step
   * @returns {boolean}
   */
  isStepSatisfied(world, step) {
    const gameState = GameState.getInstance();
    const agent = world.agent;
    const buildOrder = this.getBuildOrderForCurrentStrategy();
    const stepIndex = buildOrder.steps.findIndex(s => isEqualStep(s, step));

    // Retrieve interpreted actions, considering optional properties
    const interpretedActions = Array.isArray(step.interpretedAction) ? step.interpretedAction :
      step.interpretedAction ? [step.interpretedAction] :
        interpretBuildOrderAction(step.action, ('comment' in step) ? step.comment : '');

    if (!this.strategyData) {
      console.error('Strategy data is not initialized');
      return false; // Early exit if strategyData is not initialized
    }

    return interpretedActions.every(action => {
      if (!action.isUpgrade && action.unitType) {
        const currentUnitCount = gameState.getUnitCount(world, action.unitType);
        const startingUnitCounts = { [`unitType_${action.unitType}`]: gameState.getStartingUnitCount(action.unitType) };
        const targetCounts = this.strategyData.calculateTargetCountForStep(step, buildOrder, startingUnitCounts);
        const targetCount = targetCounts[`unitType_${action.unitType}_step_${stepIndex}`] || 0;

        return currentUnitCount >= targetCount;
      } else if (action.isUpgrade && action.upgradeType) {
        return agent.upgradeIds?.includes(action.upgradeType) ?? false;
      }
      return false;
    });
  }

  /**
   * @param {import("../../core/utils/globalTypes").BuildOrder | Strategy | undefined} plan
   */
  static isValidPlan(plan) {
    return plan && Array.isArray(plan.steps);
  }

  /**
   * Dynamically loads a strategy based on race and build order key.
   * @param {SC2APIProtocol.Race | undefined} race
   * @param {string} buildOrderKey
   * @returns {import("../../core/utils/globalTypes").BuildOrder | undefined}
   */
  static loadStrategy(race, buildOrderKey) {
    if (!race) {
      console.error('Race must be provided to load strategy');
      return;
    }

    const raceKey = StrategyManager.mapRaceToKey(race);

    if (!raceKey || !buildOrders[raceKey]) {
      console.error(`Build orders for race ${race} not found`);
      return;
    }

    const raceBuildOrders = buildOrders[raceKey];

    return raceBuildOrders[buildOrderKey];
  }

  /**
   * Maps SC2APIProtocol.Race to a specific race key.
   * @param {SC2APIProtocol.Race} race - The race to map.
   * @returns {'protoss' | 'terran' | 'zerg' | undefined} - Corresponding race key or undefined
   */
  static mapRaceToKey(race) {
    const raceMapping = {
      [Race.PROTOSS]: 'protoss',
      [Race.TERRAN]: 'terran',
      [Race.ZERG]: 'zerg'
    };

    // Ensure the return value matches one of the specific strings or undefined
    const key = raceMapping[race];
    return key === 'protoss' || key === 'terran' || key === 'zerg' ? key : undefined;
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
        actions = actions.concat(UnitActionStrategy.handleUnitTypeAction(world, planStep));
        break;
      case 'Upgrade':
        // Using non-null assertion operator in TypeScript, or ensure your JSDoc/environment knows it's always initialized
        if (this.upgradeStrategy) {
          actions = actions.concat(UpgradeActionStrategy.handleUpgradeAction(world, planStep));
        } else {
          console.error("upgradeStrategy is not initialized.");
        }
        break;
      default:
        break;
    }

    return actions;
  }

  /**
   * Processes all steps in the strategy plan.
   * @param {World} world - The game world context.
   * @param {import("../../core/utils/globalTypes").BuildOrder | Strategy} plan - The strategy plan to execute.
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
    // Check for necessary context before proceeding
    if (!this.strategyContext) {
      console.error('strategyContext is undefined, unable to set current step and perform actions.');
      return; // Early exit to prevent further execution
    }

    // Set the current strategy step
    this.strategyContext.setCurrentStep(step);

    // Perform actions specific to the plan step and add to actionsToPerform
    const stepActions = this.performPlanStepActions(world, planStep);
    if (stepActions && stepActions.length > 0) {
      actionsToPerform.push(...stepActions);
    }
  }

  /**
   * Processes each step of the strategy plan.
   * @param {World} world
   * @param {import("../../core/utils/globalTypes").BuildOrderStep | StrategyStep} rawStep
   * @param {number} step
   * @param {StrategyManager} strategyManager
   * @param {SC2APIProtocol.ActionRawUnitCommand[]} actionsToPerform
   */
  processStep(world, rawStep, step, strategyManager, actionsToPerform) {
    const interpretedActions = StrategyData.getInterpretedActions(rawStep);
    if (!interpretedActions) return;

    for (const interpretedAction of interpretedActions) {
      this.processInterpretedAction(world, rawStep, step, interpretedAction, strategyManager, actionsToPerform);
    }
  }

  /**
   * Processes an interpreted action from the current strategy step.
   * @param {World} world
   * @param {import("../../core/utils/globalTypes").BuildOrderStep | StrategyManager.StrategyStep} rawStep
   * @param {number} step
   * @param {import('../../core/utils/globalTypes').InterpretedAction} interpretedAction
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
   * Resets the current step in the strategy context safely.
   */
  resetCurrentStep() {
    if (this.strategyContext) {
      this.strategyContext.setCurrentStep(-1);
    } else {
      console.error("finalizeStrategyExecution: strategyContext is undefined");
    }
  }  
  /**
   * Execute the game plan and return the actions to be performed.
   * @param {World} world 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions to be performed.
   */
  runPlan(world) {
    const { agent, data } = world;
    const { race } = agent;
    const specificBuildOrderKey = StrategyManager.getBuildOrderKey(); // Assume this fetches based on some criteria

    // Validate required resources first before continuing
    if (!StrategyManager.validateResources(agent)) {
      console.error('Insufficient resources to run the plan.');
      return [];
    }

    // Get or initialize the strategy manager instance
    const strategyManager = StrategyManager.getInstance(race, specificBuildOrderKey);
    if (!strategyManager) {
      console.error('Failed to retrieve or initialize StrategyManager.');
      return [];
    }

    // Reset and prepare game state for the plan execution
    resetEarmarks(data);
    const gameState = GameState.getInstance();
    gameState.pendingFood = 0;  // Example of resetting some game state

    // Ensure strategy context is set up correctly
    if (!this.strategyContext) {
      console.error('strategyContext is undefined');
      return [];
    }

    // Fetch and validate the current strategy plan
    const plan = this.strategyContext.getCurrentStrategy();
    if (!plan || !StrategyManager.isValidPlan(plan)) {
      console.error('Invalid or undefined strategy plan');
      return [];
    }

    // Execute the strategy plan
    return this.executeStrategyPlan(world, plan, strategyManager);
  }

  /**
   * Selects a build order key based on race and possibly other criteria.
   * If a specific build order key is provided, it uses that key; otherwise, it selects randomly.
   * @param {SC2APIProtocol.Race | undefined} race
   * @param {string | undefined} specificBuildOrderKey - Optional specific build order key for debugging.
   * @returns {string}
   */
  static selectBuildOrderKey(race, specificBuildOrderKey = undefined) {
    if (race === undefined) {
      throw new Error('Race must be provided');
    }
    // Directly use the specific build order key if provided
    if (specificBuildOrderKey !== undefined) {
      return specificBuildOrderKey;
    }
    // Otherwise, proceed to select a key randomly
    return StrategyManager.selectRandomBuildOrderKey(race);
  }

  /**
   * Selects a random build order key for a given race.
   * @param {SC2APIProtocol.Race} race - The race for which to select a build order.
   * @param {string | undefined} specificBuildOrderKey - Optional specific build order key for debugging.
   * @returns {string} A randomly selected or specified build order key.
   */
  static selectRandomBuildOrderKey(race, specificBuildOrderKey = undefined) {
    if (specificBuildOrderKey) {
      return specificBuildOrderKey;
    }
    const raceKey = StrategyManager.mapRaceToKey(race);

    // Ensure raceKey is not undefined before proceeding
    if (!raceKey) {
      throw new Error(`Race key for race ${race} not found`);
    }

    const raceBuildOrders = buildOrders[raceKey];
    if (!raceBuildOrders) {
      throw new Error(`Build orders for race ${raceKey} not found`);
    }

    // Log available build orders for insight
    console.log(`Available build order keys for ${raceKey}:`, Object.keys(raceBuildOrders));

    const buildOrderKeys = Object.keys(raceBuildOrders);
    const randomIndex = Math.floor(Math.random() * buildOrderKeys.length);
    return buildOrderKeys[randomIndex];
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
   * Updates the outpowered status of the bot.
   * @param {boolean} status The new outpowered status.
   */
  setOutpowered(status) {
    this.outpowered = status;
  }

  getPlanMin() {
    return this.planMin;
  }

  /**
   * @param {{ [key: string]: number; }} min
   */
  setPlanMin(min) {
    this.planMin = min;
  }

  getUnitMax() {
    return this.unitMax;
  }

  /**
   * @param {{ [key: string]: number; }} max
   */
  setUnitMax(max) {
    this.unitMax = max;
  }

  getSelectedTypeToBuild() {
    return this.selectedTypeToBuild;
  }

  /**
   * Resets planning variables to their default values.
   */
  resetPlanningVariables() {
    this.planMin = {};
    this.selectedTypeToBuild = null;
    this.unitMax = {};
  }

  /**
   * @param {number | null} type
   */
  setSelectedTypeToBuild(type) {
    this.selectedTypeToBuild = type;
  }

  /**
   * Checks if an action should be delayed based on the current time and target time.
   * @param {string} specialAction - The special action to check.
   * @param {World} world - The world context.
   * @param {import('../../core/utils/globalTypes').BuildOrderStep | StrategyManager.StrategyStep} rawStep - The step data.
   * @returns {boolean} True if the action should be delayed, false otherwise.
   */
  shouldDelayAction(specialAction, world, rawStep) {
    const targetTime = convertTimeStringToSeconds(rawStep.time);
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
  static validateResources(agent) {
    const { minerals, vespene } = agent;
    return !(minerals === undefined || vespene === undefined);
  }
}

module.exports = StrategyManager;

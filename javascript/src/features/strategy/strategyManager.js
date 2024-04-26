// strategyManager.js
"use strict";

const { Upgrade } = require("@node-sc2/core/constants");
const { Race } = require("@node-sc2/core/constants/enums");

// Import build orders for each race
const StrategyContext = require("./strategyContext");
const UnitActionStrategy = require("./unitActionStrategy");
const { UpgradeActionStrategy } = require("./upgradeActionStrategy");
const config = require("../../../config/config");
const { GameState } = require('../../core/gameState');
const { calculateTargetCountForStep } = require("../../gameLogic/intermediaryUtils");
const { performScoutingWithSCV } = require("../../gameLogic/scouting/scoutActions");
const { getSingletonInstance } = require("../../gameLogic/singletonFactory");
const { isBuildOrderStep } = require("../../gameLogic/strategy/strategyUtils");
const { balanceResources, setFoodUsed } = require("../../utils/economy/economyManagement");
const { buildSupplyOrTrain } = require("../../utils/unit/unitManagement");
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
 * @property {import("../../utils/core/globalTypes").InterpretedAction} [interpretedAction] - Optional property for interpreted action details
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
   * @param {SC2APIProtocol.Race | undefined} race - The race type, optional.
   * @param {string | undefined} specificBuildOrderKey - Optional specific build order key for debugging.
   */
  constructor(race = undefined, specificBuildOrderKey = undefined) {
    this.strategyContext = StrategyContext.getInstance();

    if (StrategyManager.instance) {
      const instance = StrategyManager.instance;
      instance.initializeProperties();
      return instance;
    }

    StrategyManager.instance = this;
    this.race = race;
    this.specificBuildOrderKey = specificBuildOrderKey;
    this.initializeStrategy(race);

    this.loggedDelays = new Map();
    this.actionStrategy = new UnitActionStrategy();
    this.upgradeStrategy = new UpgradeActionStrategy();

    this.initializeProperties();
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
   * @param {import('../../utils/core/globalTypes').BuildOrderStep | StrategyStep} rawStep - The raw step from the build order.
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
   * Converts a time string formatted as 'm:ss' to the total number of seconds.
   * @param {string} timeString - The time string to convert.
   * @returns {number} The total seconds.
   */
  convertTimeStringToSeconds(timeString) {
    const [minutes, seconds] = timeString.split(':').map(Number);
    return minutes * 60 + seconds;
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
   * @param {import("../../utils/core/globalTypes").BuildOrder | Strategy | undefined} plan - The strategy plan to execute.
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
    this.strategyContext.setCurrentStep(-1);
    if (!hasEarmarks(world.data)) {
      actionsToPerform.push(...balanceResources(world, undefined, build));
    }
  }

  /**
   * Get the current strategy's build order.
   * @returns {import('../../utils/core/globalTypes').BuildOrder}
   */
  getBuildOrderForCurrentStrategy() {
    const currentStrategy = this.strategyContext.getCurrentStrategy();

    if (!currentStrategy) {
      throw new Error('No current strategy found');
    }

    // Check if currentStrategy is a BuildOrder
    if ('title' in currentStrategy && 'raceMatchup' in currentStrategy && 'steps' in currentStrategy && 'url' in currentStrategy) {
      return currentStrategy;
    }

    // If currentStrategy is not a BuildOrder, handle the error or alternative case
    throw new Error('Current strategy does not contain a valid build order');
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
   * Retrieves the singleton instance of StrategyManager.
   * @param {SC2APIProtocol.Race | undefined} race - The race for the strategy manager.
   * @returns {StrategyManager} The singleton instance.
   */
  static getInstance(race = undefined) {
    // Wrap 'race' in an array
    const instance = getSingletonInstance(StrategyManager, [race]);

    // Only initialize with race if race is provided
    if (race !== undefined && instance.race === undefined) {
      instance.assignRaceAndInitializeStrategy(race);
    }

    return instance;
  }

  /**
   * @param {import("../../utils/core/globalTypes").BuildOrderStep | StrategyStep} rawStep
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
   * Initializes or ensures that all required properties are properly set up.
   * This method can help to make sure that every property is initialized, especially 
   * useful if the instance was created with some properties initially undefined.
   */
  initializeProperties() {
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

    try {
      // Use the debug build order key from configuration if available, otherwise select randomly
      const buildOrderKey = config.debugBuildOrderKey || this.selectBuildOrderKey(race);
      
      this.strategyContext.setCurrentStrategy(this.loadStrategy(race, buildOrderKey));
    } catch (error) {
      console.error(`Error loading strategy for ${race}:`, error);
    }

    this.planMin = {};
    this.selectedTypeToBuild = null;
    this.unitMax = {};
  }

  /**
  * Checks if there's an active strategy plan.
  * @returns {boolean} True if there's an active plan, false otherwise.
  */
  isActivePlan() {
    const strategyManager = StrategyManager.getInstance();
    const plan = this.strategyContext.getCurrentStrategy();
    // Coerce the result to a boolean to ensure the return type is strictly boolean
    return !!plan && !strategyManager.isPlanCompleted();
  } 

  /**
   * Determines if the current strategy plan has been completed.
   * @returns {boolean} True if the plan is completed, false otherwise.
   */
  isPlanCompleted() {
    const currentStrategy = this.strategyContext.getCurrentStrategy();
    if (!currentStrategy || !currentStrategy.steps || currentStrategy.steps.length === 0) {
      // If there's no current strategy, or it has no steps, consider the plan not completed.
      return false;
    }

    // Check if the current step index is beyond the last step in the strategy steps array.
    const currentStep = this.strategyContext.getCurrentStep();
    return currentStep >= currentStrategy.steps.length;
  }

  /**
   * Check if the step conditions are satisfied.
   * @param {World} world
   * @param {import('../../utils/core/globalTypes').BuildOrderStep | StrategyStep} step
   * @returns {boolean}
   */
  isStepSatisfied(world, step) {
    const gameState = GameState.getInstance();
    const agent = world.agent;

    let interpretedActions;
    if (step.interpretedAction) {
      interpretedActions = Array.isArray(step.interpretedAction) ? step.interpretedAction : [step.interpretedAction];
    } else {
      let comment = '';
      if (isBuildOrderStep(step)) {
        comment = step.comment || '';
      }
      interpretedActions = interpretBuildOrderAction(step.action, comment);
    }

    return interpretedActions.every(interpretedAction => {
      if (interpretedAction.isUpgrade === false && interpretedAction.unitType !== null) {
        const currentUnitCount = gameState.getUnitCount(world, interpretedAction.unitType);
        const buildOrder = this.getBuildOrderForCurrentStrategy();

        // Assuming calculateTargetCountForStep now includes logic for initial unit count
        const startingUnitCount = gameState.getStartingUnitCount(interpretedAction.unitType);
        const targetCountForStep = calculateTargetCountForStep(step, buildOrder, startingUnitCount);

        return currentUnitCount >= targetCountForStep;
      } else if (interpretedAction.isUpgrade === true && interpretedAction.upgradeType !== null) {
        return agent.upgradeIds ? agent.upgradeIds.includes(interpretedAction.upgradeType) : false;
      }

      return false;
    });
  }

  /**
   * @param {import("../../utils/core/globalTypes").BuildOrder | Strategy | undefined} plan
   */
  isValidPlan(plan) {
    return plan && Array.isArray(plan.steps);
  }

  /**
   * Dynamically loads a strategy based on race and build order key.
   * @param {SC2APIProtocol.Race | undefined} race
   * @param {string} buildOrderKey
   * @returns {import("../../utils/core/globalTypes").BuildOrder | undefined}
   */
  loadStrategy(race, buildOrderKey) {
    if (!race) {
      console.error('Race must be provided to load strategy');
      return;
    }

    const raceKey = this.mapRaceToKey(race);

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
  mapRaceToKey(race) {
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
        actions = actions.concat(this.actionStrategy.handleUnitTypeAction(world, planStep));
        break;
      case 'Upgrade':
        // Using non-null assertion operator in TypeScript, or ensure your JSDoc/environment knows it's always initialized
        if (this.upgradeStrategy) {
          actions = actions.concat(this.upgradeStrategy.handleUpgradeAction(world, planStep));
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
   * @param {import("../../utils/core/globalTypes").BuildOrder | Strategy} plan - The strategy plan to execute.
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
    this.strategyContext.setCurrentStep(step);
    actionsToPerform.push(...this.performPlanStepActions(world, planStep));
    this.handleEarmarksIfNeeded(world, actionsToPerform);
  }

  /**
   * Processes each step of the strategy plan.
   * @param {World} world
   * @param {import("../../utils/core/globalTypes").BuildOrderStep | StrategyStep} rawStep
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

    const plan = this.strategyContext.getCurrentStrategy();
    if (!plan || !this.isValidPlan(plan)) return [];

    return this.executeStrategyPlan(world, plan, strategyManager);
  }

  /**
   * Selects a build order key based on race and possibly other criteria.
   * If a specific build order key is provided, it uses that key; otherwise, it selects randomly.
   * @param {SC2APIProtocol.Race | undefined} race
   * @param {string | undefined} specificBuildOrderKey - Optional specific build order key for debugging.
   * @returns {string}
   */
  selectBuildOrderKey(race, specificBuildOrderKey = undefined) {
    if (race === undefined) {
      throw new Error('Race must be provided');
    }
    // Directly use the specific build order key if provided
    if (specificBuildOrderKey !== undefined) {
      return specificBuildOrderKey;
    }
    // Otherwise, proceed to select a key randomly
    return this.selectRandomBuildOrderKey(race);
  }

  /**
   * Selects a random build order key for a given race.
   * @param {SC2APIProtocol.Race} race - The race for which to select a build order.
   * @param {string | undefined} specificBuildOrderKey - Optional specific build order key for debugging.
   * @returns {string} A randomly selected or specified build order key.
   */
  selectRandomBuildOrderKey(race, specificBuildOrderKey = undefined) {
    if (specificBuildOrderKey) {
      return specificBuildOrderKey;
    }
    const raceKey = this.mapRaceToKey(race);

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
   * @param {number | null} type
   */
  setSelectedTypeToBuild(type) {
    this.selectedTypeToBuild = type;
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

module.exports = StrategyManager;

"use strict";

const {
  Upgrade,
  UnitType,
  Buff,
} = require("@node-sc2/core/constants");
const { Race } = require("@node-sc2/core/constants/enums");

const StrategyContext = require("./strategyContext");
const UnitActionStrategy = require("./unitActionStrategy");
const UpgradeActionStrategy = require("./upgradeActionStrategy");
const config = require("../../../../config/config");
const { getUnitTypeData } = require("../../../core/gameData");
const {
  balanceResources,
  setFoodUsed,
} = require("../../../gameLogic/economy/economyManagement");
const { checkUnitCount } = require("../../../gameLogic/shared/stateManagement");
const { GameState } = require("../../../gameState");
const { buildSupplyOrTrain } = require("../../../units/management/unitManagement");
const { isEqualStep, getBuildOrderKey, validateResources, isValidPlan } = require("../../../utils/strategyUtils");
const { convertTimeStringToSeconds } = require("../../../utils/timeUtils");
const { getUnitsById } = require("../../../utils/unitUtils");
const { checkUpgradeStatus } = require("../../../utils/upgradeUtils");
const buildOrders = require("../../buildOrders");
const { interpretBuildOrderAction } = require("../../buildOrders/buildOrderUtils");
const { build, hasEarmarks, resetEarmarks } = require("../../construction/buildingService");
const { executeSpecialAction } = require("../actions/specialActions");
const StrategyData = require("../data/strategyData");

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
 * @property {import("../../../utils/globalTypes").InterpretedAction} [interpretedAction] - Optional property for interpreted action details
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
    this.initializeSingleton(race, specificBuildOrderKey);
    StrategyManager.instance = this;
  }

  /**
   * Initializes the singleton instance.
   * @param {SC2APIProtocol.Race | undefined} race
   * @param {string | undefined} specificBuildOrderKey
   */
  initializeSingleton(race, specificBuildOrderKey) {
    this.strategyContext = StrategyContext.getInstance();
    this.race = race;
    this.specificBuildOrderKey = specificBuildOrderKey;
    this.loggedDelays = new Map();
    this.cumulativeCounts = {};
    this.stepCompletionStatus = new Map();

    if (race) {
      this.assignRaceAndInitializeStrategy(race);
    }

    this.strategyData = new StrategyData();
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
    const { minerals = 0, vespene = 0 } = agent;
    const earmarkTotals = data.getEarmarkTotals('');
    const mineralsNeeded = Math.max(earmarkTotals.minerals - minerals, 0);
    const vespeneNeeded = Math.max(earmarkTotals.vespene - vespene, 0);
    return balanceResources(world, mineralsNeeded / vespeneNeeded, build);
  }

  /**
   * Check if the unit type is being ChronoBoosted.
   * @param {World} world - The game world object.
   * @param {number} unitType - The ID of the unit type to check.
   * @returns {boolean} - Returns true if the unit type is being ChronoBoosted, otherwise false.
   */
  static checkChronoBoostStatus(world, unitType) {
    const nexusUnits = getUnitsById(world, UnitType.NEXUS);
    if (nexusUnits.length === 0) return false;

    const unitTypeData = getUnitTypeData(world, unitType);
    if (!unitTypeData) return false;

    const trainingUnit = world.resources.get().units.getStructures().find((unit) =>
      unit.orders?.some((order) => order.abilityId === unitTypeData.abilityId)
    );

    if (!trainingUnit) return false;

    return trainingUnit.buffIds?.includes(Buff.CHRONOBOOSTENERGYCOST) || false;
  }

  /**
   * Creates a plan step from the given raw step and interpreted action.
   * @param {import('../../../utils/globalTypes').BuildOrderStep | StrategyStep} rawStep - The raw step from the build order.
   * @param {import('../../../utils/globalTypes').InterpretedAction} interpretedAction - The interpreted action for the step.
   * @param {number} cumulativeCount - The cumulative count of the unitType up to this step in the plan.
   * @returns {PlanStep} The created plan step.
   */
  static createPlanStep(rawStep, interpretedAction, cumulativeCount) {
    const { supply, time, action } = rawStep;
    const { isUpgrade, unitType, upgradeType, count } = interpretedAction;

    return {
      supply: parseInt(supply, 10),
      time,
      action,
      orderType: isUpgrade ? "Upgrade" : "UnitType",
      unitType: unitType || 0,
      targetCount: cumulativeCount + (count || 0),
      upgrade: isUpgrade ? upgradeType || Upgrade.NULL : Upgrade.NULL,
      isChronoBoosted: Boolean(interpretedAction.isChronoBoosted),
      count: count || 0,
      candidatePositions: [],
      food: parseInt(supply, 10),
    };
  }

  /**
   * Executes the given strategy plan.
   * @param {World} world - The game world context.
   * @param {import("../../../utils/globalTypes").BuildOrder | Strategy | undefined} plan - The strategy plan to execute.
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
    this.handleEarmarksAndResources(actionsToPerform, world);
  }

  /**
   * Get the current strategy's build order.
   * @returns {import('../../../utils/globalTypes').BuildOrder}
   */
  getBuildOrderForCurrentStrategy() {
    if (!this.strategyContext) {
      throw new Error(
        "Strategy context is undefined, which is required to get the current build order."
      );
    }

    const currentStrategy = this.strategyContext.getCurrentStrategy();
    if (!currentStrategy) {
      throw new Error(
        "No current strategy found in the strategy context."
      );
    }

    if (StrategyManager.isBuildOrder(currentStrategy)) {
      return currentStrategy;
    }

    throw new Error(
      "The current strategy does not conform to the expected build order structure."
    );
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
   * @param {SC2APIProtocol.Race | undefined} race - The race for the strategy manager.
   * @param {string | undefined} specificBuildOrderKey - Optional specific build order key for debugging.
   * @returns {StrategyManager}
   */
  static getInstance(race = undefined, specificBuildOrderKey = undefined) {
    if (!this.instance) {
      this.instance = new StrategyManager(race, specificBuildOrderKey);
    } else {
      if (race !== undefined && this.instance.race !== race) {
        this.instance.assignRaceAndInitializeStrategy(race);
      }
      if (
        specificBuildOrderKey !== undefined &&
        this.instance.specificBuildOrderKey !== specificBuildOrderKey
      ) {
        this.instance.specificBuildOrderKey = specificBuildOrderKey;
      }
    }

    return this.instance;
  }
  /**
   * Handles earmarks and balances resources if necessary.
   * @param {SC2APIProtocol.ActionRawUnitCommand[]} actionsToPerform
   * @param {World} world
   */
  handleEarmarksAndResources(actionsToPerform, world) {
    try {
      const earmarksExist = hasEarmarks(world.data);
      if (!earmarksExist) {
        actionsToPerform.push(...balanceResources(world, undefined, build));
      } else {
        this.handleEarmarksIfNeeded(world, actionsToPerform);
      }
    } catch (error) {
      console.error(
        "Error handling earmarks and resources:",
        error instanceof Error ? error.message : "Unknown error"
      );
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
   * @param {import('../../../utils/globalTypes').BuildOrderStep | import('./strategyManager').StrategyStep} rawStep The raw step data from the build order or strategy.
   * @param {number} step The current step number in the strategy.
   * @param {import('../../../utils/globalTypes').InterpretedAction} interpretedAction The interpreted action for the current step.
   * @param {SC2APIProtocol.ActionRawUnitCommand[]} actionsToPerform The array of actions to be performed.
   * @param {number} currentCumulativeCount The current cumulative count of the unit type up to this step.
   */
  handlePlanStep(
    world,
    rawStep,
    step,
    interpretedAction,
    actionsToPerform,
    currentCumulativeCount
  ) {
    const effectiveUnitType =
      interpretedAction.unitType?.toString() || "default";
    const planStep = StrategyManager.createPlanStep(
      rawStep,
      interpretedAction,
      currentCumulativeCount
    );
    this.cumulativeCounts[effectiveUnitType] =
      currentCumulativeCount + (interpretedAction.count || 0);

    if (interpretedAction.specialAction) {
      actionsToPerform.push(
        ...this.handleSpecialAction(
          interpretedAction.specialAction,
          world,
          rawStep
        )
      );
      return;
    }

    this.processRegularAction(world, planStep, step, actionsToPerform);
  }

  /**
   * Handles special actions identified in build order steps.
   * @param {string} specialAction - The special action to handle.
   * @param {World} world - The current world state.
   * @param {import('../../../utils/globalTypes').BuildOrderStep | StrategyManager.StrategyStep} rawStep - The raw step data containing timing and other contextual information.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions to be performed for the special action.
   */
  handleSpecialAction(specialAction, world, rawStep) {
    if (this.shouldDelayAction(specialAction, world, rawStep)) {
      return [];
    }
    return executeSpecialAction(specialAction, world);
  }

  /**
   * Handles the completion of a strategy step.
   * @param {World} world The game world context.
   * @param {import("../../../utils/globalTypes").BuildOrderStep | import('./strategyManager').StrategyStep} rawStep The raw step data from the build order or strategy.
   * @param {string} unitType The unit type identifier.
   * @param {number} currentCumulativeCount The current cumulative count for the unit type.
   * @param {import("../../../utils/globalTypes").InterpretedAction} interpretedAction The interpreted action for the current step.
   * @param {StrategyManager} strategyManager The strategy manager instance.
   * @param {number} actionIndex The index of the current interpreted action in the rawStep.
   * @returns {boolean} True if the step is completed, false otherwise.
   */
  static handleStepCompletion(
    world,
    rawStep,
    unitType,
    currentCumulativeCount,
    interpretedAction,
    strategyManager,
    actionIndex
  ) {
    const stepWithStatus = /** @type {any} */ (rawStep);

    if (
      strategyManager.isActionSatisfied(world, interpretedAction, rawStep)
    ) {
      stepWithStatus.interpretedActionsStatus[actionIndex] = true;
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
      return;
    }

    try {
      const buildOrderKey =
        config.debugBuildOrderKey ||
        StrategyManager.selectBuildOrderKey(race);
      this.strategyContext.setCurrentStrategy(
        StrategyManager.loadStrategy(race, buildOrderKey)
      );
    } catch (error) {
      console.error(`Error loading strategy for ${race}:`, error);
      return;
    }

    this.resetPlanningVariables();
  }

  /**
   * Check if the action conditions are satisfied.
   * @param {World} world
   * @param {import('../../../utils/globalTypes').InterpretedAction} action
   * @param {import('../../../utils/globalTypes').BuildOrderStep | StrategyStep} step
   * @returns {boolean}
   */
  isActionSatisfied(world, action, step) {
    const gameState = GameState.getInstance();
    const agent = world.agent;

    if (!this.strategyData) {
      console.error("Strategy data is not initialized");
      return false;
    }

    if (action.isUpgrade && action.upgradeType) {
      return checkUpgradeStatus(agent, action.upgradeType);
    }

    if (action.unitType == null) {
      return false;
    }

    const buildOrder = this.getBuildOrderForCurrentStrategy();
    const stepIndex = buildOrder.steps.findIndex((s) => isEqualStep(s, step));

    const startingUnitCounts = {
      [`unitType_${action.unitType}`]:
        gameState.getStartingUnitCount(action.unitType),
    };
    const targetCounts = this.strategyData.calculateTargetCountForStep(
      step,
      buildOrder,
      startingUnitCounts
    );
    const targetCount =
      targetCounts[`unitType_${action.unitType}_step_${stepIndex}`] || 0;

    if (!action.isUpgrade) {
      const isCountSatisfied = checkUnitCount(
        world,
        action.unitType,
        targetCount,
        true
      );

      if (action.isChronoBoosted) {
        return (
          isCountSatisfied &&
          StrategyManager.checkChronoBoostStatus(world, action.unitType)
        );
      }

      return isCountSatisfied;
    }

    return false;
  }

  /**
   * Checks if there's an active strategy plan.
   * @returns {boolean} True if there's an active plan, false otherwise.
   */
  isActivePlan() {
    if (!this.strategyContext) {
      console.error("strategyContext is undefined");
      return false;
    }

    const plan = this.strategyContext.getCurrentStrategy();
    if (!plan) {
      return false;
    }

    return !this.isPlanCompleted();
  }

  /**
   * Type guard to check if a strategy conforms to the BuildOrder type.
   * @param {any} strategy - The strategy to check.
   * @returns {strategy is import('../../../utils/globalTypes').BuildOrder}
   */
  static isBuildOrder(strategy) {
    return (
      "title" in strategy &&
      "raceMatchup" in strategy &&
      "steps" in strategy &&
      "url" in strategy
    );
  }

  /**
   * Determines if the current strategy plan has been completed.
   * @returns {boolean} True if the plan is completed, false otherwise.
   */
  isPlanCompleted() {
    const currentStrategy = this.strategyContext?.getCurrentStrategy();
    if (!currentStrategy?.steps?.length) {
      return false;
    }

    const currentStep = this.strategyContext?.getCurrentStep() ?? -1;
    return currentStep >= currentStrategy.steps.length;
  }

  /**
   * Check if the step conditions are satisfied.
   * @param {World} world
   * @param {import('../../../utils/globalTypes').BuildOrderStep | StrategyStep} step
   * @returns {boolean}
   */
  isStepSatisfied(world, step) {
    const gameState = GameState.getInstance();
    const agent = world.agent;
    const buildOrder = this.getBuildOrderForCurrentStrategy();
    const stepIndex = buildOrder.steps.findIndex((s) => isEqualStep(s, step));

    const interpretedActions = Array.isArray(step.interpretedAction)
      ? step.interpretedAction
      : step.interpretedAction
        ? [step.interpretedAction]
        : interpretBuildOrderAction(step.action, "comment" in step ? step.comment : "");

    if (!this.strategyData) {
      console.error("Strategy data is not initialized");
      return false;
    }

    return interpretedActions.every((action) => {
      if (!action.isUpgrade && action.unitType) {
        const currentUnitCount = gameState.getUnitCount(world, action.unitType);
        const startingUnitCounts = {
          [`unitType_${action.unitType}`]:
            gameState.getStartingUnitCount(action.unitType),
        };

        const targetCounts = this.strategyData
          ? this.strategyData.calculateTargetCountForStep(
            step,
            buildOrder,
            startingUnitCounts
          )
          : {};
        const targetCount =
          targetCounts[`unitType_${action.unitType}_step_${stepIndex}`] || 0;

        return currentUnitCount >= targetCount;
      } else if (action.isUpgrade && action.upgradeType) {
        const isUpgradeCompleted =
          agent.upgradeIds?.includes(action.upgradeType) ?? false;
        const isUpgradeInProgress = gameState.isUpgradeInProgress(
          action.upgradeType
        );

        return isUpgradeCompleted || isUpgradeInProgress;
      }
      return false;
    });
  }

  /**
   * Dynamically loads a strategy based on race and build order key.
   * @param {SC2APIProtocol.Race | undefined} race
   * @param {string} buildOrderKey
   * @returns {import("../../../utils/globalTypes").BuildOrder | undefined}
   */
  static loadStrategy(race, buildOrderKey) {
    if (!race) {
      console.error("Race must be provided to load strategy");
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
      [Race.PROTOSS]: "protoss",
      [Race.TERRAN]: "terran",
      [Race.ZERG]: "zerg",
    };

    const key = raceMapping[race];
    return key === "protoss" || key === "terran" || key === "zerg"
      ? key
      : undefined;
  }

  /**
   * Perform the necessary actions for the current plan step based on the available resources.
   * @param {World} world - The current game world context.
   * @param {PlanStep} planStep - The current step in the plan to be executed.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} A list of actions to be performed.
   */
  performPlanStepActions(world, planStep) {
    let actions = [...buildSupplyOrTrain(world, planStep)];
    const { orderType, isChronoBoosted, supply } = planStep;

    switch (orderType) {
      case "UnitType":
        actions.push(...UnitActionStrategy.handleUnitTypeAction(world, planStep));
        break;
      case "Upgrade":
        if (this.upgradeStrategy) {
          actions.push(...UpgradeActionStrategy.handleUpgradeAction(world, planStep));
        } else {
          console.error("upgradeStrategy is not initialized.");
        }
        break;
      default:
        console.warn("Unhandled orderType:", orderType);
        break;
    }

    if (isChronoBoosted) {
      const gameState = GameState.getInstance();
      const currentSupply = gameState.getFoodUsed();
      if (currentSupply >= supply) {
        actions.push(...UnitActionStrategy.handleChronoBoostAction(world, planStep));
      }
    }

    return actions;
  }

  /**
   * Processes an interpreted action from the current strategy step.
   * @param {World} world
   * @param {import("../../../utils/globalTypes").BuildOrderStep | StrategyStep} rawStep
   * @param {number} step
   * @param {import('../../../utils/globalTypes').InterpretedAction} interpretedAction
   * @param {StrategyManager} strategyManager
   * @param {SC2APIProtocol.ActionRawUnitCommand[]} actionsToPerform
   * @param {number} currentCumulativeCount The current cumulative count of the unit type up to this step.
   * @param {number} actionIndex The index of the current interpreted action in the rawStep.
   */
  processInterpretedAction(
    world,
    rawStep,
    step,
    interpretedAction,
    strategyManager,
    actionsToPerform,
    currentCumulativeCount,
    actionIndex
  ) {
    const unitType = interpretedAction.unitType?.toString() || "default";

    if (
      StrategyManager.handleStepCompletion(
        world,
        rawStep,
        unitType,
        currentCumulativeCount,
        interpretedAction,
        strategyManager,
        actionIndex
      )
    ) {
      return;
    }

    this.handlePlanStep(
      world,
      rawStep,
      step,
      interpretedAction,
      actionsToPerform,
      currentCumulativeCount
    );
  }

  /**
   * Processes all steps in the strategy plan.
   * @param {World} world - The game world context.
   * @param {import("../../../utils/globalTypes").BuildOrder | Strategy} plan - The strategy plan to execute.
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
   * @param {SC2APIProtocol.ActionRawUnitCommand[]} actionsToPerform The array of actions to be performed.
   */
  processRegularAction(world, planStep, step, actionsToPerform) {
    if (!this.strategyContext) {
      console.error(
        "strategyContext is undefined, unable to set current step and perform actions."
      );
      return;
    }

    this.strategyContext.setCurrentStep(step);
    const stepActions = this.performPlanStepActions(world, planStep);
    if (stepActions && stepActions.length > 0) {
      actionsToPerform.push(...stepActions);
    }
  }

  /**
   * Processes each step of the strategy plan.
   * @param {World} world
   * @param {import("../../../utils/globalTypes").BuildOrderStep | StrategyStep} rawStep
   * @param {number} step
   * @param {StrategyManager} strategyManager
   * @param {SC2APIProtocol.ActionRawUnitCommand[]} actionsToPerform
   */
  processStep(world, rawStep, step, strategyManager, actionsToPerform) {
    const interpretedActions = StrategyData.getInterpretedActions(rawStep);
    if (!interpretedActions) return;

    const stepWithStatus = /** @type {import("../../../utils/globalTypes").BuildOrderStep & { interpretedActionsStatus?: boolean[], completed?: boolean }} */ (
      rawStep
    );

    if (!stepWithStatus.interpretedActionsStatus) {
      stepWithStatus.interpretedActionsStatus = new Array(
        interpretedActions.length
      ).fill(false);
    }

    for (let i = 0; i < interpretedActions.length; i++) {
      const interpretedAction = interpretedActions[i];
      const unitType = interpretedAction.unitType
        ? interpretedAction.unitType.toString()
        : "default";
      const currentCumulativeCount = this.getCumulativeCount(unitType);

      this.updateCumulativeCount(unitType, interpretedAction.count || 0);

      if (!stepWithStatus.interpretedActionsStatus[i]) {
        this.processInterpretedAction(
          world,
          rawStep,
          step,
          interpretedAction,
          strategyManager,
          actionsToPerform,
          currentCumulativeCount,
          i
        );
      }
    }

    stepWithStatus.completed = stepWithStatus.interpretedActionsStatus.every(
      (status) => status
    );
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
   * Resets the strategy data to a new instance.
   */
  resetStrategyData() {
    this.strategyData = new StrategyData();
  }

  /**
   * Execute the game plan and return the actions to be performed.
   * @param {World} world
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions to be performed.
   */
  runPlan(world) {
    const { agent, data } = world;
    const { race } = agent;
    const specificBuildOrderKey = getBuildOrderKey();

    if (!validateResources(agent)) {
      console.error("Insufficient resources to run the plan.");
      return [];
    }

    const strategyManager = StrategyManager.getInstance(
      race,
      specificBuildOrderKey
    );
    if (!strategyManager) {
      console.error("Failed to retrieve or initialize StrategyManager.");
      return [];
    }

    resetEarmarks(data);
    const gameState = GameState.getInstance();
    gameState.pendingFood = 0;

    if (!this.strategyContext) {
      console.error("strategyContext is undefined");
      return [];
    }

    const plan = this.strategyContext.getCurrentStrategy();
    if (!plan || !isValidPlan(plan)) {
      console.error("Invalid or undefined strategy plan");
      return [];
    }

    return this.executeStrategyPlan(world, plan, strategyManager);
  }

  /**
   * Selects a build order key based on race and possibly other criteria.
   * If a specific build order key is provided, it uses that key; otherwise, it selects randomly.
   * @param {SC2APIProtocol.Race | undefined} race
   * @param {string | undefined} specificBuildOrderKey - Optional specific build order key for debugging.
   * @returns {string}
   */
  static selectBuildOrderKey(
    race,
    specificBuildOrderKey = undefined
  ) {
    if (race === undefined) {
      throw new Error("Race must be provided");
    }
    if (specificBuildOrderKey !== undefined) {
      return specificBuildOrderKey;
    }
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

    if (!raceKey) {
      throw new Error(`Race key for race ${race} not found`);
    }

    const raceBuildOrders = buildOrders[raceKey];
    if (!raceBuildOrders) {
      throw new Error(`Build orders for race ${raceKey} not found`);
    }

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
   * @param {import('../../../utils/globalTypes').BuildOrderStep | StrategyStep} rawStep - The step data.
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

    if (this.loggedDelays) {
      this.loggedDelays.delete(delayKey);
    }
    return false;
  }

  /**
   * Updates the cumulative count for a given unit type.
   * @param {string} unitType The unit type identifier.
   * @param {number} count The count to add to the cumulative count.
   */
  updateCumulativeCount(unitType, count) {
    this.cumulativeCounts[unitType] =
      (this.cumulativeCounts[unitType] || 0) + count;
  }
}

module.exports = StrategyManager;

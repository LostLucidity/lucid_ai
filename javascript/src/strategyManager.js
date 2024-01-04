// strategyManager.js
"use strict";

const { Race } = require("@node-sc2/core/constants/enums");

// Import build orders for each race
/** @type {import("./utils/globalTypes").BuildOrders} */
const buildOrders = require('./buildOrders');
const { interpretBuildOrderAction } = require("./buildOrders/buildOrderUtils");
const GameState = require("./gameState");
const { calculateTargetCountForStep, sharedData } = require("./utils/intermediaryUtils");
const { getSingletonInstance } = require("./utils/singletonFactory");
const { isBuildOrderStep } = require("./utils/typeGuards");

/**
 * @typedef {Object} StrategyStep
 * @property {string} supply
 * @property {string} time
 * @property {string} action
 * @property {import("./utils/globalTypes").InterpretedAction} [interpretedAction] - Optional property for interpreted action details
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
   * @type {StrategyManager | null}
   * @private
   */
  static instance = null;

  /**
   * @type {SC2APIProtocol.Race | undefined}
   */
  race;

  /**
   * @param {SC2APIProtocol.Race | undefined} race
   */
  constructor(race) {
    if (StrategyManager.instance) {
      return StrategyManager.instance;
    }
    StrategyManager.instance = this;
    this.race = race;

    try {
      // Select a build order based on some criteria
      const buildOrderKey = this.selectBuildOrderKey(race);

      // Dynamically load the strategy
      /** @type {import("./utils/globalTypes").BuildOrder | Strategy | undefined} */
      this.currentStrategy = this.loadStrategy(race, buildOrderKey);
    } catch (error) {
      console.error(`Error loading strategy for ${race}:`, error);
    }

    this.currentStep = -1;
    /** @type {boolean} Indicates whether the bot is currently outpowered by the opponent. */
    this.outpowered = false;
    /** @type {{ [key: string]: number }} Minimum thresholds or requirements for the plan. */
    this.planMin = {}; // Initialize planMin as an empty object or with default values
    /**
     * The type of unit currently selected for training.
     * @type {number|null}
     */    
    this.selectedTypeToBuild = null;
    /** @type {number[]} Types of units currently being trained. */
    this.trainingTypes = [];
    /** @type {{ [key: string]: number }} Maximum thresholds or limits for unit types. */
    this.unitMax = {}; // Initialize unitMax as an empty object or with default values
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
   * Get the current strategy's build order.
   * @param {World} world
   * @returns {import('./utils/globalTypes').BuildOrder}
   */
  getBuildOrderForCurrentStrategy(world) {
    const strategyManager = StrategyManager.getInstance(world.agent.race);
    const currentStrategy = strategyManager.getCurrentStrategy();

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

  // Getters and setters for the properties
  getOutpowered() {
    return this.outpowered;
  }

  /**
   * Initializes the strategy for the given race.
   * @param {SC2APIProtocol.Race | undefined} race - The race for which to initialize the strategy.
   */
  initializeStrategy(race) {
    if (this.race === undefined) {
      this.race = race;
    }
    try {
      const buildOrderKey = this.selectBuildOrderKey(race);
      this.currentStrategy = this.loadStrategy(race, buildOrderKey);
    } catch (error) {
      console.error(`Error loading strategy for ${race}:`, error);
    }
  }

  /**
   * Check if the step conditions are satisfied.
   * @param {World} world
   * @param {import('./utils/globalTypes').BuildOrderStep | StrategyStep} step
   * @returns {boolean}
   */
  isStepSatisfied(world, step) {
    const gameState = GameState.getInstance();
    const agent = world.agent;

    let interpretedAction = step.interpretedAction;
    if (!interpretedAction) {
      // Provide a default value of an empty string if step.comment is undefined
      let comment = '';

      // Use the custom type guard to check if 'step' is a BuildOrderStep
      if (isBuildOrderStep(step)) {
        comment = step.comment || ''; // Provide a default empty string
      }

      interpretedAction = interpretBuildOrderAction(step.action, comment);
    }

    // Checking for unit production actions
    if (interpretedAction.isUpgrade === false && interpretedAction.unitType !== null) {
      const currentUnitCount = gameState.getUnitCount(world, interpretedAction.unitType);
      const buildOrder = this.getBuildOrderForCurrentStrategy(world); // Retrieve the build order for the current strategy
      const targetCountForStep = calculateTargetCountForStep(step, buildOrder, sharedData.cumulativeTargetCounts);
      return currentUnitCount >= targetCountForStep;
    }

    // Checking for upgrade-related actions
    if (interpretedAction.isUpgrade === true && interpretedAction.upgradeType !== null) {
      return agent.upgradeIds ? agent.upgradeIds.includes(interpretedAction.upgradeType) : false;
    }

    return false;
  }

  /**
   * Dynamically loads a strategy based on race and build order key.
   * @param {SC2APIProtocol.Race | undefined} race
   * @param {string} buildOrderKey
   * @returns {import("./utils/globalTypes").BuildOrder | undefined}
   */
  loadStrategy(race, buildOrderKey) {
    switch (race) {
      case Race.TERRAN:
        return buildOrders.terran[buildOrderKey];
      case Race.PROTOSS:
        return buildOrders.protoss[buildOrderKey];
      case Race.ZERG:
        return buildOrders.zerg[buildOrderKey];
      default:
        throw new Error('Unknown race');
    }
  }

  /**
   * Maps SC2APIProtocol.Race to a specific race key.
   * @param {SC2APIProtocol.Race} race - The race to map.
   * @returns {keyof import("./utils/globalTypes").BuildOrders}
   */
  mapRaceToKey(race) {
    switch (race) {
      case Race.PROTOSS:
        return 'protoss';
      case Race.TERRAN:
        return 'terran';
      case Race.ZERG:
        return 'zerg';
      default:
        throw new Error('Unknown race');
    }
  }

  /**
   * Selects a build order key based on race and possibly other criteria.
   * @param {SC2APIProtocol.Race | undefined} race
   * @returns {string}
   */
  selectBuildOrderKey(race) {
    if (race === undefined) {
      throw new Error('Race must be provided');
    }
    return this.selectRandomBuildOrderKey(race);
  }

  /**
   * Selects a random build order key for a given race.
   * @param {SC2APIProtocol.Race} race - The race for which to select a build order.
   * @returns {string} A randomly selected build order key.
   */
  selectRandomBuildOrderKey(race) {
    const raceKey = this.mapRaceToKey(race);
    const raceBuildOrders = buildOrders[raceKey];

    if (!raceBuildOrders) {
      // Handle the case where the raceBuildOrders is undefined
      // This could be throwing an error or choosing a default behavior
      throw new Error(`Build orders for race ${raceKey} not found`);
    }

    const buildOrderKeys = Object.keys(raceBuildOrders);
    const randomIndex = Math.floor(Math.random() * buildOrderKeys.length);
    return buildOrderKeys[randomIndex];
  }

  /**
   * Updates the outpowered status of the bot.
   * @param {boolean} status The new outpowered status.
   */
  setOutpowered(status) {
    this.outpowered = status;
  }

  getCurrentStrategy() {
    return this.currentStrategy;
  }

  /**
   * Gets the current step index.
   * @returns {number} The current step index. Returns 0 if undefined.
   */
  getCurrentStep() {
    return this.currentStep !== undefined ? this.currentStep : 0;
  }

  /**
   * @param {number} step
   */
  setCurrentStep(step) {
    this.currentStep = step;
  }

  getTrainingTypes() {
    return this.trainingTypes;
  }

  /**
   * @param {number[]} types
   */
  setTrainingTypes(types) {
    this.trainingTypes = types;
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
   * Selects a type of unit to build based on current resources and candidate types.
   * @param {World} world 
   * @param {UnitTypeId[]} candidateTypesToBuild 
   * @returns {UnitTypeId}
   */
  selectTypeToBuild(world, candidateTypesToBuild) {
    const { agent, data } = world;
    const { vespene } = agent;
    if (vespene === undefined) return candidateTypesToBuild[0];
    const filteredTypes = candidateTypesToBuild.filter(type => {
      const { vespeneCost } = data.getUnitTypeData(type);
      return vespeneCost === undefined || vespene > 170 || vespeneCost === 0;
    });
    return filteredTypes[Math.floor(Math.random() * filteredTypes.length)];
  }

}

module.exports = StrategyManager;
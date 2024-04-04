// strategyManager.js
"use strict";

const { Race } = require("@node-sc2/core/constants/enums");

// Import build orders for each race
const config = require("../../../config/config");
const GameState = require("../../core/gameState");
const { calculateTargetCountForStep } = require("../../gameLogic/intermediaryUtils");
const { getSingletonInstance } = require("../../gameLogic/singletonFactory");
const { isBuildOrderStep } = require("../../gameLogic/typeGuards");
/** @type {import("../../utils/globalTypes").BuildOrders} */
const buildOrders = require('../buildOrders');
const { interpretBuildOrderAction } = require("../buildOrders/buildOrderUtils");

/**
 * @typedef {Object} StrategyStep
 * @property {string} supply
 * @property {string} time
 * @property {string} action
 * @property {import("../../utils/globalTypes").InterpretedAction} [interpretedAction] - Optional property for interpreted action details
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
   * @type {number} The current step index in the strategy, initialized to -1 indicating no current step.
   */
  currentStep = -1;  

  /**
   * @param {SC2APIProtocol.Race | undefined} race
   * @param {string | undefined} specificBuildOrderKey - Optional specific build order key for debugging.
   */
  constructor(race, specificBuildOrderKey = undefined) {
    if (StrategyManager.instance) {
      return StrategyManager.instance;
    }
    StrategyManager.instance = this;
    this.race = race;
    this.specificBuildOrderKey = specificBuildOrderKey; // Store the specific build order key

    this.initializeStrategy(race); // Refactor strategy initialization to its own method
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
   * @returns {import('../../utils/globalTypes').BuildOrder}
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
    if (!race) {
      throw new Error("Race must be provided for strategy initialization");
    }
    this.race = race;

    try {
      // Use the debug build order key from configuration if available, otherwise select randomly
      const buildOrderKey = config.debugBuildOrderKey || this.selectBuildOrderKey(race);

      this.currentStrategy = this.loadStrategy(race, buildOrderKey);
    } catch (error) {
      console.error(`Error loading strategy for ${race}:`, error);
    }

    this.currentStep = -1;
    this.outpowered = false;
    this.planMin = {};
    this.selectedTypeToBuild = null;
    /**
     * @type {number[]}
     */
    this.trainingTypes = [];
    this.unitMax = {};
  }


  /**
   * Determines if the current strategy plan has been completed.
   * @returns {boolean} True if the plan is completed, false otherwise.
   */
  isPlanCompleted() {
    if (!this.currentStrategy || !this.currentStrategy.steps || this.currentStrategy.steps.length === 0) {
      // If there's no current strategy, or it has no steps, consider the plan not completed.
      return false;
    }

    // Check if the current step index is beyond the last step in the strategy steps array.
    return this.currentStep >= this.currentStrategy.steps.length;
  }

  /**
   * Check if the step conditions are satisfied.
   * @param {World} world
   * @param {import('../../utils/globalTypes').BuildOrderStep | StrategyStep} step
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
        const buildOrder = this.getBuildOrderForCurrentStrategy(world);

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
   * Dynamically loads a strategy based on race and build order key.
   * @param {SC2APIProtocol.Race | undefined} race
   * @param {string} buildOrderKey
   * @returns {import("../../utils/globalTypes").BuildOrder | undefined}
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

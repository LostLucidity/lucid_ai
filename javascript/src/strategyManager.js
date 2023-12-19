// strategyManager.js
"use strict";

const pvxStalkerColossiBuildOrder = require("./buildOrders/pvxStalkerColossi");

/**
 * @typedef {Object} StrategyStep
 * @property {string} supply - The supply count at this step.
 * @property {string} time - The game time for this step.
 * @property {string} action - The action to be taken at this step.
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
  constructor() {
    if (StrategyManager.instance) {
      return StrategyManager.instance;
    }
    StrategyManager.instance = this;

    this.currentStep = -1;
    // Initialize with default or initial strategy
    this.currentStrategy = pvxStalkerColossiBuildOrder;
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
   * Retrieves the singleton instance of StrategyManager.
   * @returns {StrategyManager} The singleton instance.
   */
  static getInstance() {
    if (!StrategyManager.instance) {
      StrategyManager.instance = new StrategyManager();
    }
    return StrategyManager.instance;
  }

  // Getters and setters for the properties
  getOutpowered() {
    return this.outpowered;
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
   * Sets the current strategy.
   * @param {Strategy} strategy - The strategy to set.
   */  
  setCurrentStrategy(strategy) {
    this.currentStrategy = strategy;
    this.currentStep = 0; // Reset current step when strategy changes
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
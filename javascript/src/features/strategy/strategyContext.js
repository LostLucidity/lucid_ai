class StrategyContext {
  /** @type {number} The current step index in the strategy, initialized to -1 indicating no current step. */
  currentStep = -1;

  /** @type {import("../../core/globalTypes").BuildOrder | import("./strategyManager").Strategy | null | undefined} */
  currentStrategy = null; // Define the type according to your strategy structure.
  
  /** @type {StrategyContext | null} */
  static instance = null;

  /** @type {boolean} */
  outpowered = false; // Default value as false, assuming outpowered is a boolean.

  /** @type {number[]} */
  trainingTypes = []; // Explicitly initialized as an array of numbers here.

  /** @type {import("./strategyManager").StrategyStep[]} */
  strategySteps = []; // Explicitly typed as an array of StrategyStep

  constructor() {
    if (StrategyContext.instance) {
      return StrategyContext.instance;
    }
    this.initialize();
    StrategyContext.instance = this;
  }

  /**
   * Gets the current step index.
   * @returns {number} The current step index. Returns 0 if undefined.
   */
  getCurrentStep() {
    return this.currentStep !== undefined ? this.currentStep : 0;
  }

  getCurrentStrategy() {
    return this.currentStrategy;
  }

  // Getters and setters for the properties
  getOutpowered() {
    return this.outpowered;
  }

  getTrainingTypes() {
    return this.trainingTypes;
  }

  static getInstance() {
    return this.instance || new StrategyContext();
  }

  initialize() {
    this.currentStrategy = null;
    this.strategySteps = [];
    this.trainingTypes = []; // Redundantly initialized here, ensures never undefined.
  }

  /**
   * Selects a type of unit to build based on current resources and candidate types.
   * @param {World} world 
   * @param {UnitTypeId[]} candidateTypesToBuild 
   * @returns {UnitTypeId}
   */
  static selectTypeToBuild(world, candidateTypesToBuild) {
    const { agent, data } = world;
    const { vespene } = agent;
    if (vespene === undefined) return candidateTypesToBuild[0];
    const filteredTypes = candidateTypesToBuild.filter(type => {
      const { vespeneCost } = data.getUnitTypeData(type);
      return vespeneCost === undefined || vespene > 170 || vespeneCost === 0;
    });
    return filteredTypes[Math.floor(Math.random() * filteredTypes.length)];
  }

  /**
   * @param {number} step
   */
  setCurrentStep(step) {
    this.currentStep = step;
  }

  /**
   * @param {import("../../core/globalTypes").BuildOrder | import("./strategyManager").Strategy | undefined} strategy
   */
  setCurrentStrategy(strategy) {
    this.currentStrategy = strategy;
  }

  /**
   * @param {number[]} types
   */
  setTrainingTypes(types) {
    this.trainingTypes = types;
  }

  // Additional necessary methods...
}

module.exports = StrategyContext;

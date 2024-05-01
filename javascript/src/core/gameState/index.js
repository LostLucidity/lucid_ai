//@ts-check
"use strict"

// External library imports from @node-sc2/core
const { UnitType } = require('@node-sc2/core/constants');
const { Alliance, Attribute, Race } = require('@node-sc2/core/constants/enums');
const groupTypes = require('@node-sc2/core/constants/groups');

// Internal module imports
const GasMineManager = require('./GasMineManager');
const cacheManager = require('../../utils/common/cache');
const { missingUnits } = require('../../utils/misc/gameDataStore');
const { defaultResources } = require('../data/gameData');

/** 
 * This module manages shared game state resources.
 */

/** @type {Map<number, Point2D>} */
const buildingPositions = new Map();

/** @type {{foodUsed: number}} */
const foodData = {
  foodUsed: 12,
};

// Assuming `gasMineManager` is instantiated and available in this context
const gasMineManager = new GasMineManager();

/**
 * Function or methods to manipulate buildingPositions and other shared resources
 * can be added here. For example:
 */

/**
 * Sets a new building position.
 * @param {number} key Key to identify the building position.
 * @param {Point2D} position Array of positions for the building.
 */
function setBuildingPosition(key, position) {
  buildingPositions.set(key, position);
}

/**
 * Retrieves building positions based on the key.
 * @param {number} key Key to identify the building position.
 * @returns {Point2D | undefined} Array of positions for the building or undefined.
 */
function getBuildingPosition(key) {
  return buildingPositions.get(key);
}

/**
 * Class representing the game state.
 * It maintains and manages various game-related data such as resources, unit statuses, etc.
 */
class GameState {
  /**
   * Private static property to hold the Singleton instance.
   * It should be null initially and set to a GameState instance upon the first call to getInstance.
   * @type {GameState | null}
   */
  static #instance = null;

  /**
   * A map to cache the availability of production units.
   * @type {Map<number, boolean>}
   */
  availableProductionUnits = new Map();

  /**
   * The armor upgrade level for enemy units.
   * @type {number}
   */
  enemyArmorUpgradeLevel = 0;

  /**
   * Indicates whether the enemy Zealot has the charge upgrade.
   * @type {boolean}
   */
  enemyCharge = false;

  /**
   * @type {number} Tracks the total food used in the game.
   * Initialized to 0.
   */
  foodUsed = 0;

  framesPerStep = 1

  /**
   * A map to cache the results of tech availability checks.
   * @type {Map<number, boolean>}
   */
  hasTechFor = new Map();

  /**
   * @type {GameState | null} Singleton instance of the GameState.
   */
  static instance = null;  

  /**
   * The plan consisting of a sequence of PlanStep objects.
   * @type {import('../../features/strategy/strategyManager').PlanStep[]}
   */
  plan = [];

  /**
   * Stores the previous game loop number to calculate the frames per step.
   * @type {number}
   */
  previousGameLoop = 0;

  /**
   * @type {SC2APIProtocol.Race | null}
   */
  race = null;

  /**
   * @type {import('../data/gameData').Resources} - Typing the resources property using JSDoc comment
   */
  resources = defaultResources;

  /**
   * The armor upgrade level for the player's (self) units.
   * @type {number}
   */
  selfArmorUpgradeLevel = 0;

  setEarmark = false;

  /**
   * Stores the starting unit counts. The keys are unit type identifiers (numbers),
   * and the values are counts (numbers) for each unit type at the start of the game.
   * @type {Record<number, number>}
   */
  startingUnitCounts = {};

  /**
   * A map of unit types to their corresponding units and frame information.
   * @type {Map<number, { units: Unit[]; frame: number; }>}
   */
  unitsById = new Map();

  /**
   * Constructor for the GameState class.
   * Initializes various game state properties.
   */
  constructor() {
    if (GameState.#instance) {
      throw new Error("Instantiation failed: Use GameState.getInstance() instead of new.");
    }
    this.calculateTimeToFinishStructureFn = (/** @type {DataStorage} */ _data, /** @type {Unit} */ _unit) => {
      // Since '_data' and '_unit' are unused in this default implementation, they are prefixed with an underscore.
      // Return a safe default value that suits the expected functionality of the real implementation.
      return 0;
    };

    /**
     * A map of unit types to arrays of related unit types.
     * This is used for grouping together related unit types, such as a building and its flying version.
     * @type {Map<number, number[]>}
     */
    this.countTypes = new Map();
    /**
     * The attack upgrade level for the enemy alliance.
     * @type {number}
     */
    this.enemyAttackUpgradeLevel = 0;

    /** @type {(unit: Unit) => SC2APIProtocol.UnitOrder[]} */
    this.getPendingOrdersFn = (_) => [];

    this.pendingFood = 0;
    this.previousGameLoop = 0;
    this.resources = defaultResources;
    /**
     * The attack upgrade level for the self alliance.
     * @type {number}
     */
    this.selfAttackUpgradeLevel = 0;
    this.unitStatuses = {};
    this.initCountTypes();
    this.initMorphMapping();
    this.enemyMetabolicBoost = false;
  }

  /**
   * Dynamically calculates the number of frames per step based on the change in game loop number.
   * 
   * @param {World} world - The game world context.
   * @returns {number} The number of frames processed in each game step.
   */
  calculateFramesPerStep(world) {
    const currentGameLoop = this.getCurrentGameLoop(world);
    const framesPerStep = this.getFramesPerStep();

    this.previousGameLoop = currentGameLoop;
    return framesPerStep;
  }

  /**
   * Calculates the total count of orders and pending orders for a specific unit type based on the given ability ID.
   * This function checks both current and pending orders across all units and adds to the count based on conditions.
   * If the unit type is a Zergling and the order relates to training Zerglings, the count is doubled due to how
   * Zerglings are trained in pairs.
   * 
   * @param {Unit[]} units - An array of units to examine for current and pending orders.
   * @param {number} abilityId - The ability ID to filter orders by. This should correspond to the creation or training of the unit.
   * @param {UnitTypeId} unitType - The unit type to check, which affects counting (e.g., Zerglings are counted as pairs).
   * @returns {number} The total number of units including those currently in orders and pending orders adjusted for unit type specifics.
   */
  calculateOrderCounts(units, abilityId, unitType) {
    return units.reduce((count, unit) => {
      const ordersCount = unit.orders ? unit.orders.filter(order => order.abilityId === abilityId).length : 0;
      const pendingOrdersCount = this.getPendingOrdersFn(unit).filter(pendingOrder => pendingOrder.abilityId === abilityId).length;
      return count + ordersCount + pendingOrdersCount * (unitType === UnitType.ZERGLING ? 2 : 1);
    }, 0);
  }

  /**
   * Checks if there are available production units for a given unit type.
   * @param {number} unitType - The type of unit to check.
   * @returns {boolean} - True if there are available production units.
   */
  checkProductionAvailability(unitType) {
    return this.availableProductionUnits.get(unitType) || false;
  }

  /**
   * @description Cache the result of agent.hasTechFor() to avoid unnecessary calls to the game.
   * @param {Agent} agent
   * @param {number} unitType
   * @returns {boolean | undefined}
   **/
  checkTechFor(agent, unitType) {
    if (this.hasTechFor.has(unitType)) {
      return this.hasTechFor.get(unitType);
    }
    const hasTechFor = agent.hasTechFor(unitType);
    this.hasTechFor.set(unitType, hasTechFor);
    return hasTechFor;
  }

  /**
   * Retrieves the armor upgrade level based on the alliance of the unit.
   * @param {Alliance} alliance - The alliance of the unit (SELF, NEUTRAL, ENEMY).
   * @returns {number} - The armor upgrade level of the unit.
   */
  getArmorUpgradeLevel(alliance) {
    switch (alliance) {
      case Alliance.SELF:
        // Return self alliance armor upgrade level
        return this.selfArmorUpgradeLevel; // Assuming this is a property of the class
      case Alliance.ENEMY:
        // Return enemy alliance armor upgrade level
        return this.enemyArmorUpgradeLevel; // Assuming this is a property of the class
      default:
        // Default to 0 if the alliance is not SELF or ENEMY
        return 0;
    }
  }

  /**
   * Retrieves the attack upgrade level based on the alliance.
   * @param {Alliance} alliance The alliance to check the upgrade level for.
   * @returns {number} The attack upgrade level.
   */
  getAttackUpgradeLevel(alliance) {
    let attackUpgradeLevel = 0;
    if (alliance === Alliance.SELF) {
      attackUpgradeLevel = this.selfAttackUpgradeLevel;
    } else if (alliance === Alliance.ENEMY) {
      attackUpgradeLevel = this.enemyAttackUpgradeLevel;
    }
    return attackUpgradeLevel;
  }

  /**
   * Retrieves the building type associated with a specific step number.
   * @param {number} stepNumber - The step number in the building plan.
   * @returns {number | undefined} - The building type (as a unit type ID), or undefined if not found.
   */
  getBuildingTypeByStepNumber(stepNumber) {
    if (stepNumber < 0 || stepNumber >= this.plan.length) {
      console.warn("Step number out of range");
      return undefined;
    }

    const planStep = this.plan[stepNumber];

    // Assuming each plan step has a property 'unitType' that stores the building type
    return planStep.unitType; // Replace with actual logic based on your plan structure
  }

  /**
   * Retrieves the current game loop number from the world context.
   * 
   * @param {World} world - The game world context.
   * @returns {number} The current game loop number.
   */
  getCurrentGameLoop(world) {
    return world.resources.get().frame.getGameLoop();
  }

  /**
   * Get the amount of food used.
   * @returns {number}
   */
  getFoodUsed() {
    // Assuming 'this.resources' has a property 'foodUsed' that keeps track of the food used.
    return this.resources.foodUsed;
  }

  /**
   * Gets the latest calculated frames per step value.
   * 
   * @returns {number} The number of frames processed in the last game step.
   */
  getFramesPerStep() {
    return this.framesPerStep;
  }

  /**
   * The static method that controls the access to the singleton instance.
   * @returns {GameState} The singleton instance of the GameState class.
   */
  static getInstance() {
    if (!GameState.#instance) {
      GameState.#instance = new GameState();
    }
    return GameState.#instance;
  }

  /**
   * Get the starting unit count for a given unit type.
   * @param {number} unitType - The type of unit.
   * @returns {number} - The starting count of units of the specified type.
   */
  getStartingUnitCount(unitType) {
    return this.startingUnitCounts[unitType] || 0;
  }

  /**
   * Retrieves the race of the player or AI.
   * @returns {SC2APIProtocol.Race | null}
   */
  getRace() {
    return this.race;
  }

  /**
   * Retrieves worker units for the given race from the cache.
   * @param {World} world
   * @returns {Unit[]}
   */
  getWorkers(world) {
    const { agent, resources } = world;
    const { race } = agent;
    if (race === undefined) return [];

    const workerType = groupTypes.workerTypes[race];
    const currentFrame = resources.get().frame.getGameLoop();
    const cachedWorkers = cacheManager.getDataIfCurrent(workerType, currentFrame);

    if (cachedWorkers) {
      return cachedWorkers;
    } else {
      // Fetch and update cache if not current
      const newWorkers = resources.get().units.getById(workerType);
      cacheManager.updateCache(workerType, newWorkers, currentFrame);
      return newWorkers;
    }
  }

  /**
   * Initialize the starting unit counts based on the player's race.
   * @param {SC2APIProtocol.Race} race - The player's race.
   */
  initializeStartingUnitCounts(race) {
    switch (race) {
      case Race.TERRAN:
        this.startingUnitCounts = {
          [UnitType.SCV]: 12,
          [UnitType.COMMANDCENTER]: 1,
          // Add other Terran-specific unit types if necessary
        };
        break;
      case Race.PROTOSS:
        this.startingUnitCounts = {
          [UnitType.PROBE]: 12,
          [UnitType.NEXUS]: 1,
          // Add other Protoss-specific unit types if necessary
        };
        break;
      case Race.ZERG:
        this.startingUnitCounts = {
          [UnitType.DRONE]: 12,
          [UnitType.HATCHERY]: 1,
          [UnitType.OVERLORD]: 1,
          // Add other Zerg-specific unit types if necessary
        };
        break;
      default:
        this.startingUnitCounts = {};
        console.warn(`Unknown race: ${race}`);
    }
  }

  /**
   * Injects external functionalities into the GameState.
   * @param {Object} dependencies - The external functionalities to inject.
   * @param {(unit: Unit) => SC2APIProtocol.UnitOrder[]} dependencies.getPendingOrders - Function to get pending orders.
   * @param {(_data: DataStorage, _unit: Unit) => number} dependencies.calculateTimeToFinishStructure - Function to calculate time to finish a structure.
   */
  injectDependencies({ getPendingOrders, calculateTimeToFinishStructure }) {
    this.getPendingOrdersFn = getPendingOrders;
    this.calculateTimeToFinishStructureFn = calculateTimeToFinishStructure;
  }

  /**
   * Set available expansions.
   * @param {Expansion[]} expansions
   */
  setAvailableExpansions(expansions) {
    this.availableExpansions = expansions;
  }

  /**
   * Retrieves units with specific current orders.
   * 
   * @param {Unit[]} units - An array of units to filter.
   * @param {AbilityId[]} abilityIds - An array of ability IDs to filter units by.
   * @returns {Unit[]} An array of units with the specified current orders.
   */
  getUnitsWithCurrentOrders(units, abilityIds) {
    /** @type {Unit[]} */
    const unitsWithCurrentOrders = [];

    abilityIds.forEach(abilityId => {
      units.forEach(unit => {
        if (unit.orders && unit.orders.some(order => order.abilityId === abilityId)) {
          unitsWithCurrentOrders.push(unit);
        }
      });
    });

    // Remove duplicates
    return Array.from(new Set(unitsWithCurrentOrders));
  }

  initMorphMapping() {
    const { HELLION, HELLIONTANK, ROACH, RAVAGER, HYDRALISK, LURKERMPBURROWED, SIEGETANK, SIEGETANKSIEGED, WIDOWMINE, WIDOWMINEBURROWED, VIKINGFIGHTER, VIKINGASSAULT, ZERGLING, BANELING, BANELINGCOCOON } = UnitType;
    this.morphMapping = new Map([
      [HELLION, [HELLION, HELLIONTANK]],
      [ROACH, [ROACH, RAVAGER]],
      [HYDRALISK, [HYDRALISK, LURKERMPBURROWED]],
      [SIEGETANK, [SIEGETANK, SIEGETANKSIEGED]],
      [WIDOWMINE, [WIDOWMINE, WIDOWMINEBURROWED]],
      [VIKINGFIGHTER, [VIKINGFIGHTER, VIKINGASSAULT]],
      [ZERGLING, [ZERGLING, BANELING, BANELINGCOCOON]],
    ]);
  }

  /**
   * Initializes the countTypes map with mappings of unit types.
   */
  initCountTypes() {
    this.countTypes = new Map([
      [UnitType.BARRACKS, [UnitType.BARRACKS, UnitType.BARRACKSFLYING]],
      [UnitType.COMMANDCENTER, [UnitType.COMMANDCENTER, UnitType.COMMANDCENTERFLYING, UnitType.ORBITALCOMMAND, UnitType.ORBITALCOMMANDFLYING]],
      [UnitType.CREEPTUMORQUEEN, [UnitType.CREEPTUMORBURROWED]],
      [UnitType.FACTORY, [UnitType.FACTORY, UnitType.FACTORYFLYING]],
      [UnitType.GATEWAY, [UnitType.GATEWAY, UnitType.WARPGATE]],
      [UnitType.HATCHERY, [UnitType.HATCHERY, UnitType.LAIR]],
      [UnitType.ORBITALCOMMAND, [UnitType.ORBITALCOMMAND, UnitType.ORBITALCOMMANDFLYING]],
      [UnitType.REACTOR, [UnitType.REACTOR, UnitType.BARRACKSREACTOR, UnitType.FACTORYREACTOR, UnitType.STARPORTREACTOR]],
      [UnitType.STARPORT, [UnitType.STARPORT, UnitType.STARPORTFLYING]],
      [UnitType.SUPPLYDEPOT, [UnitType.SUPPLYDEPOT, UnitType.SUPPLYDEPOTLOWERED]],
      [UnitType.TECHLAB, [UnitType.TECHLAB, UnitType.BARRACKSTECHLAB, UnitType.FACTORYTECHLAB, UnitType.STARPORTTECHLAB]],
    ]);
  }

  // Method to get the metabolic boost state
  getEnemyMetabolicBoostState() {
    // Logic to determine if the enemy has metabolic boost
    return this.enemyMetabolicBoost;
  }

  /**
   * @param {DataStorage} data 
   * @returns {AbilityId[]}
   */
  getReactorAbilities(data) {
    const { reactorTypes } = require("@node-sc2/core/constants/groups");

    /** @type {AbilityId[]} */
    const reactorAbilities = [];

    reactorTypes.forEach(type => {
      const abilityId = data.getUnitTypeData(type).abilityId;
      if (abilityId !== undefined) {
        reactorAbilities.push(abilityId);
      }
    });

    return reactorAbilities;
  }

  /**
   * Retrieves ability IDs associated with Tech Labs.
   * 
   * @param {DataStorage} data 
   * @returns {AbilityId[]}
   */
  getTechlabAbilities(data) {
    const { techLabTypes } = groupTypes;

    /** @type {AbilityId[]} */
    const techlabAbilities = [];

    techLabTypes.forEach(type => {
      const abilityId = data.getUnitTypeData(type).abilityId;
      if (abilityId !== undefined) {
        techlabAbilities.push(abilityId);
      }
    });

    return techlabAbilities;
  }

  /**
   * Sets the building plan.
   * @param {import('../../features/strategy/strategyManager').PlanStep[]} newPlan - The new building plan.
   */
  setPlan(newPlan) {
    this.plan = newPlan;
  }

  /**
   * Sets the availability of production units for a given unit type.
   * @param {number} unitType - The type of unit.
   * @param {boolean} available - Whether the unit type is available for production.
   */
  setProductionAvailability(unitType, available) {
    this.availableProductionUnits.set(unitType, available);
  }

  /**
   * Sets the race of the player or AI.
   * @param {SC2APIProtocol.Race} newRace - The race to be set.
   */
  setRace(newRace) {
    this.race = newRace;
  }

  reset() {
    this.unitStatuses = {}; // Reset unit statuses
    this.enemyCharge = false; // Reset enemyCharge
    // Reset countTypes to an empty map
    this.countTypes = new Map();
  }

  /**
   * Update the food used based on the world state.
   * @param {World} world - The current world state.
   */
  setFoodUsed(world) {
    const { agent } = world;
    const { foodUsed, race } = agent;
    if (foodUsed === undefined) { return 0; }
    const pendingFoodUsed = race === Race.ZERG ? this.getWorkers(world).filter(worker => worker.isConstructing()).length : 0;
    const calculatedFoodUsed = foodUsed + this.pendingFood - pendingFoodUsed;
    foodData.foodUsed = calculatedFoodUsed;
  }

  // Method to update the metabolic boost state
  /**
   * @param {boolean} hasBoost
   */
  updateEnemyMetabolicBoostState(hasBoost) {
    this.enemyMetabolicBoost = hasBoost;
  }

  /**
   * Retrieves ability IDs for unit addons.
   * 
   * @param {DataStorage} data - The data storage context.
   * @param {UnitTypeId} unitType - The unit type ID for which to retrieve ability IDs.
   * @returns {AbilityId[]} An array of ability IDs.
   */
  getAbilityIdsForAddons(data, unitType) {
    let { abilityId } = data.getUnitTypeData(unitType);
    let abilityIds = [];

    if (abilityId === 1674) { // Assuming this is the ID for a reactor
      abilityIds.push(...this.getReactorAbilities(data));
    } else if (abilityId === 1666) { // Assuming this is the ID for a tech lab
      abilityIds.push(...this.getTechlabAbilities(data));
    } else if (abilityId !== undefined) {
      abilityIds.push(abilityId);
    }

    return abilityIds;
  }

  /**
   * Calculates the total number of units of a specified type, including those currently in production,
   * hidden inside structures, or otherwise unaccounted for in standard tracking.
   * @param {World} world - The world context containing game data and resources.
   * @param {UnitTypeId} unitType - The type of the unit to count.
   * @returns {number} Total count of the specified unit type.
   */
  getUnitCount(world, unitType) {
    const { data, resources } = world;
    const { units } = resources.get();
    const unitData = data.getUnitTypeData(unitType);

    if (!unitData || !unitData.abilityId) {
      return 0; // Exit early if critical unit data is missing
    }

    if (unitData.attributes && unitData.attributes.includes(Attribute.STRUCTURE)) {
      // Directly return the count of structural units
      return this.getUnitTypeCount(world, unitType);
    }

    // Handle morphing efficiently
    const morphedTypes = this.morphMapping ? this.morphMapping.get(unitType) : undefined;
    const unitTypes = morphedTypes ? [unitType, ...morphedTypes] : [unitType];

    const existingUnits = units.getById(unitTypes).length;
    const unitsInProduction = this.calculateOrderCounts(units.getAll(Alliance.SELF), unitData.abilityId, unitType);

    // Count only relevant units inside structures
    const insideStructureCount = (unitType === UnitType.SCV || unitType === UnitType.DRONE || unitType === UnitType.PROBE)
      ? gasMineManager.countWorkersInsideGasMines(world)
      : 0;

    const missingUnitsCount = (missingUnits || []).filter(unit => unit.unitType === unitType).length;

    // Sum and return all counts
    return existingUnits + unitsInProduction + insideStructureCount + missingUnitsCount;
  }

  /**
   * Retrieves and counts units of a specific type.
   * 
   * @param {World} world - The game world context.
   * @param {UnitTypeId} unitType - The unit type ID to count.
   * @returns {number} The count of units of the specified type.
   */
  getUnitTypeCount(world, unitType) {
    const { agent, data, resources } = world;
    const unitResource = resources.get().units;
    const unitArray = unitResource.getAll(); // Adjust as needed
    const abilityIds = this.getAbilityIdsForAddons(data, unitType);
    const unitsWithCurrentOrders = this.getUnitsWithCurrentOrders(unitArray, abilityIds);
    let count = unitsWithCurrentOrders.length;

    const unitTypes = this.countTypes.get(unitType) || [unitType];

    unitTypes.forEach(type => {
      let unitsToCount = unitArray.filter(unit => unit.unitType === type);
      if (agent.race === Race.TERRAN) {
        const completed = type === UnitType.ORBITALCOMMAND ? 0.998 : 1;
        unitsToCount = unitsToCount.filter(unit => (unit.buildProgress || 0) >= completed);
      }
      count += unitsToCount.length;
    });

    return count;
  }

  /**
   * Determines whether to premove a unit based on resource availability and specific game conditions.
   * 
   * @param {World} world
   * @param {number} timeToTargetCost 
   * @param {number} timeToPosition 
   * @returns {boolean}
   */
  shouldPremoveNow(world, timeToTargetCost, timeToPosition) {
    const { PYLON } = UnitType;
    const { agent, data, resources } = world;
    const { units } = resources.get();
    const willHaveEnoughMineralsByArrival = timeToTargetCost <= timeToPosition;

    if (agent.race === Race.PROTOSS) {
      const pylons = units.getById(PYLON);
      if (pylons.length === 1) {
        const [pylon] = pylons;
        // Check if buildProgress is defined before comparing
        if (pylon.buildProgress !== undefined && pylon.buildProgress < 1) {
          const timeToFinish = this.calculateTimeToFinishStructureFn(data, pylon);
          return willHaveEnoughMineralsByArrival && timeToFinish <= timeToPosition;
        }
      }
    }
    return willHaveEnoughMineralsByArrival;
  }

  /**
   * Updates the game state for each game loop, including calculating frames per step.
   * 
   * @param {World} world - The game world context.
   */
  updateGameState(world) {
    const currentGameLoop = world.resources.get().frame.getGameLoop();
    this.framesPerStep = currentGameLoop - this.previousGameLoop;

    // Update previousGameLoop for the next cycle
    this.previousGameLoop = currentGameLoop;

    // Ensure framesPerStep is always at least 1
    this.framesPerStep = Math.max(1, this.framesPerStep);
  }

  /**
   * Verify if the starting unit counts match the actual game state.
   * @param {World} world - The game world context.
   */
  verifyStartingUnitCounts(world) {
    // Access the current game frame
    const currentFrame = world.resources.get().frame.getGameLoop();

    // Check if it's the first frame
    if (currentFrame !== 0) {
      console.warn('verifyStartingUnitCounts called after the first frame');
      return;
    }

    /** @type {{ [key: number]: number }} */
    const actualUnitCounts = {};
    const units = world.resources.get().units.getAll();

    // Count actual units in the first game frame
    units.forEach(unit => {
      const unitTypeId = unit.unitType;
      if (typeof unitTypeId !== 'undefined') {
        actualUnitCounts[unitTypeId] = (actualUnitCounts[unitTypeId] || 0) + 1;
      }
    });

    // Compare actualUnitCounts with the hardcoded startingUnitCounts
    Object.keys(this.startingUnitCounts).forEach(unitTypeKey => {
      const unitType = parseInt(unitTypeKey, 10); // Convert string key back to number
      const expectedCount = this.startingUnitCounts[unitType];
      const actualCount = actualUnitCounts[unitType] || 0;

      if (actualCount !== expectedCount) {
        console.warn(`Discrepancy for unit type ${unitType}: Expected ${expectedCount}, Found ${actualCount}`);
      }
    });
  }
}

// Exports
module.exports = {
  GameState,
  buildingPositions,
  getBuildingPosition,
  setBuildingPosition,
}
//@ts-check
"use strict"

// External library imports from @node-sc2/core
const { UnitType, Ability } = require('@node-sc2/core/constants');
const { Alliance, Attribute, Race } = require('@node-sc2/core/constants/enums');
const groupTypes = require('@node-sc2/core/constants/groups');

// Internal module imports
const { calculateTimeToFinishStructure } = require('./buildingUtils');
const { missingUnits } = require('./gameDataStore');
const { currentStep } = require('./gameStateResources');

/**
 * Class representing the game state.
 * It maintains and manages various game-related data such as resources, unit statuses, etc.
 */
class GameState {
  /** @type {any[][]} */
  static legacyPlan = [];

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
   * The plan consisting of a sequence of PlanStep objects.
   * @type {import("../interfaces/plan-step").PlanStep[]}
   */
  plan = [];

  /**
   * The armor upgrade level for the player's (self) units.
   * @type {number}
   */
  selfArmorUpgradeLevel = 0;  

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
    this.pendingFood = 0;
    this.resources = {};
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
   * Get the amount of food used.
   * @returns {number}
   */
  getFoodUsed() {
    // Assuming 'this.resources' has a property 'foodUsed' that keeps track of the food used.
    return this.resources.foodUsed;
  }

  /**
   * Gets the food value of the current step in the plan.
   * @returns {number}
   */
  getPlanFoodValue() {
    if (this.plan.length === 0 || currentStep >= this.plan.length) {
      console.error('Plan is empty or current step is out of range.');
      return 0;
    }
    return this.plan[currentStep].food;
  }  

  /**
   * Set available expansions.
   * @param {Expansion[]} expansions
   */
  setAvailableExpansions(expansions) {
    this.availableExpansions = expansions;
  }  

  /**
   * Converts a legacy plan into the current plan format.
   * @param {any[]} legacyPlan - The legacy plan to convert.
   * @returns {import("../interfaces/plan-step").PlanStep[]}
   */
  convertLegacyPlan(legacyPlan) {
    const trueActions = ['build', 'train', 'upgrade'];
    return legacyPlan.filter(step => {
      return trueActions.includes(step[1]);
    }).map(step => {
      return this.convertLegacyStep(step);
    });
  }

  /**
   * Converts a legacy step to a new step, legacy step is an array of [food, orderType, unitType, targetCount]
   * @param {any[]} trueStep
   * @returns {import("../interfaces/plan-step").PlanStep}
   */
  convertLegacyStep(trueStep) {
    const [food, orderType, itemType, targetCount] = trueStep;
    const step = { food, orderType, targetCount };

    if (orderType === 'upgrade') {
      step.upgrade = itemType;
    } else {
      step.unitType = itemType;
    }

    return step;
  }  

  /**
   * Singleton instance accessor.
   */
  static getInstance() {
    if (!this.instance) {
      this.instance = new GameState();
    }
    return this.instance;
  }  

  reset() {
    this.resources = {}; // Reset resources
    this.unitStatuses = {}; // Reset unit statuses
    this.enemyCharge = false; // Reset enemyCharge
    // Reset countTypes to an empty map
    this.countTypes = new Map();
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

  // Method to update the metabolic boost state
  /**
   * @param {boolean} hasBoost
   */
  updateEnemyMetabolicBoostState(hasBoost) {
    this.enemyMetabolicBoost = hasBoost;
  }

  /**
   * Retrieves units with specific current orders.
   * 
   * @param {Unit[]} units - An array of units to filter.
   * @param {AbilityId[]} abilityIds - An array of ability IDs to filter units by.
   * @returns {Unit[]} An array of units with the specified current orders.
   */
  getUnitsWithCurrentOrders(units, abilityIds) {
    const unitsWithCurrentOrders = [];
    // Assuming 'units' is already an array of alive and self-alliance units

    abilityIds.forEach(abilityId => {
      // Add units with matching current orders
      units.forEach(unit => {
        if (unit.orders && unit.orders.some(order => order.abilityId === abilityId)) {
          unitsWithCurrentOrders.push(unit);
        }
      });
    });

    // Remove duplicates
    return Array.from(new Set(unitsWithCurrentOrders));
  }  

  /**
   * @param {DataStorage} data 
   * @returns {AbilityId[]}
   */
  getReactorAbilities(data) {
    const { reactorTypes } = require("@node-sc2/core/constants/groups");
    const reactorAbilities = [];
    reactorTypes.forEach(type => {
      reactorAbilities.push(data.getUnitTypeData(type).abilityId)
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
    const techlabAbilities = [];
    techLabTypes.forEach(type => {
      techlabAbilities.push(data.getUnitTypeData(type).abilityId)
    });
    return techlabAbilities;
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
   * @param {World} world 
   * @param {UnitTypeId} unitType 
   * @returns {number}
   */
  getUnitCount(world, unitType) {
    const { data, resources } = world;
    const { units } = resources.get();
    const { ZERGLING } = UnitType;
    const { abilityId, attributes } = data.getUnitTypeData(unitType);
    if (abilityId === undefined || attributes === undefined) return 0;
    if (attributes.includes(Attribute.STRUCTURE)) {
      return this.getUnitTypeCount(world, unitType);
    } else {
      let unitTypes = [];
      if (this.morphMapping && this.morphMapping.has(unitType)) {
        unitTypes = this.morphMapping.get(unitType) || [];
      } else {
        unitTypes = [unitType];
      }
      // get orders from units with current orders that match the abilityId
      const orders = units.withCurrentOrders(abilityId).reduce((/** @type {SC2APIProtocol.UnitOrder[]} */ matchingOrders, unit) => {
        const { orders } = unit;
        if (orders === undefined) return matchingOrders;
        orders.forEach(order => {
          if (order.abilityId === abilityId) {
            matchingOrders.push(order);
          }
        });
        return matchingOrders;
      }, []);
      const unitsWithPendingOrders = units.getAlive(Alliance.SELF).filter(u => u['pendingOrders'] && u['pendingOrders'].some((/** @type {SC2APIProtocol.UnitOrder} */ o) => o.abilityId === abilityId));
      /** @type {SC2APIProtocol.UnitOrder[]} */
      const pendingOrders = unitsWithPendingOrders.map(u => u['pendingOrders']).reduce((a, b) => a.concat(b), []);
      const ordersLength = orders.some(order => order.abilityId === Ability.TRAIN_ZERGLING) ? orders.length * 2 : orders.length;
      let pendingOrdersLength = pendingOrders.some(order => order.abilityId === Ability.TRAIN_ZERGLING) ? pendingOrders.length * 2 : pendingOrders.length;
      let totalOrdersLength = ordersLength + pendingOrdersLength;
      if (totalOrdersLength > 0) {
        totalOrdersLength = unitType === ZERGLING ? totalOrdersLength - 1 : totalOrdersLength;
      }
      return units.getById(unitTypes).length + totalOrdersLength + missingUnits.filter(unit => unit.unitType === unitType).length;
    }
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
          const timeToFinish = calculateTimeToFinishStructure(data, pylon);
          return willHaveEnoughMineralsByArrival && timeToFinish <= timeToPosition;
        }
      }
    }
    return willHaveEnoughMineralsByArrival;
  }

}

module.exports = GameState;
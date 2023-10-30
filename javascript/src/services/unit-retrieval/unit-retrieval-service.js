//@ts-check
"use strict";

const { Alliance, Attribute, Race } = require("@node-sc2/core/constants/enums");
const unitService = require("../../../services/unit-service");
const trackUnitsService = require("../../../systems/track-units/track-units-service");
const { getDistance } = require("../../../services/position-service");
const unitResourceService = require("../../../systems/unit-resource/unit-resource-service");
const dataService = require("../../../services/data-service");
const { UnitType } = require("@node-sc2/core/constants");
const { morphMapping, countTypes } = require("../../../helper/groups");
const { TRAIN_ZERGLING } = require("@node-sc2/core/constants/ability");
const { getAbilityIdsForAddons } = require("../shared-utilities/ability-utils");
const groupTypes = require("@node-sc2/core/constants/groups");

class UnitRetrievalService {

  constructor() {
    /** @type {Map<UnitTypeId, Unit[]>} */
    this.productionUnitsCache = new Map();
  }

  /**
  * @param {ResourceManager} resources
  * @param {UnitTypeId[]} unitTypes
  * @returns {Unit[]}
  */
  getById(resources, unitTypes) {
    const { isCurrent } = unitResourceService;
    const { frame, units } = resources.get();
    const currentFrame = frame.getGameLoop();
    return unitTypes.reduce((/** @type {Unit[]} */ unitsById, unitType) => {
      if (!isCurrent(unitType, frame.getGameLoop())) {
        const newUnits = units.getById(unitType);
        unitResourceService.unitsById.set(unitType, { units: newUnits, frame: currentFrame });
      }
      const entry = unitResourceService.unitsById.get(unitType);
      return [...unitsById, ...(entry ? entry.units : [])];
    }, []);
  }  
  
  /**
   * @param {UnitResource} units
   * @returns {Unit[]}
  */
  getGasGeysers(units) {
    return unitResourceService.gasGeysers || (unitResourceService.gasGeysers = units.getGasGeysers());
  }

  /**
   * Retrieves units capable of producing a specific unit type.
   * @param {World} world
   * @param {UnitTypeId} unitTypeId
   * @returns {Unit[]}
   */
  getProductionUnits(world, unitTypeId) {
    const { units } = world.resources.get();
    // Check if the result is in the cache
    if (this.productionUnitsCache.has(unitTypeId)) {
      return this.productionUnitsCache.get(unitTypeId) || [];
    }

    const { abilityId } = world.data.getUnitTypeData(unitTypeId); if (abilityId === undefined) return [];
    let producerUnitTypeIds = world.data.findUnitTypesWithAbility(abilityId);

    if (producerUnitTypeIds.length <= 0) {
      const alias = world.data.getAbilityData(abilityId).remapsToAbilityId; if (alias === undefined) return [];
      producerUnitTypeIds = world.data.findUnitTypesWithAbility(alias);
    }

    const result = units.getByType(producerUnitTypeIds);

    // Store the result in the cache
    this.productionUnitsCache.set(unitTypeId, result);

    return result;
  }
  
  /**
   * @param {UnitResource} units
   * @param {Unit} unit
   * @param {Unit[]} mappedEnemyUnits
   * @param {number} withinRange
   * @returns {Unit[]}
   */
  getSelfUnits(units, unit, mappedEnemyUnits, withinRange = 16) {
    const { pos, tag } = unit; if (pos === undefined || tag === undefined) return [];
    let hasSelfUnits = unitService.selfUnits.has(tag);
    if (!hasSelfUnits) {
      let unitsByAlliance = [];
      if (unit.alliance === Alliance.SELF) {
        unitsByAlliance = trackUnitsService.selfUnits.length > 0 ? trackUnitsService.selfUnits : units.getAlive(Alliance.SELF);
      } else if (unit.alliance === Alliance.ENEMY) {
        unitsByAlliance = mappedEnemyUnits.length > 0 ? mappedEnemyUnits : units.getAlive(Alliance.ENEMY);
      }
      const selfUnits = unitsByAlliance.filter(allyUnit => {
        const { pos: allyPos } = allyUnit; if (allyPos === undefined) return false;
        return getDistance(pos, allyPos) < withinRange;
      });
      unitService.selfUnits.set(tag, selfUnits);
    }
    return unitService.selfUnits.get(tag) || [];
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
      if (morphMapping.has(unitType)) {
        // @ts-ignore
        unitTypes = morphMapping.get(unitType);
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
      const ordersLength = orders.some(order => order.abilityId === TRAIN_ZERGLING) ? orders.length * 2 : orders.length;
      let pendingOrdersLength = pendingOrders.some(order => order.abilityId === TRAIN_ZERGLING) ? pendingOrders.length * 2 : pendingOrders.length;
      let totalOrdersLength = ordersLength + pendingOrdersLength;
      if (totalOrdersLength > 0) {
        totalOrdersLength = unitType === ZERGLING ? totalOrdersLength - 1 : totalOrdersLength;
      }
      return units.getById(unitTypes).length + totalOrdersLength + trackUnitsService.missingUnits.filter(unit => unit.unitType === unitType).length;
    }
  }

  /**
   * Retrieves and counts units of a specific type.
   * 
   * @param {World} world 
   * @param {UnitTypeId} unitType
   * @returns {number}
   */
  getUnitTypeCount(world, unitType) {
    const { agent, data, resources } = world;
    const { units } = resources.get();
    const abilityIds = getAbilityIdsForAddons(data, unitType);
    const unitsWithCurrentOrders = this.getUnitsWithCurrentOrders(units, abilityIds);
    let count = unitsWithCurrentOrders.length;
    const unitTypes = countTypes.get(unitType) ? countTypes.get(unitType) : [unitType];
    unitTypes.forEach(type => {
      let unitsToCount = this.getById(resources, [type])
      if (agent.race === Race.TERRAN) {
        const completed = type === UnitType.ORBITALCOMMAND ? 0.998 : 1;
        unitsToCount = unitsToCount.filter(unit => unit.buildProgress >= completed);
      }
      count += unitsToCount.length;
    });
    return count;
  }

  /**
   * @param {World} world
   * @returns {{unitType: number, timeLeft: number}[]}
   * @description returns unit types that are training, with time left to train
   */
  getUnitsTraining(world) {
    const { getBuildTimeLeft } = unitService;
    const { data, resources } = world;
    const { units } = resources.get();
    const unitsWithOrders = units.getAlive(Alliance.SELF).filter(unit => unit.orders !== undefined && unit.orders.length > 0);
    return unitsWithOrders.reduce((/** @type {{unitType: number, timeLeft: number}[]} */ acc, unit) => {
      const { orders } = unit; if (orders === undefined) return acc;
      /** @type {{abilityId: number | undefined, progress: number | undefined}[]} */
      const mappedOrders = orders.map(order => ({ abilityId: order.abilityId, progress: order.progress }));
      mappedOrders.forEach(({ abilityId, progress }) => {
        if (abilityId === undefined || progress === undefined) return acc;
        const unitType = dataService.unitTypeTrainingAbilities.get(abilityId);
        if (unitType !== undefined) {
          const { attributes, buildTime } = data.getUnitTypeData(unitType); if (attributes === undefined || buildTime === undefined) return acc;
          if (attributes.includes(Attribute.STRUCTURE)) return acc;
          const timeLeft = getBuildTimeLeft(unit, buildTime, progress);
          acc.push({ unitType, timeLeft });
        }
      });
      return acc;
    }, []);
  }

  /**
   * Retrieve units with specific current or pending orders.
   * @param {UnitResource} units
   * @param {AbilityId[]} abilityIds
   * @returns {Unit[]}
   */
  getUnitsWithCurrentOrders(units, abilityIds) {
    const unitsWithCurrentOrders = [];
    const allUnits = units.getAlive(Alliance.SELF);

    abilityIds.forEach(abilityId => {
      // Add units with matching current orders
      unitsWithCurrentOrders.push(...units.withCurrentOrders(abilityId));

      // Add units with matching pending orders
      allUnits.forEach(unit => {
        const pendingOrders = unitService.getPendingOrders(unit);
        if (pendingOrders.some(order => order.abilityId === abilityId)) {
          unitsWithCurrentOrders.push(unit);
        }
      });
    });

    // Remove duplicates
    return Array.from(new Set(unitsWithCurrentOrders));
  }

  /**
   * @param {World} world
   * @returns {Unit[]}
   */
  getWorkers(world) {
    const { agent, resources } = world;
    const { race } = agent; if (race === undefined) return [];
    return this.getById(resources, [groupTypes.workerTypes[race]])
  }  

  resetCache() {
    this.productionUnitsCache.clear();
  }
}

// Export as a singleton, or export the class if you prefer to instantiate it elsewhere
module.exports = new UnitRetrievalService();


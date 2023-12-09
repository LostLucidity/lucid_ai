//@ts-check
"use strict";

const { UnitType, WarpUnitAbility } = require("@node-sc2/core/constants");
const unitService = require("../../services/unit-service");
const { flyingTypesMapping } = require("../../helper/groups");
const { isSupplyNeeded } = require("./supply-utils");
const unitRetrievalService = require("../services/unit-retrieval");


/**
 * @param {World} world 
 * @param {UnitTypeId} unitTypeId 
 * @returns {boolean}
 */
function canBuild(world, unitTypeId) {
  const { agent } = world;
  return agent.canAfford(unitTypeId) && agent.hasTechFor(unitTypeId) && (!isSupplyNeeded(world) || unitTypeId === UnitType.OVERLORD)
}

/**
 * @param {World} world
 * @param {UnitTypeId} unitTypeId
 * @returns {Unit[]}
 */
function getTrainer(world, unitTypeId) {
  const { getPendingOrders } = unitService;
  const { WARPGATE } = UnitType;
  const { data, resources } = world;
  const { units } = resources.get();
  let { abilityId } = data.getUnitTypeData(unitTypeId); if (abilityId === undefined) return [];

  const unitFilter = (/** @type {Unit} */ unit) => {
    const { orders } = unit;
    const pendingOrders = getPendingOrders(unit);
    if (abilityId === undefined || orders === undefined || pendingOrders === undefined) return false;
    const allOrders = [...orders, ...pendingOrders];
    const spaceToTrain = allOrders.length === 0 || (unit.hasReactor() && allOrders.length < 2);
    return spaceToTrain && unit.abilityAvailable(abilityId) && !unit.labels.has('reposition');
  };

  let productionUnits = unitRetrievalService.getProductionUnits(world, unitTypeId).filter(unitFilter);

  if (productionUnits.length === 0) {
    const abilityId = WarpUnitAbility[unitTypeId];
    productionUnits = units.getById(WARPGATE).filter(warpgate => abilityId && warpgate.abilityAvailable(abilityId));
  }

  // Check for flying units
  const unitTypesWithAbility = data.findUnitTypesWithAbility(abilityId);
  const flyingTypes = unitTypesWithAbility.flatMap(value => findKeysForValue(flyingTypesMapping, value));
  const flyingUnits = units.getById(flyingTypes).filter(unit => unit.isIdle());

  productionUnits = [...productionUnits, ...flyingUnits];

  return productionUnits;
}


module.exports = {
  canBuild,
  getTrainer,
};

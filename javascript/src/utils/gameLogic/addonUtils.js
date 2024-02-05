//@ts-check
"use strict";

const groupTypes = require("@node-sc2/core/constants/groups");

const { attemptLand } = require("./landingUtils");
const { getPendingOrders } = require("./stateManagement");
const GameState = require("../../core/gameState");
const { attemptBuildAddOn, attemptLiftOff } = require("../common/unitActions");
const { canUnitBuildAddOn, flyingTypesMapping } = require("../common/unitConfig");
const { updateAddOnType, getUnitTypeToBuild } = require("../common/unitHelpers");
const { addEarmark } = require("../resourceManagement/resourceUtils");

/**
 * Adds addon, with placement checks and relocating logic.
 * @param {World} world 
 * @param {Unit} unit 
 * @param {UnitTypeId} addOnType 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function addAddOn(world, unit, addOnType) {
  const { landingAbilities, liftingAbilities } = groupTypes;
  const { data } = world;
  const { tag } = unit;
  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const collectedActions = [];

  if (tag === undefined) return collectedActions;

  const gameState = GameState.getInstance();
  addOnType = updateAddOnType(addOnType, gameState.countTypes);
  const unitTypeToBuild = getUnitTypeToBuild(unit, flyingTypesMapping, addOnType);

  // Check if unitTypeToBuild is defined and retrieve abilityId
  if (unitTypeToBuild === undefined) return collectedActions;
  const unitTypeData = data.getUnitTypeData(unitTypeToBuild);
  if (!unitTypeData || unitTypeData.abilityId === undefined) return collectedActions;
  const abilityId = unitTypeData.abilityId;

  const unitCommand = { abilityId, unitTags: [tag] };

  if (!unit.noQueue || unit.labels.has('swapBuilding') || getPendingOrders(unit).length > 0) {
    return collectedActions;
  }

  const availableAbilities = unit.availableAbilities();

  if (unit.abilityAvailable(abilityId)) {
    const buildAddOnActions = attemptBuildAddOn(world, unit, addOnType, unitCommand);
    if (buildAddOnActions && buildAddOnActions.length > 0) {
      addEarmark(data, unitTypeData);
      collectedActions.push(...buildAddOnActions);
      return collectedActions;
    }
  }

  if (availableAbilities.some(ability => liftingAbilities.includes(ability))) {
    const liftOffActions = attemptLiftOff(unit);
    if (liftOffActions && liftOffActions.length > 0) {
      collectedActions.push(...liftOffActions);
      return collectedActions;
    }
  }

  if (availableAbilities.some(ability => landingAbilities.includes(ability))) {
    const landActions = attemptLand(world, unit, addOnType);
    collectedActions.push(...landActions);
  }

  return collectedActions;
}

/**
 * Get units that are capable to add an add-on (either they don't have one or they have one but can add another).
 * @param {Unit[]} units 
 * @returns {Unit[]}
 */
function getUnitsCapableToAddOn(units) {
  return units.filter(unit => unit.unitType && canUnitBuildAddOn(unit.unitType));
}

module.exports = {
  addAddOn,
  getUnitsCapableToAddOn,
};

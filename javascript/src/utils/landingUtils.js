"use strict";

/**
 * @typedef {import('@node-sc2/core/constants').UnitType} UnitType
 * @typedef {import('@node-sc2/core/constants').UnitTypeId} UnitTypeId
 */

// Import necessary constants or modules
const { UnitType, UnitTypeId } = require('@node-sc2/core/constants');

const { checkAddOnPlacement } = require('./sharedUnitPlacement');
const { addEarmark } = require('../resourceUtils');
const { flyingTypesMapping } = require('../unitConfig');
const { setPendingOrders } = require('../unitOrders');

/**
 * Attempts to land the unit at a suitable location.
 * @param {World} world
 * @param {Unit} unit 
 * @param {UnitTypeId} addOnType 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function attemptLand(world, unit, addOnType) {
  const { data } = world;
  const { tag, unitType } = unit;
  if (tag === undefined || unitType === undefined) return [];
  const collectedActions = [];

  const foundPosition = checkAddOnPlacement(world, unit, addOnType);

  if (foundPosition) {
    unit.labels.set('addAddOn', foundPosition);

    // Convert flyingType and addOnType to strings before using them as keys
    /** @type {{ [key: string]: string }} */
    const unitTypeIdMap = UnitTypeId;
    const flyingTypeKey = String(flyingTypesMapping.get(unitType) || unitType);
    const addOnTypeKey = String(addOnType);

    const dynamicKey = `${unitTypeIdMap[flyingTypeKey]}${unitTypeIdMap[addOnTypeKey]}`;
    const abilityId = getAbilityIdIfValid(dynamicKey, data, UnitType);

    if (abilityId) {
      const unitCommand = {
        abilityId: abilityId,
        unitTags: [tag],
        targetWorldSpacePos: foundPosition
      };

      collectedActions.push(unitCommand);
      setPendingOrders(unit, unitCommand);
      addEarmark(data, data.getUnitTypeData(addOnType));
    }
  }

  return collectedActions;
}

module.exports = {
  attemptLand,
};

/**
 * Checks if the given key is valid in UnitType and returns the abilityId if valid.
 * @param {string} unitTypeKey 
 * @param {DataStorage} data
 * @param {{ [key: string]: number }} UnitType 
 * @returns {number | null}
 */
function getAbilityIdIfValid(unitTypeKey, data, UnitType) {
  if (unitTypeKey in UnitType) {
    const abilityId = data.getUnitTypeData(UnitType[unitTypeKey]).abilityId;
    return abilityId !== undefined ? abilityId : null;
  }
  return null;
}
//@ts-check
"use strict"

const groupTypes = require("@node-sc2/core/constants/groups");

/**
 * @param {DataStorage} data 
 * @returns {AbilityId[]}
 */
function getReactorAbilities(data) {
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
function getTechlabAbilities(data) {
  const { techLabTypes } = groupTypes;
  const techlabAbilities = [];
  techLabTypes.forEach(type => {
    techlabAbilities.push(data.getUnitTypeData(type).abilityId)
  });
  return techlabAbilities;
}

// shared-utilities/ability-utils.js
module.exports = {
  /**
   * Retrieves the ability IDs for unit addons.
   * @param {DataStorage} data
   * @param {UnitTypeId} unitType
   * @returns {AbilityId[]}
   */  
  getAbilityIdsForAddons: function (data, unitType) {
    let { abilityId } = data.getUnitTypeData(unitType);
    let abilityIds = [];

    if (abilityId === 1674) {
      abilityIds.push(...getReactorAbilities(data));
    } else if (abilityId === 1666) {
      abilityIds.push(...getTechlabAbilities(data));
    } else if (abilityId !== undefined) {
      abilityIds.push(abilityId);
    }

    return abilityIds;
  },
  getReactorAbilities: getReactorAbilities,
  getTechlabAbilities: getTechlabAbilities 
};
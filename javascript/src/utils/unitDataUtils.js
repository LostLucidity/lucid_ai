// src/utils/unitDataUtils.js

const { unitTypeData, saveAndGetUnitTypeData } = require("./misc/gameData");

/**
 * Retrieves detailed data for a specific unit type.
 * @param {UnitResource} units
 * @param {UnitTypeId} unitType
 * @returns {{ healthMax: number; isFlying: boolean; radius: number; shieldMax: number; weaponCooldownMax: number; }}
 */
function getUnitTypeData(units, unitType) {
  let data = unitTypeData[unitType];

  if (!data || !['healthMax', 'isFlying', 'radius', 'shieldMax', 'weaponCooldownMax'].every(property => Object.prototype.hasOwnProperty.call(data, property))) {
    // Fetch and save data if not present or incomplete
    data = saveAndGetUnitTypeData(units, unitType);
    unitTypeData[unitType] = data; // Update the unitTypeData store
  }

  // Ensure the returned data matches the expected structure
  return {
    healthMax: data.healthMax || 0,
    isFlying: data.isFlying || false,
    radius: data.radius || 0,
    shieldMax: data.shieldMax || 0,
    weaponCooldownMax: data.weaponCooldownMax || 0
  };
}

module.exports = { getUnitTypeData };

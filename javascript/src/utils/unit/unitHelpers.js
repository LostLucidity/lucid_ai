// src/utils/unit/unitHelpers.js

const { UnitTypeId, UnitType } = require("@node-sc2/core/constants");

/**
 * Returns the unit type to build based on the given unit and add-on type.
 * @param {Unit} unit 
 * @param {Map<number, number>} flyingTypesMapping 
 * @param {UnitTypeId} addOnType 
 * @returns {UnitTypeId | undefined}
 */
function getUnitTypeToBuild(unit, flyingTypesMapping, addOnType) {
  if (unit.unitType === undefined || addOnType === undefined) {
    console.error("Undefined unit type or addOn type encountered in getUnitTypeToBuild.");
    return undefined;
  }

  const flyingType = flyingTypesMapping.get(unit.unitType);
  const baseUnitType = flyingType !== undefined ? flyingType : unit.unitType;

  // Using the keys as strings
  const baseTypeKey = baseUnitType.toString();
  const addOnTypeKey = addOnType.toString();

  /** @type {{ [key: string]: string }} */
  const castedUnitTypeId = /** @type {*} */ (UnitTypeId);

  // Check if keys exist in UnitTypeId using Object.prototype.hasOwnProperty
  if (Object.prototype.hasOwnProperty.call(castedUnitTypeId, baseTypeKey) && Object.prototype.hasOwnProperty.call(castedUnitTypeId, addOnTypeKey)) {
    // Construct the unit type string
    const unitTypeString = `${castedUnitTypeId[baseTypeKey]}${castedUnitTypeId[addOnTypeKey]}`;

    /** @type {{ [key: string]: number }} */
    const castedUnitType = /** @type {*} */ (UnitType);

    return castedUnitType[unitTypeString];
  }

  return undefined;
}

/**
 * Returns updated addOnType using countTypes.
 * @param {UnitTypeId} addOnType 
 * @param {Map<UnitTypeId, UnitTypeId[]>} countTypes 
 * @returns {UnitTypeId}
 */
function updateAddOnType(addOnType, countTypes) {
  for (const [key, value] of countTypes.entries()) {
    if (value.includes(addOnType)) {
      return key;
    }
  }
  return addOnType;
}

module.exports = { getUnitTypeToBuild, updateAddOnType };

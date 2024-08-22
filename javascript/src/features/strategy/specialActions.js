const { EFFECT_CALLDOWNMULE } = require("@node-sc2/core/constants/ability");

const { createUnitCommand } = require("../../core/common");
const { getDistance } = require("../../utils/spatialCoreUtils");
const { performScoutingWithSCV } = require("../shared/scoutActions");

/**
 * Calls down MULEs in the specified world state.
 * @param {World} world - The current world state.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions to be performed.
 */
function callDownMULEs(world) {
  const { resources } = world;
  const { units } = resources.get();
  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const collectedActions = [];
  const bases = units.getBases();
  const canCallDownMules = bases.filter(orbitalCommand => orbitalCommand.abilityAvailable(EFFECT_CALLDOWNMULE));
  canCallDownMules.forEach(canCallDownMule => {
    const mineralField = getMineralFieldTarget(units, canCallDownMule);
    if (mineralField) {
      const unitCommand = createUnitCommand(EFFECT_CALLDOWNMULE, [canCallDownMule]);
      unitCommand.targetUnitTag = mineralField.tag;
      collectedActions.push(unitCommand);
    }
  });
  return collectedActions;
}

/**
 * Executes the specified special action.
 * @param {string} specialAction - The action to execute.
 * @param {World} world - The current world state.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions to be performed.
 */
function executeSpecialAction(specialAction, world) {
  switch (specialAction) {
    case 'Scouting with SCV':
      return performScoutingWithSCV(world);
    case 'Call Down MULEs':
      return callDownMULEs(world);
    default:
      console.warn(`Unhandled special action: ${specialAction}`);
      return [];
  }
}

/**
 * Finds the closest mineral field to the specified base.
 * @param {UnitResource} units - The units object containing all units.
 * @param {Unit} base - The base unit to find the closest mineral field to.
 * @returns {Unit | null} The closest mineral field unit, or null if none are found.
 */
function getMineralFieldTarget(units, base) {
  if (!base.pos) {
    console.warn(`Base position is undefined for unit: ${base.tag}`);
    return null;
  }

  const mineralFields = units.getClosest(base.pos, units.getMineralFields(), units.getMineralFields().length)
    .filter(mineralField => getDistance(mineralField.pos, base.pos) < 8);

  if (mineralFields.length === 0) {
    console.warn(`No mineral fields found within distance for base: ${base.tag}`);
    return null;
  }

  return mineralFields.reduce((mineralFieldWithHighestAmount, mineralField) => {
    const currentMineralContents = mineralField.mineralContents ?? 0;
    const highestMineralContents = mineralFieldWithHighestAmount.mineralContents ?? 0;
    if (currentMineralContents > highestMineralContents) {
      return mineralField;
    } else {
      return mineralFieldWithHighestAmount;
    }
  }, mineralFields[0]);
}

module.exports = {
  executeSpecialAction
};

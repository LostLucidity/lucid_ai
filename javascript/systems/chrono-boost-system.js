//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { EFFECT_CHRONOBOOSTENERGYCOST: CHRONOBOOST } = require("@node-sc2/core/constants/ability");
const { CHRONOBOOSTENERGYCOST: CHRONOBOOSTED } = require("@node-sc2/core/constants/buff");
const { NEXUS } = require("@node-sc2/core/constants/unit-type");
const getRandom = require("@node-sc2/core/utils/get-random");
const { createUnitCommand } = require("../services/actions-service");

module.exports = createSystem({
  name: 'ChronoBoostSystem',
  type: 'agent',
  async onStep(world) {
    const { resources } = world;
    const { actions, units } = resources.get();
    const collectedActions = [];
    const nexusWithChronoBoost = units.getById(NEXUS).filter(n => n.abilityAvailable(CHRONOBOOST));
    if (nexusWithChronoBoost.length > 0) {
      const structures = units.getStructures();
      const structuresThatCanBeChronoBoosted = structures.filter(structure => canBeChronoBoosted(structure));
      if (structuresThatCanBeChronoBoosted.length > 0) {
        const [nexusWithMostEnergy] = nexusWithChronoBoost.sort((a, b) => b.energy && a.energy ? b.energy - a.energy : 0);
        const randomStructure = getRandom(structuresThatCanBeChronoBoosted);
        const unitCommand = createUnitCommand(CHRONOBOOST, [nexusWithMostEnergy]);
        unitCommand.targetUnitTag = randomStructure.tag;
        collectedActions.push(unitCommand);
      }
      if (collectedActions.length > 0) {
        return actions.sendAction(collectedActions);
      }
    }

  }
});

/**
 * @param {Unit} unit 
 * @returns {boolean}
 */
function canBeChronoBoosted(unit) {
  const { buffIds } = unit;
  if (buffIds === undefined) return false;
  return !buffIds.includes(CHRONOBOOSTED) && !unit.isIdle();
}
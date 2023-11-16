//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { EFFECT_CALLDOWNMULE } = require("@node-sc2/core/constants/ability");
const planService = require("../services/plan-service");
const { getMineralFieldTarget } = require("./unit-resource/unit-resource-service");
const { createUnitCommand } = require("../src/shared-utilities/command-utilities");

module.exports = createSystem({
  name: 'MulingSystem',
  type: 'agent',
  async onStep(world) {
    const { agent, resources } = world;
    const { actions } = resources.get();
    const collectedActions = [];
    const { minerals } = agent;
    if (minerals === undefined) return [];
    if (minerals <= planService.mineralThreshold) {
      collectedActions.push(...callDownMules(world));
    }
    await actions.sendAction(collectedActions);
  }
});

/**
 * @param {World} world 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function callDownMules(world) {
  const { resources } = world;
  const { units } = resources.get();
  const collectedActions = [];
  const bases = units.getBases();
  const canCallDownMules = bases.filter(orbitalCommand => orbitalCommand.abilityAvailable(EFFECT_CALLDOWNMULE));
  canCallDownMules.forEach(canCallDownMule => {
      const mineralField = getMineralFieldTarget(units, canCallDownMule);
      const unitCommand = createUnitCommand(EFFECT_CALLDOWNMULE, [canCallDownMule]);
      unitCommand.targetUnitTag = mineralField.tag;
      collectedActions.push(unitCommand);
  });
  return collectedActions;
}

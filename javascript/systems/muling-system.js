//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { EFFECT_CALLDOWNMULE } = require("@node-sc2/core/constants/ability");
const { createUnitCommand } = require("../services/actions-service");
const { getMineralFieldTarget } = require("./unit-resource/unit-resource-service");

module.exports = createSystem({
  name: 'MulingSystem',
  type: 'agent',
  async onStep(world) {
    const { actions, units } = world.resources.get();
    const bases = units.getBases();
    const canCallDownMules = bases.filter(orbitalCommand => orbitalCommand.abilityAvailable(EFFECT_CALLDOWNMULE));
    /**
     * {{SC2APIProtocol.ActionRawUnitCommand[]}
     */
    const collectedActions = [];
    canCallDownMules.forEach(canCallDownMule => {
      const mineralField = getMineralFieldTarget(units, canCallDownMule);
      const unitCommand = createUnitCommand(EFFECT_CALLDOWNMULE, [canCallDownMule]);
      unitCommand.targetUnitTag = mineralField.tag;
      collectedActions.push(unitCommand);
    });
    await actions.sendAction(collectedActions);
  }
});
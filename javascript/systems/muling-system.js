//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { EFFECT_CALLDOWNMULE, MORPH_ORBITALCOMMAND } = require("@node-sc2/core/constants/ability");
const { createUnitCommand } = require("../services/actions-service");
const planService = require("../services/plan-service");
const { getMineralFieldTarget } = require("./unit-resource/unit-resource-service");

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
      collectedActions.push(...morphIntoOrbitalCommand(world));
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

/**
 * @param {World} world 
 */
function morphIntoOrbitalCommand(world) {
  const { resources } = world;
  const { units } = resources.get();
  const collectedActions = [];
  const bases = units.getBases();
  const canMorphIntoOrbitalCommand = bases.filter(base => base.abilityAvailable(MORPH_ORBITALCOMMAND));
  canMorphIntoOrbitalCommand.forEach(base => {
    const unitCommand = createUnitCommand(MORPH_ORBITALCOMMAND, [base]);
    collectedActions.push(unitCommand);
  });
  return collectedActions;
}

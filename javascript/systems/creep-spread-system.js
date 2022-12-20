//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { QUEEN } = require("@node-sc2/core/constants/unit-type");
const { spreadCreepByQueen } = require("../builds/zerg/queen-management");

module.exports = createSystem({
  name: 'CreepSpreadSystem',
  type: 'agent',
  async onStep(world) {
    const { resources } = world;
    const { actions, units } = resources.get();
    const collectedActions = [];
    setCreeperLabels(units);
    collectedActions.push(...await spreadCreepByQueen(resources));
    await actions.sendAction(collectedActions);
  }
});

/**
 * @param {UnitResource} units 
 */
function setCreeperLabels(units) {
  const creepers = units.withLabel('creeper');
  const bases = units.getBases();
  const queens = units.getById(QUEEN);
  const targetCreeperCount = queens.length > bases.length ? queens.length - bases.length : 0;
  if (creepers.length > targetCreeperCount) {
    creepers.slice(targetCreeperCount).forEach(creeper => creeper.removeLabel('creeper'));
  } else if (creepers.length < targetCreeperCount) {
    // get difference between targetCreeperCount and creepers.length
    const difference = targetCreeperCount - creepers.length;
    // add label to difference number of queens that don't already have the label
    queens.filter(queen => !queen.labels.get('creeper')).slice(0, difference).forEach(queen => queen.addLabel('creeper', true));
  }
}

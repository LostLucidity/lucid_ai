//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { EFFECT_INJECTLARVA } = require("@node-sc2/core/constants/ability");
const { QUEENSPAWNLARVATIMER } = require("@node-sc2/core/constants/buff");
const { LARVA, QUEEN } = require("@node-sc2/core/constants/unit-type");
const { createUnitCommand } = require("../services/actions-service");
const { getClosestUnitByPath } = require("../services/resources-service");
const { train } = require("./execute-plan/plan-actions");

module.exports = createSystem({
  name: "InjectorSystem",
  type: "agent",
  async onStep(world) {
    const { resources } = world;
    const { actions, units } = resources.get();
    const collectedActions = [];
    collectedActions.push(...injectLarva(resources));
    if (units.getById(LARVA).length === 0) {
      await train(world, QUEEN);
    }
    await actions.sendAction(collectedActions);
  }
});
/**
 * @param {ResourceManager} resources
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function injectLarva(resources) {
  const { units } = resources.get();
  const bases = units.getBases();
  const injectUnits = units.getAlive().filter(unit => unit.canInject());
  const collectedActions = [];
  injectUnits.forEach(injectUnit => {
    const [closestBase] = getClosestUnitByPath(resources, injectUnit.pos, bases.filter(base => !base.buffIds.includes(QUEENSPAWNLARVATIMER)));
    if (closestBase) {
      const unitCommand = createUnitCommand(EFFECT_INJECTLARVA, [injectUnit]);
      unitCommand.targetUnitTag = closestBase.tag;
      collectedActions.push(unitCommand);
    }
  });
  return collectedActions;
}
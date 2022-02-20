//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const getRandom = require("@node-sc2/core/utils/get-random");
const { getCandidatePositions } = require("../helper/placement/placement-helper");
const { getFoodUsed } = require("../services/plan-service");
const planService = require("../services/plan-service");
const resourceManagerService = require("../services/resource-manager-service");

module.exports = createSystem({
  name: 'SetRallySystem',
  type: 'agent',
  async onStep(world) {
    // set combat rally point as default. Override from plan
    // get random getRally point if no rally is found
    const rally = await getRally(world);
    if (rally.length > 0) {
      resourceManagerService.combatRally = getRandom(await getRally(world));
    } else {
      resourceManagerService.combatRally = null;
    }
  },
});
/**
 * @param {World} world
 * @returns {Promise<Point2D[]>}
 */
async function getRally(world) {
  const { agent, resources } = world;
  const { units } = resources.get();
  const foundRally = planService.rallies.find(rally => {
    // return true if foodUsed is greater than conditionStart and less than unitType count
    let conditionStartSatisfied = false;
    let conditionEndSatisfied = false;
    if (Object.prototype.hasOwnProperty.call(rally.conditionStart, 'food')) {
      conditionStartSatisfied = getFoodUsed(agent.foodUsed) >= rally.conditionStart.food;
    }
    if (Object.prototype.hasOwnProperty.call(rally.conditionEnd, 'unitType')) {
      conditionEndSatisfied = units.getById(rally.conditionEnd.unitType).length >= rally.conditionEnd.count;
    }
    return conditionStartSatisfied && !conditionEndSatisfied;
  });
  return foundRally ? await getCandidatePositions(resources, foundRally.location) : [];
}
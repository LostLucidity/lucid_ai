//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { UnitType } = require("@node-sc2/core/constants");
const { HALT_TERRANBUILD } = require("@node-sc2/core/constants/ability");
const { Race } = require("@node-sc2/core/constants/enums");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const loggingService = require("../services/logging-service");
const planService = require("../services/plan-service");
const { logActionIfNearPosition } = require("../services/world-service");

module.exports = createSystem({
  name: 'Logging',
  type: 'agent',
  async onStep(world) {
    logStepStats(world);
    addBuildStepLog(world);
  },
});
/**
 * 
 * @param {World} world 
 * @returns {void}
 */
function logStepStats({ agent, resources }) {
  const formattedTime = loggingService.formatToMinutesAndSeconds(resources.get().frame.timeInSeconds());
  const { foodUsed, minerals, vespene } = agent;
  console.log(`foodUsed: ${foodUsed}, timeInSeconds: ${formattedTime}, isPlanPaused: ${planService.isPlanPaused}, step: ${planService.currentStep}, resources: ${minerals}/${vespene}`);
}
/**
 * @param {World} world
 * @returns {void}
 */
function addBuildStepLog(world) {
  const { agent, data, resources } = world;
  const unitsWithConstructingOrders = resources.get().units.getConstructingWorkers();
  if (unitsWithConstructingOrders.length > 0) {
    unitsWithConstructingOrders.forEach(unit => {
      const foundOrder = unit.orders.find(order => order.targetWorldSpacePos && distance(order.targetWorldSpacePos, unit.pos) < 4);
      if (foundOrder) {
        const foundKey = Object.keys(UnitType).find(key => data.getUnitTypeData(UnitType[key]).abilityId === foundOrder.abilityId);
        const unitType = UnitType[foundKey];
        if (
          foundOrder &&
          (
            (agent.race !== Race.TERRAN) ||
            (
              agent.race === Race.TERRAN &&
              !unit.abilityAvailable(HALT_TERRANBUILD)
            )
          )
        ) {
          logActionIfNearPosition(world, unitType, unit, foundOrder.targetWorldSpacePos);
        }
      }
    });
  }
}
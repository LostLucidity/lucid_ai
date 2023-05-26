//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { UnitType } = require("@node-sc2/core/constants");
const { HALT_TERRANBUILD } = require("@node-sc2/core/constants/ability");
const { Race } = require("@node-sc2/core/constants/enums");
const { CREEPTUMOR, CREEPTUMORQUEEN } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const loggingService = require("../services/logging-service");
const planService = require("../services/plan-service");
const worldService = require("../services/world-service");
const { logActionIfNearPosition } = require("../services/world-service");
const healthTrackingService = require("./health-tracking/health-tracking-service");

module.exports = createSystem({
  name: 'Logging',
  type: 'agent',
  async onStep(world) {
    logStepStats(world);
    addBuildStepLog(world);
  },
  async onUnitCreated(world, unit) {
    const { agent, resources } = world;
    const { frame } = resources.get();
    const gameLoop = frame.getGameLoop();
    if (unit.isStructure() && gameLoop > 0) {
      const { unitType } = unit; if (unitType === undefined) return;
      if (agent.race === Race.ZERG && ![CREEPTUMOR, CREEPTUMORQUEEN].includes(unitType)) {
        planService.pausePlan = false;
      }
      worldService.setFoodUsed(world);
      logActionIfNearPosition(world, unit);
    }
  }
});
/**
 * 
 * @param {World} world 
 * @returns {void}
 */
function logStepStats({ agent, resources }) {
  const formattedTime = loggingService.formatToMinutesAndSeconds(resources.get().frame.timeInSeconds());
  const { foodUsed, minerals, vespene } = agent;
  const { totalSelfDPSHealth, totalEnemyDPSHealth } = worldService;
  let logBuilder = `foodUsed: ${foodUsed}`;
  logBuilder += `, time: ${formattedTime}`;
  logBuilder += `, isPlanPaused: ${planService.isPlanPaused}`;
  logBuilder += `, step: ${planService.latestStep}`;
  logBuilder += `, resources: ${minerals}/${vespene}`;
  logBuilder += `, powerLevels: ${totalSelfDPSHealth}/${totalEnemyDPSHealth}(${totalSelfDPSHealth / totalEnemyDPSHealth})`;
  // const selfHealthDifferenceAverage = healthTrackingService.healthDifference[Alliance.SELF].slice(-14).reduce((acc, curr) => acc + curr, 0) / (14 / 5);
  // const enemyHealthDifferenceAverage = healthTrackingService.healthDifference[Alliance.ENEMY].slice(-14).reduce((acc, curr) => acc + curr, 0) / (14 / 5);
  // logBuilder += `, healthDifference: ${selfHealthDifferenceAverage}/${enemyHealthDifferenceAverage}(${selfHealthDifferenceAverage / enemyHealthDifferenceAverage})`;
  console.log(`${logBuilder}`);
}
/**
 * @param {World} world
 * @returns {void}
 */
function addBuildStepLog(world) {
  const { agent, data, resources } = world;
  const { units } = resources.get();
  const unitsWithConstructingOrders = units.getConstructingWorkers();
  if (unitsWithConstructingOrders.length > 0) {
    unitsWithConstructingOrders.forEach(unit => {
      const foundOrder = unit.orders.find(order => order.targetWorldSpacePos && distance(order.targetWorldSpacePos, unit.pos) < 4);
      if (foundOrder) {
        const foundKey = Object.keys(UnitType).find(key => data.getUnitTypeData(UnitType[key]).abilityId === foundOrder.abilityId);
        const unitType = UnitType[foundKey];
        if (foundKey) {
          if (agent.race === Race.TERRAN) {
            if (unit.abilityAvailable(HALT_TERRANBUILD)) return;
          }
          if (agent.race === Race.PROTOSS) {
            const [closestUnit] = units.getClosest(foundOrder.targetWorldSpacePos, units.getById(unitType))
            if (closestUnit && distance(closestUnit.pos, foundOrder.targetWorldSpacePos) < 1) return;
          }
        }
      }
    });
  }
}
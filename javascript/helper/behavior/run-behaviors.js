//@ts-check
"use strict"

const { clearFromEnemyBehavior, scoutEnemyMainBehavior, scoutEnemyNaturalBehavior, acrossTheMapBehavior, recruitToBattleBehavior } = require("./labelled-behavior");
const { liberatorBehavior, marineBehavior, supplyDepotBehavior, workerBehavior, observerBehavior, overlordBehavior, barracksBehavior } = require("./unit-behavior");

/**
 * @param {World} world 
 * @returns {Promise<SC2APIProtocol.ActionRawUnitCommand[]>}
 */
async function runBehaviors(world) {
  const { resources } = world;
  const { units } = resources.get();
  const collectedActions = []
  collectedActions.push(...acrossTheMapBehavior(world));
  collectedActions.push(...barracksBehavior(resources));
  collectedActions.push(...clearFromEnemyBehavior(world));
  collectedActions.push(...liberatorBehavior(resources));
  collectedActions.push(...marineBehavior(resources));
  collectedActions.push(...observerBehavior(world));
  collectedActions.push(...overlordBehavior(world));
  await scoutEnemyMainBehavior(world);
  await scoutEnemyNaturalBehavior(resources);
  collectedActions.push(...supplyDepotBehavior(resources));
  collectedActions.push(...await workerBehavior(world));
  collectedActions.push(...recruitToBattleBehavior(units));
  return collectedActions;
}

module.exports = runBehaviors;
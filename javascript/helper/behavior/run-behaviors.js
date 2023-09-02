//@ts-check
"use strict"

const { setCombatBuildingsRallies } = require("../../services/resources-service");
const { clearFromEnemyBehavior, scoutEnemyMainBehavior, scoutEnemyNaturalBehavior, acrossTheMapBehavior, recruitToBattleBehavior } = require("./labelled-behavior");
const { liberatorBehavior, marineBehavior, supplyDepotBehavior, workerBehavior, observerBehavior, overlordBehavior, bunkerBehavior, creepTumorBurrowedBehavior } = require("./unit-behavior");

/**
 * @param {World} world 
 * @returns {Promise<SC2APIProtocol.ActionRawUnitCommand[]>}
 */
async function runBehaviors(world) {
  const { resources } = world;
  const { units } = resources.get();
  const collectedActions = []
  collectedActions.push(...acrossTheMapBehavior(world));
  collectedActions.push(...bunkerBehavior(world));
  collectedActions.push(...creepTumorBurrowedBehavior(world));
  collectedActions.push(...clearFromEnemyBehavior(world));
  collectedActions.push(...liberatorBehavior(resources));
  collectedActions.push(...marineBehavior(resources));
  collectedActions.push(...observerBehavior(world));
  collectedActions.push(...overlordBehavior(world));
  collectedActions.push(...scoutEnemyMainBehavior(world));
  await scoutEnemyNaturalBehavior(resources);
  collectedActions.push(...setCombatBuildingsRallies(resources));
  collectedActions.push(...supplyDepotBehavior(resources));
  collectedActions.push(...await workerBehavior(world));
  collectedActions.push(...recruitToBattleBehavior(units));
  return collectedActions;
}

module.exports = runBehaviors;
//@ts-check
"use strict"

const { clearFromEnemyBehavior, scoutEnemyMainBehavior, scoutEnemyNaturalBehavior, acrossTheMapBehavior } = require("./labelled-behavior");
const { liberatorBehavior, marineBehavior, supplyDepotBehavior, workerBehavior, observerBehavior, overlordBehavior } = require("./unit-behavior");

async function runBehaviors(world) {
  const { resources } = world;
  const collectedActions = []
  collectedActions.push(...acrossTheMapBehavior(world));
  collectedActions.push(...clearFromEnemyBehavior(resources));
  collectedActions.push(...liberatorBehavior(resources));
  collectedActions.push(...marineBehavior(resources));
  collectedActions.push(...observerBehavior(world));
  collectedActions.push(...overlordBehavior(world));
  await scoutEnemyMainBehavior(world);
  await scoutEnemyNaturalBehavior(resources);
  collectedActions.push(...supplyDepotBehavior(resources));
  collectedActions.push(...await workerBehavior(world));
  return collectedActions;
}

module.exports = runBehaviors;
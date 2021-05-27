//@ts-check
"use strict"

const { clearFromEnemyBehavior, scoutEnemyMainBehavior, scoutEnemyNaturalBehavior } = require("./labelled-behavior");
const { liberatorBehavior, marineBehavior, supplyDepotBehavior, workerBehavior, observerBehavior, overlordBehavior } = require("./unit-behavior");

async function runBehaviors (world, opponentRace) {
  const { data, resources} = world;
  const collectedActions = []
  collectedActions.push(...clearFromEnemyBehavior(resources));
  collectedActions.push(...liberatorBehavior(resources));
  collectedActions.push(...marineBehavior(resources));
  collectedActions.push(...observerBehavior(resources, data));
  collectedActions.push(...overlordBehavior(resources, data));
  await scoutEnemyMainBehavior(resources, opponentRace);
  await scoutEnemyNaturalBehavior(resources);
  collectedActions.push(...supplyDepotBehavior(resources));
  collectedActions.push(...await workerBehavior(world));
  return collectedActions;
}

module.exports = runBehaviors;
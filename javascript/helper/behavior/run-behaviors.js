//@ts-check
"use strict"

const serviceLocator = require("../../src/services/service-locator");
const { clearFromEnemyBehavior, scoutEnemyMainBehavior, scoutEnemyNaturalBehavior, acrossTheMapBehavior, recruitToBattleBehavior } = require("./labelled-behavior");
const { liberatorBehavior, marineBehavior, supplyDepotBehavior, workerBehavior, observerBehavior, overlordBehavior, bunkerBehavior, creepTumorBurrowedBehavior } = require("./unit-behavior");

/** @type {import("../../src/interfaces/i-army-management-service").IArmyManagementService} */
const armyManagementService = serviceLocator.get('armyManagementService');

/**
 * @param {World} world 
 * @returns {Promise<SC2APIProtocol.ActionRawUnitCommand[]>}
 */
async function runBehaviors(world) {
  const { resources } = world;
  const { units } = resources.get();

  // Parallelize the execution of asynchronous behavior functions
  const behaviors = await Promise.all([
    scoutEnemyNaturalBehavior(resources),
    workerBehavior(world)
  ]);

  // Combine the results of asynchronous and synchronous behavior functions
  const collectedActions = [
    ...acrossTheMapBehavior(world),
    ...bunkerBehavior(world),
    ...creepTumorBurrowedBehavior(world),
    ...clearFromEnemyBehavior(world),
    ...liberatorBehavior(resources),
    ...marineBehavior(resources),
    ...observerBehavior(world),
    ...overlordBehavior(world),
    ...scoutEnemyMainBehavior(world),
    ...armyManagementService.setCombatBuildingsRallies(resources),
    ...supplyDepotBehavior(resources),
    ...recruitToBattleBehavior(units),
    ...behaviors.flat()  // Flatten the array of arrays into a single array
  ];

  return collectedActions;
}


module.exports = runBehaviors;
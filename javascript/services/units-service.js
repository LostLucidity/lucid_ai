//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");

const unitsService = {
  getEnemyWorkers(world) {
    const workers = world.resources.get().units.getAlive(Alliance.ENEMY)
      .filter(u => u.unitType === WorkerRace[world.agent.race]);
    return workers;
  }
}

module.exports = unitsService
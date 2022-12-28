//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { trainWorkers } = require("./worker-training-service");

module.exports = createSystem({
  name: 'WorkerTrainingSystem',
  type: 'agent',
  async onGameStart(world) {
    const { resources } = world;
    const { actions } = resources.get();
    await actions.sendAction(trainWorkers(world));
  },
  async onStep(world) {
    const { resources } = world;
    const { actions } = resources.get();
    await actions.sendAction(trainWorkers(world));
  },
  async onUnitCreated(world, unit) {
    const { agent, resources } = world;
    const { race } = agent;
    const { actions, frame } = resources.get();
    if (WorkerRace[race] === unit.unitType && frame.getGameLoop() > 0) {
      await actions.sendAction(trainWorkers(world));
    }
  },
});

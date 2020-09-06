//@ts-check
const { TownhallRace, WorkerRace } = require("@node-sc2/core/constants/race-map");
const { Race } = require("@node-sc2/core/constants/enums");
const { LARVA } = require("@node-sc2/core/constants/unit-type");
const canAfford = require("./can-afford");
const { townhallTypes } = require("@node-sc2/core/constants/groups");

async function buildWorkers(agent, data, resources) {
  const {
    actions,
    units,
  } = resources.get();
  const workerType = WorkerRace[agent.race];
  if (canAfford(agent, data, workerType)) {
    const idleTownhalls = units.getById(townhallTypes, { noQueue: true, buildProgress: 1 }).filter(townhall => !townhall.isEnemy());
    if (idleTownhalls.length > 0) {
      if (agent.race === Race.ZERG && units.getById(LARVA).length === 0) {
        return;
      }
      try { await actions.train(workerType); } catch (error) { console.log(error) }
    }
  }
}

module.exports = buildWorkers;
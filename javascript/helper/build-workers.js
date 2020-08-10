//@ts-check
const { TownhallRace, WorkerRace } = require("@node-sc2/core/constants/race-map");
const { Race } = require("@node-sc2/core/constants/enums");
const { LARVA } = require("@node-sc2/core/constants/unit-type");
const canAfford = require("./can-afford");

async function buildWorkers(agent, data, resources) {
  const {
    foodCap,
    foodUsed,
  } = agent;
  const {
    actions,
    units,
  } = resources.get();
  const townhallType = TownhallRace[agent.race][0];
  const workerType = WorkerRace[agent.race];
  if (canAfford(agent, data, workerType)) {
    const idleTownhalls = units.getById(townhallType, { noQueue: true, buildProgress: 1 });
    if (idleTownhalls.length > 0) {
      if (agent.race === Race.ZERG && units.getById(LARVA).length === 0) {
        return;
      }
      try { await actions.train(workerType); } catch (error) { console.log(error) }
    }
  }
}

module.exports = buildWorkers;
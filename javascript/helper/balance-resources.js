//@ts-check
"use strict"

const { GasMineRace } = require("@node-sc2/core/constants/race-map");

async function balanceResources(agent, data, resources, ratio) {
  const {
    actions,
    map,
    units,
  } = resources.get();
  const { minerals, vespene } = agent;
  const resourceRatio = minerals / vespene;
  const gasUnitId = GasMineRace[agent.race]
  const buildAbilityId = data.getUnitTypeData(gasUnitId).abilityId;
  const [ geyser ] = map.freeGasGeysers();
  const conditions = [
    resourceRatio > ratio,
    agent.canAfford(gasUnitId),
    units.withCurrentOrders(buildAbilityId).length <= 0,
    geyser,
  ];
  if (conditions.every(c => c)) {
    await actions.buildGasMine();
  }
}

module.exports = balanceResources;
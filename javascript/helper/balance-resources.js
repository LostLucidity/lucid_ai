//@ts-check
"use strict"

const { GasMineRace } = require("@node-sc2/core/constants/race-map");

async function balanceResources(agent, data, resources, ratio=2.4) {
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
    units.getById(gasUnitId).filter(unit => unit.buildProgress < 1).length < 1,
    units.withCurrentOrders(buildAbilityId).length <= 0,
    geyser,
  ];
  if (conditions.every(c => c)) {
    try { await actions.buildGasMine(); } catch(error) { console.log(error.message); }
  }
}

module.exports = {
  gasShortage: (agent, ratio=2.4) => {
    const { minerals, vespene } = agent;
    const resourceRatio = minerals / vespene;
    return resourceRatio > ratio;
  },
  gasMineCheckAndBuild: async ({ agent, data, resources}, ratio=2.4) => {
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
      units.getById(gasUnitId).filter(unit => unit.buildProgress < 1).length < 1,
      units.withCurrentOrders(buildAbilityId).length <= 0,
      geyser,
    ];
    if (conditions.every(c => c)) {
      try { await actions.buildGasMine(); } catch(error) { console.log(error.message); }
    }
  }
};
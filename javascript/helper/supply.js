//@ts-check
const { SupplyUnitRace } = require('@node-sc2/core/constants/race-map')

function isSupplyNeeded(agent, data, resources) {
  const { foodCap, foodUsed } = agent;
  const { units } = resources.get()
  const supplyUnitId = SupplyUnitRace[agent.race];
  const buildAbilityId = data.getUnitTypeData(supplyUnitId).abilityId;
  const pendingSupply = (
    (units.inProgress(supplyUnitId).length * 8) + 
    (units.withCurrentOrders(buildAbilityId).length * 8)
  );
  const pendingSupplyCap = foodCap + pendingSupply;
  const supplyLeft = foodCap - foodUsed;
  const pendingSupplyLeft = supplyLeft + pendingSupply;
  const conditions = [
    pendingSupplyLeft < pendingSupplyCap * 0.2,
    !(foodCap == 200),
    agent.canAfford(supplyUnitId), // can afford to build a pylon
  ];
  if (conditions.every(c => c)) {
    return true
  } else {
    return false
  }
}

module.exports = isSupplyNeeded;
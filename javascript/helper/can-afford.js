//@ts-check
"use strict"

function canAfford(agent, data, type) {
  const {
    foodCap,
    foodUsed,
  } = agent;
  const supplyLeft = foodCap - foodUsed;
  return agent.canAfford(type) && agent.hasTechFor(type) && supplyLeft >= data.getUnitTypeData(type).foodRequired;
}

module.exports = canAfford;
//@ts-check
"use strict"

const { OVERLORD } = require("@node-sc2/core/constants/unit-type");

function canAfford(agent, data, type) {
  const {
    foodCap,
    foodUsed,
  } = agent;
  let supplyLeft = 1
  if (type !== OVERLORD) {
    supplyLeft = foodCap - foodUsed;
  }
  return agent.canAfford(type) && agent.hasTechFor(type) && supplyLeft >= data.getUnitTypeData(type).foodRequired;
}

module.exports = canAfford;
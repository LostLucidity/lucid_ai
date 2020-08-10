//@ts-check
"use strict"

const { LARVA, ZERGLING } = require("@node-sc2/core/constants/unit-type");
const canAfford = require("./can-afford");
const { Race } = require("@node-sc2/core/constants/enums");

async function continuouslyBuild(agent, data, resources, unitTypes, addOn=false) {
  const {
    foodUsed,
    minerals,
  } = agent;
  const {
    actions,
    units
  } = resources.get();
  // pick random unitType and train.
  const collectedActions = [];
  if (
    agent.race !== Race.ZERG || units.getById(LARVA).length > 0
    && foodUsed < 198
  ) {
    const affordableTypes = unitTypes.filter(type => !(type == ZERGLING && minerals < 50) && canAfford(agent, data, type));
    if (affordableTypes.length > 0) {
      const unitType = affordableTypes[Math.floor(Math.random() * affordableTypes.length)];
      const abilityId = data.getUnitTypeData(unitType).abilityId;
      let trainer = null;
      if (addOn) {
        trainer = units.getProductionUnits(unitType).find(unit => unit.hasReactor() && unit.orders.length < 2);
      } else {
        trainer = units.getProductionUnits(unitType).find(unit => unit.noQueue || (unit.hasReactor() && unit.orders.length < 2));
      }
      if (trainer) {
        const unitCommand = {
          abilityId,
          unitTags: [ trainer.tag ],
        }
        collectedActions.push(unitCommand);
        try { await actions.sendAction(collectedActions); } 
        // try { await actions.train(unitType); } 
        catch (error) { console.log(error)}
      }
    }
  }
}

module.exports = continuouslyBuild;
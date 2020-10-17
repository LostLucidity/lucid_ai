//@ts-check
"use strict"

const { LARVA, ZERGLING, WARPGATE } = require("@node-sc2/core/constants/unit-type");
const canAfford = require("./can-afford");
const { Race } = require("@node-sc2/core/constants/enums");
const { WarpUnitAbility } = require("@node-sc2/core/constants");
const { getRallyPoint, getRallyPointByBases } = require("./location");

async function continuouslyBuild(agent, data, resources, unitTypes, addOn=false) {
  const {
    foodUsed,
    minerals,
  } = agent;
  const {
    actions,
    map,
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
      let abilityId = data.getUnitTypeData(unitType).abilityId;
      let trainer = null;
      if (addOn) {
        trainer = units.getProductionUnits(unitType).find(unit => unit.buildProgress >= 1 && (!unit.isEnemy() && (unit.noQueue && unit.hasTechLab()) || (unit.hasReactor() && unit.orders.length < 2)));
      } else {
        trainer = units.getProductionUnits(unitType).find(unit => unit.buildProgress >= 1 && (!unit.isEnemy() && (unit.noQueue || (unit.hasReactor() && unit.orders.length < 2))));
      }
      if (trainer) {
        const unitCommand = {
          abilityId,
          unitTags: [ trainer.tag ],
        }
        collectedActions.push(unitCommand);
        try { await actions.sendAction(collectedActions); } 
        catch (error) { console.log(error)}
      } else {
        abilityId = WarpUnitAbility[unitType];
        const warpGates = units.getById(WARPGATE).filter(warpgate => warpgate.abilityAvailable(abilityId));
        if (warpGates.length > 0) {
          try { await actions.warpIn(unitType, { nearPosition: map.getNatural() ? map.getCombatRally() : getRallyPointByBases(map, units) }) } catch (error) { console.log(error); }
        }
      }
    }
  }
}

module.exports = continuouslyBuild;
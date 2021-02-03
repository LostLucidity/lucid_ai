//@ts-check
"use strict"

const { LARVA, ZERGLING, WARPGATE } = require("@node-sc2/core/constants/unit-type");
const canAfford = require("./can-afford");
const { Race, Alliance } = require("@node-sc2/core/constants/enums");
const { WarpUnitAbility } = require("@node-sc2/core/constants");
const { getCombatRally } = require("./location");
const { distance } = require("@node-sc2/core/utils/geometry/point");

async function continuouslyBuild({ agent, data, resources }, unitTypes, addOn=false) {
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
      [ trainer ] = filterTrainers(units.getProductionUnits(unitType), addOn, units);
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
          try { await actions.warpIn(unitType, { nearPosition: getCombatRally(map, units) }) } catch (error) { console.log(error); }
        }
      }
    }
  }
}

function filterTrainers(trainers, addOn, units) {
  let ownCompleteTrainers = trainers.filter(trainer => {
    const [ closestEnemy ] = units.getClosest(trainer.pos, units.getCombatUnits(Alliance.ENEMY));
    return (
      trainer.buildProgress >= 1 &&
      !trainer.isEnemy() &&
      (closestEnemy ? distance(trainer.pos, closestEnemy.pos) > 8 : true)
    )
  });
  if (addOn) {
    return ownCompleteTrainers.filter(trainer => {
      return (
        (trainer.noQueue && trainer.hasTechLab()) ||
        (trainer.hasReactor() && trainer.orders.length < 2)
      )
    })
  } else {
    return ownCompleteTrainers.filter(trainer => trainer.noQueue);
  }
}

module.exports = continuouslyBuild;
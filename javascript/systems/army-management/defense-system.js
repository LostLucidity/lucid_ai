//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Alliance, Race } = require("@node-sc2/core/constants/enums");
const { QUEEN, BUNKER } = require("@node-sc2/core/constants/unit-type");
const { salvageBunker } = require("../../builds/terran/salvage-bunker");
const { getMiddleOfNaturalWall } = require("../../helper/placement/placement-helper");
const armyManagementService = require("../../services/army-management-service");
const { attackWithArmy, engageOrRetreat } = require("../../services/army-management-service");
const { getClosestUnitByPath, getCombatRally } = require("../../services/resource-manager-service");
const { getCombatPoint } = require("../../services/resources-service");
const { canBuild } = require("../../src/world-service");
const enemyTrackingService = require("../enemy-tracking/enemy-tracking-service");
const scoutService = require("../scouting/scouting-service");

module.exports = createSystem({
  name: 'DefenseSystem',
  type: 'agent',
  async onStep(world) {
    const { resources } = world;
    const { actions, units } = resources.get();
    const collectedActions = []
    const rallyPoint = getCombatRally(resources);
    if (rallyPoint) {
      collectedActions.push(...decideDefendingActions(world, rallyPoint));
    }
    let completedBases = units.getBases().filter(base => base.buildProgress >= 1);
    if (completedBases.length >= 3) {
      collectedActions.push(...salvageBunker(units));
    } else {
      // await defenseSetup(world)
    }
    await actions.sendAction(collectedActions);
  }
});

function decideDefendingActions(world, rallyPoint) {
  const { data, resources } = world;
  const { units } = resources.get();
  const collectedActions = []
  let [closestEnemyUnit] = getClosestUnitByPath(resources, rallyPoint, enemyTrackingService.threats);
  if (closestEnemyUnit) {
    let selfCombatUnits = units.getCombatUnits();
    const [combatPoint] = getClosestUnitByPath(resources, closestEnemyUnit.pos, units.getCombatUnits());
    if (combatPoint) {
      const enemyCombatUnits = units.getCombatUnits(Alliance.ENEMY);
      const enemySupply = enemyCombatUnits.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
      let selfUnits = [...selfCombatUnits, ...units.getWorkers().filter(worker => worker.isAttacking())];
      const selfSupply = selfUnits.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
      if (selfSupply > enemySupply) {
        console.log('Defend', selfSupply, enemySupply);
        if (closestEnemyUnit.isFlying) {
          const findAntiAir = selfCombatUnits.find(unit => unit.canShootUp());
          if (!findAntiAir) {
            selfCombatUnits.push(...units.getById(QUEEN));
          }
        }
        const combatPoint = getCombatPoint(resources, selfCombatUnits, closestEnemyUnit);
        if (combatPoint) {
          const army = { combatPoint, selfCombatUnits, enemyTarget: closestEnemyUnit }
          collectedActions.push(...attackWithArmy(data, units, army));
        }
      } else {
        if (selfSupply < enemySupply) {
          console.log('engageOrRetreat', selfSupply, enemySupply);
          selfCombatUnits = [...selfCombatUnits, ...units.getById(QUEEN)];
          collectedActions.push(...engageOrRetreat(world, selfCombatUnits, enemyCombatUnits, rallyPoint));
        }
      }
      armyManagementService.defenseMode = true;
    }
  } else {
    armyManagementService.defenseMode = false;
  }
  return collectedActions;
}
/**
 * @param {World} world 
 */
async function defenseSetup(world) {
  const { agent, data, resources } = world;
  const { actions, map, units } = resources.get();
  if (!scoutService.earlyScout && scoutService.enemyBuildType === 'cheese') {
    let buildAbilityId;
    switch (agent.race) {
      case Race.TERRAN:
        buildAbilityId = data.getUnitTypeData(BUNKER).abilityId;
        if ((units.getById(BUNKER).length + units.withCurrentOrders(buildAbilityId).length) < 1) {
          const natural = map.getNatural();
          const naturalWall = natural.getWall();
          if (naturalWall) {
            if (canBuild(world, BUNKER)) {
              try {
                const [foundPosition] = await getMiddleOfNaturalWall(resources, BUNKER);
                if (foundPosition) {
                  await actions.build(BUNKER, foundPosition);
                }
              } catch (error) {
                console.log(error);
              }
            }
          }
        }
        break;
    }
  }
}
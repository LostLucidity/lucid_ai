//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { QUEEN } = require("@node-sc2/core/constants/unit-type");
const { getClosestUnitByPath } = require("../helper/get-closest-by-path");
const { getCombatRally } = require("../helper/location");
const { getCombatPoint, attackWithArmy, engageOrRetreat } = require("../services/army-management-service");
const enemyTrackingService = require("./enemy-tracking/enemy-tracking-service");

module.exports = createSystem({
  name: 'DefenseSystem',
  type: 'agent',
  async onStep(world) {
    const { data, resources } = world;
    const { actions, units } = resources.get();
    const rallyPoint = getCombatRally(resources);
    const collectedActions = []
    if (rallyPoint) {
      let [closestEnemyUnit] = getClosestUnitByPath(resources, rallyPoint, enemyTrackingService.threats);
      if (closestEnemyUnit) {
        let selfCombatUnits = units.getCombatUnits();
        const [ combatPoint ] = getClosestUnitByPath(resources, closestEnemyUnit.pos, units.getCombatUnits());
        if (combatPoint) {
          const enemyCombatUnits = units.getCombatUnits(Alliance.ENEMY);
          const enemySupply = enemyCombatUnits.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
          let selfUnits = [ ...selfCombatUnits, ...units.getWorkers().filter(worker => worker.isAttacking()) ];
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
              const army = { combatPoint, selfCombatUnits, enemyTarget: closestEnemyUnit}
              collectedActions.push(...attackWithArmy(data, units, army));
            }
          } else {
            if (selfSupply < enemySupply) {
              console.log('engageOrRetreat', selfSupply, enemySupply);
              selfCombatUnits = [...selfCombatUnits, ...units.getById(QUEEN)];
              collectedActions.push(...engageOrRetreat(world, selfCombatUnits, enemyCombatUnits, rallyPoint));
            }
          }
        }
      }
    }
    await actions.sendAction(collectedActions);
  }
});
//@ts-check
"use strict"

const { STALKER, EGG, LARVA, HATCHERY, COMMANDCENTER, ORBITALCOMMAND, NEXUS } = require("@node-sc2/core/constants/unit-type");
const { avgPoints, distance } = require("@node-sc2/core/utils/geometry/point");
const { Alliance } = require('@node-sc2/core/constants/enums');
const microService = require("../services/micro-service");
const { microRangedUnit } = require("../services/micro-service");

module.exports = {
  harass: async (world, state) => {
    const { resources } = world;
    const { actions, map, units } = resources.get();
    const label = 'harasser';
    if (units.getByType(STALKER).length == 4 && units.withLabel(label).length === 0) {
      state.harassOn = true;
      const stalkers = units.getById(STALKER);
      stalkers.forEach(stalker => stalker.labels.set(label, true));
    }
    if (state.harassOn === true) {
      // focus fire enemy
      const harassers = units.withLabel(label);
      const positionsOfHarassers = harassers.map(harasser => harasser.pos);
      const averagePoints = avgPoints(positionsOfHarassers);
      const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => {
        return (
          !(unit.unitType === EGG) &&
          !(unit.unitType === LARVA) &&
          !(unit.unitType === HATCHERY) &&
          !(unit.unitType === COMMANDCENTER) &&
          !(unit.unitType === ORBITALCOMMAND) &&
          !(unit.unitType === NEXUS)
        )
      });
      let [closestEnemyUnit] = units.getClosest(averagePoints, enemyUnits, 1);
      if (units.withLabel(label).filter(harasser => harasser.labels.get(label)).length === 4) {
        if (closestEnemyUnit && distance(closestEnemyUnit.pos, averagePoints) <= 8) {
          const harasserActions = [];
          harassers.forEach(harasser => harasserActions.push(...microRangedUnit(world, harasser, closestEnemyUnit)));
          return actions.sendAction(harasserActions);
        } else {
          return actions.attackMove(harassers, map.getEnemyNatural().townhallPosition);
        }
      } else {
        if (!closestEnemyUnit || distance(closestEnemyUnit.pos, averagePoints) > 8) {
          state.harassOn = false;
          harassers.forEach(harasser => harasser.labels.set(label, false));
        }
        return actions.move(harassers, map.getCombatRally());
      }
    }
  }
}
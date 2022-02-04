//@ts-check
"use strict"

const { STALKER } = require("@node-sc2/core/constants/unit-type");
const { avgPoints, distance } = require("@node-sc2/core/utils/geometry/point");
const { Alliance } = require('@node-sc2/core/constants/enums');
const { createUnitCommand } = require("../services/actions-service");
const { ATTACK_ATTACK, MOVE } = require("@node-sc2/core/constants/ability");
const { microRangedUnit } = require("../services/world-service");

module.exports = {
  /**
   * @param {World} world 
   * @param {{ harassOn: boolean, harassFinished: boolean; }} state 
   * @returns {Promise<void>}
   */
  harass: async (world, state) => {
    const { resources } = world;
    const { actions, map, units } = resources.get();
    const label = 'harasser';
    if (units.getById(STALKER).length === 4) { 
      state.harassOn = true;
      const stalkers = units.getById(STALKER);
      stalkers.forEach(stalker => stalker.labels.set(label, true));
    }
    if (state.harassOn === true && !state.harassFinished) {
      const harassers = units.withLabel(label);
      const positionsOfHarassers = harassers.map(harasser => harasser.pos);
      const averagePoints = avgPoints(positionsOfHarassers);
      const enemyWorkers = [];
      const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => {
        if (unit.isWorker()) enemyWorkers.push(unit);
        return true;
      });
      let [closestEnemyUnit] = units.getClosest(averagePoints, enemyWorkers);
      closestEnemyUnit = closestEnemyUnit ? closestEnemyUnit : units.getClosest(averagePoints, enemyUnits)[0];
      if (units.withLabel(label).filter(harasser => harasser.labels.get(label)).length === 4) {
        if (closestEnemyUnit && distance(closestEnemyUnit.pos, averagePoints) <= 8) {
          const harasserActions = [];
          harassers.forEach(harasser => harasserActions.push(...microRangedUnit(world, harasser, closestEnemyUnit)));
          await actions.sendAction(harasserActions);
        } else {
          const outOfGroupHarassers = [];
          const groupedHarassers = harassers.filter(harasser => {
            if (distance(harasser.pos, averagePoints) > 8) outOfGroupHarassers.push(harasser);
            else return true;
          });
          const groupedHarassersCommand = createUnitCommand(ATTACK_ATTACK, groupedHarassers);
          groupedHarassersCommand.targetWorldSpacePos = map.getEnemyNatural().townhallPosition;
          const outOfGroupHarasserCommand = createUnitCommand(MOVE, outOfGroupHarassers);
          outOfGroupHarasserCommand.targetWorldSpacePos = averagePoints;
          await actions.sendAction([groupedHarassersCommand, outOfGroupHarasserCommand]);
        }
      } else {
        if (!closestEnemyUnit || distance(closestEnemyUnit.pos, averagePoints) > 8) {
          state.harassOn = false;
          state.harassFinished = true;
          harassers.forEach(harasser => harasser.labels.delete(label));
        }
        await actions.move(harassers, map.getCombatRally());
      }
    }
  }
}
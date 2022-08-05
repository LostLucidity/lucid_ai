//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { ATTACK_ATTACK, MOVE } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { STALKER } = require("@node-sc2/core/constants/unit-type");
const { avgPoints, distance } = require("@node-sc2/core/utils/geometry/point");
const { createUnitCommand } = require("../../services/actions-service");
const { microRangedUnit } = require("../../services/world-service");
const harassService = require("./harass-service");

module.exports = createSystem({
  name: "HarassSystem",
  type: "agent",
  async onStep(world) {
    const { resources } = world;
    const { actions, map, units } = resources.get();
    const label = 'harasser';
    const { harassFinished, harassOn } = harassService;
    if (harassOn === true && !harassFinished) {
      if (units.getById(STALKER).length === 4) {
        const stalkers = units.getById(STALKER);
        stalkers.forEach(stalker => stalker.labels.set(label, true));
      }
      const harassers = units.withLabel(label);
      const positionsOfHarassers = harassers.map(harasser => harasser.pos);
      const averagePoints = avgPoints(positionsOfHarassers);
      const enemyWorkers = [];
      const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => {
        if (unit.isWorker()) enemyWorkers.push(unit);
        return true;
      });
      let [closestEnemyWorker] = units.getClosest(averagePoints, enemyWorkers);
      const closestEnemyUnit = closestEnemyWorker ? closestEnemyWorker : units.getClosest(averagePoints, enemyUnits)[0];
      if (units.withLabel(label).filter(harasser => harasser.labels.get(label)).length === 4) {
        if (closestEnemyUnit && distance(closestEnemyUnit.pos, averagePoints) <= 8) {
          const harasserActions = [];
          harassers.forEach(harasser => harasserActions.push(...microRangedUnit(world, harasser, closestEnemyUnit)));
          await actions.sendAction(harasserActions);
          console.log('harassers attacking');
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
          console.log(`${groupedHarassers.length} harassers attacking`);
          console.log(`${outOfGroupHarassers.length} harassers moving`);
        }
      } else {
        if (!closestEnemyUnit || distance(closestEnemyUnit.pos, averagePoints) > 8) {
          harassService.harassOn = false;
          harassService.harassFinished = true;
          harassers.forEach(harasser => harasser.labels.delete(label));
          console.log('harass finished');
        }
        await actions.move(harassers, map.getCombatRally());
        console.log('harassers moving');
      }
    }
  }
});
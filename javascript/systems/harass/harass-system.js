//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { UnitType } = require("@node-sc2/core/constants");
const { ATTACK_ATTACK, MOVE } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { avgPoints, distance } = require("@node-sc2/core/utils/geometry/point");
const { createUnitCommand } = require("../../src/services/command-service");
const planService = require("../../services/plan-service");
const scoutingService = require("../scouting/scouting-service");
const harassService = require("./harass-service");
const armyManagementService = require("../../src/services/army-management/army-management-service");
const { pathFindingService } = require("../../src/services/pathfinding");
const { microRangedUnit } = require("../../src/services/army-management/army-management-service");

module.exports = createSystem({
  name: "HarassSystem",
  type: "agent",
  async onStep(world) {
    const { resources } = world;
    const { actions, map, units } = resources.get();
    const collectedActions = [];
    const label = 'harasser';
    const { harassFinished } = harassService;
    const { enemyBuildType } = scoutingService
    const { harass } = planService;
    if (harass) {
      const { enemyBuild, units: harassUnits } = harass;
      if (harass && !harassFinished) {
        if (enemyBuild === enemyBuildType && harassUnitsReady(units, harassUnits)) {
          harassService.harassOn = true;
        }
      }
      if (harassService.harassOn === true && !harassFinished) {
        for (const harassUnit in harassUnits) {
          const harassUnitId = UnitType[harassUnit];
          const targetUnits = units.getById(harassUnitId);
          if (harassUnits[harassUnit] === targetUnits.length) {
            targetUnits.forEach(targetUnit => targetUnit.labels.set(label, true));
          }
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
          if (closestEnemyUnit && pathFindingService.getDistanceByPath(resources, closestEnemyUnit.pos, averagePoints) <= 16) {
            const harasserActions = [];
            harassers.forEach(harasser => harasserActions.push(...microRangedUnit(world, harasser, closestEnemyUnit)));
            collectedActions.push(...harasserActions);
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
            collectedActions.push(groupedHarassersCommand, outOfGroupHarasserCommand);
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
          const unitCommand = createUnitCommand(MOVE, harassers);
          unitCommand.targetWorldSpacePos = armyManagementService.getCombatRally(resources);
          collectedActions.push(unitCommand);
          console.log('harassers moving');
        }
      }
    }
    if (collectedActions.length) {
      return actions.sendAction(collectedActions);
    }
  }
});

/**
 * @param {UnitResource} units 
 * @param {*} harassUnits
 */
function harassUnitsReady(units, harassUnits) {
  for (const unit in harassUnits) {
    if (units.getById(UnitType[unit]).length < harassUnits[unit]) return false;
  }
  return true;
}

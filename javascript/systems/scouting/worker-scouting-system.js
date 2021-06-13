//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const planService = require("../../services/plan-service");
const locationHelper = require("../../helper/location");
const scoutService = require("./scouting-service");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { MOVE } = require("@node-sc2/core/constants/ability");
const { UnitType } = require("@node-sc2/core/constants");
const { Race, Alliance } = require("@node-sc2/core/constants/enums");
const { GATEWAY, BARRACKS, SPAWNINGPOOL, ZERGLING } = require("@node-sc2/core/constants/unit-type");
const { GasMineRace } = require("@node-sc2/core/constants/race-map");

module.exports = createSystem({
  name: 'WorkerScoutSystem',
  type: 'agent',
  async onStep(world) {
    await setAndSendScout(world);
    checkEnemyBuild(world)
  }
});

async function setAndSendScout(world) {
  const { actions, map, units } = world.resources.get();
  const collectedActions = [];
  planService.scouts.forEach(scout => {
    let { food, targetLocationFunction, scoutType, unitType } = scout;
    unitType = UnitType[unitType]
    if (world.agent.foodUsed >= food) {
      const targetLocation = (map[targetLocationFunction] && map[targetLocationFunction]()) ? map[targetLocationFunction]().centroid : locationHelper[targetLocationFunction](map);
      let label;
      if (targetLocationFunction.includes('get')) {
        label = targetLocationFunction.replace('get', 'scout')
      } else {
        label = 'scout';
      }
      let labelledScouts = units.withLabel(label).filter(unit => unit.unitType === unitType && !unit.isConstructing());
      if (labelledScouts.length === 0) {
        if (scoutType && !scoutService[scoutType]) { return; }
        scoutService.setScout(units, targetLocation, unitType, label);
        labelledScouts = units.withLabel(label).filter(unit => unit.unitType === unitType && !unit.isConstructing());
        const [scout] = labelledScouts;
        if (scout && distance(scout.pos, targetLocation) > 16) {
          const unitCommand = {
            abilityId: MOVE,
            targetWorldSpacePos: targetLocation,
            unitTags: [scout.tag],
          }
          collectedActions.push(unitCommand);
        }
      }
    }
  });
  await actions.sendAction(collectedActions);
}

function checkEnemyBuild(world) {
  const { frame, map, units } = world.resources.get();
  if (frame.timeInSeconds() > 122) {
    scoutService.earlyScout = false;
    const earlyScouts = units.getAlive(Alliance.SELF).filter(unit => {
      return unit.labels.has('scoutEnemyMain') || unit.labels.has('scoutEnemyNatural');
    });
    if (earlyScouts.length > 0) {
      earlyScouts.forEach(earlyScout => {
        earlyScout.labels.clear();
        earlyScout.labels.set('clearFromEnemy', true);
      });
    }
  }
  if (scoutService.earlyScout) {
    let conditions = [];
    switch (scoutService.opponentRace) {
      case Race.PROTOSS:
        const moreThanTwoGateways = units.getById(GATEWAY, Alliance.ENEMY).length > 2;
        if (moreThanTwoGateways) {
          console.log(frame.timeInSeconds(), 'More than two gateways');
          scoutService.enemyBuildType = 'cheese';
          scoutService.earlyScout = false;
        }
        conditions = [
          units.getById(GATEWAY, Alliance.ENEMY).length === 2,
        ];
        if (!conditions.every(c => c)) {
          scoutService.enemyBuildType = 'cheese';
        } else {
          scoutService.enemyBuildType = 'standard';
        }
        scoutService.scoutReport = `${scoutService.enemyBuildType} detected:
        Gateway Count: ${units.getById(GATEWAY, Alliance.ENEMY).length}.`;
        break;
      case Race.TERRAN:
        // scout alive, more than 1 barracks.
        const moreThanOneBarracks = units.getById(BARRACKS, Alliance.ENEMY).length > 1;
        if (scoutService.enemyBuildType !== 'cheese') {
          if (moreThanOneBarracks) {
            console.log(frame.timeInSeconds(), 'More than one barracks');
            scoutService.enemyBuildType = 'cheese';
          }
        }
        // 1 barracks and 1 gas, second command center
        conditions = [
          units.getById(BARRACKS, Alliance.ENEMY).length === 1,
          units.getById(GasMineRace[scoutService.opponentRace], Alliance.ENEMY).length === 1,
          !!map.getEnemyNatural().getBase()
        ];
        if (!conditions.every(c => c)) {
          scoutService.enemyBuildType = 'cheese';
        } else {
          scoutService.enemyBuildType = 'standard';
        }
        scoutService.scoutReport = `${scoutService.enemyBuildType} detected:
        Barracks Count: ${units.getById(BARRACKS, Alliance.ENEMY).length}.
        Gas Mine Count: ${units.getById(GasMineRace[scoutService.opponentRace], Alliance.ENEMY).length}.
        Enemy Natural detected: ${!!map.getEnemyNatural().getBase()}.`;
        break;
      case Race.ZERG:
        const spawningPoolDetected = units.getById(SPAWNINGPOOL, Alliance.ENEMY).length > 0 || units.getById(ZERGLING, Alliance.ENEMY).length > 0;
        const enemyNaturalDetected = map.getEnemyNatural().getBase();
        if (scoutService.enemyBuildType !== 'cheese') {
          if (spawningPoolDetected && !enemyNaturalDetected) {
            console.log(frame.timeInSeconds(), 'Pool first. Cheese detected');
            scoutService.enemyBuildType = 'cheese';
            scoutService.scoutReport = `${scoutService.enemyBuildType} detected:
            Spawning Pool: ${units.getById(SPAWNINGPOOL, Alliance.ENEMY).length}.
            Zergling Pool: ${units.getById(ZERGLING, Alliance.ENEMY).length}
            Enemy Natural detected: ${!!map.getEnemyNatural().getBase()}`;
            scoutService.earlyScout = false;
          } else if (!spawningPoolDetected && enemyNaturalDetected) {
            console.log(frame.timeInSeconds(), 'Hatcher first. Standard.');
            scoutService.enemyBuildType = 'standard';
            scoutService.scoutReport = `${scoutService.enemyBuildType} detected:
            Spawning Pool: ${units.getById(SPAWNINGPOOL, Alliance.ENEMY).length}.
            Zergling Pool: ${units.getById(ZERGLING, Alliance.ENEMY).length}
            Enemy Natural detected: ${!!map.getEnemyNatural().getBase()}`;
            scoutService.earlyScout = false;
          }
          if (!enemyNaturalDetected && !!map.getNatural().getBase()) {
            console.log(frame.timeInSeconds(), 'Enemy expanding slower. Cheese detected');
            scoutService.enemyBuildType = 'cheese';
          }
        }
        break;
    }
  } else {
    if (scoutService.scoutReport) {
      console.log(scoutService.scoutReport);
      scoutService.scoutReport = '';
    }
  }
}
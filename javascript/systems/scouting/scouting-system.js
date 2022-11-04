//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { UnitType } = require("@node-sc2/core/constants");
const { MOVE } = require("@node-sc2/core/constants/ability");
const { Alliance, Race } = require("@node-sc2/core/constants/enums");
const { GasMineRace, TownhallRace } = require("@node-sc2/core/constants/race-map");
const { GATEWAY, BARRACKS } = require("@node-sc2/core/constants/unit-type");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { cancelEarlyScout } = require("../../builds/scouting");
const placementHelper = require("../../helper/placement/placement-helper");
const planService = require("../../services/plan-service");
const { getZergEarlyBuild } = require("../../services/world-service");
const worldService = require("../../services/world-service");
const scoutingService = require("./scouting-service");
const scoutService = require("./scouting-service");
const { setOutsupplied, setEnemyCombatSupply } = require("./scouting-service");

module.exports = createSystem({
  name: 'ScoutingSystem',
  type: 'agent',
  async onStep(world) {
    const { agent, data, resources } = world;
    checkEnemyBuild(world);
    await setAndSendScout(world);
    setEnemyCombatSupply(data);
    setPositionLastSeen(resources, TownhallRace[agent.race][0]);
    setOutsupplied();
    setOutpowered();
  }
});

/**
 * @param {World} world 
 */
function checkEnemyBuild(world) {
  const { frame, map, units } = world.resources.get();
  if (scoutingService.earlyScout) {
    if (frame.timeInSeconds() > 122) {
      scoutService.earlyScout = false;
      console.log(scoutingService.scoutReport);
      cancelEarlyScout(units);
      return;
    } else {
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
            getZergEarlyBuild(world);
            break;
        }
      }
    }
    if (!scoutingService.earlyScout) {
      console.log(scoutingService.scoutReport);
      cancelEarlyScout(units);
    }
  }
}
/**
 * @param {World} world 
 */
async function setAndSendScout(world) {
  const { actions, frame, map, units } = world.resources.get();
  const collectedActions = [];
  planService.scouts && planService.scouts.forEach((/** @type {{ end: any; start: any; targetLocation: any; unitType: any; }} */ scout) => {
    let { end, start, targetLocation, unitType } = scout;
    unitType = UnitType[unitType];
    const startConditionMet = (start.food && start.food <= world.agent.foodUsed) || start.time <= frame.timeInSeconds();
    const endConditionMet = (end.food && end.food > world.agent.foodUsed) || end.time > frame.timeInSeconds();
    const targetLocationFunction = `get${targetLocation}`;
    const location = (map[targetLocationFunction] && map[targetLocationFunction]()) ? map[targetLocationFunction]().centroid : placementHelper[targetLocationFunction](map);
    const label = `scout${location}`;
    if (startConditionMet && endConditionMet) {
      let labelledScouts = units.withLabel(label).filter(unit => unit.unitType === unitType && !unit.isConstructing());
      if (labelledScouts.length === 0) {
        scoutService.setScout(units, location, unitType, label);
        labelledScouts = units.withLabel(label).filter(unit => unit.unitType === unitType && !unit.isConstructing());
        const [scout] = labelledScouts;
        if (scout && distance(scout.pos, location) > 16) {
          const unitCommand = {
            abilityId: MOVE,
            targetWorldSpacePos: location,
            unitTags: [scout.tag],
          }
          collectedActions.push(unitCommand);
        }
      }
    } else {
      // delete label
      const labelledScouts = units.withLabel(label).filter(unit => unit.unitType === unitType && !unit.isConstructing());
      if (labelledScouts.length > 0) {
        labelledScouts.forEach(scout => {
          scout.removeLabel(label);
          scout.labels.set('clearFromEnemy', true);
        });
      }
    }
  });
  await actions.sendAction(collectedActions);
}
/**
 * 
 * @param {ResourceManager} resources 
 * @param {UnitTypeId} unitType 
 */
function setPositionLastSeen(resources, unitType) {
  const { map, frame, units } = resources.get();
  // get townhall footprint from enemy natural
  const townhallFootprint = cellsInFootprint(map.getEnemyNatural().townhallPosition, getFootprint(unitType));
  // check if any self units are in sight range of townhall footprint
  const selfUnits = units.getAlive(Alliance.SELF).filter(unit => townhallFootprint.some(cell => distance(cell, unit.pos) <= unit.data().sightRange + unit.radius));
  // if any self units are in sight range of townhall footprint, set time of last seen to current frame time
  if (selfUnits.length > 0) {
    scoutingService.lastSeen['enemyNaturalTownhallFootprint'] = frame.timeInSeconds();
  }
}
function setOutpowered() {
  worldService.outpowered = worldService.totalEnemyDPSHealth > worldService.totalSelfDPSHealth;
  if (!planService.dirtyBasePlan && worldService.outpowered) {
    planService.dirtyBasePlan = true;
    console.log('dirtyBasePlan'.toUpperCase());
  }
}
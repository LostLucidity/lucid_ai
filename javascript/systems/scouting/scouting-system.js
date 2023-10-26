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
const { createUnitCommand } = require("../../src/services/command-service");
const planService = require("../../services/plan-service");
const { getZergEarlyBuild } = require("../../src/world-service");
const worldService = require("../../src/world-service");
const enemyTrackingService = require("../enemy-tracking/enemy-tracking-service");
const scoutingService = require("./scouting-service");
const scoutService = require("./scouting-service");
const { setOutsupplied, setEnemyCombatSupply } = require("./scouting-service");
const armyManagementService = require("../../src/services/army-management/army-management-service");
const unitService = require("../../services/unit-service");
const { calculateTimeToKillUnits } = require("../../src/services/combat-statistics");
const enemyTrackingServiceV2 = require("../../src/services/enemy-tracking/enemy-tracking-service");
const { getUnitsTraining } = require("../../src/services/unit-retrieval");
const { getUnitTypeData } = require("../unit-resource/unit-resource-service");
const { combatTypes } = require("@node-sc2/core/constants/groups");

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
    setOutpowered(world);
  },
  async onUnitDamaged(world, damagedUnit) {
    const { resources } = world;
    const { actions, units } = resources.get();
    const { pos } = damagedUnit; if (pos === undefined) { return; }
    const collectedActions = [];
    if (damagedUnit.labels.get('scoutEnemyMain') || damagedUnit.labels.get('scoutEnemyNatural')) {
      const [closestEnemyUnit] = units.getClosest(pos, enemyTrackingService.enemyUnits);
      const unitCommand = createUnitCommand(MOVE, [damagedUnit]);
      unitCommand.targetWorldSpacePos = armyManagementService.retreat(world, damagedUnit, [closestEnemyUnit], false);
      collectedActions.push(unitCommand);
    }
    collectedActions.length && actions.sendAction(collectedActions);
  },
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
    const label = `scout${targetLocation}`;
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

/**
 * @param {World} world
 */
function setOutpowered(world) {
  const { units } = world.resources.get();
  const allSelfUnits = units.getAlive(Alliance.SELF);
  const allEnemyUnits = enemyTrackingServiceV2.mappedEnemyUnits;
  const unitTypesTraining = getUnitTypesInTraining(world);

  // Filter out unit types in training that are not of combat type or QUEEN
  const validTrainingTypes = unitTypesTraining.filter(type => combatTypes.includes(type) || type === UnitType.QUEEN);

  const currentSelfUnits = allSelfUnits.filter(unit => unitService.potentialCombatants(unit));
  const enemyUnits = allEnemyUnits.filter(unit => unitService.potentialCombatants(unit));

  // Create a unit object from types for valid training units
  const trainingUnits = validTrainingTypes.map(type => createMockUnitFromTypeID(world, type))
    .filter(unit => unitService.potentialCombatants(unit)); // Filter out undesired units after creation

  // Combine current units and units in training for total self units
  const totalSelfUnits = currentSelfUnits.concat(trainingUnits);

  // Calculate combined engagement metrics with default values
  let timeToKill = Infinity, timeToBeKilled = 0;
  if (totalSelfUnits.length > 0 && enemyUnits.length > 0) {
    const metrics = calculateTimeToKillUnits(world, totalSelfUnits, enemyUnits);
    timeToKill = metrics.timeToKill;
    timeToBeKilled = metrics.timeToBeKilled;
  }

  // Check if either army is empty
  if (totalSelfUnits.length === 0 && enemyUnits.length === 0) {
    armyManagementService.outpowered = false;
  } else if (totalSelfUnits.length === 0) {
    armyManagementService.outpowered = true;
  } else if (enemyUnits.length === 0) {
    armyManagementService.outpowered = false;
  } else {
    armyManagementService.outpowered = timeToKill > timeToBeKilled;
  }

  // Log details including the metrics leading to shouldEngage decision
  const logDetails = {
    selfUnitsCount: totalSelfUnits.length,
    enemyUnitsCount: enemyUnits.length,
    totalEnemyDPSHealth: worldService.totalEnemyDPSHealth,
    totalSelfDPSHealth: worldService.totalSelfDPSHealth,
    outpowered: armyManagementService.outpowered,
    shouldEngage: worldService.shouldEngage,
    timeToKill: timeToKill || "N/A",
    timeToBeKilled: timeToBeKilled || "N/A"
  };

  console.log(JSON.stringify(logDetails));

  if (armyManagementService.outpowered) {
    console.log('Outpowered! Consider training more units or improving defenses.');
  }
}

/**
 * Create a mock unit object from a unit type ID.
 * @param {World} world - The world context
 * @param {number} unitTypeID - The ID of the unit type to create.
 * @returns {Unit} - The created mock unit object.
 */
function createMockUnitFromTypeID(world, unitTypeID) {
  const { units } = world.resources.get();
  const { healthMax, isFlying, radius, shieldMax }
    = getUnitTypeData(units, unitTypeID);

  return {
    unitType: unitTypeID,
    health: healthMax,
    shield: shieldMax,
    _availableAbilities: [],
    labels: new Map(),
    isFlying: isFlying,
    radius: radius,
    abilityAvailable: () => false,
    availableAbilities: () => [],
    data: () => ({}),
    is: (type) => type === unitTypeID,
    isAttacking: () => false,
    isCloaked: () => false,
    isConstructing: () => false,
    isCombatUnit: () => true,
    isMelee: () => false,
    isEnemy: () => false,
    isFinished: () => true,
    isWorker: () => false,
    isTownhall: () => false,
    isGasMine: () => false,
    isMineralField: () => false,
    isStructure: () => false,
    isIdle: () => true,
    isCurrent: () => true,
    isHolding: () => false,
    isGathering: () => false,
    isReturning: () => false,
    isHarvesting: () => false,
    hasReactor: () => false,
    hasTechLab: () => false,
    hasNoLabels: () => true,
    canInject: () => false,
    canBlink: () => false,
    canMove: () => true,
    canShootGround: () => true,
    canShootUp: () => true,
    update: () => { },
    inject: () => Promise.resolve({}),
    blink: () => Promise.resolve({}),
    toggle: () => Promise.resolve({}),
    burrow: () => Promise.resolve({}),
    addLabel: (name, value) => new Map().set(name, value),
    hasLabel: () => false,
    getLife: () => 100,
    getLabel: () => null,
    removeLabel: () => true
  };
}

/**
 * @param {World} world
 * @returns {number[]} - Array of unit types that are currently in training
 */
function getUnitTypesInTraining(world) {
  const unitsTraining = getUnitsTraining(world);

  // Extract just the unit types from the array of objects
  const unitTypesInTraining = unitsTraining.map(unit => unit.unitType);

  return unitTypesInTraining;
}

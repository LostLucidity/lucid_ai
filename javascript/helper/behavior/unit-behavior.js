//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const getRandom = require("@node-sc2/core/utils/get-random");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { filterLabels } = require("../unit-selection");
const Ability = require("@node-sc2/core/constants/ability");
const { larvaOrEgg } = require("../groups");
const { isRepairing, isMining, getOrderTargetPosition } = require("../../systems/unit-resource/unit-resource-service");
const { createUnitCommand } = require("../../services/actions-service");
const { shadowEnemy } = require("../../builds/helper");
const { getDistance } = require("../../services/position-service");
const { pullWorkersToDefend, getUnitsInRangeOfPosition, findPosition } = require("../../src/world-service");
const { getTimeInSeconds } = require("../../services/frames-service");
const { UnitType } = require("@node-sc2/core/constants");
const { getPendingOrders, setPendingOrders, triggerAbilityByDistance } = require("../../services/unit-service");
const { getMapPath } = require("../../systems/map-resource-system/map-resource-service");
const { getPathCoordinates } = require("../../services/path-service");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { creepGeneratorsTypes } = require("@node-sc2/core/constants/groups");
const { existsInMap } = require("../location");
const { getClosestPosition } = require("../get-closest");
const { CREEPTUMOR } = require("@node-sc2/core/constants/unit-type");
const InfoRetrievalService = require('../../src/services/info-retrieval-service');
const unitService = require("../../services/unit-service");
const { calculateNearDPSHealth } = require("../../src/services/combat-statistics");
const { getClosestPathWithGasGeysers } = require("../../src/services/utility-service");
const { getWeaponDPS } = require("../../src/services/shared-utilities/combat-utilities");
const armyManagementService = require("../../src/services/army-management/army-management-service");
const { getDistanceByPath } = require("../../src/services/pathfinding/pathfinding-service");
const { getSelfUnits } = require("../../src/services/unit-retrieval/unit-retrieval-service");
const enemyTrackingService = require("../../src/services/enemy-tracking");

module.exports = {
  /**
   * @param {World} world
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  bunkerBehavior: (world) => {
    const { resources } = world;
    const { units } = resources.get();
    const collectedActions = [];
    const bunkers = units.getByType(UnitType.BUNKER);
    bunkers.forEach(bunker => {
      const { orders, passengers } = bunker; if (orders === undefined || passengers === undefined) return;
      if (orders.length > 0) console.log('bunker order', orders[0]);
      if (passengers.length > 0) {
        const { tag } = passengers[0]; if (tag === undefined) return;
        const passenger = units.getByTag(tag); if (passenger === undefined) return;
        const { orders } = passenger; if (orders === undefined) return;
        if (orders.length > 0) console.log('passenger order', orders[0]);
        const lowestTimeToKill = getLowestTimeToKill(world, bunker);
        if (lowestTimeToKill === null) return;
        const { tag: lowestTimeToKillTag } = lowestTimeToKill;
        const unitCommand = createUnitCommand(Ability.SMART, [bunker]);
        unitCommand.targetUnitTag = lowestTimeToKillTag;
        collectedActions.push(unitCommand);
      }
    });
    return collectedActions;
  },
  /**
   * @param {World} world
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  creepTumorBurrowedBehavior: (world) => {
    const { resources } = world;
    const { map, units } = resources.get();
    const collectedActions = [];
    const creepTumorsBurrowed = units.getById(UnitType.CREEPTUMORBURROWED);
    const enemyNaturalTownhallPosition = map.getEnemyNatural().townhallPosition;

    creepTumorsBurrowed.forEach(creepTumorBurrowed => handleTumor(world, creepTumorBurrowed, creepTumorsBurrowed, enemyNaturalTownhallPosition, collectedActions));

    return collectedActions;
  },      
  liberatorBehavior: (resources) => {
    const { MORPH_LIBERATORAAMODE, MORPH_LIBERATORAGMODE } = Ability;
    const {
      units,
    } = resources.get();
    const collectedActions = [];
    const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !larvaOrEgg.includes(unit.unitType) && !(unit.isStructure()));
    units.getByType(UnitType.LIBERATOR).filter(liberator => {
      let [closestEnemyUnit] = units.getClosest(liberator.pos, enemyUnits, 1);
      if (closestEnemyUnit && !closestEnemyUnit.isFlying) {
        collectedActions.push(...triggerAbilityByDistance(liberator, closestEnemyUnit.pos, '<', 10, MORPH_LIBERATORAGMODE, 'target'));
      }
    });
    units.getByType(UnitType.LIBERATORAG).filter(liberator => {
      let [closestEnemyUnit] = units.getClosest(liberator.pos, enemyUnits, 1);
      if (closestEnemyUnit && !closestEnemyUnit.isFlying) {
        collectedActions.push(...triggerAbilityByDistance(liberator, closestEnemyUnit.pos, '>', 10, MORPH_LIBERATORAAMODE));
      } else if (!closestEnemyUnit) {
        const unitCommand = {
          abilityId: MORPH_LIBERATORAAMODE,
          unitTags: [liberator.tag],
        }
        collectedActions.push(unitCommand);
      }
    });
    return collectedActions;
  },
  marineBehavior: (resources) => {
    const {
      units,
    } = resources.get();
    const { EFFECT_STIM_MARINE } = Ability;
    const collectedActions = [];
    const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !larvaOrEgg.includes(unit.unitType));
    units.getByType(UnitType.MARINE).filter(marine => {
      let [closestEnemyUnit] = units.getClosest(marine.pos, enemyUnits, 1);
      if (closestEnemyUnit) {
        if (marine.health / marine.healthMax === 1 && marine.abilityAvailable(EFFECT_STIM_MARINE)) {
          collectedActions.push(...triggerAbilityByDistance(marine, closestEnemyUnit.pos, '<', 5, EFFECT_STIM_MARINE));
        }
      }
    });
    return collectedActions;
  },
  marauderBehavior: (resources) => {
    const {
      units,
    } = resources.get();
    const { EFFECT_STIM_MARINE } = Ability;
    const collectedActions = [];
    const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !larvaOrEgg.includes(unit.unitType));
    units.getByType(UnitType.MARAUDER).filter(marauder => {
      let [closestEnemyUnit] = units.getClosest(marauder.pos, enemyUnits, 1);
      if (closestEnemyUnit) {
        if (marauder.health / marauder.healthMax === 1 && marauder.abilityAvailable(EFFECT_STIM_MARINE)) {
          collectedActions.push(...triggerAbilityByDistance(marauder, closestEnemyUnit.pos, '<', 6, EFFECT_STIM_MARINE));
        }
      }
    });
    return collectedActions;
  },
  /**
   * @param {ResourceManager} resources
   */
  muleBehavior: (resources) => {
    const { SMART } = Ability;
    const { units } = resources.get();
    const collectedActions = [];
    const mules = units.getByType(UnitType.MULE);
    // get mules that are gathering but not on a mineral field
    const mulesGatheringButNotMining = mules.filter(mule => mule.isGathering() && !isMining(units, mule));
    // check time left on mule
    mulesGatheringButNotMining.forEach(mule => {
      // if time left is less than 5 seconds, send it away
      const { buffDurationRemain, orders, pos } = mule;
      if (buffDurationRemain === undefined || orders === undefined || pos === undefined) return;
      // find order that is mining from far mineral field
      const miningOrder = orders.find(order => order.targetUnitTag !== undefined);
      if (miningOrder === undefined) return;
      const { targetUnitTag } = miningOrder;
      if (targetUnitTag === undefined) return;
      const targetUnit = units.getByTag(targetUnitTag);
      if (targetUnit === undefined) return;
      const { pos: targetPos } = targetUnit;
      if (targetPos === undefined) return;
      if (getTimeInSeconds(buffDurationRemain) < 5.59 && getDistance(pos, targetPos) < 16) {
        const mineralFields = units.getMineralFields();
        const randomMineralField = getRandom(mineralFields.filter(mineralField => mineralField.pos && getDistance(pos, mineralField.pos) > 16));
        const unitCommand = createUnitCommand(SMART, [mule]);
        unitCommand.targetUnitTag = randomMineralField.tag;
        collectedActions.push(unitCommand);
      }
    });
    return collectedActions; 
  },
  /**
   * @param {World} world
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  observerBehavior: (world) => {
    const collectedActions = [];
    const { units } = world.resources.get();
    const observers = units.getById(UnitType.OBSERVER);

    if (observers.length > 0) {
      collectedActions.push(...shadowEnemy(world, observers));
    }

    return collectedActions;
  },
  /**
   * @param {ResourceManager} resources
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  orbitalCommandCenterBehavior: (resources) => {
    const { map, units } = resources.get();
    const { LIFT_ORBITALCOMMAND } = Ability;
    const { ORBITALCOMMAND } = UnitType;
    const orbitalCommandCenters = units.getById(ORBITALCOMMAND).filter(orbitalCommandCenter => orbitalCommandCenter.abilityAvailable(LIFT_ORBITALCOMMAND));
    const expansionsWithMineralFields = getExpansionsWithMineralFields(map);
    const collectedActions = [];
    orbitalCommandCenters.forEach(orbitalCommandCenter => {
      const { pos } = orbitalCommandCenter; if (pos === undefined) { return; }
      const inRangeOfTownhallPosition = expansionsWithMineralFields.some(expansions => distance(pos, expansions.townhallPosition) < 1);
      if (inRangeOfTownhallPosition) return;
      collectedActions.push(createUnitCommand(LIFT_ORBITALCOMMAND, [orbitalCommandCenter]));
    });
    return collectedActions;
  },
  /**
   * @param {ResourceManager} resources
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  orbitalCommandCenterFlyingBehavior: (resources) => {
    const { map, units } = resources.get();
    // TODO: land orbital command center to nearest expansion with mineral fields
    const flyingOrbitalCommandCenters = units.getById(UnitType.ORBITALCOMMANDFLYING).filter(orbitalCommandCenter => orbitalCommandCenter.abilityAvailable(Ability.LAND_ORBITALCOMMAND));
    const expansionsWithMineralFields = getExpansionsWithMineralFields(map);
    const collectedActions = [];
    flyingOrbitalCommandCenters.forEach(orbitalCommandCenter => {
      const { pos, unitType } = orbitalCommandCenter; if (pos === undefined || unitType === undefined) { return; }
      const foundInRangeExpansion = expansionsWithMineralFields.find(expansion => distance(pos, expansion.townhallPosition) < 1);
      if (foundInRangeExpansion) {
        const unitCommand = createUnitCommand(Ability.LAND_ORBITALCOMMAND, [orbitalCommandCenter]);
        unitCommand.targetWorldSpacePos = foundInRangeExpansion.townhallPosition;
        collectedActions.push(unitCommand);
      } else {
        const nearestExpansion = expansionsWithMineralFields.reduce((/** @type {Expansion | undefined} */ nearestExpansion, expansion) => {
          const targettedByFlyingOrbitalCommandCenter = flyingOrbitalCommandCenters.some(flyingOrbitalCommandCenter => {
            if (orbitalCommandCenter.tag === flyingOrbitalCommandCenter.tag) return false;
            const { orders } = flyingOrbitalCommandCenter; if (orders === undefined) { return false; }
            orders.push(...getPendingOrders(orbitalCommandCenter));
            const foundOrder = orders.find(order => order.targetWorldSpacePos && distance(order.targetWorldSpacePos, expansion.townhallPosition) < 1);
            return foundOrder !== undefined;
          });
          if (targettedByFlyingOrbitalCommandCenter || !map.isPlaceableAt(UnitType.COMMANDCENTER, expansion.townhallPosition)) return nearestExpansion;
          if (nearestExpansion === undefined) return expansion;
          return getDistance(pos, expansion.townhallPosition) < getDistance(pos, nearestExpansion.townhallPosition) ? expansion : nearestExpansion;
        }, undefined);
        if (nearestExpansion) {
          const unitCommand = createUnitCommand(Ability.LAND_ORBITALCOMMAND, [orbitalCommandCenter]);
          unitCommand.targetWorldSpacePos = nearestExpansion.townhallPosition;
          collectedActions.push(unitCommand);
        }
      }
    });
    return collectedActions;
  },
  overlordBehavior: (world) => {
    const collectedActions = [];
    const { units } = world.resources.get()
    const { OVERLORD, OVERSEER } = UnitType;
    collectedActions.push(...shadowEnemy(world, units.getById([OVERLORD, OVERSEER])));
    return collectedActions;
  },
  /**
   * 
   * @param {ResourceManager} resources 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  supplyDepotBehavior: (resources) => {
    const { MORPH_SUPPLYDEPOT_LOWER, MORPH_SUPPLYDEPOT_RAISE } = Ability;
    const { units } = resources.get();
    const collectedActions = [];
    const enemyUnits = units.getAlive(Alliance.ENEMY);
    const { SUPPLYDEPOT, SUPPLYDEPOTLOWERED } = UnitType;
    units.getById([SUPPLYDEPOT, SUPPLYDEPOTLOWERED]).filter(depot => {
      let [closestEnemyUnit] = units.getClosest(depot.pos, enemyUnits.filter(unit => !unit.isFlying), 1);
      if (closestEnemyUnit && distance(closestEnemyUnit.pos, depot.pos) < 8) {
        collectedActions.push(createUnitCommand(MORPH_SUPPLYDEPOT_RAISE, [depot]));
      } else {
        collectedActions.push(createUnitCommand(MORPH_SUPPLYDEPOT_LOWER, [depot]));
      }
    });
    return collectedActions;
  },
  /**
   * @param {World} world 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  workerBehavior: (world) => {
    const { agent, resources } = world;
    const { units } = resources.get();

    const enemyUnits = enemyTrackingService.mappedEnemyUnits
      .filter(unit => unit.unitType && !larvaOrEgg.includes(unit.unitType));

    const workers = units.getById(WorkerRace[agent.race])
      .filter(unit => filterLabels(unit, ['scoutEnemyMain', 'scoutEnemyNatural', 'clearFromEnemy']) && !isRepairing(unit));

    // Early exit if no enemies or workers
    if (!enemyUnits.length || !workers.length) {
      return [];
    }

    const nonStructureEnemyUnits = enemyUnits.filter(unit => !unit.isStructure());

    const actions = [];
    for (const worker of workers) {
      if (!worker.pos) continue;

      let [closestEnemyUnit] = units.getClosest(worker.pos, nonStructureEnemyUnits, 1);
      if (!closestEnemyUnit) {
        [closestEnemyUnit] = units.getClosest(worker.pos, units.getStructures(Alliance.ENEMY), 1);
      }

      // Skip if the closest enemy unit is a peaceful worker
      if (enemyTrackingService.isPeacefulWorker(resources, closestEnemyUnit)) continue;

      actions.push(...handleThreatenedWorker(world, worker, closestEnemyUnit, workers, enemyUnits));
    }

    return actions;
  },
}

/**
 * @param {MapResource} map 
 * @returns {Expansion[]}
 */
function getExpansionsWithMineralFields(map) {
  return map.getExpansions().filter(expansion => expansion.townhallPosition && expansion.cluster.mineralFields.length > 0);
}

/**
 * @param {World} world
 * @param {Unit} bunker
 * @returns {Unit | null}
 * @description Returns the enemy unit with the lowest time to kill
 */
function getLowestTimeToKill(world, bunker) {
  const { units } = world.resources.get();
  const { pos } = bunker; if (pos === undefined) return null;
  const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => unit.pos && getDistance(pos, unit.pos) <= 16);
  const lowestTimeToKill = enemyUnits.reduce((/** @type {{ timeToKill: number, enemyUnit: Unit | null }} */ lowestTimeToKill, enemyUnit) => {
    const timeToKill = calculateTimeToKill(world, bunker, enemyUnit);
    if (timeToKill < lowestTimeToKill.timeToKill) {
      lowestTimeToKill.timeToKill = timeToKill;
      lowestTimeToKill.enemyUnit = enemyUnit;
    }
    return lowestTimeToKill;
  }, { timeToKill: Infinity, enemyUnit: null });
  return lowestTimeToKill.enemyUnit;
}

/**
 * @param {World} world
 * @param {Unit} bunker
 * @param {Unit} enemyUnit
 * @returns {number}
 * @description Returns the time it takes to kill the enemy unit
 */
function calculateTimeToKill(world, bunker, enemyUnit) {
  const { data } = world;
  const { units } = world.resources.get();
  const { alliance, passengers, pos, radius } = bunker; if (alliance === undefined || passengers === undefined || pos === undefined || radius === undefined) return Infinity;
  const { health, pos: enemyUnitPos, radius: enemyUnitRadius, shield, unitType } = enemyUnit;
  if (health === undefined || enemyUnitPos === undefined || enemyUnitRadius === undefined || shield === undefined || unitType === undefined) return Infinity;
  const bunkerDistanceToEnemyUnit = getDistance(pos, enemyUnitPos);
  const bunkerPassengers = passengers.map(passenger => passenger.tag && units.getByTag(passenger.tag));
  return bunkerPassengers.reduce((timeToKill, passenger) => {
    if (passenger === undefined || passenger === '') return timeToKill;
    const { unitType: passengerUnitType } = passenger; if (passengerUnitType === undefined) return timeToKill;
    const { weapons } = passenger.data(); if (weapons === undefined) return timeToKill;
    const weapon = unitService.getWeaponThatCanAttack(data, passengerUnitType, enemyUnit); if (weapon === undefined) return timeToKill;
    const { range, damage } = weapon; if (range === undefined || damage === undefined) return timeToKill;
    const inRange = bunkerDistanceToEnemyUnit <= (range + 1 + radius + enemyUnitRadius);
    if (!inRange) return timeToKill;
    const totalUnitHealth = health + shield;
    const timeToKillCurrent = totalUnitHealth / getWeaponDPS(world, unitType, alliance, [unitType]);
    return (timeToKill === Infinity ? timeToKillCurrent : timeToKill + timeToKillCurrent);
  }, Infinity);
}

/**
 * @param {World} world
 * @param {Unit} tumor
 * @param {Unit[]} creepTumorsBurrowed
 * @param {Point2D} enemyNaturalTownhallPosition
 * @param {SC2APIProtocol.ActionRawUnitCommand[]} collectedActions
 */
function handleTumor(world, tumor, creepTumorsBurrowed, enemyNaturalTownhallPosition, collectedActions) {
  const { resources } = world;
  const { map, units } = resources.get();
  const { pos } = tumor;
  if (pos === undefined) { return; }

  if (tumor.availableAbilities().length > 0 && !tumor.labels.get('done')) {
    if (creepTumorsBurrowed.length <= 3) {
      const { pos } = tumor;
      if (pos === undefined) { return; }
      const pathablePositions = getClosestPathWithGasGeysers(resources, pos, enemyNaturalTownhallPosition);
      const { pathablePosition, pathCoordinates } = pathablePositions;
      if (!pathablePosition) { return; }
      const [farthestPosition] = pathCoordinates.filter(position => distance(position, pos) <= 10 && map.hasCreep(position)).sort((a, b) => distance(b, pos) - distance(a, pos));
      if (!farthestPosition) { return; }

      const unitCommand = createUnitCommand(Ability.BUILD_CREEPTUMOR_TUMOR, [tumor]);
      unitCommand.targetWorldSpacePos = farthestPosition;
      collectedActions.push(unitCommand);
    } else {
      const radius = 10;
      let lowerLimit = 9;
      let foundPosition = null;
      const { pos } = tumor;
      if (pos === undefined) {
        return;
      }
      const hasCreepTumorAbility = tumor.availableAbilities().includes(Ability.BUILD_CREEPTUMOR_TUMOR);
      if (!hasCreepTumorAbility) {
        return;
      }
  
      do {
        let excludedCircle = gridsInCircle(pos, lowerLimit);
        const creepGenerators = units.getById(creepGeneratorsTypes);
        const candidatePositions = gridsInCircle(pos, radius).filter(position => {
          if (!existsInMap(map, position)) return false;
          const [closestCreepGenerator] = units.getClosest(position, creepGenerators);
          const { pos: closestCreepGeneratorPos } = closestCreepGenerator;
          if (closestCreepGeneratorPos === undefined) return false;
          const [closestTownhallPosition] = getClosestPosition(position, map.getExpansions().map(expansion => expansion.townhallPosition));
          const isSafePosition = armyManagementService.isStrongerAtPosition(world, position);
  
          return [
            closestCreepGenerator,
            !excludedCircle.includes(position),
            distance(position, closestCreepGeneratorPos) > lowerLimit,
            distance(position, pos) <= radius,
            closestTownhallPosition ? distance(position, closestTownhallPosition) > 3 : true,
            isSafePosition
          ].every(condition => condition);
        });
  
        if (candidatePositions.length > 0) {
          foundPosition = findPosition(world, CREEPTUMOR, candidatePositions);
        }
  
        lowerLimit -= 0.5;
      } while (!foundPosition && lowerLimit > 0);
  
  
      if (foundPosition) {
        const unitCommand = createUnitCommand(Ability.BUILD_CREEPTUMOR_TUMOR, [tumor]);
        unitCommand.targetWorldSpacePos = foundPosition;
        collectedActions.push(unitCommand);
      }
  
      tumor.labels.set('done', true);
    }
  }
}

/**
 * Handle a worker that's threatened by an enemy unit.
 * 
 * @param {World} world - The game world 
 * @param {Unit} worker - The worker under threat
 * @param {Unit} closestEnemyUnit - The nearest enemy unit
 * @param {Unit[]} allWorkers - All worker units
 * @param {Unit[]} enemyUnits - All enemy units
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - The actions to be taken
 */
function handleThreatenedWorker(world, worker, closestEnemyUnit, allWorkers, enemyUnits) {
  const collectedActions = [];

  if (!isWithinDangerDistance(worker, closestEnemyUnit)) return collectedActions;

  const workerDPSHealth = InfoRetrievalService.getSelfDPSHealth(world, worker);
  const enemyDPSHealth = InfoRetrievalService.getSelfDPSHealth(world, closestEnemyUnit);

  if (enemyDPSHealth <= workerDPSHealth) return collectedActions;

  const newActions = workerIsBuilder(worker)
    ? handleBuilder(world, worker, closestEnemyUnit, enemyUnits)
    : handleRetreatOrDefend(world, worker, enemyUnits, allWorkers);

  collectedActions.push(...newActions);

  return collectedActions;
}

/**
 * @param {Unit} worker
 * @param {Unit} enemy
 * @returns {boolean}
 */
function isWithinDangerDistance(worker, enemy) {
  if (!worker.pos || !enemy.pos) {
    return false;  // You can handle it differently if needed
  }
  return getDistance(worker.pos, enemy.pos) < 16;
}

/**
 * @param {Unit} worker
 * @returns {boolean}
 */
function workerIsBuilder(worker) {
  return worker.labels.get('builder');
}

/**
 * @param {World} world
 * @param {Unit} worker
 * @param {Unit} closestEnemyUnit
 * @param {Unit[]} enemyUnits
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function handleBuilder(world, worker, closestEnemyUnit, enemyUnits) {
  const { frame } = world.resources.get();
  const collectedActions = [];
  const orders = worker.orders || [];
  const hasOrders = orders.length > 0;

  let position;
  let moveOrder;

  if (hasOrders) {
    moveOrder = orders.find(order => order.abilityId === Ability.MOVE);
    position = moveOrder ? moveOrder.targetWorldSpacePos : worker.pos;
  } else {
    position = worker.isGathering() || worker.isConstructing() ? worker.pos : undefined;
  }

  // Logging
  if (hasOrders) {
    orders.forEach(order => {
      console.log(frame.timeInSeconds(), `Builder Ability: ${Object.keys(Ability).find(ability => Ability[ability] === order.abilityId)}, worker.tag: ${worker.tag}`);
    });
  } else {
    console.log(frame.timeInSeconds(), 'No Orders');
  }

  // Decision-making
  if (position && closestEnemyUnit.pos && (moveOrder || !hasOrders) && getDistance(position, closestEnemyUnit.pos) <= 3) {
    collectedActions.push(...pullWorkersToDefend(world, worker, closestEnemyUnit, enemyUnits));
  } else {
    console.log('Ignore out of build range enemy.');
  }

  return collectedActions;
}

/**
 * Handle retreat or defend logic for a threatened worker.
 * 
 * @param {World} world 
 * @param {Unit} worker - The worker under threat
 * @param {Unit[]} enemyUnits - All enemy units
 * @param {Unit[]} allWorkers - All worker units
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function handleRetreatOrDefend(world, worker, enemyUnits, allWorkers) {

  const { resources } = world;
  const { map, units } = resources.get();
  const { orders, pos } = worker;

  // Initialize actions array.
  let actions = [];

  if (!pos || !orders) return actions;

  const workerDestination = getOrderTargetPosition(units, worker);

  if (!workerDestination || getDistance(pos, workerDestination) <= 16) {
    handleCloseProximityActions(world, worker, enemyUnits, allWorkers, actions);
    return actions;
  }

  handleGatheringActions(map, worker, workerDestination);

  const closestEnemyUnitPos = getClosestEnemyPosition(units, pos, enemyUnits);

  if (!closestEnemyUnitPos) return actions;

  const closestEnemyUnit = getUnitByPosition(enemyUnits, closestEnemyUnitPos);

  if (!closestEnemyUnit) {
    // Handle this situation appropriately, maybe return or do some other action
    return actions;
  }

  // Check for retreat options
  const retreatPoint = armyManagementService.retreat(world, worker, [closestEnemyUnit]);
  if (retreatPoint) {
    actions.push(createFinalMoveCommand(worker, retreatPoint, false));
    return actions;
  }

  const workerPathDistance = getDistanceByPath(resources, pos, workerDestination);
  const enemyPathDistance = getDistanceByPath(resources, closestEnemyUnitPos, workerDestination);

  const isWorkerGathering = worker.isGathering();

  if (isWorkerGathering) {
    resetPathability(map, worker, workerDestination);
  }

  if (workerPathDistance < enemyPathDistance && !isWorkerGathering) {
    actions.push(createFinalMoveCommand(worker, workerDestination));
    return actions;
  }

  actions = handleWaypointActions(map, worker, workerDestination, closestEnemyUnitPos, actions);

  return actions;
}

/**
 * @param {Point2D} waypoint
 * @param {Point2D} reference
 * @param {number} angleToDestination
 * @param {number} halfPi
 * @returns {boolean}
 */
function isWaypointSuitable(waypoint, reference, angleToDestination, halfPi) {
  if (!waypoint.x || !waypoint.y || !reference.x || !reference.y) {
    throw new Error('One or more coordinates are undefined');
  }

  return Math.abs(Math.atan2(waypoint.y - reference.y, waypoint.x - reference.x) - angleToDestination) < halfPi;
}

/**
 * @param {MapResource} map
 * @param {Point2D} pos
 * @param {number} numWaypoints
 * @param {number} bypassDistance
 * @param {number} angleToDestination
 * @returns {Point2D[]} waypoints
 */
function generateWaypoints(map, pos, numWaypoints, bypassDistance, angleToDestination) {
  if (!pos.x || !pos.y) {
    throw new Error('Position x or y is undefined');
  }

  const waypoints = [];
  const angleIncrement = 2 * Math.PI / numWaypoints;
  const halfPi = Math.PI / 2;

  for (let i = 0; i < numWaypoints; i++) {
    const angle = angleIncrement * i;
    const waypoint = {
      x: pos.x + bypassDistance * Math.cos(angle),
      y: pos.y + bypassDistance * Math.sin(angle)
    };

    if (map.isPathable(waypoint)) {
      waypoints.push(waypoint);
    }
  }

  return waypoints.filter(wp => isWaypointSuitable(wp, pos, angleToDestination, halfPi));
}

/**
 * @param {Point2D[]} waypoints
 * @param {Point2D} enemyPos
 * @returns {Point2D | undefined}
 */
function selectBestWaypoint(waypoints, enemyPos) {
  return waypoints.sort((a, b) => getDistance(a, enemyPos) - getDistance(b, enemyPos)).pop();
}
/**
 * @param {Unit[]} unitsToExtract
 * @returns {number[]}
 */
function extractUnitTypes(unitsToExtract) {
  return unitsToExtract.reduce((/** @type {number[]} */ acc, unit) => {
    if (typeof unit.unitType === 'number') {
      acc.push(unit.unitType);
    }
    return acc;
  }, []);
}

/**
 * @param {Unit} unit
 * @returns {boolean}
 */
function isArmed(unit) {
  return (unit.data().weapons || []).some(w => w.range || 0 > 0);
}

/**
 * @param {World} world
 * @param {Unit} worker
 * @param {Unit[]} enemyUnits
 * @param {Unit[]} workers
 * @param {SC2APIProtocol.ActionRawUnitCommand[]} collectedActions
 */
function handleCloseProximityActions(world, worker, enemyUnits, workers, collectedActions) {
  if (!worker.pos || (worker['pendingOrders'] && worker['pendingOrders'].length > 0)) return;

  const { units } = world.resources.get();
  const workerPosition = worker.pos;

  const closestEnemies = units.getClosest(workerPosition, enemyUnits.filter(isArmed));

  if (closestEnemies.length === 0) return;

  const selfCombatRallyUnits = getUnitsInRangeOfPosition(world, armyManagementService.getCombatRally(world.resources));
  const selfCombatRallyUnitTypes = extractUnitTypes(selfCombatRallyUnits);
  const inRangeUnitsOfClosestEnemy = getSelfUnits(units, closestEnemies[0], enemyTrackingService.mappedEnemyUnits);

  const inRangeUnitTypesOfClosestEnemy = extractUnitTypes(inRangeUnitsOfClosestEnemy);
  const selfCombatRallyDPSHealth = calculateNearDPSHealth(world, selfCombatRallyUnits, inRangeUnitTypesOfClosestEnemy);
  const inRangeCombatUnitsOfEnemyDPSHealth = calculateNearDPSHealth(world, inRangeUnitsOfClosestEnemy, selfCombatRallyUnitTypes);

  const shouldRallyToCombatRally = selfCombatRallyDPSHealth > inRangeCombatUnitsOfEnemyDPSHealth;
  const targetPosition = armyManagementService.retreat(world, worker, closestEnemies, shouldRallyToCombatRally);

  /** @type {SC2APIProtocol.ActionRawUnitCommand} */
  const unitCommand = {
    abilityId: Ability.MOVE,
    targetWorldSpacePos: targetPosition,
    unitTags: []
  };

  const closeWorkers = workers.filter(unit => unit.pos && getDistance(unit.pos, workerPosition) <= 1);
  unitCommand.unitTags = closeWorkers.reduce((/** @type {string[]} */ acc, unit) => {
    setPendingOrders(unit, unitCommand);
    if (unit.tag) {
      acc.push(unit.tag);
    }
    return acc;
  }, []);

  collectedActions.push(unitCommand);
}

/**
 * Creates and returns a final move command for a worker.
 * 
 * @param {Unit} worker The worker for which the command should be created.
 * @param {Point2D} workerDestination The destination position for the worker.
 * @returns {SC2APIProtocol.ActionRawUnitCommand} The generated move command.
 */
function createFinalMoveCommand(worker, workerDestination, queue = true) {
  return {
    ...createUnitCommand(Ability.SMART, [worker]),
    targetWorldSpacePos: workerDestination,
    queueCommand: queue
  };
}

/**
 * @param {MapResource} map
 * @param {Point2D} workerDestination
 * @param {number} gatherType
 * @param {boolean} isPathable
 */
function handlePathability(map, workerDestination, gatherType, isPathable) {
  // Early exit if workerDestination is not provided
  if (!workerDestination) return;

  const footprint = getFootprint(gatherType);
  if (!footprint) return;

  const footprintCells = cellsInFootprint(workerDestination, footprint);
  for (let i = 0; i < footprintCells.length; i++) {
    map.setPathable(footprintCells[i], isPathable);
  }
}

/**
 * Calculate angles between worker's destination and the closest enemy unit.
 *
 * @param {Point2D} workerDestination - The worker's destination point.
 * @param {Point2D} pos - The current position of the worker.
 * @param {Point2D} closestEnemyUnitPos - The position of the closest enemy unit.
 * @return {{ angleToEnemy: number, angleToDestination: number }} - The angles in radians.
 */
function calculateAngles(workerDestination, pos, closestEnemyUnitPos) {
  const { x = 0, y = 0 } = pos;
  const { x: closestEnemyUnitX = 0, y: closestEnemyUnitY = 0 } = closestEnemyUnitPos;
  const { x: destinationX = 0, y: destinationY = 0 } = workerDestination;

  // Function to calculate angle between two points
  const calculateAngle = (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1);

  // Angle calculations
  const angleToEnemy = calculateAngle(x, y, closestEnemyUnitX, closestEnemyUnitY);
  const angleToDestination = calculateAngle(x, y, destinationX, destinationY);

  // Check for invalid calculations
  if (isNaN(angleToEnemy) || isNaN(angleToDestination)) {
    throw new Error("Invalid angle calculation");
  }

  return {
    angleToEnemy,
    angleToDestination
  };
}

/**
 * @param {MapResource} map
 * @param {Unit} worker
 * @param {Point2D} workerDestination
 */
function handleGatheringActions(map, worker, workerDestination) {
  let gatherType;

  if (worker.isGathering('minerals')) {
    gatherType = UnitType.MINERALFIELD;
  } else if (worker.isGathering('vespene')) {
    gatherType = UnitType.VESPENEGEYSER;
  } else {
    return; // worker isn't gathering any resource
  }

  const footprint = getFootprint(gatherType);
  if (!footprint) return;

  cellsInFootprint(workerDestination, footprint).forEach(cell => map.setPathable(cell, true));
  handlePathability(map, workerDestination, gatherType, true);
}

/**
 * @param {UnitResource} units
 * @param {Point2D} workerPos
 * @param {Unit[]} enemyUnits
 * @returns {Point2D | null}
 */
function getClosestEnemyPosition(units, workerPos, enemyUnits) {
  const result = units.getClosest(workerPos, enemyUnits);

  if (!result || !result[0]) {
    return null;
  }

  const [closestEnemyUnit] = result;
  return closestEnemyUnit.pos || null;
}

/**
 * Resets the pathability of the worker's gathering destination.
 * 
 * @param {MapResource} map - The map object.
 * @param {Unit} worker - The worker unit.
 * @param {Point2D} workerDestination - The destination of the worker.
 */
function resetPathability(map, worker, workerDestination) {
  if (!worker.isGathering()) return;

  const gatherType = determineGatherType(worker);

  handlePathability(map, workerDestination, gatherType, false);
}

/**
 * Determines the type of resource the worker is gathering.
 * 
 * @param {Unit} worker - The worker unit.
 * @returns {number} - The type of resource (MINERALFIELD or VESPENEGEYSER).
 */
function determineGatherType(worker) {
  return worker.isGathering('minerals') ? UnitType.MINERALFIELD : UnitType.VESPENEGEYSER;
}

/**
 * Handles the actions for waypoints based on the worker's and enemy's positions. 
 * Determines the best waypoint to take and collects the appropriate movement actions for the worker.
 *
 * @param {MapResource} map - The game map.
 * @param {Unit} worker - The worker unit.
 * @param {Point2D} workerDestination - The destination of the worker.
 * @param {Point2D} enemyPos - The position of the nearest enemy.
 * @param {SC2APIProtocol.ActionRawUnitCommand[]} collectedActions - The collection of actions to be updated.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function handleWaypointActions(map, worker, workerDestination, enemyPos, collectedActions) {
  const workerPos = worker.pos;
  if (!workerPos) return collectedActions; // Explicitly return collectedActions for clarity

  const angleToDestination = calculateAngles(workerDestination, workerPos, enemyPos).angleToDestination;

  // Generate potential waypoints based on worker's position and angle to the destination
  const potentialWaypoints = generateWaypoints(map, workerPos, 8, 3, angleToDestination);

  // Select the best waypoint considering the enemy's position
  const bestWaypoint = selectBestWaypoint(potentialWaypoints, enemyPos);

  if (!bestWaypoint) return collectedActions;

  const pathToWaypoint = getMapPath(map, workerPos, bestWaypoint);
  const pathCoordinates = getPathCoordinates(pathToWaypoint);

  // Start the path from the worker's current position
  pathCoordinates.unshift(workerPos);

  // Collect movement actions based on the best path towards the destination
  collectMovementActions(worker, pathCoordinates, workerDestination, collectedActions);

  return collectedActions;
}

/**
 * Generates and collects movement commands based on the given path coordinates for a worker.
 * It will update the collectedActions array with the movement actions for the worker to take.
 *
 * @param {Unit} worker - The worker unit.
 * @param {Point2D[]} pathCoordinates - An array of path coordinates that the worker should follow.
 * @param {Point2D} workerDestination - The final destination of the worker.
 * @param {SC2APIProtocol.ActionRawUnitCommand[]} collectedActions - The collection of actions to be updated.
 */
function collectMovementActions(worker, pathCoordinates, workerDestination, collectedActions) {
  // For simplification, let's assume the MOVE command has a constant value of MOVE_ABILITY_ID.
  // You might need to replace this with the actual AbilityId constant for MOVE from your environment.
  const MOVE_ABILITY_ID = Ability.MOVE;

  // Issue a clear command at the first position in the complete path
  const clearCommand = createUnitCommand(MOVE_ABILITY_ID, [worker], false);
  clearCommand.targetWorldSpacePos = pathCoordinates[0];
  collectedActions.push(clearCommand);

  // Issue move orders for each coordinate in the path
  for (const point of pathCoordinates) {
    const moveCommand = createUnitCommand(MOVE_ABILITY_ID, [worker], true);
    moveCommand.targetWorldSpacePos = point;
    collectedActions.push(moveCommand);
  }

  // Set the last order to the original destination
  const finalMoveCommand = createUnitCommand(MOVE_ABILITY_ID, [worker], true);
  finalMoveCommand.targetWorldSpacePos = workerDestination;
  collectedActions.push(finalMoveCommand);
}

/**
 * Retrieve a unit by its position.
 * 
 * @param {Unit[]} units - Array of units to search.
 * @param {Point2D} targetPos - The position to match against.
 * @param {number} [threshold=0.5] - How close a unit must be to be considered a match.
 * @returns {Unit|undefined} - Returns the found unit or undefined if not found.
 */
function getUnitByPosition(units, targetPos, threshold = 0.5) {
  return units.find(unit => {
    if (!unit.pos || unit.pos.x === undefined || unit.pos.y === undefined) return false;

    if (targetPos.x === undefined || targetPos.y === undefined) return false;

    const distance = Math.sqrt(Math.pow(unit.pos.x - targetPos.x, 2) + Math.pow(unit.pos.y - targetPos.y, 2));

    return distance <= threshold;
  });
}


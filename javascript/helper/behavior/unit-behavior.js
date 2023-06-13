//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const getRandom = require("@node-sc2/core/utils/get-random");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { getInRangeUnits, calculateHealthAdjustedSupply } = require("../battle-analysis");
const { filterLabels } = require("../unit-selection");
const Ability = require("@node-sc2/core/constants/ability");
const { larvaOrEgg } = require("../groups");
const { isRepairing, isMining } = require("../../systems/unit-resource/unit-resource-service");
const { createUnitCommand } = require("../../services/actions-service");
const { shadowEnemy } = require("../../builds/helper");
const { getDistance } = require("../../services/position-service");
const { retreat, pullWorkersToDefend, calculateNearDPSHealth, getUnitsInRangeOfPosition, getWeaponDPS } = require("../../services/world-service");
const { canAttack } = require("../../services/resources-service");
const { getTimeInSeconds } = require("../../services/frames-service");
const { UnitType } = require("@node-sc2/core/constants");
const { getCombatRally } = require("../../services/resource-manager-service");
const { getPendingOrders, setPendingOrders, getWeaponThatCanAttack, triggerAbilityByDistance } = require("../../services/unit-service");

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
  observerBehavior: (world) => {
    const collectedActions = [];
    const { units } = world.resources.get()
    collectedActions.push(...shadowEnemy(world, units.getById(UnitType.OBSERVER)));
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
    const { MOVE } = Ability;
    const { agent, resources } = world
    const { frame, units } = resources.get();
    const collectedActions = [];
    const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !larvaOrEgg.includes(unit.unitType));
    const workers = units.getById(WorkerRace[agent.race]).filter(unit => filterLabels(unit, ['scoutEnemyMain', 'scoutEnemyNatural', 'clearFromEnemy']) && !isRepairing(unit));
    if (enemyUnits.length > 0) {
      for (const worker of workers) {
        let [closestEnemyUnit] = units.getClosest(worker.pos, enemyUnits.filter(unit => !unit.isStructure()), 1);
        if (!closestEnemyUnit) { [closestEnemyUnit] = units.getClosest(worker.pos, units.getStructures(Alliance.ENEMY), 1) }
        const distanceToClosestEnemy = distance(worker.pos, closestEnemyUnit.pos);
        if (distanceToClosestEnemy < 16) {
          const inRangeSelfCombatUnits = getInRangeUnits(worker, units.getCombatUnits(Alliance.SELF));
          const inRangeCombatSupply = calculateHealthAdjustedSupply(world, inRangeSelfCombatUnits);
          const inRangeCombatUnitsOfEnemy = getInRangeUnits(closestEnemyUnit, units.getCombatUnits(Alliance.SELF));
          const inRangeCombatUnitsOfEnemySupply = calculateHealthAdjustedSupply(world, inRangeCombatUnitsOfEnemy);
          closestEnemyUnit['inRangeUnits'] = getInRangeUnits(closestEnemyUnit, enemyUnits);
          const inRangeEnemySupply = calculateHealthAdjustedSupply(world, closestEnemyUnit['inRangeUnits']);
          const combatSupply = inRangeCombatSupply > inRangeCombatUnitsOfEnemySupply ? inRangeCombatSupply : inRangeCombatUnitsOfEnemySupply;
          if (inRangeEnemySupply > combatSupply) {
            const inRangeWorkers = getInRangeUnits(worker, workers);
            const inRangeWorkerSupply = calculateHealthAdjustedSupply(world, inRangeWorkers);
            if (inRangeEnemySupply > inRangeWorkerSupply) {
              worker.labels.set('retreating');
              const unitCommand = { abilityId: MOVE }
              if (worker['pendingOrders'] === undefined || worker['pendingOrders'].length === 0) {
                const [closestArmedEnemyUnit] = units.getClosest(worker.pos, enemyUnits.filter(unit => unit.data().weapons.some(w => w.range > 0)));
                const [closestAttackableEnemyUnit] = units.getClosest(worker.pos, enemyUnits.filter(enemyUnit => canAttack(worker, enemyUnit)));
                const selfCombatRallyUnits = getUnitsInRangeOfPosition(world, getCombatRally(resources));
                // @ts-ignore
                const selfCombatRallyDPSHealth = calculateNearDPSHealth(world, selfCombatRallyUnits, closestEnemyUnit['inRangeUnits'].map((/** @type {{ Unit }} */ unit) => unit.unitType));
                // @ts-ignore
                const inRangeCombatUnitsOfEnemyDPSHealth = calculateNearDPSHealth(world, closestEnemyUnit['inRangeUnits'], selfCombatRallyUnits.map(unit => unit.unitType));
                const shouldRallyToCombatRally = selfCombatRallyDPSHealth > inRangeCombatUnitsOfEnemyDPSHealth; 
                unitCommand.targetWorldSpacePos = retreat(world, worker, closestArmedEnemyUnit || closestAttackableEnemyUnit, shouldRallyToCombatRally);
                unitCommand.unitTags = workers.filter(unit => distance(unit.pos, worker.pos) <= 1).map(unit => {
                  setPendingOrders(unit, unitCommand);
                  return unit.tag;
                });
                collectedActions.push(unitCommand);
              }
            } else {
              if (worker.labels.get('builder')) {
                const buildOnStandby = (worker.orders.length === 0 || worker.isGathering()) || worker.isConstructing();
                const moveOrder = worker.orders.find(order => order.abilityId === MOVE);
                const position = buildOnStandby ? worker.pos : (moveOrder ? moveOrder.targetWorldSpacePos : worker.pos);
                if (worker.orders.length === 0) {
                  console.log(frame.timeInSeconds(), 'No Orders');
                } else {
                  worker.orders.forEach(order => console.log(frame.timeInSeconds(), `Builder Ability: ${Object.keys(Ability).find(ability => Ability[ability] === order.abilityId)}, worker.tag: ${worker.tag}`));
                }
                if ((buildOnStandby || moveOrder) && distance(position, closestEnemyUnit.pos) > 3) {
                  console.log('Ignore out of build range enemy.');
                  continue;
                } else {
                  collectedActions.push(...pullWorkersToDefend(world, worker, closestEnemyUnit, enemyUnits));
                }
              }
            }
          }
        }
      }
    }
    return collectedActions;
  }
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
    const weapon = getWeaponThatCanAttack(data, passengerUnitType, enemyUnit); if (weapon === undefined) return timeToKill;
    const { range, damage } = weapon; if (range === undefined || damage === undefined) return timeToKill;
    const inRange = bunkerDistanceToEnemyUnit <= (range + 1 + radius + enemyUnitRadius);
    if (!inRange) return timeToKill;
    const totalUnitHealth = health + shield;
    const timeToKillCurrent = totalUnitHealth / getWeaponDPS(world, unitType, alliance, [unitType]);
    return (timeToKill === Infinity ? timeToKillCurrent : timeToKill + timeToKillCurrent);
  }, Infinity);
}


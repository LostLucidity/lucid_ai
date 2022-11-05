//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getOccupiedExpansions, getBase } = require("../expansions");
const getRandom = require("@node-sc2/core/utils/get-random");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { getInRangeUnits, calculateHealthAdjustedSupply } = require("../battle-analysis");
const { filterLabels } = require("../unit-selection");
const Ability = require("@node-sc2/core/constants/ability");
const { larvaOrEgg } = require("../groups");
const { isRepairing, setPendingOrders, isMining } = require("../../systems/unit-resource/unit-resource-service");
const { createUnitCommand } = require("../../services/actions-service");
const { shadowEnemy } = require("../../builds/helper");
const { moveAwayPosition, getDistance } = require("../../services/position-service");
const { retreat, pullWorkersToDefend, calculateNearDPSHealth, getUnitsInRangeOfPosition } = require("../../services/world-service");
const { canAttack } = require("../../services/resources-service");
const { getTimeInSeconds } = require("../../services/frames-service");
const { UnitType } = require("@node-sc2/core/constants");
const { getCombatRally } = require("../../services/resource-manager-service");

module.exports = {
  /**
   * @param {ResourceManager} resources 
   * @returns {Point2D[]}
   */
  barracksBehavior: (resources) => {
    const collectedActions = [];
    const { units } = resources.get();
    units.getByType(UnitType.BARRACKS).forEach(unit => {
      const foundRallyAbility = unit.availableAbilities().find(ability => ability === Ability.RALLY_BUILDING);
      if (foundRallyAbility) {
        const unitCommand = createUnitCommand(foundRallyAbility, [unit]);
        let rallyPosition = getCombatRally(resources);
        const [closestEnemyUnit] = units.getClosest(unit.pos, units.getAlive(Alliance.ENEMY)).filter(enemyUnit => distance(enemyUnit.pos, unit.pos) < 16);
        if (closestEnemyUnit && unit['selfDPSHealth'] < closestEnemyUnit['selfDPSHealth']) {
          rallyPosition = moveAwayPosition(closestEnemyUnit.pos, unit.pos);
        }
        unitCommand.targetWorldSpacePos = rallyPosition;
        collectedActions.push(unitCommand);
      }
    });
    return collectedActions;
  },
  orbitalCommandCenterBehavior: (resources, action) => {
    const { EFFECT_CALLDOWNMULE, EFFECT_SCAN } = Ability;
    const {
      units,
    } = resources.get();
    const collectedActions = [];
    const orbitalCommand = units.getById(UnitType.ORBITALCOMMAND).find(n => n.energy > 50);
    if (orbitalCommand) {
      const expansions = getOccupiedExpansions(resources).filter(expansion => getBase(resources, expansion).buildProgress >= 1);
      if (expansions.length >= 0) {
        const randomExpansion = getRandom(expansions);
        if (randomExpansion) {
          if (action === EFFECT_CALLDOWNMULE) {
            const [closestMineralField] = units.getClosest(randomExpansion.townhallPosition, units.getMineralFields());
            if (closestMineralField) {
              const unitCommand = {
                abilityId: EFFECT_CALLDOWNMULE,
                targetUnitTag: closestMineralField.tag,
                unitTags: [orbitalCommand.tag],
              }
              collectedActions.push(unitCommand);
            }
          }
        }
      }
      const enemyCloakedUnits = units.getAlive(Alliance.ENEMY).filter(unit => unit.isCloaked());
      const randomCloak = enemyCloakedUnits[Math.floor(Math.random() * enemyCloakedUnits.length)];
      if (randomCloak) {
        const unitCommand = {
          abilityId: EFFECT_SCAN,
          targetWorldSpacePos: randomCloak.pos,
          unitTags: [orbitalCommand.tag],
        }
        collectedActions.push(unitCommand);
      }
    }
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
      if (closestEnemyUnit && distance(closestEnemyUnit.pos, depot.pos) < 16) {
        collectedActions.push(createUnitCommand(MORPH_SUPPLYDEPOT_RAISE, [depot]));
      } else {
        collectedActions.push(createUnitCommand(MORPH_SUPPLYDEPOT_LOWER, [depot]));
      }
    });
    return collectedActions;
  },
  tankBehavior: (units, target) => {
    const collectedActions = [];
    const { MORPH_SIEGEMODE, MORPH_UNSIEGE } = Ability;
    const { SIEGETANK, SIEGETANKSIEGED } = UnitType;
    // get siege tanks
    if (target) {
      units.getByType(SIEGETANK).filter(tank => {
        collectedActions.push(...triggerAbilityByDistance(tank, target, '<', 4, MORPH_SIEGEMODE));
      });
      units.getByType(SIEGETANKSIEGED).filter(tank => {
        collectedActions.push(...triggerAbilityByDistance(tank, target, '>', 4, MORPH_UNSIEGE));
      });
    } else {
      const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !larvaOrEgg.includes(unit.unitType));
      units.getByType(SIEGETANK).filter(tank => {
        let [closestEnemyUnit] = units.getClosest(tank.pos, enemyUnits, 1);
        if (closestEnemyUnit) {
          collectedActions.push(...triggerAbilityByDistance(tank, closestEnemyUnit.pos, '<', 13, MORPH_SIEGEMODE));
        }
      });
      units.getById(SIEGETANKSIEGED).filter(tank => {
        let [closestEnemyUnit] = units.getClosest(tank.pos, enemyUnits, 1);
        if (closestEnemyUnit) {
          collectedActions.push(...triggerAbilityByDistance(tank, closestEnemyUnit.pos, '>', 13, MORPH_UNSIEGE));
        }
      });
    }
    return collectedActions;
  },
  /**
   * @param {World} world 
   * @returns {Promise<SC2APIProtocol.ActionRawUnitCommand[]>}
   */
  workerBehavior: async (world) => {
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
                const [closestAttackableEnemyUnit] = units.getClosest(worker.pos, enemyUnits.filter(enemyUnit => canAttack(resources, worker, enemyUnit)));
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
                  collectedActions.push(...await pullWorkersToDefend(world, worker, closestEnemyUnit, enemyUnits));
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

function triggerAbilityByDistance(unit, target, operator, range, abilityId, pointType) {
  const collectedActions = [];
  if (!unit.isEnemy()) {
    const unitCommand = {};
    if (operator === '>' && distance(unit.pos, target) > range) {
      unitCommand.abilityId = abilityId;
      unitCommand.unitTags = [unit.tag];
    } else if (operator === '<' && distance(unit.pos, target) < range) {
      unitCommand.abilityId = abilityId;
      unitCommand.unitTags = [unit.tag];
    }
    if (pointType === 'target') {
      unitCommand.targetWorldSpacePos = target;
    }
    collectedActions.push(unitCommand);
  }
  return collectedActions;
}


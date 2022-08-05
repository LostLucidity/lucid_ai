//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { LARVA, QUEEN, BUNKER, SIEGETANKSIEGED, OVERSEER, ADEPTPHASESHIFT } = require("@node-sc2/core/constants/unit-type");
const { MOVE, ATTACK_ATTACK, ATTACK, SMART, LOAD_BUNKER, STOP } = require("@node-sc2/core/constants/ability");
const { getRandomPoint, getCombatRally } = require("../location");
const { tankBehavior } = require("./unit-behavior");
const { distance, avgPoints } = require("@node-sc2/core/utils/geometry/point");
const { filterLabels } = require("../unit-selection");
const { scanCloakedEnemy } = require("../terran");
const { workerTypes, changelingTypes } = require("@node-sc2/core/constants/groups");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { isRepairing, canAttack, setPendingOrders } = require("../../systems/unit-resource/unit-resource-service");
const { createUnitCommand } = require("../../services/actions-service");
const { getCombatPoint, getClosestUnitByPath } = require("../../services/resources-service");
const getRandom = require("@node-sc2/core/utils/get-random");
const { microRangedUnit, defendWithUnit, getDPSHealth, retreat, pullWorkersToDefend, getWeaponDPS } = require("../../services/world-service");
const { micro } = require("../../services/micro-service");
const enemyTrackingService = require("../../systems/enemy-tracking/enemy-tracking-service");
const { moveAwayPosition } = require("../../services/position-service");
const { getMovementSpeed, getWeaponThatCanAttack } = require("../../services/unit-service");
const worldService = require("../../services/world-service");
const { getTravelDistancePerStep } = require("../../services/frames-service");
const healthTrackingService = require("../../systems/health-tracking/health-tracking-service");

const armyBehavior = {
  /**
   * 
   * @param {World} world 
   * @param {UnitTypeId[]} mainCombatTypes 
   * @param {UnitTypeId[]} supportUnitTypes 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  attack: (world, mainCombatTypes, supportUnitTypes) => {
    const { resources } = world;
    const { units } = resources.get();
    const collectedActions = [];
    let [closestEnemyBase] = getClosestUnitByPath(resources, getCombatRally(resources), units.getBases(Alliance.ENEMY), 1);
    const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !(unit.unitType === LARVA));
    const [combatUnits, supportUnits] = groupUnits(units, mainCombatTypes, supportUnitTypes);
    const avgCombatUnitsPoint = avgPoints(combatUnits.map(unit => unit.pos));
    let [closestEnemyUnit] = units.getClosest(avgCombatUnitsPoint, enemyUnits, 1);
    if (closestEnemyBase || closestEnemyUnit) {
      const enemyTarget = closestEnemyBase || closestEnemyUnit;
      const combatPoint = getCombatPoint(resources, combatUnits, enemyTarget);
      if (combatPoint) {
        const army = { combatPoint, combatUnits, supportUnits, enemyTarget }
        collectedActions.push(...armyBehavior.attackWithArmy(world, army, enemyUnits));
      }
      collectedActions.push(...scanCloakedEnemy(units, enemyTarget, combatUnits));
    } else {
      collectedActions.push(...armyBehavior.searchAndDestroy(resources, combatUnits, supportUnits));
    }
    return collectedActions;
  },
  /**
   * 
   * @param {World} world 
   * @param {Unit[]} threats 
   */
  defend0: async (world, threats) => {
    const { resources } = world;
    const { units } = resources.get();
    const collectedActions = [];
    // attack with army if stronger. Include attacking workers.
    const enemyUnits = units.getAlive(Alliance.ENEMY);
    const rallyPoint = getCombatRally(resources);
    if (rallyPoint) {
      let [closestEnemyUnit] = getClosestUnitByPath(resources, rallyPoint, threats);
      let combatUnits = [...units.getCombatUnits(), ...units.getById([OVERSEER])];
      collectedActions.push(...scanCloakedEnemy(units, closestEnemyUnit, combatUnits));
      const [combatPoint] = getClosestUnitByPath(resources, closestEnemyUnit.pos, combatUnits, 1);
      const workers = units.getWorkers().filter(unit => filterLabels(unit, ['scoutEnemyMain', 'scoutEnemyNatural', 'clearFromEnemy']) && !isRepairing(unit));
      if (combatPoint) {
        const allyUnits = [...combatUnits, ...units.getWorkers().filter(worker => !worker.isHarvesting())]
        const enemyDPSHealth = enemyUnits.reduce((accumulator, unit) => accumulator + getDPSHealth(world, unit, allyUnits.map(allyUnit => allyUnit.unitType)), 0)
        const selfDPSHealth = allyUnits.reduce((accumulator, unit) => accumulator + getDPSHealth(world, unit, enemyUnits.map(enemyUnit => enemyUnit.unitType)), 0)
        if (selfDPSHealth >= enemyDPSHealth) {
          console.log('Defend', selfDPSHealth, enemyDPSHealth);
          if (closestEnemyUnit.isFlying) {
            const findAntiAir = combatUnits.find(unit => unit.canShootUp());
            if (!findAntiAir) {
              combatUnits.push(...units.getById(QUEEN));
            }
            const combatPoint = getCombatPoint(resources, combatUnits, closestEnemyUnit);
            if (combatPoint) {
              const army = { combatPoint, combatUnits, enemyTarget: closestEnemyUnit }
              collectedActions.push(...armyBehavior.attackWithArmy(world, army, enemyUnits));
            }
          } else {
            for (const worker of workers) { collectedActions.push(...await pullWorkersToDefend(world, worker, closestEnemyUnit, enemyUnits)); }
            combatUnits = [...combatUnits, ...units.getById(QUEEN)]
            collectedActions.push(...armyBehavior.engageOrRetreat(world, combatUnits, enemyUnits, rallyPoint));
          }
        }
      }
    }
    // engage or retreat if not.
  },
  /**
   * 
   * @param {World} world 
   * @param {UnitTypeId[]} mainCombatTypes 
   * @param {UnitTypeId[]} supportUnitTypes 
   * @param {Unit[]} threats 
   * @returns 
   */
  defend: async (world, mainCombatTypes, supportUnitTypes, threats) => {
    const { agent, resources } = world;
    const { units } = resources.get();
    const collectedActions = [];
    const enemyUnits = units.getAlive(Alliance.ENEMY);
    const rallyPoint = getCombatRally(resources);
    if (rallyPoint) {
      let [closestEnemyUnit] = getClosestUnitByPath(resources, rallyPoint, threats);
      if (closestEnemyUnit) {
        const [combatUnits, supportUnits] = groupUnits(units, mainCombatTypes, supportUnitTypes);
        collectedActions.push(...scanCloakedEnemy(units, closestEnemyUnit, combatUnits));
        const [combatPoint] = getClosestUnitByPath(resources, closestEnemyUnit.pos, combatUnits, 1);
        const workers = units.getById(WorkerRace[agent.race]).filter(unit => filterLabels(unit, ['scoutEnemyMain', 'scoutEnemyNatural', 'clearFromEnemy']) && !isRepairing(unit));
        if (combatPoint) {
          let allyUnits = [...combatUnits, ...supportUnits];
          let selfDPSHealth = allyUnits.reduce((accumulator, unit) => accumulator + getDPSHealth(world, unit, enemyUnits.map(enemyUnit => enemyUnit.unitType)), 0)
          if (selfDPSHealth > closestEnemyUnit['selfDPSHealth']) {
            console.log('Defend', selfDPSHealth, closestEnemyUnit['selfDPSHealth']);
            if (closestEnemyUnit.isFlying) {
              const findAntiAir = combatUnits.find(unit => unit.canShootUp());
              if (!findAntiAir) {
                combatUnits.push(...units.getById(QUEEN));
              }
            }
            const combatPoint = getCombatPoint(resources, combatUnits, closestEnemyUnit);
            if (combatPoint) {
              const army = { combatPoint, combatUnits, supportUnits, enemyTarget: closestEnemyUnit }
              collectedActions.push(...armyBehavior.attackWithArmy(world, army, enemyUnits));
            }
          } else {
            let workersToDefend = [];
            const inRangeSortedWorkers = units.getClosest(closestEnemyUnit.pos, workers, workers.length).filter(worker => distance(worker.pos, closestEnemyUnit.pos) <= 16);
            for (const worker of inRangeSortedWorkers) {
              workersToDefend.push(worker);
              selfDPSHealth += getDPSHealth(world, worker, enemyUnits.map(enemyUnit => enemyUnit.unitType));
              if (selfDPSHealth > closestEnemyUnit['selfDPSHealth']) {
                workersToDefend.forEach(worker => worker.labels.set('defending'));
                // console.log(`Pulling ${workersToDefend.length} to defend with.`);
                break;
              }
            }
            workersToDefend = selfDPSHealth > closestEnemyUnit['selfDPSHealth'] ? workersToDefend : [];
            allyUnits = [...allyUnits, ...units.getById(QUEEN), ...workersToDefend];
            collectedActions.push(...armyBehavior.engageOrRetreat(world, allyUnits, enemyUnits, rallyPoint));
          }
        } else {
          const workersToDefend = [];
          for (const worker of workers) {
            const distanceToClosestEnemy = distance(worker.pos, closestEnemyUnit.pos);
            if (closestEnemyUnit.isWorker() && closestEnemyUnit['selfUnits'].length === 1 && distanceToClosestEnemy > 16) {
              continue;
            }
            if (defendWithUnit(world, worker, closestEnemyUnit)) {
              workersToDefend.push(worker);
              worker.labels.set('defending')
            } else {
              if (isTargetUnitInOrders(worker, closestEnemyUnit, [ATTACK, ATTACK_ATTACK])) {
                worker.labels.has('defending') && worker.labels.delete('defending');
                collectedActions.push(...stop(worker));
              }
            }
          }
          console.log(`Pulling ${workersToDefend.length} to defend with.`);
          collectedActions.push(...armyBehavior.engageOrRetreat(world, workersToDefend, enemyUnits, rallyPoint));
        }
      }
    }
    return collectedActions;
  },
  getInRangeDestructables: (units, selfUnit) => {
    let tag = null;
    const ROCKS = [373, 638, 639, 640, 643];
    const DEBRIS = [364, 365, 376, 377];
    const destructableRockTypes = [...DEBRIS, ...ROCKS];
    const destructableRockUnits = units.getAlive(Alliance.NEUTRAL).filter(unit => destructableRockTypes.includes(unit.unitType));
    const [closestDestructable] = units.getClosest(selfUnit.pos, destructableRockUnits).filter(destructableRockUnit => distance(selfUnit.pos, destructableRockUnit.pos) < 16);
    if (closestDestructable) {
      tag = closestDestructable.tag;
    }
    return tag;
  },
  /**
   * Returns an array of unitCommands to give to selfUnits to engage or retreat.
   * @param {World} world 
   * @param {Unit[]} selfUnits 
   * @param {Unit[]} enemyUnits 
   * @param {Point2D} position 
   * @param {boolean} clearRocks 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  engageOrRetreat: (world, selfUnits, enemyUnits, position, clearRocks = true) => {
    const { data, resources } = world;
    const { units } = resources.get();
    /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
    const collectedActions = [];
    const randomUnit = getRandom(selfUnits);
    selfUnits.forEach(selfUnit => {
      let targetPosition = position;
      if (!workerTypes.includes(selfUnit.unitType) || selfUnit.labels.has('defending')) {
        const [closestAttackableEnemyUnit] = units.getClosest(selfUnit.pos, enemyUnits.filter(enemyUnit => canAttack(resources, selfUnit, enemyUnit)));
        const attackablePosition = closestAttackableEnemyUnit ? closestAttackableEnemyUnit.pos : null;
        if (closestAttackableEnemyUnit && distance(selfUnit.pos, closestAttackableEnemyUnit.pos) < 16) {
          const selfDPSHealth = selfUnit['selfDPSHealth'] > closestAttackableEnemyUnit['enemyDPSHealth'] ? selfUnit['selfDPSHealth'] : closestAttackableEnemyUnit['enemyDPSHealth'];
          if (selfUnit.tag === randomUnit.tag) {
            logBattleFieldSituation(world, selfUnit, closestAttackableEnemyUnit, selfDPSHealth);
          }
          if (closestAttackableEnemyUnit['selfDPSHealth'] > selfDPSHealth) {
            if (getMovementSpeed(selfUnit) < getMovementSpeed(closestAttackableEnemyUnit) && closestAttackableEnemyUnit.unitType !== ADEPTPHASESHIFT) {
              if (selfUnit.isMelee()) {
                collectedActions.push(...micro(units, selfUnit, closestAttackableEnemyUnit, enemyUnits));
              } else {
                const enemyInAttackRange = isEnemyInAttackRange(data, selfUnit, closestAttackableEnemyUnit);
                if (enemyInAttackRange) {
                  collectedActions.push(...microRangedUnit(world, selfUnit, closestAttackableEnemyUnit));
                } else {
                  const unitCommand = createUnitCommand(MOVE, [selfUnit]);
                  unitCommand.targetWorldSpacePos = retreat(world, selfUnit, closestAttackableEnemyUnit);
                  collectedActions.push(unitCommand);
                }
              }
            } else {
              const unitCommand = createUnitCommand(MOVE, [selfUnit]);
              if (selfUnit.isFlying) {
                unitCommand.targetWorldSpacePos = moveAwayPosition(attackablePosition, selfUnit.pos);
              } else {
                if (selfUnit['pendingOrders'] === undefined || selfUnit['pendingOrders'].length === 0) {
                  const closestEnemyRange = getClosestEnemyByRange(data, selfUnit, enemyUnits)
                  if (!selfUnit.isMelee()) {
                    const foundEnemyWeapon = getWeaponThatCanAttack(data, closestEnemyRange.unitType, selfUnit);
                    if (foundEnemyWeapon) {
                      const bufferDistance = foundEnemyWeapon.range + selfUnit.radius + closestEnemyRange.radius + getTravelDistancePerStep(closestEnemyRange) + getTravelDistancePerStep(selfUnit);
                      if ((bufferDistance) < distance(selfUnit.pos, closestEnemyRange.pos)) {
                        collectedActions.push(...microRangedUnit(world, selfUnit, closestEnemyRange));
                        return;
                      } else {
                        unitCommand.targetWorldSpacePos = retreat(world, selfUnit, closestEnemyRange || closestAttackableEnemyUnit);
                        unitCommand.unitTags = selfUnits.filter(unit => distance(unit.pos, selfUnit.pos) <= 1).map(unit => {
                          setPendingOrders(unit, unitCommand);
                          return unit.tag;
                        });
                      }
                    } else {
                      // no weapon found, micro ranged unit
                      collectedActions.push(...microRangedUnit(world, selfUnit, closestEnemyRange || closestAttackableEnemyUnit));
                      return;
                    }
                  } else {
                    // retreat if melee
                    unitCommand.targetWorldSpacePos = retreat(world, selfUnit, closestEnemyRange || closestAttackableEnemyUnit);
                  }
                } else {
                  // skip action if pending orders
                  return;
                }
              }
              collectedActions.push(unitCommand);
            }
          } else {
            setRecruitToBattleLabel(selfUnit, attackablePosition);
            if (canAttack(resources, selfUnit, closestAttackableEnemyUnit)) {
              if (!selfUnit.isMelee()) { collectedActions.push(...microRangedUnit(world, selfUnit, closestAttackableEnemyUnit)); }
              else {
                const [rangedUnitAlly] = units.getClosest(selfUnit.pos, selfUnit['selfUnits']
                  .filter((/** @type {Unit} */ unit) => unit.data().weapons.some(w => w.range > 1) && getWeaponThatCanAttack(data, unit.unitType, closestAttackableEnemyUnit) !== undefined));
                if (rangedUnitAlly) {
                  const distanceBetweenUnits = distance(selfUnit.pos, rangedUnitAlly.pos);
                  const rangedAllyEdgeDistance = distance(rangedUnitAlly.pos, closestAttackableEnemyUnit.pos) - rangedUnitAlly.radius - closestAttackableEnemyUnit.radius;
                  const weaponRange = getWeaponThatCanAttack(data, rangedUnitAlly.unitType, closestAttackableEnemyUnit).range + selfUnit.radius;
                  if (
                    distanceBetweenUnits < 16 &&
                    rangedAllyEdgeDistance > weaponRange + getTravelDistancePerStep(rangedUnitAlly)
                  ) {
                    const unitCommand = createUnitCommand(MOVE, [selfUnit]);
                    unitCommand.targetWorldSpacePos = rangedUnitAlly.pos;
                    collectedActions.push(unitCommand);
                  } else {
                    const unitCommand = createUnitCommand(ATTACK_ATTACK, [selfUnit]);
                    unitCommand.targetWorldSpacePos = attackablePosition;
                    collectedActions.push(unitCommand);
                  }
                } else {
                  const unitCommand = createUnitCommand(ATTACK_ATTACK, [selfUnit]);
                  unitCommand.targetWorldSpacePos = attackablePosition;
                  collectedActions.push(unitCommand);
                }
              }
            } else {
              collectedActions.push({
                abilityId: ATTACK_ATTACK,
                targetWorldSpacePos: attackablePosition,
                unitTags: [selfUnit.tag],
              });
            }
          }
        } else {
          if (selfUnit.unitType !== QUEEN) {
            const unitCommand = {
              abilityId: ATTACK_ATTACK,
              unitTags: [selfUnit.tag],
            }
            const destructableTag = armyBehavior.getInRangeDestructables(units, selfUnit);
            if (destructableTag && clearRocks && !worldService.outpowered) { unitCommand.targetUnitTag = destructableTag; }
            else {
              const [closestCompletedBunker] = units.getClosest(selfUnit.pos, units.getById(BUNKER).filter(bunker => bunker.buildProgress >= 1));
              if (closestCompletedBunker && closestCompletedBunker.abilityAvailable(LOAD_BUNKER)) {
                unitCommand.abilityId = SMART;
                unitCommand.targetUnitTag = closestCompletedBunker.tag;
              } else {
                unitCommand.targetWorldSpacePos = targetPosition;
              }
            }
            collectedActions.push(unitCommand);
          }
        }
      }
    });
    return collectedActions;
  },
  /**
   * 
   * @param {World} world 
   * @param {{ combatPoint: Unit; combatUnits: Unit[]; enemyTarget: Unit; supportUnits?: any[]; }} army 
   * @param {Unit[]} enemyUnits 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  attackWithArmy: (world, army, enemyUnits) => {
    const { resources } = world;
    const { units } = resources.get();
    const collectedActions = [];
    const pointType = army.combatPoint.unitType;
    const pointTypeUnits = units.getById(pointType);
    const nonPointTypeUnits = army.combatUnits.filter(unit => !(unit.unitType === pointType) && unit.labels.size === 0);
    const pointTypeUnitTags = pointTypeUnits.map(unit => unit.tag);
    if (changelingTypes.includes(army.enemyTarget.unitType)) {
      const killChanglingCommand = {
        abilityId: ATTACK,
        targetUnitTag: army.enemyTarget.tag,
        unitTags: [...pointTypeUnitTags],
      }
      collectedActions.push(killChanglingCommand);
    } else {
      const range = Math.max.apply(Math, world.data.getUnitTypeData(SIEGETANKSIEGED).weapons.map(weapon => { return weapon.range; }));
      const targetWorldSpacePos = distance(army.combatPoint.pos, army.enemyTarget.pos) > range ? army.combatPoint.pos : army.enemyTarget.pos;
      [...pointTypeUnits, ...nonPointTypeUnits].forEach(unit => {
        const [closestUnit] = units.getClosest(unit.pos, enemyUnits.filter(enemyUnit => distance(unit.pos, enemyUnit.pos) < 16));
        if (!unit.isMelee() && closestUnit) { collectedActions.push(...microRangedUnit(world, unit, closestUnit)); }
        else {
          const unitCommand = createUnitCommand(ATTACK_ATTACK, [unit]);
          if (unit.labels.get('combatPoint')) {
            unitCommand.targetWorldSpacePos = army.enemyTarget.pos;
          } else {
            unitCommand.targetWorldSpacePos = targetWorldSpacePos;
          }
          collectedActions.push(unitCommand);
        }
      });
      if (army.supportUnits.length > 0) {
        const supportUnitTags = army.supportUnits.map(unit => unit.tag);
        let unitCommand = {
          abilityId: MOVE,
          targetWorldSpacePos: army.combatPoint.pos,
          unitTags: [...supportUnitTags],
        }
        collectedActions.push(unitCommand);
      }
    }
    collectedActions.push(...tankBehavior(units));
    return collectedActions;
  },
  /**
   * @param {World} world 
   * @param {UnitTypeId} mainCombatTypes 
   * @param {UnitTypeId} supportUnitTypes 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  push: (world, mainCombatTypes, supportUnitTypes) => {
    const { resources } = world;
    const { units } = resources.get();
    const collectedActions = [];
    let [closestEnemyBase] = getClosestUnitByPath(resources, getCombatRally(resources), units.getBases(Alliance.ENEMY), 1);
    const { mappedEnemyUnits } = enemyTrackingService;
    const [combatUnits, supportUnits] = groupUnits(units, mainCombatTypes, supportUnitTypes);
    const avgCombatUnitsPoint = avgPoints(combatUnits.map(unit => unit.pos));
    let [closestEnemyUnit] = getClosestUnitByPath(resources, avgCombatUnitsPoint, mappedEnemyUnits, 1);
    const closestEnemyTarget = closestEnemyBase || closestEnemyUnit;
    if (closestEnemyTarget) {
      const [combatUnits, supportUnits] = groupUnits(units, mainCombatTypes, supportUnitTypes);
      collectedActions.push(...scanCloakedEnemy(units, closestEnemyUnit, combatUnits));
      const [combatPoint] = getClosestUnitByPath(resources, closestEnemyUnit.pos, combatUnits, 1);
      if (combatPoint) {
        let allyUnits = [...combatUnits, ...supportUnits, ...units.getWorkers().filter(worker => worker.isAttacking())];
        let selfDPSHealth = allyUnits.reduce((accumulator, unit) => accumulator + getDPSHealth(world, unit, mappedEnemyUnits.map(enemyUnit => enemyUnit.unitType)), 0)
        console.log('Push', selfDPSHealth, closestEnemyTarget['selfDPSHealth']);
        collectedActions.push(...armyBehavior.engageOrRetreat(world, allyUnits, mappedEnemyUnits, closestEnemyTarget.pos, false));
      }
      collectedActions.push(...scanCloakedEnemy(units, closestEnemyTarget, combatUnits));
    } else {
      collectedActions.push(...armyBehavior.searchAndDestroy(resources, combatUnits, supportUnits));
    }
    return collectedActions;
  },
  searchAndDestroy: (resources, combatUnits, supportUnits) => {
    const { map, units } = resources.get();
    const collectedActions = [];
    const label = 'combatPoint';
    const combatPoint = combatUnits.find(unit => unit.labels.get(label));
    if (combatPoint) { combatPoint.labels.set(label, false); }
    const expansions = [...map.getAvailableExpansions(), ...map.getOccupiedExpansions(4)];
    const idleCombatUnits = units.getCombatUnits().filter(u => u.noQueue);
    const randomExpansion = expansions[Math.floor(Math.random() * expansions.length)];
    const randomPosition = randomExpansion ? randomExpansion.townhallPosition : getRandomPoint(map)
    if (randomPosition) {
      if (supportUnits.length > 1) {
        const supportUnitTags = supportUnits.map(unit => unit.tag);
        let unitCommand = {
          abilityId: MOVE,
          targetWorldSpacePos: randomPosition,
          unitTags: [...supportUnitTags],
        }
        collectedActions.push(unitCommand);
      }
      const idleCombatUnitTags = idleCombatUnits.map(unit => unit.tag);
      let unitCommand = {
        abilityId: ATTACK_ATTACK,
        targetWorldSpacePos: randomPosition,
        unitTags: [...idleCombatUnitTags],
      }
      collectedActions.push(unitCommand);
    }
    return collectedActions;
  }
};

function groupUnits(units, mainCombatTypes, supportUnitTypes) {
  const combatUnits = [];
  mainCombatTypes.forEach(type => {
    combatUnits.push(...units.getById(type).filter(unit => filterLabels(unit, ['scout', 'harasser'])));
  });
  const supportUnits = [];
  supportUnitTypes.forEach(type => {
    supportUnits.push(...units.getById(type).filter(unit => !unit.labels.get('scout') && !unit.labels.get('creeper') && !unit.labels.get('injector')));
  });
  return [combatUnits, supportUnits];
}

/**
 * @param {Unit} unit 
 * @param {Point2D} position 
 */
function setRecruitToBattleLabel(unit, position) {
  unit['selfUnits'].forEach((/** @type {Unit} */ selfUnit) => {
    if (distance(selfUnit.pos, position) > 16) {
      if (selfUnit.isWorker()) {
        if (selfUnit.isHarvesting() || selfUnit.isConstructing() || selfUnit.labels.has('retreating')) {
          return;
        }
      }
      selfUnit.labels.set('recruitToBattle', position);
    }
  });
}
/**
 * @param {DataStorage} data
 * @param {Unit} unit 
 * @param {Unit} targetUnit 
 * @returns {Boolean}
 */
function isEnemyInAttackRange(data, unit, targetUnit) {
  const { pos, radius, unitType } = unit;
  if (!pos || !radius || !unitType || !targetUnit.pos || !targetUnit.radius) return false;
  // check if properties exist
  const foundWeapon = getWeaponThatCanAttack(data, unitType, targetUnit);
  return foundWeapon && foundWeapon.range ? (foundWeapon.range >= distance(pos, targetUnit.pos) + radius + targetUnit.radius) : false;
}
/**
 * @param {Unit} unit 
 * @param {Unit} targetUnit 
 * @param {AbilityId[]} abilityIds
 * @returns {boolean}
 */
function isTargetUnitInOrders(unit, targetUnit, abilityIds) {
  return unit.orders.some(order => {
    if (abilityIds.includes(order.abilityId)) {
      if (order.targetUnitTag === targetUnit.tag) {
        return true;
      } else if (order.targetWorldSpacePos && distance(order.targetWorldSpacePos, targetUnit.pos) < 1) {
        return true;
      }
    }
    return false;
  });
}
/**
 * @param {Unit} unit 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function stop(unit) {
  const collectedActions = [];
  collectedActions.push(createUnitCommand(STOP, [unit]));
  return collectedActions;
}
/**
 * @param {World} world
 * @param {Unit} selfUnit
 * @param {Unit} targetUnit
 * @param {number} selfDPSHealth
 * @returns {void}
 */
function logBattleFieldSituation(world, selfUnit, targetUnit, selfDPSHealth) {
  const { data } = world;
  const selfOverEnemyDPSHealth = `${Math.round(selfDPSHealth)}/${Math.round(targetUnit['selfDPSHealth'])}`;
  const distanceFromEnemy = distance(selfUnit.pos, targetUnit.pos);
  const selfOverEnemyUnitType = `${selfUnit.unitType}/${targetUnit.unitType}`;
  // // calculate health differences total of allied units within 16 range of selfUnit and targetUnit
  // const selfUnits = selfUnit['selfUnits'].filter((/** @type {Unit} */ unit) => distance(unit.pos, selfUnit.pos) < 16);
  // const targetUnits = targetUnit['selfUnits'].filter((/** @type {Unit} */ unit) => distance(unit.pos, targetUnit.pos) < 16);
  // const selfUnitsHealthDifferences = selfUnits.map((/** @type {Unit} */ unit) => healthTrackingService.healthOfUnits[unit.alliance][unit.tag].getAverageDifference());
  // const targetUnitsHealthDifferences = targetUnits.map((/** @type {Unit} */ unit) => healthTrackingService.healthOfUnits[unit.alliance][unit.tag].getAverageDifference());
  // const selfUnitsHealthDifferencesTotal = selfUnitsHealthDifferences.reduce((acc, cur) => acc + cur, 0);
  // const targetUnitsHealthDifferencesTotal = targetUnitsHealthDifferences.reduce((acc, cur) => acc + cur, 0);
  // const selfUnitsHealthDifferencesTotalStr = `${selfUnitsHealthDifferencesTotal}/${targetUnitsHealthDifferencesTotal}`;
  // const selfUnitsDPSAverage = selfUnits.map((/** @type {Unit} */ unit) => healthTrackingService.healthOfUnits[unit.alliance][unit.tag].getAverageDPS());
  // const targetUnitsDPSAverage = targetUnits.map((/** @type {Unit} */ unit) => healthTrackingService.healthOfUnits[unit.alliance][unit.tag].getAverageDPS());
  // const selfUnitsDPSTotal = selfUnitsDPSAverage.reduce((acc, cur) => acc + cur, 0);
  // const targetUnitsDPSTotal = targetUnitsDPSAverage.reduce((acc, cur) => acc + cur, 0);
  // // compare selfUnitsDPSTotal to targetUnitsHealthDifferencesTotal * -1
  // const calculatedSelfDPSTotalVsTargetHealthDifferencesTotal = selfUnitsDPSTotal / -targetUnitsHealthDifferencesTotal;
  // const calculatedTargetDPSTotalVsSelfHealthDifferencesTotal = targetUnitsDPSTotal / -selfUnitsHealthDifferencesTotal;
  // // if targetUnitsDPSTotal is less than selfUnitsHealthDifferencesTotal log that targetUnitsDPSTotal is underestimated
  // if (targetUnitsDPSTotal < -selfUnitsHealthDifferencesTotal) {
  //   console.log('targetUnitsDPSTotal is underestimated');
  // }
  console.log(selfOverEnemyDPSHealth, distanceFromEnemy, selfOverEnemyUnitType);
}

/**
 * @param {DataStorage} data
 * @param {Unit} unit
 * @param {Unit[]} enemyUnits
 * @returns {Unit|null}
 */
function getClosestEnemyByRange(data, unit, enemyUnits) {
  let shortestDifference = Number.MAX_VALUE;
  return enemyUnits.reduce((closestEnemyByRange, enemyUnit) => {
    const weapon = getWeaponThatCanAttack(data, enemyUnit.unitType, unit);
    if (weapon) {
      const range = weapon.range + unit.radius + enemyUnit.radius + getTravelDistancePerStep(enemyUnit);
      const distanceToUnit = distance(unit.pos, enemyUnit.pos);
      const difference = distanceToUnit - range;
      if (difference < shortestDifference) {
        shortestDifference = difference;
        closestEnemyByRange = enemyUnit;
      }
    }
    return closestEnemyByRange;
  });
}

module.exports = armyBehavior;


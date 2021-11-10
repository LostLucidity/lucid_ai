//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { LARVA, QUEEN, BUNKER, SIEGETANKSIEGED, OVERSEER } = require("@node-sc2/core/constants/unit-type");
const { MOVE, ATTACK_ATTACK, ATTACK, SMART, LOAD_BUNKER } = require("@node-sc2/core/constants/ability");
const { getRandomPoint, getCombatRally } = require("../location");
const { tankBehavior } = require("./unit-behavior");
const { distance, avgPoints } = require("@node-sc2/core/utils/geometry/point");
const continuouslyBuild = require("../continuously-build");
const { moveAwayPosition, retreatToExpansion } = require("../../builds/helper");
const { getClosestUnitByPath } = require("../get-closest-by-path");
const { filterLabels } = require("../unit-selection");
const { scanCloakedEnemy } = require("../terran");
const { workerTypes, changelingTypes } = require("@node-sc2/core/constants/groups");
const { microRangedUnit } = require("../../services/micro-service");
const { pullWorkersToDefend } = require("../../services/army-management-service");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { isRepairing, canAttack, setPendingOrders } = require("../../services/units-service");
const scoutService = require("../../systems/scouting/scouting-service");
const { getSupply } = require("../../services/shared-service");
const { getDPSHealth } = require("../../services/data-service");
const { createUnitCommand } = require("../../services/actions-service");
const { getCombatPoint } = require("../../services/resources-service");

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
    const { agent, data, resources } = world;
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
        const selfDPSHealth = getDPSHealth(data, [...combatUnits, ...units.getWorkers().filter(worker => !worker.isHarvesting())]);
        const enemyDPSHealth = getDPSHealth(data, enemyUnits);
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
            for (const worker of workers) { collectedActions.push(...await pullWorkersToDefend({ agent, data, resources }, worker, closestEnemyUnit, enemyUnits)); }
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
   * @param {*} assemblePlan 
   * @param {UnitTypeId[]} mainCombatTypes 
   * @param {UnitTypeId[]} supportUnitTypes 
   * @param {Unit[]} threats 
   * @returns 
   */
  defend: async (world, assemblePlan, mainCombatTypes, supportUnitTypes, threats) => {
    const { agent, data, resources } = world;
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
          const enemySupply = getSupply(data, enemyUnits);
          let allyUnits = [...combatUnits, ...supportUnits, ...units.getWorkers().filter(worker => worker.isAttacking())];
          const selfSupply = getSupply(data, allyUnits);
          if (selfSupply > enemySupply) {
            console.log('Defend', selfSupply, enemySupply);
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
            console.log('building defensive units');
            await continuouslyBuild(world, assemblePlan, mainCombatTypes);
            if (selfSupply < enemySupply) {
              // console.log('engageOrRetreatVisible', selfSupply, enemyUnits.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0));
              // console.log('engageOrRetreatMapped', selfSupply, enemyTrackingService.mappedEnemyUnits.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0));
              for (const worker of workers) { collectedActions.push(...await pullWorkersToDefend({ agent, data, resources }, worker, closestEnemyUnit, enemyUnits)); }
              allyUnits = [...allyUnits, ...units.getById(QUEEN)];
              collectedActions.push(...armyBehavior.engageOrRetreat(world, allyUnits, enemyUnits, rallyPoint));
            }
          }
        } else {
          for (const worker of workers) { collectedActions.push(...await pullWorkersToDefend({ agent, data, resources }, worker, closestEnemyUnit, enemyUnits)); }
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
   * @param {World} param0 
   * @param {Unit[]} selfUnits 
   * @param {Unit[]} enemyUnits 
   * @param {Point2D} position 
   * @param {boolean} clearRocks 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  engageOrRetreat: ({ data, resources }, selfUnits, enemyUnits, position, clearRocks = true) => {
    const { units } = resources.get();
    const collectedActions = [];
    selfUnits.forEach(selfUnit => {
      let targetPosition = position;
      if (!workerTypes.includes(selfUnit.unitType)) {
        const [closestEnemyUnit] = units.getClosest(selfUnit.pos, enemyUnits);
        if (closestEnemyUnit && distance(selfUnit.pos, closestEnemyUnit.pos) < 16) {
          const selfDPSHealth = selfUnit['selfDPSHealth'] > closestEnemyUnit['enemyDPSHealth'] ? selfUnit['selfDPSHealth'] : closestEnemyUnit['enemyDPSHealth'];
          const noBunker = units.getById(BUNKER).length === 0;
          if (closestEnemyUnit['selfDPSHealth'] > selfDPSHealth && noBunker) {
            const unitCommand = { abilityId: MOVE }
            if (selfUnit.isFlying) {
              unitCommand.targetWorldSpacePos = moveAwayPosition(closestEnemyUnit, selfUnit);
              unitCommand.unitTags = [selfUnit.tag];
              collectedActions.push(unitCommand);
            } else {
              if (selfUnit['pendingOrders'] === undefined || selfUnit['pendingOrders'].length === 0) {
                const [closestArmedEnemyUnit] = units.getClosest(selfUnit.pos, enemyUnits.filter(unit => unit.data().weapons.some(w => w.range > 0)));
                unitCommand.targetWorldSpacePos = retreatToExpansion(resources, selfUnit, closestArmedEnemyUnit || closestEnemyUnit);
                unitCommand.unitTags = selfUnits.filter(unit => distance(unit.pos, selfUnit.pos) <= 1).map(unit => {
                  setPendingOrders(unit, unitCommand);
                  return unit.tag;
                });
                collectedActions.push(unitCommand);
              }
            }
          } else {
            if (canAttack(resources, selfUnit, closestEnemyUnit)) {
              if (!selfUnit.isMelee()) { collectedActions.push(...microRangedUnit(data, selfUnit, closestEnemyUnit)); }
              else {
                collectedActions.push({
                  abilityId: ATTACK_ATTACK,
                  targetUnitTag: closestEnemyUnit.tag,
                  unitTags: [selfUnit.tag],
                });
              }
            } else {
              collectedActions.push({
                abilityId: ATTACK_ATTACK,
                targetWorldSpacePos: closestEnemyUnit.pos,
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
            if (destructableTag && clearRocks && !scoutService.outsupplied) { unitCommand.targetUnitTag = destructableTag; }
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
   * @param {World} param0 
   * @param {{ combatPoint: Unit; combatUnits: Unit[]; enemyTarget: Unit; supportUnits?: any[]; }} army 
   * @param {Unit[]} enemyUnits 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  attackWithArmy: ({ data, resources }, army, enemyUnits) => {
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
      const range = Math.max.apply(Math, data.getUnitTypeData(SIEGETANKSIEGED).weapons.map(weapon => { return weapon.range; }));
      const targetWorldSpacePos = distance(army.combatPoint.pos, army.enemyTarget.pos) > range ? army.combatPoint.pos : army.enemyTarget.pos;
      [...pointTypeUnits, ...nonPointTypeUnits].forEach(unit => {
        const [closestUnit] = units.getClosest(unit.pos, enemyUnits.filter(enemyUnit => distance(unit.pos, enemyUnit.pos) < 16));
        if (!unit.isMelee() && closestUnit) { collectedActions.push(...microRangedUnit(data, unit, closestUnit)); }
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
  push: async (world, mainCombatTypes, supportUnitTypes) => {
    const { data, resources } = world;
    const { units } = resources.get();
    const collectedActions = [];
    let [closestEnemyBase] = getClosestUnitByPath(resources, getCombatRally(resources), units.getBases(Alliance.ENEMY), 1);
    const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !(unit.unitType === LARVA));
    const [combatUnits, supportUnits] = groupUnits(units, mainCombatTypes, supportUnitTypes);
    const avgCombatUnitsPoint = avgPoints(combatUnits.map(unit => unit.pos));
    let [closestEnemyUnit] = getClosestUnitByPath(resources, avgCombatUnitsPoint, enemyUnits, 1);
    const closestEnemyTarget = closestEnemyBase || closestEnemyUnit;
    if (closestEnemyTarget) {
      const [combatUnits, supportUnits] = groupUnits(units, mainCombatTypes, supportUnitTypes);
      collectedActions.push(...scanCloakedEnemy(units, closestEnemyUnit, combatUnits));
      const [combatPoint] = getClosestUnitByPath(resources, closestEnemyUnit.pos, combatUnits, 1);
      if (combatPoint) {
        const enemySupply = enemyUnits.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
        let allyUnits = [...combatUnits, ...supportUnits, ...units.getWorkers().filter(worker => worker.isAttacking())];
        const selfSupply = allyUnits.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
        console.log('Push', selfSupply, enemySupply);
        collectedActions.push(...armyBehavior.engageOrRetreat(world, allyUnits, enemyUnits, closestEnemyTarget.pos, false));
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

module.exports = armyBehavior;
//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { LARVA, SIEGETANKSIEGED } = require("@node-sc2/core/constants/unit-type");
const { MOVE, ATTACK_ATTACK, ATTACK } = require("@node-sc2/core/constants/ability");
const { getRandomPoint } = require("../location");
const { tankBehavior } = require("./unit-behavior");
const { distance, avgPoints } = require("@node-sc2/core/utils/geometry/point");
const { scanCloakedEnemy } = require("../terran");
const { changelingTypes } = require("@node-sc2/core/constants/groups");
const { createUnitCommand } = require("../../services/actions-service");
const { getCombatPoint } = require("../../services/resources-service");
const { microRangedUnit, getDPSHealth } = require("../../services/world-service");
const enemyTrackingService = require("../../systems/enemy-tracking/enemy-tracking-service");
const healthTrackingService = require("../../systems/health-tracking/health-tracking-service");
const { getClosestUnitByPath, getCombatRally } = require("../../services/resource-manager-service");
const { groupUnits } = require("../../services/unit-service");

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
    const closestEnemyTarget = closestEnemyBase || getClosestUnitByPath(resources, avgCombatUnitsPoint, mappedEnemyUnits, 1)[0];
    if (closestEnemyTarget) {
      const { pos } = closestEnemyTarget; if (pos === undefined) { return []; }
      const [combatUnits, supportUnits] = groupUnits(units, mainCombatTypes, supportUnitTypes);
      collectedActions.push(...scanCloakedEnemy(units, closestEnemyTarget, combatUnits));
      if (combatUnits.length > 0) {
        let allyUnits = [...combatUnits, ...supportUnits, ...units.getWorkers().filter(worker => worker.isAttacking())];
        let selfDPSHealth = allyUnits.reduce((accumulator, unit) => accumulator + getDPSHealth(world, unit, mappedEnemyUnits.map(enemyUnit => enemyUnit.unitType)), 0)
        console.log('Push', selfDPSHealth, closestEnemyTarget['selfDPSHealth']);
        collectedActions.push(...armyBehavior.engageOrRetreat(world, allyUnits, mappedEnemyUnits, pos, false));
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

module.exports = armyBehavior;


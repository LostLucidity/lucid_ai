//@ts-check
"use strict"

const { MOVE, ATTACK_ATTACK } = require("@node-sc2/core/constants/ability");
const { CYCLONE } = require("@node-sc2/core/constants/unit-type");
const { toDegrees, gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance, avgPoints } = require("@node-sc2/core/utils/geometry/point");
const { moveAwayPosition } = require("../builds/helper");
const { getClosestPosition } = require("../helper/get-closest");
const { createUnitCommand } = require("./actions-service");

const microService = {
  /**
   * @param {DataStorage} data 
   * @param {Unit} unit 
   * @param {Unit} targetUnit 
   * @returns {Point2D}
   */
  getPositionVersusTargetUnit: (data, unit, targetUnit) => {
    const totalRadius = unit.radius + targetUnit.radius + 1;
    const range = Math.max.apply(Math, data.getUnitTypeData(unit.unitType).weapons.map(weapon => { return weapon.range; })) + totalRadius;
    if (distance(unit.pos, targetUnit.pos) < range) {
      const outerRangeOfEnemy = gridsInCircle(targetUnit.pos, range).filter(grid => distance(grid, targetUnit.pos) >= (range - 0.5));
      const [closestCandidatePosition] = getClosestPosition(avgPoints(unit['selfUnits'].map((/** @type {Unit} */ unit) => unit.pos)), outerRangeOfEnemy);
      return closestCandidatePosition;
    } else {
      return targetUnit.pos;
    }
  },
  /**
   * 
   * @param {Unit} unit 
   * @param {Unit} targetUnit 
   * @returns {boolean}
   */
  isFacing: (unit, targetUnit) => {
    const targetFacingDegrees = toDegrees(targetUnit.facing);
    const positionOfUnitDegrees = toDegrees(Math.atan2(unit.pos.y - targetUnit.pos.y, unit.pos.x - targetUnit.pos.x));
    const normalizedPositionOfUnitDegrees = positionOfUnitDegrees > 0 ? positionOfUnitDegrees : 360 + positionOfUnitDegrees;
    return Math.abs(targetFacingDegrees - normalizedPositionOfUnitDegrees) < 7;
  },
  micro: (unit, targetUnit, enemyUnits, retreatCommand) => {
    const collectedActions = [];
    // if cool down and fighting melee move back
    const microConditions = [
      targetUnit.isMelee(),
      (distance(unit.pos, targetUnit.pos) + 0.05) - (unit.radius + targetUnit.radius) < 0.5,
      microService.isFacing(targetUnit, unit),
    ]
    if (
      [...microConditions, unit.weaponCooldown > 12].every(condition => condition) ||
      [...microConditions, (unit.health + unit.shield) < (targetUnit.health + targetUnit.shield)].every(condition => condition)
    ) {
      console.log('unit.weaponCooldown', unit.weaponCooldown);
      console.log('distance(unit.pos, targetUnit.pos)', distance(unit.pos, targetUnit.pos));
      collectedActions.push(retreatCommand);
    } else {
      const inRangeMeleeEnemyUnits = enemyUnits.filter(enemyUnit => enemyUnit.isMelee() && ((distance(unit.pos, enemyUnit.pos) + 0.05) - (unit.radius + enemyUnit.radius) < 0.25));
      const [weakestInRange] = inRangeMeleeEnemyUnits.sort((a, b) => (a.health + a.shield) - (b.health + b.shield));
      targetUnit = weakestInRange || targetUnit;
      const unitCommand = {
        abilityId: ATTACK_ATTACK,
        targetUnitTag: targetUnit.tag,
        unitTags: [unit.tag],
      }
      collectedActions.push(unitCommand);
    }
    return collectedActions;
  },
  /**
   * @param {DataStorage} data 
   * @param {Unit} unit 
   * @param {Unit} targetUnit 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  microRangedUnit: (data, unit, targetUnit) => {
    const collectedActions = [];
    if (
      (unit.weaponCooldown > 12 || unit.unitType === CYCLONE) &&
      data.getUnitTypeData(targetUnit.unitType).weapons.some(weapon => { return weapon.range; })
    ) {
      const microPosition = microService.getPositionVersusTargetUnit(data, unit, targetUnit)
      collectedActions.push({
        abilityId: MOVE,
        targetWorldSpacePos: microPosition,
        unitTags: [unit.tag],
      });
    } else {
      const unitCommand = createUnitCommand(ATTACK_ATTACK, [unit]);
      unitCommand.targetWorldSpacePos = targetUnit.pos;
      collectedActions.push(unitCommand);
    }
    return collectedActions;
  }
}

module.exports = microService;
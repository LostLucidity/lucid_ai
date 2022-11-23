//@ts-check
"use strict"

const { ATTACK_ATTACK, HARVEST_GATHER, MOVE } = require("@node-sc2/core/constants/ability");
const { mineralFieldTypes } = require("@node-sc2/core/constants/groups");
const { ADEPTPHASESHIFT, ZEALOT, SCV } = require("@node-sc2/core/constants/unit-type");
const { toDegrees } = require("@node-sc2/core/utils/geometry/angle");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { createUnitCommand } = require("./actions-service");
const { moveAwayPosition } = require("./position-service");

const microService = {
  /**
   * @param {Unit} unit 
   * @param {Unit} targetUnit 
   * @param {number} degrees
   * @returns {boolean}
   */
  isFacing: (unit, targetUnit, degrees=7, log=false) => {
    const targetFacingDegrees = toDegrees(unit.facing);
    const { pos } = unit; if (pos === undefined) { return false; }
    const { pos: targetPos } = targetUnit; if (targetPos === undefined) { return false; }
    const { x, y } = pos; if (x === undefined || y === undefined) { return false; }
    const { x: targetX, y: targetY } = targetPos; if (targetX === undefined || targetY === undefined) { return false; }
    const positionOfUnitDegrees = toDegrees(Math.atan2(targetY - y, targetX - x));
    // facing difference is difference of 0 or 360 degrees
    const facingDifference = Math.abs(targetFacingDegrees - positionOfUnitDegrees);
    const facingDifference2 = Math.abs(targetFacingDegrees - positionOfUnitDegrees + 360);
    const facingDifference3 = Math.abs(targetFacingDegrees - positionOfUnitDegrees - 360);
    const facingDifferenceMin = Math.min(facingDifference, facingDifference2, facingDifference3);
    if (log && unit.unitType === ZEALOT) {
      console.log('targetFacingDegrees', targetFacingDegrees);
      console.log('positionOfUnitDegrees', positionOfUnitDegrees);
      console.log('facingDifference', facingDifference);
      console.log('facingDifference2', facingDifference2);
      console.log('facingDifference3', facingDifference3);
      console.log('facingDifferenceMin', facingDifferenceMin);
    }
    return facingDifferenceMin < degrees;
  },
  /**
   * @param {UnitResource} units
   * @param {Unit} unit 
   * @param {Unit} targetUnit 
   * @param {Unit[]} enemyUnits 
   * @returns 
   */
  micro: (units, unit, targetUnit, enemyUnits) => {
    const collectedActions = [];
    // if cool down and fighting melee move back
    const retreatCommand = createUnitCommand(MOVE, [unit]);
    if (unit.isWorker()) {
      const candidateMinerals = units.getByType(mineralFieldTypes).filter(mineralField => distance(unit.pos, mineralField.pos) < distance(targetUnit.pos, mineralField.pos));
      const [closestCandidateMineral] = units.getClosest(unit.pos, candidateMinerals); if (closestCandidateMineral === undefined) { return collectedActions; }
      retreatCommand.abilityId = HARVEST_GATHER;
      retreatCommand.targetUnitTag = closestCandidateMineral.tag;
    } else {
      retreatCommand.targetWorldSpacePos = moveAwayPosition(targetUnit.pos, unit.pos);
    }
    const microConditions = [
      targetUnit.isMelee(),
      (distance(unit.pos, targetUnit.pos) + 0.05) - (unit.radius + targetUnit.radius) < 0.5,
      microService.isFacing(targetUnit, unit),
    ];
    if (
      [...microConditions, unit.weaponCooldown > 8].every(condition => condition) ||
      [...microConditions, (unit.health + unit.shield) < (targetUnit.health + targetUnit.shield)].every(condition => condition)
    ) {
      console.log('unit.weaponCooldown', unit.weaponCooldown);
      console.log('distance(unit.pos, targetUnit.pos)', distance(unit.pos, targetUnit.pos));
      collectedActions.push(retreatCommand);
    } else {
      const inRangeMeleeEnemyUnits = enemyUnits.filter(enemyUnit => enemyUnit.isMelee() && ((distance(unit.pos, enemyUnit.pos) + 0.05) - (unit.radius + enemyUnit.radius) < 0.25));
      const [weakestInRange] = inRangeMeleeEnemyUnits.sort((a, b) => (a.health + a.shield) - (b.health + b.shield));
      targetUnit = weakestInRange || targetUnit;
      /** @type {SC2APIProtocol.ActionRawUnitCommand} */
      const unitCommand = {
        abilityId: ATTACK_ATTACK,
        unitTags: [unit.tag],
      }
      if (targetUnit.unitType === ADEPTPHASESHIFT) {
        unitCommand.targetWorldSpacePos = targetUnit.pos;
      } else {
        unitCommand.targetUnitTag = targetUnit.tag;
      }
      collectedActions.push(unitCommand);
    }
    return collectedActions;
  },
}

module.exports = microService;
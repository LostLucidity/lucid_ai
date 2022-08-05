//@ts-check
"use strict"

const { ATTACK_ATTACK, HARVEST_GATHER, MOVE } = require("@node-sc2/core/constants/ability");
const { mineralFieldTypes } = require("@node-sc2/core/constants/groups");
const { ADEPTPHASESHIFT } = require("@node-sc2/core/constants/unit-type");
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
    const targetFacingDegrees = toDegrees(targetUnit.facing);
    const positionOfUnitDegrees = toDegrees(Math.atan2(unit.pos.y - targetUnit.pos.y, unit.pos.x - targetUnit.pos.x));
    const normalizedPositionOfUnitDegrees = positionOfUnitDegrees > 0 ? positionOfUnitDegrees : 360 + positionOfUnitDegrees;
    if (log) {
      console.log('Math.abs(targetFacingDegrees - normalizedPositionOfUnitDegrees)', Math.abs(targetFacingDegrees - normalizedPositionOfUnitDegrees));
    }
    return Math.abs(targetFacingDegrees - normalizedPositionOfUnitDegrees) < degrees;
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
      const [closestCandidateMineral] = units.getClosest(unit.pos, candidateMinerals);
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
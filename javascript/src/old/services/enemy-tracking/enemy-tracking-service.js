//@ts-check
"use strict"


const { Alliance } = require("@node-sc2/core/constants/enums");

const { pathFindingService } = require("../pathfinding");
const { isByItselfAndNotAttacking } = require("../../shared-utilities/game-analysis-utils");

class EnemyTrackingService {
  /**
   * Get the closest enemy to a given point by path distance.
   *
   * @param {ResourceManager} resources - The resources object.
   * @param {Point2D} point - The reference point.
   * @param {Unit[]} unitsFromClustering - The units to search for the closest enemy.
   * @returns {Unit | undefined} - The closest enemy unit or undefined if none found.
   */
  getClosestEnemyByPath(resources, point, unitsFromClustering) {
    const [closestEnemy] = pathFindingService.getClosestUnitByPath(resources, point, unitsFromClustering, getGasGeysers(resources.get ().units));
    return closestEnemy;
  }
  /**
   * 
   * Retrieves enemy units based on the provided unit.
   * @param {Unit} unit
   * @returns {Unit[]}
   */
  getEnemyUnits(unit) {
    // check if enemy units are in stateOfGame map, if not, add them
    if (!stateOfGame.has('enemyUnits')) {
      stateOfGameService.stateOfGame.set('enemyUnits', new Map());
    }
    const enemyUnits = stateOfGame.get('enemyUnits').get(unit.tag);
    if (enemyUnits) {
      return enemyUnits;
    } else {
      // if no enemy units in state of game map, get enemy units from world
      const { world } = stateOfGameService;
      if (world) {
        const { units } = world.resources.get();
        const enemyUnits = units.getAlive(unit.alliance === Alliance.SELF ? Alliance.ENEMY : Alliance.SELF);
        if (unit.alliance === Alliance.ENEMY) {
          const { missingUnits } = trackUnitsService;
          enemyUnits.push(...missingUnits);
        } else {
          enemyUnits.push(...this.mappedEnemyUnits);
        }
        stateOfGameService.stateOfGame.set('enemyUnits', new Map([[unit.tag, getInRangeUnits(unit, enemyUnits)]]));
        return enemyUnits;
      } else {
        return [];
      }
    }
  }
  /**
   * @param {ResourceManager} resources
   * @param {Unit} enemyUnit
   * @returns {boolean}
   * @description Returns true if enemy unit is a worker and is in mineral line or is by itself and not attacking
   */
  isPeacefulWorker(resources, enemyUnit) {
    const { map, units } = resources.get();
    const { pos: enemyPos } = enemyUnit;
    if (enemyPos === undefined) return false;
    return enemyUnit.isWorker() && (isInMineralLine(map, enemyPos) || isByItselfAndNotAttacking(units, enemyUnit, this.mappedEnemyUnits));
  }
}

// Export the service for use in other parts of your application
module.exports = new EnemyTrackingService();

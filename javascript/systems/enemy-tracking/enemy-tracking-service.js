//@ts-check
"use strict"

const { UnitType } = require("@node-sc2/core/constants");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { morphMapping } = require("../../helper/groups");
const { existsInMap } = require("../../helper/location");
const { getSupply } = require("../../services/data-service");
const enemyTrackingServiceV2 = require("../../src/services/enemy-tracking/enemy-tracking-service");

const enemyTrackingService = {
  /** @type {Unit[]} */
  enemyUnits: [],
  /** @type {Map<string, {current: { pos: Point2D, lastSeen: number }, previous: { pos: Point2D, lastSeen: number }}>} */
  enemyUnitsPositions: new Map(),
  enemySupply: null,
  get movedEnemyUnits() {
    const movedEnemyUnits = [];
    if (enemyTrackingService.enemyUnitsPositions.size === 0) {
      enemyTrackingService.setEnemyUnitPositions();
    }
    enemyTrackingServiceV2.mappedEnemyUnits.forEach(unit => {
      const { tag, pos } = unit; if (tag === undefined || pos === undefined) { return; }
      const lastPosition = enemyTrackingService.enemyUnitsPositions.get(tag); if (lastPosition === undefined) { return; }
      if (lastPosition && distance(lastPosition.previous.pos, pos) > 0.5) {
        movedEnemyUnits.push(unit);
      }
    });
    return movedEnemyUnits;
  },
  threats: [],
  /**
   * @returns {Unit[]}
   */
  get enemyCombatUnits() {
    return enemyTrackingService.enemyUnits.filter(unit => unit.isCombatUnit());
  },
  /**
   * Keep track of units whose destruction hasn't been detected.
   * @param {Unit} enemyUnit 
   * @returns {void}
   */
  addEnemyUnit: (enemyUnit) => {
    enemyTrackingService.enemyUnits.push(enemyUnit);
  },
  /**
   * Keep track of units last seen on the map including visible units.
   * @param {UnitResource} units 
   * * @returns {void}
   */
  addUnmappedUnit: (units) => {
    enemyTrackingServiceV2.mappedEnemyUnits.push(...units.getAlive(Alliance.ENEMY).filter(unit => !enemyTrackingServiceV2.mappedEnemyUnits.some(mappedUnit => unit.tag === mappedUnit.tag)));
  },
  clearOutdatedMappedUnits: (resources) => {
    const { map, units } = resources.get();
    enemyTrackingServiceV2.mappedEnemyUnits.forEach(unit => {
      const visibleCandidates = gridsInCircle(unit.pos, 1, { normalize: true }).filter(grid => {
        if (existsInMap(map, grid)) {
          if (!unit.isFlying) { return map.isPathable(unit.pos); } else { return true; }
        }
      });
      if (visibleCandidates.every(candidate => map.isVisible(candidate)) && !units.getByTag(unit.tag).isCurrent()) {
        enemyTrackingService.removedMappedUnit(unit);
      }
    });
  },
  removeEnemyUnit: (enemyUnit) => {
    enemyTrackingService.enemyUnits = [...enemyTrackingService.enemyUnits.filter(unit => unit.tag !== enemyUnit.tag)];
    enemyTrackingService.removedMappedUnit(enemyUnit);
  },
  removedMappedUnit: (enemyUnit) => {
    enemyTrackingServiceV2.mappedEnemyUnits = [...enemyTrackingServiceV2.mappedEnemyUnits.filter(unit => unit.tag !== enemyUnit.tag)];
  },
  getEnemyCombatSupply: (data) => {
    const {enemyCombatUnits} = enemyTrackingService;
    const morphedUnitTypes = [];
    Object.keys(morphMapping).forEach(morphableType => morphedUnitTypes.push(...morphMapping[morphableType]));
    const morphedUnits = enemyCombatUnits.filter(unit => morphedUnitTypes.includes(unit.unitType));
    let supplyToRemove = 0;
    morphedUnits.forEach(unit => {
      const foundKey = Object.keys(morphMapping).find(key => morphMapping[key].includes(unit.unitType));
      supplyToRemove += data.getUnitTypeData(UnitType[foundKey]).foodRequired;
    })
    return getSupply(data, enemyCombatUnits) - supplyToRemove;
  },
  setBaseThreats(resources) {
    const { units } = resources.get();
    const positionsOfStructures = units.getStructures().map(structure => structure.pos);
    enemyTrackingService.threats = [];
    // check if structure in natural
    positionsOfStructures.forEach(position => {
      const enemyUnits = units.getAlive(Alliance.ENEMY);
      const inRange = enemyUnits.filter(unit => distance(unit.pos, position) < 16);
      enemyTrackingService.threats.push(...inRange);
    });
  },
  setEnemyUnitPositions() {
    const { enemyUnitsPositions } = enemyTrackingService;
    enemyTrackingServiceV2.mappedEnemyUnits.forEach(unit => {
      const { lastSeen, tag, pos } = unit; if (lastSeen === undefined || tag === undefined || pos === undefined) { return; }
      if (enemyUnitsPositions.has(tag)) {
        enemyUnitsPositions.set(
          tag,
          {
            current: { pos, lastSeen },
              // @ts-ignore
            previous: enemyUnitsPositions.get(tag).current,
          }
        );
      } else {
        enemyUnitsPositions.set(tag, { current: { pos, lastSeen }, previous: { pos, lastSeen } });
      }
    });
    enemyTrackingService.enemyUnitsPositions = enemyUnitsPositions;
  }
}

module.exports = enemyTrackingService;

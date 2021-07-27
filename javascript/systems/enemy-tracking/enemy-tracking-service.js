//@ts-check
"use strict"

const { UnitType } = require("@node-sc2/core/constants");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getSupply } = require("../../helper");
const { morphMapping } = require("../../helper/groups");

const enemyTrackingService = {
  enemyUnits: [],
  enemySupply: null,
  mappedEnemyUnits: [],
  threats: [],
  get enemyCombatUnits() {
    return enemyTrackingService.enemyUnits.filter(unit => unit.isCombatUnit());
  },
  addEnemyUnit: (enemyUnit) => {
    enemyTrackingService.enemyUnits.push(enemyUnit);
  },
  addUnmappedUnit: (units) => {
    enemyTrackingService.mappedEnemyUnits.push(...units.getAlive(Alliance.ENEMY).filter(unit => !enemyTrackingService.mappedEnemyUnits.some(mappedUnit => unit.tag === mappedUnit.tag)));
  },
  clearOutdatedMappedUnits: (resources) => {
    const { map, units } = resources.get();
    enemyTrackingService.mappedEnemyUnits.forEach(unit => {
      if (map.isVisible(unit.pos) && !units.getByTag(unit.tag).isCurrent()) {
        enemyTrackingService.removedMappedUnit(unit);
      }
    });
  },
  removeEnemyUnit: (enemyUnit) => {
    enemyTrackingService.enemyUnits = [...enemyTrackingService.enemyUnits.filter(unit => unit.tag !== enemyUnit.tag)];
    enemyTrackingService.removedMappedUnit(enemyUnit);
  },
  removedMappedUnit: (enemyUnit) => {
    enemyTrackingService.mappedEnemyUnits = [...enemyTrackingService.mappedEnemyUnits.filter(unit => unit.tag !== enemyUnit.tag)];
  },
  getEnemyCombatSupply: (data) => {
    const {enemyCombatUnits} = enemyTrackingService;
    const morphedUnitTypes = [];
    Object.keys(morphMapping).forEach(morphableType => morphedUnitTypes.push(...morphMapping[morphableType]))
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
}

module.exports = enemyTrackingService;

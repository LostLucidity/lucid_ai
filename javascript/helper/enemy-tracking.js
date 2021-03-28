//@ts-check
"use strict"

const { UnitType } = require("@node-sc2/core/constants");
const { getSupply } = require("../helper");
const { morphMapping } = require("./groups");

const enemyTrackingService = {
  enemyUnits: [],
  enemySupply: null,
  get enemyCombatUnits() {
    return enemyTrackingService.enemyUnits.filter(unit => unit.isCombatUnit());
  },
  addEnemyUnit: (enemyUnit) => {
    enemyTrackingService.enemyUnits.push(enemyUnit);
  },
  removeEnemyUnit: (enemyUnit) => {
    enemyTrackingService.enemyUnits = [...enemyTrackingService.enemyUnits.filter(unit => unit.tag !== enemyUnit.tag)];
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
}

module.exports = enemyTrackingService;

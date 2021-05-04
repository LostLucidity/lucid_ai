//@ts-check
"use strict"

const { creepTumorTypes } = require("@node-sc2/core/constants/groups");
const { distance } = require("@node-sc2/core/utils/geometry/point")

module.exports = {
  calculateNearSupply: (data, units) => {
    return units.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0)
  },
  getInRangeUnits: (unit, targetUnits) => {
    return targetUnits.filter(targetUnit => distance(unit.pos, targetUnit.pos) < 16);
  },
  assessBattleField: (selfUnits, enemyunits) => {
    // I want a mapping of unit types and count for each composition.
    const selfComposition = {};
    const enemyComposition = {};
    selfUnits.forEach(unit => {
      let unitTypeCount = selfComposition[unit.unitType];
      unitTypeCount = typeof unitTypeCount !== 'undefined' ? selfComposition[unit.unitType] + 1 : 1;
      selfComposition[unit.unitType] = unitTypeCount;
    });
    enemyunits.forEach(unit => {
      let unitTypeCount = enemyComposition[unit.unitType]
      unitTypeCount = typeof unitTypeCount !== 'undefined' ? enemyComposition[unit.unitType] + 1 : 1;
      enemyComposition[unit.unitType] = unitTypeCount
    });
    const battleComposition = {
      selfComposition,
      enemyComposition,
    }
    return battleComposition;

  },
  decideEngagement: (storedCompositions, composition) => {
    let foundIndex;
    const foundComposition = storedCompositions.find((storedComposition, index) => {
      if (Object.keys(composition).every(key => {
        return Object.keys(storedComposition[key]).every(storedKey => {
          if (!['selfComposition', 'enemyComposition'].includes(key)) { return true }
          if (Object.keys(storedComposition[key]).length !== Object.keys(composition[key]).length) { return false }
          return storedComposition[key][storedKey] === composition[key][storedKey];
        });
      })) {
        foundIndex = index;
        return true;
      }
    });
    // I want to grab a json to look for matching compositions.
    // For now, nothing.
    // If none are found, 50/50 attack chance. If one is matching, get differential calculate with a 1-1 increment.
    if (foundComposition) {
      storedCompositions.unshift(storedCompositions.splice(foundIndex, 1)[0]);
      if (!foundComposition.hasOwnProperty('attack')) {
        foundComposition.attack = module.exports.selectAttackAction(foundComposition.differential);
      }
      foundComposition.seen++;
      return foundComposition.attack;
    } else {
      composition.attack = 0.5 > Math.random();
      composition.differential = 0;
      storedCompositions.unshift(composition);
      composition.seen = 1;
      composition.matches = 0;
      return composition.attack;
    }
  },
  selectAttackAction: (differential) => {
    if (differential >= 0) {
      return ((differential + 1) / (differential + 2) > Math.random());
    } else {
      const reverseDifferential = differential * -1;
      return !((reverseDifferential + 1) / (reverseDifferential + 2) > Math.random());
    }
  }
}
//@ts-check
"use strict"

const { MOVE } = require("@node-sc2/core/constants/ability");
const { PROBE } = require("@node-sc2/core/constants/unit-type");

const scoutService = {
  earlyScout: true,
  enemyBuildType: null,
  scoutReport: null,
  setScout: (units, location, unitType, label) => {
    let [unit] = units.getClosest(
      location,
      units.getById(unitType).filter(unit => {
        return (
          unit.noQueue ||
          unit.orders.findIndex(order => order.abilityId === MOVE) > -1 ||
          unit.isConstructing() && unit.unitType === PROBE
        )
      })
    );
    if (!unit) { [ unit ] = units.getClosest(location, units.getById(unitType).filter(unit => unit.unitType === unitType && !unit.isConstructing() && unit.isGathering())); }
    if (unit) {
      console.log(unit.orders[0] && unit.orders[0].abilityId)
      unit.labels.clear();
      if (!unit.labels.get(label)) {
        unit.labels.set(label, true);
        console.log(`Set ${label}`);
      }
    }
  },
  opponentRace: null,
}

module.exports = scoutService;
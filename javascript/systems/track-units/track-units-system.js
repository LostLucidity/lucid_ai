//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Alliance } = require("@node-sc2/core/constants/enums");

// for issues like keeping track of units loaded into a bunker

module.exports = createSystem({
  name: 'TrackUnitsSystem',
  type: 'agent',
  async onStep({ resources }) {
    const { units } = resources.get();
    const currentUnits = units.getAlive(Alliance.SELF);
    var inCurrent = {};
    currentUnits.forEach(unit => inCurrent[unit.tag] = true);
    trackUnitsService.missingUnits = trackUnitsService.previousUnits.filter(unit => {
      return !inCurrent[unit.tag] && !unit.labels.get('dead');
    });
    trackUnitsService.missingUnits = trackUnitsService.missingUnits.filter(unit => !currentUnits.some(currentUnit => currentUnit.tag === unit.tag));
  },
});
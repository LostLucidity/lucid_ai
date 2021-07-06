//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Alliance } = require("@node-sc2/core/constants/enums");
const trackUnitsService = require("./track-units-service");

module.exports = createSystem({
  name: 'TrackUnitsSystem',
  type: 'agent',
  async onStep({ resources }) {
    const { units } = resources.get();
    const currentUnits = units.getAlive(Alliance.SELF);
    var inCurrent = {};
    currentUnits.forEach(unit => inCurrent[unit.tag] = true);
    trackUnitsService.missingUnits.push(...trackUnitsService.previousUnits.filter(unit => {
      return !inCurrent[unit.tag] && !unit.labels.get('dead');
    }));
    trackUnitsService.missingUnits = trackUnitsService.missingUnits.filter(unit => !currentUnits.some(currentUnit => currentUnit.tag === unit.tag));
    trackUnitsService.previousUnits = currentUnits;
  },
});
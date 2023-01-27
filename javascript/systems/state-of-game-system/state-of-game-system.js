//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { clearOutdatedMappedUnits, addUnmappedUnit } = require("../enemy-tracking/enemy-tracking-service");
const trackUnitsService = require("../track-units/track-units-service");
const stateOfGameService = require("./state-of-game-service");

module.exports = createSystem({
  name: 'StateOfGameSystem',
  type: 'agent',
  async onGameStart(world) {
    stateOfGameService.world = world;
  },
  async onStep(world) {
    stateOfGameService.world = world;
    const { resources } = world;
    const { units } = resources.get();
    setMissingUnits(units);
    clearOutdatedMappedUnits(resources);
    addUnmappedUnit(units);
    stateOfGameService.clearStateOfGame();
  },
  async onUnitDestroyed(_world, destroyedUnit) {
    trackUnitsService.missingUnits = trackUnitsService.missingUnits.filter(unit => destroyedUnit.tag !== unit.tag);
  },
});

/**
 * @param {UnitResource} units 
 */
function setMissingUnits(units) {
  const currentUnits = units.getAlive(Alliance.SELF);
  var inCurrent = {};
  currentUnits.forEach(unit => inCurrent[unit.tag] = true);
  trackUnitsService.missingUnits.push(...trackUnitsService.previousUnits.filter(unit => {
    const { tag, labels } = unit;
    return !inCurrent[tag] && !labels.get('dead');
  }));
  trackUnitsService.missingUnits = trackUnitsService.missingUnits.filter(unit => !currentUnits.some(currentUnit => currentUnit.tag === unit.tag));
  trackUnitsService.previousUnits = currentUnits;
}


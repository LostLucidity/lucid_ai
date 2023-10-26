//@ts-check
"use strict"

const { MOVE } = require("@node-sc2/core/constants/ability");
const { PROBE } = require("@node-sc2/core/constants/unit-type");
const { getEnemyCombatSupply } = require("../enemy-tracking/enemy-tracking-service");
const trackUnitsService = require("../track-units/track-units-service");
const unitResourceService = require("../unit-resource/unit-resource-service");

const scoutingService = {
  earlyScout: true,
  earlyScoutTime: 122,
  enemyBuildType: 'standard',
  enemyCombatSupply: 0,
  /** @type {SC2APIProtocol.Race | undefined} */
  opponentRace: undefined,
  outsupplied: false,
  scoutReport: 'No cheese detected',
  lastSeen: {},
  setEnemyCombatSupply: (data) => {
    scoutingService.enemyCombatSupply = getEnemyCombatSupply(data);
  },
  /**
   * @param {Unit} unit
   * @returns {void}
   **/
  setOpponentRace: (unit) => {
    const { opponentRace } = scoutingService;
    scoutingService.opponentRace = opponentRace ? opponentRace : unit.data().race;
  },
  setOutsupplied: () => {
    scoutingService.outsupplied = scoutingService.enemyCombatSupply > trackUnitsService.selfCombatSupply;
  },
  /**
   * 
   * @param {UnitResource} units 
   * @param {Point2D} location 
   * @param {UnitTypeId} unitType 
   * @param {string} label 
   */
  setScout: (units, location, unitType, label) => {
    let [unit] = units.getClosest(
      location,
      units.getById(unitType).filter(unit => {
        const { noQueue, orders, pos, unitType } = unit;
        if (noQueue === undefined || orders === undefined || pos === undefined || unitType === undefined) return false;
        const gatheringAndNotMining = unit.isGathering() && !unitResourceService.isMining(units, unit);
        return (
          noQueue ||
          orders.some(order => order.abilityId === MOVE || unit.isAttacking()) ||
          unit.isConstructing() && unitType === PROBE ||
          gatheringAndNotMining
        )
      })
    );
    if (!unit) { [unit] = units.getClosest(location, units.getById(unitType).filter(unit => unit.unitType === unitType && !unit.isConstructing() && unit.isGathering())); }
    if (unit) {
      console.log(unit.orders[0] && unit.orders[0].abilityId)
      unit.labels.clear();
      if (!unit.labels.get(label)) {
        unit.labels.set(label, true);
        console.log(`Set ${label}`);
      }
    }
  }
}

module.exports = scoutingService;
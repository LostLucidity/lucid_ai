const { Alliance } = require("@node-sc2/core/constants/enums");
const unitService = require("../../../services/unit-service");
const trackUnitsService = require("../../../systems/track-units/track-units-service");
const { getDistance } = require("../../../services/position-service");
const unitResourceService = require("../../../systems/unit-resource/unit-resource-service");

class UnitRetrievalService {

  constructor() {
    // Initialization if needed
  }


  /**
   * @param {UnitResource} units
   * @returns {Unit[]}
   */
  getGasGeysers(units) {
    return unitResourceService.gasGeysers || (unitResourceService.gasGeysers = units.getGasGeysers());
  }

  /**
   * @param {UnitResource} units
   * @param {Unit} unit
   * @param {Unit[]} mappedEnemyUnits
   * @param {number} withinRange
   * @returns {Unit[]}
   */
  getSelfUnits(units, unit, mappedEnemyUnits, withinRange = 16) {
    const { pos, tag } = unit; if (pos === undefined || tag === undefined) return [];
    let hasSelfUnits = unitService.selfUnits.has(tag);
    if (!hasSelfUnits) {
      let unitsByAlliance = [];
      if (unit.alliance === Alliance.SELF) {
        unitsByAlliance = trackUnitsService.selfUnits.length > 0 ? trackUnitsService.selfUnits : units.getAlive(Alliance.SELF);
      } else if (unit.alliance === Alliance.ENEMY) {
        unitsByAlliance = mappedEnemyUnits.length > 0 ? mappedEnemyUnits : units.getAlive(Alliance.ENEMY);
      }
      const selfUnits = unitsByAlliance.filter(allyUnit => {
        const { pos: allyPos } = allyUnit; if (allyPos === undefined) return false;
        return getDistance(pos, allyPos) < withinRange;
      });
      unitService.selfUnits.set(tag, selfUnits);
    }
    return unitService.selfUnits.get(tag) || [];
  }
}

// Export as a singleton, or export the class if you prefer to instantiate it elsewhere
module.exports = new UnitRetrievalService();
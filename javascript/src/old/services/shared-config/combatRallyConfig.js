//@ts-check
"use strict";

const { getRallyPointByBases } = require("../../../helper/location");

let combatRally;

module.exports = {
  /**
   * @param {ResourceManager} resources 
   * @returns {Point2D}
   */
  getCombatRally(resources) {
    const { map, units } = resources.get();
    if (combatRally) {
      return combatRally;
    } else {
      return map.getCombatRally() || getRallyPointByBases(map, units);
    }
  }
};
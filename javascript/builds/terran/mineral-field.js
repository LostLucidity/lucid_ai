//@ts-check
"use strict"

const { EFFECT_CALLDOWNMULE } = require("@node-sc2/core/constants/ability");
const { ORBITALCOMMAND } = require("@node-sc2/core/constants/unit-type");
const getRandom = require("@node-sc2/core/utils/get-random");
const { getOccupiedExpansions, getBase } = require("../../helper/expansions");

module.exports = {
  getMineralFieldTarget: (units, unit) => {
    const [ closestMineralField ] = units.getClosest(unit.pos, units.getMineralFields());
    return closestMineralField;
  }
}
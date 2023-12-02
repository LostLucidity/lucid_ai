//@ts-check
'use strict';

const { BUILD_REACTOR_STARPORT, BUILD_REACTOR_BARRACKS, BUILD_TECHLAB_FACTORY } = require("@node-sc2/core/constants/ability");
const { SUPPLYDEPOT, EGG, LARVA, OVERLORD, PYLON } = require("@node-sc2/core/constants/unit-type");

const addOnAbilities = [
  BUILD_REACTOR_BARRACKS,
  BUILD_REACTOR_STARPORT,
  BUILD_TECHLAB_FACTORY,
];

const larvaOrEgg = [EGG, LARVA];

const supplyTypes = [
  OVERLORD,
  PYLON,
  SUPPLYDEPOT,
];

module.exports = {
  addOnAbilities,
  larvaOrEgg,
  supplyTypes,
}
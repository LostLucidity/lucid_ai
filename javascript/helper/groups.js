//@ts-check
'use strict';

const { UnitType } = require("@node-sc2/core/constants");
const { BUILD_REACTOR_STARPORT, BUILD_REACTOR_BARRACKS, BUILD_TECHLAB_FACTORY } = require("@node-sc2/core/constants/ability");
const { COMMANDCENTER, COMMANDCENTERFLYING, ORBITALCOMMAND, ORBITALCOMMANDFLYING, SUPPLYDEPOT, SUPPLYDEPOTLOWERED, BARRACKS, BARRACKSFLYING, FACTORY, FACTORYFLYING, STARPORT, STARPORTFLYING, GATEWAY, WARPGATE, HATCHERY, LAIR, BARRACKSREACTOR, FACTORYTECHLAB, STARPORTREACTOR, EGG, LARVA, BANELINGCOCOON, RAVAGER, BANELING, LURKERMPBURROWED, SIEGETANK, SIEGETANKSIEGED, HELLION, HELLIONTANK, ROACH, HYDRALISK, ZERGLING, VIKINGFIGHTER, VIKINGASSAULT, WIDOWMINE, WIDOWMINEBURROWED, OVERLORD, PYLON, PLANETARYFORTRESS, REACTOR, FACTORYREACTOR, TECHLAB, BARRACKSTECHLAB, STARPORTTECHLAB } = require("@node-sc2/core/constants/unit-type");


const addOnTypesMapping = new Map([
  [BARRACKS, [BARRACKSREACTOR, BARRACKSTECHLAB]],
  [FACTORY, [FACTORYREACTOR, FACTORYTECHLAB]],
  [STARPORT, [STARPORTREACTOR, STARPORTTECHLAB]],
]);

const flyingTypesMapping = new Map([
  [COMMANDCENTERFLYING, COMMANDCENTER],
  [BARRACKSFLYING, BARRACKS],
  [FACTORYFLYING, FACTORY],
  [STARPORTFLYING, STARPORT],
]);

const addOnAbilities = [
  BUILD_REACTOR_BARRACKS,
  BUILD_REACTOR_STARPORT,
  BUILD_TECHLAB_FACTORY,
];

const countTypes = new Map([
  [BARRACKS, [BARRACKS, BARRACKSFLYING]],
  [COMMANDCENTER, [COMMANDCENTER, COMMANDCENTERFLYING, ORBITALCOMMAND, ORBITALCOMMANDFLYING]],
  [UnitType.CREEPTUMORQUEEN, [UnitType.CREEPTUMORBURROWED]],
  [FACTORY, [FACTORY, FACTORYFLYING]],
  [GATEWAY, [GATEWAY, WARPGATE]],
  [HATCHERY, [HATCHERY, LAIR]],
  [ORBITALCOMMAND, [ORBITALCOMMAND, ORBITALCOMMANDFLYING]],
  [REACTOR, [REACTOR, BARRACKSREACTOR, FACTORYREACTOR, STARPORTREACTOR]],
  [STARPORT, [STARPORT, STARPORTFLYING]],
  [SUPPLYDEPOT, [SUPPLYDEPOT, SUPPLYDEPOTLOWERED]],
  [TECHLAB, [TECHLAB, BARRACKSTECHLAB, FACTORYTECHLAB, STARPORTTECHLAB]],
]);

const upgradeTypes = new Map([
  [COMMANDCENTER, [ORBITALCOMMAND, PLANETARYFORTRESS]],
]);

const larvaOrEgg = [EGG, LARVA];

const morphMapping = new Map([
  [HELLION, [HELLION, HELLIONTANK]],
  [ROACH, [ROACH, RAVAGER]],
  [HYDRALISK, [HYDRALISK, LURKERMPBURROWED]],
  [SIEGETANK, [SIEGETANK, SIEGETANKSIEGED]],
  [WIDOWMINE, [WIDOWMINE, WIDOWMINEBURROWED]],
  [VIKINGFIGHTER, [VIKINGFIGHTER, VIKINGASSAULT]],
  [ZERGLING, [ZERGLING, BANELING, BANELINGCOCOON]],
]);

const supplyTypes = [
  OVERLORD,
  PYLON,
  SUPPLYDEPOT,
];

module.exports = {
  addOnAbilities,
  addOnTypesMapping,
  countTypes,
  flyingTypesMapping,
  larvaOrEgg,
  morphMapping,
  supplyTypes,
  upgradeTypes,
}
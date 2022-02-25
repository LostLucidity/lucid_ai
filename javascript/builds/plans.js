//@ts-check
"use strict"

const { EFFECT_CHRONOBOOSTENERGYCOST, MORPH_ORBITALCOMMAND, MORPH_OVERSEER, RESEARCH_MUSCULARAUGMENTS, MORPH_HIVE, EFFECT_CALLDOWNMULE } = require('@node-sc2/core/constants/ability');
const { NEXUS, PYLON, STALKER, GATEWAY, COLOSSUS, IMMORTAL, OBSERVER, WARPPRISM, ROBOTICSFACILITY, OVERLORD, ZERGLING, ROACH, HYDRALISK, OVERSEER, CYCLONE, MARINE, MARAUDER, SIEGETANK, SIEGETANKSIEGED, LIBERATOR, MEDIVAC, VIKINGFIGHTER, SCV, PROBE, QUEEN, BUNKER, SHIELDBATTERY, LAIR, HIVE, ORBITALCOMMAND, STARPORTREACTOR, STARPORT, BARRACKS, SPINECRAWLER, OVERLORDCOCOON, ZEALOT, MINERALFIELD, SUPPLYDEPOT, REFINERY, COMMANDCENTER, FACTORY, ENGINEERINGBAY, ARMORY, MISSILETURRET, HATCHERY, EXTRACTOR, SPAWNINGPOOL, ROACHWARREN, EVOLUTIONCHAMBER, HYDRALISKDEN, INFESTATIONPIT, SPORECRAWLER, ASSIMILATOR, CYBERNETICSCORE, FORGE, TWILIGHTCOUNCIL, PHOTONCANNON, TEMPLARARCHIVE, ROBOTICSBAY, REACTOR, TECHLAB, RAVEN } = require('@node-sc2/core/constants/unit-type');
const { WARPGATERESEARCH, EXTENDEDTHERMALLANCE, PROTOSSGROUNDWEAPONSLEVEL1, CHARGE, PROTOSSGROUNDWEAPONSLEVEL2, GLIALRECONSTITUTION, ZERGMISSILEWEAPONSLEVEL2, ZERGMISSILEWEAPONSLEVEL1, ZERGGROUNDARMORSLEVEL1, ZERGGROUNDARMORSLEVEL2, TERRANINFANTRYWEAPONSLEVEL1, TERRANINFANTRYARMORSLEVEL1, TERRANINFANTRYWEAPONSLEVEL2, TERRANINFANTRYARMORSLEVEL2, ZERGLINGMOVEMENTSPEED, STIMPACK, EVOLVEGROOVEDSPINES, COMBATSHIELD } = require('@node-sc2/core/constants/upgrade');
const { countTypes } = require('../helper/groups');
const { range } = require('../helper/utilities');

const plans = {
  1: {
    oneOneOne: {
      unitTypes: {
        defenseStructures: [ BUNKER ],
        defenseTypes: [ MARAUDER, MARINE, SIEGETANK ],
        mainCombatTypes: [ MARINE, MARAUDER, SIEGETANK, SIEGETANKSIEGED ],
        supportUnitTypes: [ CYCLONE, LIBERATOR, MEDIVAC, VIKINGFIGHTER ],
      },
      orders: [
        [14, 'build', SUPPLYDEPOT, 0],
        [16, 'build', BARRACKS, 0],
        [16, 'build', REFINERY, 0],
        [[...range(18, 21)], 'scout', SCV, 'getEnemyMain', { scoutType: 'earlyScout' }],
        [19, 'build', ORBITALCOMMAND, 0],
        [19, 'build', REACTOR, 0],
        [19, 'build', COMMANDCENTER, 1],
        [19, 'ability', EFFECT_CALLDOWNMULE, { targetType: MINERALFIELD, continuous: true, controlled: true }],
        [20, 'build', SUPPLYDEPOT, 1],
        [20, 'build', FACTORY, 0],
        [21, 'train', MARINE, 0],
        [21, 'train', MARINE, 1],
        [24, 'build', BUNKER, 0, 'getMiddleOfNaturalWall', 'cheese'],
        [31, 'build', ORBITALCOMMAND, 1],
        [31, 'build', TECHLAB, 0],
        [33, 'build', STARPORT, 0],
        [34, 'build', REFINERY, 1],
        [37, 'train', CYCLONE, 0],
        [42, 'build', SUPPLYDEPOT, 2],
        [42, 'build', SUPPLYDEPOT, 3],
        [44, 'train', VIKINGFIGHTER, 0],
        [46, 'train', SIEGETANK, 0],
        [49, 'build', SUPPLYDEPOT, 4],
        [49, 'build', SUPPLYDEPOT, 5],
        [[...range(49, 200)], 'manageSupply'],
        [[...range(53, 54)], 'scout', MARINE, 'outInFront',],
        [[...range(53, 54)], 'scout', MARINE, 'AcrossTheMap',],
        [58, 'build', BARRACKS, 1],
        [58, 'build', BARRACKS, 2],
        [62, 'build', REACTOR, 1],
        [62, 'build', COMMANDCENTER, 2, 'inTheMain'],
        [62, 'build', ENGINEERINGBAY, 0],
        [62, 'build', ENGINEERINGBAY, 1],
        [69, 'build', TECHLAB, 1],
        [71, 'swapBuildings', new Map([
          [STARPORTREACTOR, 1],
          [BARRACKS, 3],
        ])],
        [71, 'build', REACTOR, 2],
        [71, 'build', REFINERY, 2],
        [75, 'upgrade', STIMPACK],
        [77, 'build', BARRACKS, 3],
        [86, 'upgrade', TERRANINFANTRYWEAPONSLEVEL1],
        [86, 'upgrade', TERRANINFANTRYARMORSLEVEL1],
        [87, 'ability', MORPH_ORBITALCOMMAND, { targetCount: 2, countType: countTypes.get(ORBITALCOMMAND) }],
        [91, 'build', BARRACKS, 4],
        [[...range(104, 193)], 'continuouslyBuild', [MEDIVAC], true],
        [[...range(193, 200)], 'continuouslyBuild', [LIBERATOR], true],
        [105, 'build', REACTOR, 3],
        [105, 'build', REACTOR, 4],
        [113, 'liftToThird'],
        [117, 'upgrade', COMBATSHIELD],
        [117, 'build', ARMORY, 0],
        [131, 'build', MISSILETURRET, 0],
        [131, 'build', MISSILETURRET, 1],
        [131, 'build', MISSILETURRET, 2],
        [131, 'build', MISSILETURRET, 3],
        [141, 'upgrade', TERRANINFANTRYWEAPONSLEVEL2],
        [141, 'upgrade', TERRANINFANTRYARMORSLEVEL2],
      ]
    },
    138658: {
      buildType: 'two variable',
      orders: [
        [14, 'Supply Depot'],
        [14, 'Refinery'],
        [16, 'Barracks'],
        [19, 'Orbital Command, Reaper'],
        [20, 'Command Center'],
        [20, 'Factory'],
        [21, 'Barracks Reactor'],
        [22, 'Supply Depot'],
        [22, 'Refinery'],
        [23, 'Factory Tech Lab'],
        [24, 'Marine x2'],
        [27, 'Orbital Command'],
        [27, 'Cyclone'],
        [27, 'Marine x2'],
        [33, 'Starport'],
        [36, 'Siege Tank'],
        [41, 'Refinery, Supply Depot'],
        [41, 'Marine x2'],
        [41, 'Starport Tech Lab'],
        [45, 'Supply Depot'],
        [48, 'Raven'],
        [50, 'Command Center'],
        [52, 'Supply Depot'],
        [52, 'Siege Tank'],
        [55, 'Marine x2'],
        [59, 'Marine x2'],
        [63, 'Raven'],
        [63, 'Siege Tank'],
        [70, 'Refinery'],
        [74, 'Barracks x2'],
        [76, 'Siege Tank'],
        [81, 'Engineering Bay x2'],
        [81, 'Stimpack, Starport Reactor'],
        [83, 'Orbital Command'],
        [85, 'Siege Tank'],
        [90, 'Terran Infantry Weapons Level 1, Terran Infantry Armor Level 1'],
        [92, 'Starport Reactor'],
        [103, 'Siege Tank'],
        [103, 'Barracks x2'],
        [107, 'Refinery x2'],
        [109, 'Medivac x2'],
        [118, 'Siege Tank'],
        [118, 'Sensor Tower'],
        [121, 'Armory'],
        [126, 'Combat Shield'],
        [126, 'Barracks Reactor x2'],
        [126, 'Viking x2'],
        [140, 'Command Center'],
        [140, 'Missile Turret x3'],
        [140, 'Siege Tank'],
        [140, 'Viking x2'],
      ],
      rallies: [
        { conditionStart: { food: 0 }, conditionEnd: { unitType: CYCLONE, count: 1 }, location: 'ByMainRamp' },
      ],
      scouts: [{ food: 17, unitType: 'SCV', targetLocationFunction: 'EnemyMain', scoutType: 'earlyScout' }],
      unitMax: {
        ['RAVEN']: 2,
      },
      wallOff: true,
    }
  },
  2: {
    lingRoachHydra: {
      unitTypes: {
        defenseTypes: [ZERGLING, ROACH, HYDRALISK],
        defenseStructures: [SPINECRAWLER],
        mainCombatTypes: [ZERGLING, ROACH, HYDRALISK],
        supportUnitTypes: [OVERSEER, QUEEN],
      },
      orders: [
        [13, 'train', OVERLORD, 1],
        [17, 'build', HATCHERY, 1],
        [17, 'build', EXTRACTOR, 0],
        [18, 'build', SPAWNINGPOOL, 0],
        [21, 'train', OVERLORD, 2],
        [21, 'train', QUEEN, 0],
        [21, 'train', QUEEN, 1],
        [25, 'upgrade', ZERGLINGMOVEMENTSPEED],
        [25, 'train', ZERGLING, 0],
        [25, 'train', ZERGLING, 1],
        [[...range(26, 200)], 'continuouslyBuild', [ZERGLING, ROACH, HYDRALISK]],
        [[...range(32, 33)], 'scout', ZERGLING, 'AcrossTheMap'],
        [32, 'train', OVERLORD, 3],
        [34, 'build', LAIR, 0],
        [34, 'train', QUEEN, 2],
        [36, 'build', ROACHWARREN, 0],
        [35, 'train', OVERLORD, 4],
        [35, 'build', EVOLUTIONCHAMBER, 0],
        [38, 'train', OVERLORD, 5],
        [[...range(39, 200)], 'manageSupply'],
        [40, 'build', SPORECRAWLER, 0, 'findMineralLines'],
        [39, 'build', SPORECRAWLER, 1, 'findMineralLines'],
        [42, 'upgrade', ZERGMISSILEWEAPONSLEVEL1],
        [42, 'upgrade', GLIALRECONSTITUTION],
        [42, 'build', EXTRACTOR, 1],
        [41, 'build', EXTRACTOR, 2],
        [42, 'train', ROACH, 0],
        [45, 'train', ROACH, 1],
        [45, 'train', ROACH, 2],
        [45, 'train', ROACH, 3],
        [45, 'train', ROACH, 4],
        [45, 'train', ROACH, 5],
        [55, 'build', HATCHERY, 2],
        [58, 'train', ROACH, 6],
        [58, 'train', ROACH, 7],
        [58, 'train', ROACH, 8],
        [58, 'train', ROACH, 9],
        [68, 'build', EVOLUTIONCHAMBER, 1],
        [[...range(71, 200)], 'push'],
        [74, 'build', EXTRACTOR, 3],
        [78, 'upgrade', ZERGMISSILEWEAPONSLEVEL2],
        [78, 'upgrade', ZERGGROUNDARMORSLEVEL1],
        [78, 'build', HYDRALISKDEN, 0],
        [87, 'build', EXTRACTOR, 4],
        [87, 'build', EXTRACTOR, 5],
        [97, 'train', HYDRALISK, 0],
        [97, 'train', HYDRALISK, 1],
        [101, 'ability', MORPH_OVERSEER, { targetCount: 0, countType: [OVERSEER, OVERLORDCOCOON] }],
        [101, 'train', HYDRALISK, 2],
        [101, 'train', HYDRALISK, 3],
        [101, 'train', HYDRALISK, 4],
        [101, 'train', HYDRALISK, 5],
        [105, 'train', HYDRALISK, 6],
        [105, 'train', HYDRALISK, 7],
        [113, 'train', HYDRALISK, 8],
        [113, 'train', HYDRALISK, 9],
        [119, 'upgrade', EVOLVEGROOVEDSPINES],
        [129, 'build', HATCHERY, 3],
        [138, 'build', HYDRALISKDEN, 1],
        [149, 'upgrade', ZERGGROUNDARMORSLEVEL2],
        [149, 'ability', RESEARCH_MUSCULARAUGMENTS],
        [165, 'build', INFESTATIONPIT, 0],
        [164, 'build', HATCHERY, 4],
        [200, 'ability', MORPH_HIVE, { targetCount: 0, countType: HIVE }],
      ]
    }
  },
  3: {
    economicStalkerColossi: {
      unitTypes: {
        defenseStructures: [SHIELDBATTERY],
        defenseTypes: [STALKER, IMMORTAL],
        mainCombatTypes: [STALKER, COLOSSUS, IMMORTAL, ZEALOT],
        supportUnitTypes: [OBSERVER, WARPPRISM],
      },
      orders: [
        [14, 'build', PYLON, 0, 'NaturalWallPylon'],
        [[...range(14, 19)], 'scout', PROBE, 'EnemyMain', { unitType: PYLON, unitCount: 1, scoutType: 'earlyScout' }],
        [15, 'build', GATEWAY, 0],
        [16, 'ability', EFFECT_CHRONOBOOSTENERGYCOST, { targetType: NEXUS, continuous: false }],
        [17, 'build', ASSIMILATOR, 0],
        [18, 'build', ASSIMILATOR, 1],
        [19, 'build', GATEWAY, 1],
        [20, 'build', CYBERNETICSCORE, 0],
        [20, 'build', PYLON, 1],
        [[...range(20, 26)], 'scout', PROBE, 'EnemyNatural', { scoutType: 'earlyScout' }],
        [23, 'train', STALKER, 0],
        [23, 'ability', EFFECT_CHRONOBOOSTENERGYCOST, { targetType: GATEWAY, continuous: false }],
        [23, 'train', STALKER, 1],
        [27, 'ability', EFFECT_CHRONOBOOSTENERGYCOST, { targetType: GATEWAY, continuous: false }],
        [27, 'upgrade', WARPGATERESEARCH],
        [[...range(27, 180)], 'continuouslyBuild', [STALKER, COLOSSUS]],
        [27, 'train', STALKER, 2],
        [27, 'train', STALKER, 3],
        [31, 'harass'],
        [31, 'build', PYLON, 2],
        [31, 'build', NEXUS, 1],
        [31, 'harass', STALKER, 4],
        [32, 'build', ROBOTICSFACILITY, 0],
        [33, 'build', PYLON, 3],
        [35, 'build', GATEWAY, 2],
        [36, 'train', OBSERVER, 0],
        [36, 'ability', EFFECT_CHRONOBOOSTENERGYCOST, { targetType: ROBOTICSFACILITY, continuous: true }],
        [37, 'build', ROBOTICSBAY, 0],
        [37, 'train', STALKER, 4],
        [[...range(37, 44)], 'scout', OBSERVER, 'EnemyNatural'],
        [39, 'train', STALKER, 5],
        [45, 'train', IMMORTAL, 0],
        [51, 'build', ASSIMILATOR, 2],
        [51, 'build', ASSIMILATOR, 3],
        [53, 'train', COLOSSUS, 0],
        [61, 'upgrade', EXTENDEDTHERMALLANCE],
        [61, 'build', PYLON, 4],
        [[...range(61, 200)], 'manageSupply'],
        [64, 'build', NEXUS, 2],
        [66, 'train', COLOSSUS, 1],
        [74, 'build', FORGE, 0],
        [76, 'train', STALKER, 6],
        [78, 'train', STALKER, 7],
        [80, 'build', GATEWAY, 3],
        [80, 'upgrade', PROTOSSGROUNDWEAPONSLEVEL1],
        [80, 'train', COLOSSUS, 2],
        [91, 'build', TWILIGHTCOUNCIL, 0],
        [94, 'train', STALKER, 8],
        [96, 'train', STALKER, 9],
        [101, 'build', PHOTONCANNON, 0],
        [101, 'build', PHOTONCANNON, 1],
        [101, 'train', COLOSSUS, 3],
        [110, 'upgrade', CHARGE],
        [110, 'build', GATEWAY, 4],
        [110, 'build', GATEWAY, 5],
        [110, 'build', GATEWAY, 6],
        [120, 'train', OBSERVER, 1],
        [126, 'upgrade', PROTOSSGROUNDWEAPONSLEVEL2],
        [126, 'train', COLOSSUS, 4],
        [132, 'build', NEXUS, 3],
        [151, 'train', WARPPRISM, 0],
        [151, 'build', GATEWAY, 7],
        [151, 'build', TEMPLARARCHIVE, 0],
        [151, 'build', GATEWAY, 8],
        [151, 'build', GATEWAY, 9],
        [151, 'build', GATEWAY, 5],
        [[...range(180, 200)], 'continuouslyBuild', [STALKER, COLOSSUS, ZEALOT]],
      ],
    },
  }
}

module.exports = plans;
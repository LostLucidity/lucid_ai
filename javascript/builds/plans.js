//@ts-check
"use strict"

const { EFFECT_CHRONOBOOSTENERGYCOST, MORPH_ORBITALCOMMAND, BUILD_REACTOR_BARRACKS, RESEARCH_ZERGLINGMETABOLICBOOST, BUILD_TECHLAB_FACTORY, MORPH_LAIR, MORPH_OVERSEER, RESEARCH_GROOVEDSPINES, RESEARCH_MUSCULARAUGMENTS, MORPH_HIVE, BUILD_REACTOR_STARPORT, BUILD_TECHLAB_BARRACKS, LIFT_STARPORT, LAND_BARRACKS } = require('@node-sc2/core/constants/ability');
const { NEXUS, PYLON, STALKER, GATEWAY, COLOSSUS, IMMORTAL, OBSERVER, WARPPRISM, ROBOTICSFACILITY, OVERLORD, ZERGLING, ROACH, HYDRALISK, OVERSEER, CYCLONE, MARINE, MARAUDER, SIEGETANK, SIEGETANKSIEGED, LIBERATOR, MEDIVAC, VIKINGFIGHTER, HATCHERY, REFINERY, SCV, EXTRACTOR, PROBE, QUEEN, BUNKER, SHIELDBATTERY, LAIR, HIVE, ORBITALCOMMAND, ORBITALCOMMANDFLYING, BARRACKSREACTOR, FACTORYTECHLAB, STARPORTREACTOR, BARRACKSTECHLAB, STARPORT, BARRACKS } = require('@node-sc2/core/constants/unit-type');
const { WARPGATERESEARCH, EXTENDEDTHERMALLANCE, PROTOSSGROUNDWEAPONSLEVEL1, CHARGE, PROTOSSGROUNDWEAPONSLEVEL2, GLIALRECONSTITUTION, ZERGMISSILEWEAPONSLEVEL2, ZERGMISSILEWEAPONSLEVEL1, ZERGGROUNDARMORSLEVEL1, ZERGGROUNDARMORSLEVEL2 } = require('@node-sc2/core/constants/upgrade');
const range = require('../helper/range');

const plans = {
  1: {
    oneOneOne: {
      unitTypes: {
        mainCombatTypes: [ MARINE, MARAUDER, SIEGETANK, SIEGETANKSIEGED ],
        defenseTypes: [ CYCLONE ],
        defenseStructure: [ BUNKER ],
        supportUnitTypes: [ LIBERATOR, MEDIVAC, VIKINGFIGHTER ],
      },
      order: [
        [[...range(0, 200)], 'buildWorkers', true],
        [14, 'build', 'SUPPLYDEPOT', 0],
        [16, 'build', 'BARRACKSREACTOR', 0],
        [16, 'build', 'REFINERY', 0],
        [[...range(17, 21)], 'scout', SCV, 'getEnemyNatural',],
        [[...range(19, 200)], 'ability', MORPH_ORBITALCOMMAND, { targetCount: 0, countType: [ORBITALCOMMAND, ORBITALCOMMANDFLYING] } ],
        [[...range(19, 200)], 'ability', BUILD_REACTOR_BARRACKS, { targetCount: 0, countType: BARRACKSREACTOR } ],
        [[...range(19, 21)], 'scout', SCV, 'getEnemyMain',],
        [19, 'build', 'COMMANDCENTER', 1],
        [20, 'build', 'SUPPLYDEPOT', 1],
        [20, 'build', 'FACTORY', 0],
        [[...range(21, 200)], 'continuouslyBuild'],
        [[...range(31, 200)], 'ability', MORPH_ORBITALCOMMAND, { targetCount: 1, countType: [ORBITALCOMMAND, ORBITALCOMMANDFLYING] } ],
        [[...range(31, 33)], 'ability', BUILD_TECHLAB_FACTORY, { targetCount: 0, countType: [FACTORYTECHLAB] } ],
        [33, 'build', 'STARPORT', 0],
        [34, 'build', 'REFINERY', 1],
        [40, 'train', CYCLONE, 0],
        [42, 'build', 'SUPPLYDEPOT', 2],
        [42, 'build', 'SUPPLYDEPOT', 3],
        [44, 'train', VIKINGFIGHTER, 0],
        [[...range(49, 200)], 'manageSupply'],
        [58, 'build', 'BARRACKSREACTOR', 1],
        [58, 'build', 'BARRACKSREACTOR', 2],
        [[...range(62, 200)], 'ability', BUILD_REACTOR_STARPORT, { targetCount: 0, countType: STARPORTREACTOR } ],
        [62, 'build', 'COMMANDCENTER', 2],
        [62, 'build', 'ENGINEERINGBAY', 0],
        [62, 'build', 'ENGINEERINGBAY', 1],
        [[...range(69, 200)], 'ability', BUILD_TECHLAB_BARRACKS, { targetCount: 0, countType: BARRACKSTECHLAB } ],
        [69, 'swapBuildings', [
          { ability: LIFT_STARPORT, addOn: STARPORTREACTOR, building: STARPORT, count: 1 },
          { ability: LAND_BARRACKS, building: BARRACKS, count: 3 }
        ]],
        [[...range(71, 200)], 'ability', BUILD_REACTOR_STARPORT, { targetCount: 0, countType: STARPORTREACTOR } ],
      ]
    }
  },
  2: {
    lingRoachHydra: {
      unitTypes: {
        mainCombatTypes: [ ZERGLING, ROACH, HYDRALISK ],
        defenseTypes: [ ],
        scoutTypes: [ OVERLORD, OVERSEER ],
        supportUnitTypes: [ OVERSEER ],
      },
      order: [
        [[...range(0, 21)], 'buildWorkers'],
        [[...range(12, 14)], 'scout', OVERLORD, 'getEnemyNatural',],
        [13, 'train', OVERLORD, 1],
        [17, 'build', 'HATCHERY', 1],
        [17, 'build', 'EXTRACTOR', 0],
        [18, 'build', 'SPAWNINGPOOL', 0],
        [[...range(21, 200)], 'buildWorkers', true],
        [21, 'train', OVERLORD, 2],
        [21, 'train', QUEEN, 0],
        [21, 'train', QUEEN, 1],
        [[...range(25, 200)], 'ability', RESEARCH_ZERGLINGMETABOLICBOOST],
        [25, 'train', ZERGLING, 0],
        [25, 'train', ZERGLING, 1],
        [[...range(29, 200)], 'continuouslyBuild'],
        [32, 'train', OVERLORD, 3],
        [[...range(34, 200)], 'ability', MORPH_LAIR, { targetCount: 0, countType: LAIR } ],
        [34, 'train', QUEEN, 2],
        [36, 'build', 'ROACHWARREN', 0],
        [35, 'train', OVERLORD, 4],
        [35, 'build', 'EVOLUTIONCHAMBER', 0],
        [38, 'train', OVERLORD, 5],
        // manage overlord scouting, retreat, move towards
        [40, 'build', 'SPORECRAWLER', 0],
        [40, 'build', 'SPORECRAWLER', 1],
        [42, 'upgrade', ZERGMISSILEWEAPONSLEVEL1],
        [42, 'upgrade', GLIALRECONSTITUTION],
        [42, 'build', 'EXTRACTOR', 1],
        // spread creep
        [58, 'build', 'HATCHERY', 2],
        [[...range(55, 200)], 'manageSupply'],
        [68, 'build', 'EVOLUTIONCHAMBER', 1],
        [74, 'build', 'EXTRACTOR', 3],
        [78, 'upgrade', ZERGMISSILEWEAPONSLEVEL2],
        [78, 'upgrade', ZERGGROUNDARMORSLEVEL1],
        [78, 'build', 'HYDRALISKDEN', 0],
        [[...range(101, 200)], 'ability', MORPH_OVERSEER, { targetCount: 0, countType: OVERSEER }],
        [[...range(119, 200)], 'ability', RESEARCH_GROOVEDSPINES],
        [129, 'build', 'HATCHERY', 3],
        [138, 'build', 'HYDRALISKDEN', 1],
        [149, 'upgrade', ZERGGROUNDARMORSLEVEL2],
        [149, 'upgrade', RESEARCH_MUSCULARAUGMENTS],
        [165, 'build', 'INFESTATIONPIT', 0],
        [[200], 'ability', MORPH_HIVE, { targetCount: 0, countType: HIVE } ],
      ]
    }
  },
  3: {
    economicStalkerColossi: {
      unitTypes: {
        mainCombatTypes: [ STALKER, COLOSSUS ],
        defenseStructure: [ SHIELDBATTERY ],
        defenseTypes: [ IMMORTAL ],
        scoutTypes: [ OBSERVER ],
        supportUnitTypes: [ OBSERVER, WARPPRISM ],
      },
      order: [
        [[...range(0, 23), ...range(31, 36)], 'buildWorkers'],
        [14, 'build', 'PYLON', 0, 'findSupplyPositions'],
        [[...range(14, 19)], 'scout', PROBE, 'getEnemyMain', { unitType: PYLON, unitCount: 1 }],
        [15, 'build', 'GATEWAY', 0],
        [[16], 'ability', EFFECT_CHRONOBOOSTENERGYCOST, { targetType: NEXUS } ],
        [19, 'build', 'ASSIMILATOR', 0],
        [19, 'build', 'GATEWAY', 1],
        [20, 'build', 'CYBERNETICSCORE', 0],
        [20, 'build', 'ASSIMILATOR', 1],
        [[...range(20, 26)], 'scout', PROBE, 'getEnemyNatural'],
        [[21, 31, 33, ...range(61, 200)], 'manageSupply'],
        [23, 'train', STALKER, 0],
        [[25], 'ability', EFFECT_CHRONOBOOSTENERGYCOST, { targetType: GATEWAY } ],
        [25, 'train', STALKER, 1],
        [[27], 'ability', EFFECT_CHRONOBOOSTENERGYCOST, { targetType: GATEWAY } ],
        [27, 'upgrade', WARPGATERESEARCH],
        [27, 'train', STALKER, 2],
        [29, 'train', STALKER, 3],
        [31, 'build', 'NEXUS', 1],
        // [31, 'harass', STALKER, 4],
        [32, 'build', 'ROBOTICSFACILITY', 0],
        [[...range(32, 200)], 'ability', EFFECT_CHRONOBOOSTENERGYCOST, { targetType: ROBOTICSFACILITY} ],
        [35, 'build', 'GATEWAY', 2],
        [36, 'train', OBSERVER, 0],
        [37, 'build', 'ROBOTICSBAY', 0],
        [37, 'train', STALKER, 4],
        [[...range(37, 44)], 'scout', OBSERVER, 'getEnemyNatural'],
        [39, 'train', STALKER, 5],
        [[...range(41, 200)], 'continuouslyBuild'],
        [[...range(40, 200)], 'buildWorkers', true],
        [45, 'train', IMMORTAL, 0],
        [53, 'train', COLOSSUS, 0],
        [61, 'upgrade', EXTENDEDTHERMALLANCE],
        [64, 'build', 'NEXUS', 2],
        [74, 'build', 'FORGE', 0],
        [80, 'build', 'GATEWAY', 3],
        [80, 'upgrade', PROTOSSGROUNDWEAPONSLEVEL1],
        [91, 'build', 'TWILIGHTCOUNCIL', 0],
        [101, 'build', 'PHOTONCANNON', 0],
        [101, 'build', 'PHOTONCANNON', 1],
        // 103 Immortal not joining battle.        
        [110, 'upgrade', CHARGE],
        [110, 'build', 'GATEWAY', 4],
        [110, 'build', 'GATEWAY', 5],
        [110, 'build', 'GATEWAY', 6],
        [120, 'train', OBSERVER, 1],
        [126, 'upgrade', PROTOSSGROUNDWEAPONSLEVEL2],
        [132, 'build', 'NEXUS', 3],
        // Cancel Nexus if almost destroyed.
        [151, 'train', WARPPRISM, 0],
        [151, 'build', 'GATEWAY', 7],
        [151, 'build', 'TEMPLARARCHIVE', 0],
        [151, 'build', 'GATEWAY', 8],
        [151, 'build', 'GATEWAY', 9],
        // gets stuck trying to reach closest unit.
        // 200, not searching/destroying.
      ],
    }
  } 
}

module.exports = plans;
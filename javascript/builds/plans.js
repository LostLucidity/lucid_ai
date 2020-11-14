//@ts-check
"use strict"

const { EFFECT_CHRONOBOOSTENERGYCOST, MORPH_ORBITALCOMMAND, BUILD_REACTOR_BARRACKS, RESEARCH_ZERGLINGMETABOLICBOOST, BUILD_TECHLAB_FACTORY, MORPH_LAIR, MORPH_OVERSEER, RESEARCH_GROOVEDSPINES, RESEARCH_MUSCULARAUGMENTS, MORPH_HIVE, BUILD_REACTOR_STARPORT, BUILD_TECHLAB_BARRACKS, LIFT_STARPORT, LAND_BARRACKS, RESEARCH_STIMPACK, RESEARCH_COMBATSHIELD, LIFT_BARRACKS, LAND_STARPORT } = require('@node-sc2/core/constants/ability');
const { NEXUS, PYLON, STALKER, GATEWAY, COLOSSUS, IMMORTAL, OBSERVER, WARPPRISM, ROBOTICSFACILITY, OVERLORD, ZERGLING, ROACH, HYDRALISK, OVERSEER, CYCLONE, MARINE, MARAUDER, SIEGETANK, SIEGETANKSIEGED, LIBERATOR, MEDIVAC, VIKINGFIGHTER, SCV, PROBE, QUEEN, BUNKER, SHIELDBATTERY, LAIR, HIVE, ORBITALCOMMAND, ORBITALCOMMANDFLYING, BARRACKSREACTOR, FACTORYTECHLAB, STARPORTREACTOR, BARRACKSTECHLAB, STARPORT, BARRACKS, SPINECRAWLER, OVERLORDCOCOON, STARPORTFLYING, BARRACKSFLYING, ZEALOT } = require('@node-sc2/core/constants/unit-type');
const { WARPGATERESEARCH, EXTENDEDTHERMALLANCE, PROTOSSGROUNDWEAPONSLEVEL1, CHARGE, PROTOSSGROUNDWEAPONSLEVEL2, GLIALRECONSTITUTION, ZERGMISSILEWEAPONSLEVEL2, ZERGMISSILEWEAPONSLEVEL1, ZERGGROUNDARMORSLEVEL1, ZERGGROUNDARMORSLEVEL2, TERRANINFANTRYWEAPONSLEVEL1, TERRANINFANTRYARMORSLEVEL1, TERRANINFANTRYWEAPONSLEVEL2, TERRANINFANTRYARMORSLEVEL2, ZERGLINGMOVEMENTSPEED } = require('@node-sc2/core/constants/upgrade');
const range = require('../helper/range');

const plans = {
  1: {
    oneOneOne: {
      unitTypes: {
        defenseStructures: [ BUNKER ],
        defenseTypes: [ MARAUDER, MARINE, SIEGETANK ],
        mainCombatTypes: [ MARINE, MARAUDER, SIEGETANK, SIEGETANKSIEGED ],
        supportUnitTypes: [ CYCLONE, LIBERATOR, MEDIVAC, VIKINGFIGHTER ],
      },
      order: [
        [[...range(0, 200)], 'buildWorkers', true],
        [14, 'build', 'SUPPLYDEPOT', 0],
        [16, 'build', 'BARRACKSREACTOR', 0],
        [16, 'build', 'REFINERY', 0],
        [[...range(17, 21)], 'scout', SCV, 'getEnemyNatural',],
        [19, 'ability', MORPH_ORBITALCOMMAND, { targetCount: 0, countType: [ORBITALCOMMAND, ORBITALCOMMANDFLYING] } ],
        [19, 'ability', BUILD_REACTOR_BARRACKS, { targetCount: 0, countType: BARRACKSREACTOR } ],
        [[...range(19, 21)], 'scout', SCV, 'getEnemyMain',],
        [19, 'build', 'COMMANDCENTER', 1],
        [19, 'ability', EFFECT_CALLDOWNMULE, { targetType: MINERALFIELD, continuous: true, controlled: true } ],
        // 19 mule.
        [20, 'build', 'SUPPLYDEPOT', 1],
        [20, 'build', 'FACTORY', 0],
        // [21, 'train', MARINE, 0],
        // [21, 'train', MARINE, 1],
        [[...range(0, 200)], 'continuouslyBuild', [MARINE, MARAUDER], true],
        [31, 'ability', MORPH_ORBITALCOMMAND, { targetCount: 1, countType: [ORBITALCOMMAND, ORBITALCOMMANDFLYING] } ],  //  
        [31, 'ability', BUILD_TECHLAB_FACTORY, { targetCount: 0, countType: [FACTORYTECHLAB] } ],
        [33, 'build', 'STARPORT', 0],
        [34, 'build', 'REFINERY', 1],
        [40, 'train', CYCLONE, 0],
        [42, 'build', 'SUPPLYDEPOT', 2],
        [42, 'build', 'SUPPLYDEPOT', 3],
        [44, 'train', VIKINGFIGHTER, 0],
        [[...range(46, 200)], 'continuouslyBuild', [SIEGETANK], true],
        [[...range(49, 200)], 'manageSupply'],
        [58, 'build', 'BARRACKSREACTOR', 1],
        [58, 'build', 'BARRACKSREACTOR', 2],
        [62, 'ability', BUILD_REACTOR_STARPORT, { targetCount: 0, countType: STARPORTREACTOR } ],
        [62, 'build', 'COMMANDCENTER', 2],
        [62, 'build', 'ENGINEERINGBAY', 0],
        [62, 'build', 'ENGINEERINGBAY', 1],
        [69, 'ability', BUILD_TECHLAB_BARRACKS, { targetCount: 0, countType: BARRACKSTECHLAB } ],
        [71, 'swapBuildings', [
          { liftAbility: LIFT_STARPORT, landAbility: LAND_STARPORT, addOn: 'hasReactor', buildings: [STARPORT, STARPORTFLYING], count: 1 },
          { liftAbility: LIFT_BARRACKS, landAbility: LAND_BARRACKS, buildings: [BARRACKS, BARRACKSFLYING], count: 3 }
        ]],
        [71, 'ability', BUILD_REACTOR_STARPORT, { targetCount: 0, countType: STARPORTREACTOR } ],
        [75, 'ability', RESEARCH_STIMPACK],
        [77, 'build', 'BARRACKSREACTOR', 3],
        [86, 'upgrade', TERRANINFANTRYWEAPONSLEVEL1],
        [86, 'upgrade', TERRANINFANTRYARMORSLEVEL1],
        [87, 'ability', MORPH_ORBITALCOMMAND, { targetCount: 2, countType: [ORBITALCOMMAND, ORBITALCOMMANDFLYING] } ],
        [91, 'build', 'BARRACKSREACTOR', 4],
        [[...range(104, 193)], 'continuouslyBuild', [MEDIVAC], true],
        [[...range(193, 200)], 'continuouslyBuild', [LIBERATOR], true],
        [105, 'ability', BUILD_REACTOR_BARRACKS, { targetCount: 2, countType: BARRACKSREACTOR } ],
        [105, 'ability', BUILD_REACTOR_BARRACKS, { targetCount: 3, countType: BARRACKSREACTOR } ],
        [105, 'ability', BUILD_REACTOR_BARRACKS, { targetCount: 3, countType: BARRACKSREACTOR } ],
        [117, 'ability', RESEARCH_COMBATSHIELD],
        [117, 'build', 'ARMORY', 0],
        [131, 'build', 'MISSILETURRET', 0],
        [131, 'build', 'MISSILETURRET', 1],
        [131, 'build', 'MISSILETURRET', 2],
        [131, 'build', 'MISSILETURRET', 3],
        [141, 'upgrade', TERRANINFANTRYWEAPONSLEVEL2],
        [141, 'upgrade', TERRANINFANTRYARMORSLEVEL2],
      ]
    }
  },
  2: {
    lingRoachHydra: {
      unitTypes: {
        defenseTypes: [ ],
        defenseStructures: [ SPINECRAWLER ],
        mainCombatTypes: [ ZERGLING, ROACH, HYDRALISK ],
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
        [21, 'train', OVERLORD, 2],
        [21, 'train', QUEEN, 0],
        [21, 'train', QUEEN, 1],
        [25, 'upgrade', ZERGLINGMOVEMENTSPEED],
        [25, 'train', ZERGLING, 0],
        [25, 'train', ZERGLING, 1],
        [[...range(26, 200)], 'continuouslyBuild', [ ZERGLING, ROACH, HYDRALISK ]],
        [32, 'train', OVERLORD, 3],
        [[...range(25, 200)], 'buildWorkers', true],
        [34, 'ability', MORPH_LAIR, { targetCount: 0, countType: LAIR } ],
        [34, 'train', QUEEN, 2],
        [36, 'maintainQueens'],
        [36, 'build', 'ROACHWARREN', 0],
        [35, 'train', OVERLORD, 4],
        [35, 'build', 'EVOLUTIONCHAMBER', 0],
        [38, 'train', OVERLORD, 5],
        // manage overlord scouting, retreat, move towards
        [40, 'build', 'SPORECRAWLER', 0],
        [39, 'build', 'SPORECRAWLER', 1],
        [42, 'upgrade', ZERGMISSILEWEAPONSLEVEL1],
        [42, 'upgrade', GLIALRECONSTITUTION],
        [42, 'build', 'EXTRACTOR', 1],
        [41, 'build', 'EXTRACTOR', 2],
        // spread creep
        [42, 'train', ROACH, 0],
        [45, 'train', ROACH, 1],
        [47, 'train', ROACH, 2],
        [58, 'build', 'HATCHERY', 2],
        // @ 5:43, 16 zerglings vs 10 stalkers
        [[...range(55, 200)], 'manageSupply'],
        [68, 'build', 'EVOLUTIONCHAMBER', 1],
        // 71, light push, 38/33
        [[...range(71, 200)], 'push'],
        [74, 'build', 'EXTRACTOR', 3],
        [78, 'upgrade', ZERGMISSILEWEAPONSLEVEL2],
        [78, 'upgrade', ZERGGROUNDARMORSLEVEL1],
        [78, 'build', 'HYDRALISKDEN', 0],
        [101, 'ability', MORPH_OVERSEER, { targetCount: 0, countType: [OVERSEER, OVERLORDCOCOON] }],
        [119, 'ability', RESEARCH_GROOVEDSPINES],
        [129, 'build', 'HATCHERY', 3],
        [138, 'build', 'HYDRALISKDEN', 1],
        [149, 'upgrade', ZERGGROUNDARMORSLEVEL2],
        [149, 'ability', RESEARCH_MUSCULARAUGMENTS],
        [165, 'build', 'INFESTATIONPIT', 0],
        [200, 'ability', MORPH_HIVE, { targetCount: 0, countType: HIVE } ],
      ]
    }
  },
  3: {
    economicStalkerColossi: {
      unitTypes: {
        defenseStructures: [ SHIELDBATTERY ],
        defenseTypes: [ STALKER, IMMORTAL ],
        mainCombatTypes: [ STALKER, COLOSSUS, IMMORTAL, ZEALOT ],
        scoutTypes: [ OBSERVER ],
        supportUnitTypes: [ OBSERVER, WARPPRISM ],
      },
      order: [
        [[...range(0, 27), ...range(31, 41)], 'buildWorkers'],
        [14, 'build', 'PYLON', 0, 'findSupplyPositions'],
        [[...range(14, 19)], 'scout', PROBE, 'getEnemyMain', { unitType: PYLON, unitCount: 1 }],
        [15, 'build', 'GATEWAY', 0],
        [16, 'ability', EFFECT_CHRONOBOOSTENERGYCOST, { targetType: NEXUS, continuous: false } ],
        [18, 'build', 'ASSIMILATOR', 0],
        [19, 'build', 'GATEWAY', 1],
        [20, 'build', 'ASSIMILATOR', 1], 
        [20, 'build', 'CYBERNETICSCORE', 0],  // 1:28 vs 1:31
        [20, 'build', 'PYLON', 1],  //  1:37 vs 1:28
        [[...range(20, 26)], 'scout', PROBE, 'getEnemyNatural'],
        [23, 'train', STALKER, 0],  //  2:02 vs 2:06
        [25, 'ability', EFFECT_CHRONOBOOSTENERGYCOST, { targetType: GATEWAY, continuous: false  } ],
        [25, 'train', STALKER, 1],  //  2:02 vs 2:09
        [27, 'ability', EFFECT_CHRONOBOOSTENERGYCOST, { targetType: GATEWAY, continuous: false  } ],
        [27, 'upgrade', WARPGATERESEARCH],  //  2:08 vs 2:19
        [27, 'train', STALKER, 2],  //  2:24 vs 2:27
        [29, 'train', STALKER, 3],  //  2:24 vs 2:37
        [31, 'harass'],
        [31, 'build', 'PYLON', 2],  //  2:36 vs 2:41
        [31, 'build', 'NEXUS', 1],  //  2:56 vs 3:02
        // [31, 'harass', STALKER, 4],
        [32, 'build', 'ROBOTICSFACILITY', 0], //  3:10 vs 3:17
        [33, 'build', 'PYLON', 3],  //  3:22 vs 3:26
        [32, 'ability', EFFECT_CHRONOBOOSTENERGYCOST, { targetType: ROBOTICSFACILITY, continuous: true } ],
        [35, 'build', 'GATEWAY', 2],  //  3:48 vs 3:50
        [36, 'train', OBSERVER, 0], //  3:57 vs 4:01
        [37, 'build', 'ROBOTICSBAY', 0],  //  4:00 vs 4:10
        [37, 'train', STALKER, 4],  
        [[...range(37, 44)], 'scout', OBSERVER, 'getEnemyNatural'],
        [39, 'train', STALKER, 5],
        [[...range(41, 180)], 'continuouslyBuild', [ STALKER, COLOSSUS ]],
        [[...range(41, 200)], 'buildWorkers', true],
        [45, 'train', IMMORTAL, 0],
        [61, 'upgrade', EXTENDEDTHERMALLANCE],
        [[...range(61, 200)], 'manageSupply'],
        [64, 'build', 'NEXUS', 2],
        [74, 'build', 'FORGE', 0],
        [80, 'build', 'GATEWAY', 3],
        [80, 'upgrade', PROTOSSGROUNDWEAPONSLEVEL1],
        [91, 'build', 'TWILIGHTCOUNCIL', 0],
        [101, 'build', 'PHOTONCANNON', 0],
        [101, 'build', 'PHOTONCANNON', 1],
        [110, 'upgrade', CHARGE],
        [110, 'build', 'GATEWAY', 4],
        [110, 'build', 'GATEWAY', 5],
        [110, 'build', 'GATEWAY', 6],
        [120, 'train', OBSERVER, 1],
        [126, 'upgrade', PROTOSSGROUNDWEAPONSLEVEL2],
        [132, 'build', 'NEXUS', 3],
        [151, 'train', WARPPRISM, 0],
        [151, 'build', 'GATEWAY', 7],
        [151, 'build', 'TEMPLARARCHIVE', 0],
        [151, 'build', 'GATEWAY', 8],
        [151, 'build', 'GATEWAY', 9],
        [[...range(180, 200)], 'continuouslyBuild', [STALKER, COLOSSUS, ZEALOT]],
      ],
    }
  } 
}

module.exports = plans;
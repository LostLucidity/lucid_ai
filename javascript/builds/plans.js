//@ts-check
"use strict"

const { EFFECT_CHRONOBOOSTENERGYCOST, MORPH_ORBITALCOMMAND, MORPH_LAIR, MORPH_OVERSEER, RESEARCH_MUSCULARAUGMENTS, MORPH_HIVE, EFFECT_CALLDOWNMULE } = require('@node-sc2/core/constants/ability');
const { NEXUS, PYLON, STALKER, GATEWAY, COLOSSUS, IMMORTAL, OBSERVER, WARPPRISM, ROBOTICSFACILITY, OVERLORD, ZERGLING, ROACH, HYDRALISK, OVERSEER, CYCLONE, MARINE, MARAUDER, SIEGETANK, SIEGETANKSIEGED, LIBERATOR, MEDIVAC, VIKINGFIGHTER, SCV, PROBE, QUEEN, BUNKER, SHIELDBATTERY, LAIR, HIVE, ORBITALCOMMAND, BARRACKSREACTOR, FACTORYTECHLAB, STARPORTREACTOR, BARRACKSTECHLAB, STARPORT, BARRACKS, SPINECRAWLER, OVERLORDCOCOON, ZEALOT, MINERALFIELD, SUPPLYDEPOT, REFINERY, COMMANDCENTER, FACTORY, ENGINEERINGBAY, ARMORY, MISSILETURRET, HATCHERY, EXTRACTOR, SPAWNINGPOOL, ROACHWARREN, EVOLUTIONCHAMBER, HYDRALISKDEN, INFESTATIONPIT, SPORECRAWLER, ASSIMILATOR, CYBERNETICSCORE, FORGE, TWILIGHTCOUNCIL, PHOTONCANNON, TEMPLARARCHIVE, ROBOTICSBAY } = require('@node-sc2/core/constants/unit-type');
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
        [[...range(0, 21)], 'buildWorkers'],
        [[...range(21, 200)], 'buildWorkers', true],
        [14, 'build', SUPPLYDEPOT, 0],
        [16, 'build', BARRACKS, 0],
        [16, 'build', REFINERY, 0],
        [[...range(18, 21)], 'scout', SCV, 'getEnemyMain', { scoutType: 'earlyScout' }],
        [19, 'ability', MORPH_ORBITALCOMMAND, { targetCount: 0, countType: countTypes.get(ORBITALCOMMAND) } ],
        [19, 'build', BARRACKSREACTOR, 0],
        [19, 'build', COMMANDCENTER, 1],
        [19, 'ability', EFFECT_CALLDOWNMULE, { targetType: MINERALFIELD, continuous: true, controlled: true } ],
        [20, 'build', SUPPLYDEPOT, 1],
        [20, 'build', FACTORY, 0],
        [21, 'train', MARINE, 0],
        [21, 'train', MARINE, 1],
        [24, 'build', BUNKER, 0, 'getBetweenBaseAndWall', 'cheese'],
        [31, 'ability', MORPH_ORBITALCOMMAND, { targetCount: 1, countType: countTypes.get(ORBITALCOMMAND) } ],
        [31, 'build', FACTORYTECHLAB, 0],
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
        [[...range(53, 54)], 'scout', MARINE, 'acrossTheMap',],
        [58, 'build', BARRACKS, 1],
        [58, 'build', BARRACKS, 2],
        [62, 'build', STARPORTREACTOR, 0],
        [62, 'build', COMMANDCENTER, 2, 'inTheMain'],
        [62, 'build', ENGINEERINGBAY, 0],
        [62, 'build', ENGINEERINGBAY, 1],
        [69, 'build', BARRACKSTECHLAB, 0 ],
        [71, 'swapBuildings', new Map([
          [ STARPORTREACTOR, 1 ],
          [ BARRACKS, 3],
        ])],
        [71, 'build', STARPORTREACTOR, 0 ],
        [71, 'build', REFINERY, 2],
        [75, 'upgrade', STIMPACK],
        [77, 'build', BARRACKS, 3],
        [86, 'upgrade', TERRANINFANTRYWEAPONSLEVEL1],
        [86, 'upgrade', TERRANINFANTRYARMORSLEVEL1],
        [87, 'ability', MORPH_ORBITALCOMMAND, { targetCount: 2, countType: countTypes.get(ORBITALCOMMAND) } ],
        [91, 'build', BARRACKS, 4],
        [[...range(104, 193)], 'continuouslyBuild', [MEDIVAC], true],
        [[...range(193, 200)], 'continuouslyBuild', [LIBERATOR], true],
        [105, 'build', BARRACKSREACTOR, 2],
        [105, 'build', BARRACKSREACTOR, 3],
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
    }
  },
  2: {
    lingRoachHydra: {
      unitTypes: {
        defenseTypes: [ ZERGLING, ROACH, HYDRALISK ],
        defenseStructures: [ SPINECRAWLER ],
        mainCombatTypes: [ ZERGLING, ROACH, HYDRALISK ],
        supportUnitTypes: [ OVERSEER, QUEEN ],
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
        [[...range(26, 200)], 'continuouslyBuild', [ ZERGLING, ROACH, HYDRALISK ]],
        [[...range(32, 33)], 'scout', ZERGLING, 'acrossTheMap'],
        [32, 'train', OVERLORD, 3],
        [34, 'ability', MORPH_LAIR, { targetCount: 0, countType: LAIR } ],
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
        supportUnitTypes: [ OBSERVER, WARPPRISM ],
      },
      orders: [
        [[...range(0, 27), ...range(30, 41)], 'buildWorkers'],
        [14, 'build', PYLON, 0, 'findSupplyPositions'],
        [[...range(14, 19)], 'scout', PROBE, 'getEnemyMain', { unitType: PYLON, unitCount: 1, scoutType: 'earlyScout' }],
        [15, 'build', GATEWAY, 0],
        [16, 'ability', EFFECT_CHRONOBOOSTENERGYCOST, { targetType: NEXUS, continuous: false } ],
        [17, 'build', ASSIMILATOR, 0],
        [18, 'build', ASSIMILATOR, 1], 
        [19, 'build', GATEWAY, 1],
        [20, 'build', CYBERNETICSCORE, 0],
        [20, 'build', PYLON, 1],
        [[...range(20, 26)], 'scout', PROBE, 'getEnemyNatural', { scoutType: 'earlyScout' }],
        [23, 'train', STALKER, 0],
        [23, 'ability', EFFECT_CHRONOBOOSTENERGYCOST, { targetType: GATEWAY, continuous: false  } ],
        [23, 'train', STALKER, 1],
        [27, 'ability', EFFECT_CHRONOBOOSTENERGYCOST, { targetType: GATEWAY, continuous: false  } ],
        [27, 'upgrade', WARPGATERESEARCH],
        [[...range(27, 180)], 'continuouslyBuild', [ STALKER, COLOSSUS ]],
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
        [36, 'ability', EFFECT_CHRONOBOOSTENERGYCOST, { targetType: ROBOTICSFACILITY, continuous: true } ],
        [37, 'build', ROBOTICSBAY, 0],
        [37, 'train', STALKER, 4],  
        [[...range(37, 44)], 'scout', OBSERVER, 'getEnemyNatural'],
        [39, 'train', STALKER, 5],
        [[...range(41, 200)], 'buildWorkers', true],
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
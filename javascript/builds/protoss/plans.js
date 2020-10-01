//@ts-check
"use strict"

const { EFFECT_CHRONOBOOSTENERGYCOST, MORPH_ORBITALCOMMAND, BUILD_REACTOR_BARRACKS } = require('@node-sc2/core/constants/ability');
const { NEXUS, PYLON, STALKER, GATEWAY, COLOSSUS, IMMORTAL, OBSERVER, WARPPRISM, ROBOTICSFACILITY, OVERLORD, ZERGLING, ROACH, HYDRALISK, OVERSEER, CYCLONE, MARINE, MARAUDER, SIEGETANK, SIEGETANKSIEGED, LIBERATOR, MEDIVAC, VIKINGFIGHTER, HATCHERY, REFINERY, SCV, EXTRACTOR } = require('@node-sc2/core/constants/unit-type');
const { WARPGATERESEARCH, EXTENDEDTHERMALLANCE, PROTOSSGROUNDWEAPONSLEVEL1, CHARGE, PROTOSSGROUNDWEAPONSLEVEL2 } = require('@node-sc2/core/constants/upgrade');
const range = require('../../helper/range');

const plans = {
  1: {
    oneOneOne: {
      unitTypes: {
        mainCombatTypes: [ CYCLONE, MARINE, MARAUDER, SIEGETANK, SIEGETANKSIEGED ],
        defenseTypes: [ ],
        supportUnitTypes: [ LIBERATOR, MEDIVAC, VIKINGFIGHTER ],
      },
      order: [
        [[...range(0, 200)], 'buildWorkers', true],
        [14, 'build', 'SUPPLYDEPOT', 0],
        [16, 'build', 'BARRACKS', 0],
        [16, 'build', 'REFINERY', 0],
        [[...range(17, 21)], 'scout', SCV, 'getEnemyNatural',],
        [[...range(19, 21)], 'ability', MORPH_ORBITALCOMMAND ],
        [[...range(19, 21)], 'ability', BUILD_REACTOR_BARRACKS ],
        [[...range(19, 21)], 'scout', SCV, 'getEnemyMain',],
      ]
    }
  },
  2: {
    lingRoachHydra: {
      unitTypes: {
        mainCombatTypes: [ ZERGLING, ROACH, HYDRALISK ],
        defenseTypes: [ ],
        supportUnitTypes: [ OVERSEER ],
      },
      order: [
        // scout with first overlord
        [[...range(0, 200)], 'buildWorkers', true],
        [[...range(12, 14)], 'scout', OVERLORD, 'getEnemyMain',],
        [13, 'train', OVERLORD, 1],
        [17, 'build', 'HATCHERY', 1],
        [17, 'build', 'EXTRACTOR', 0],
        [18, 'build', 'SPAWNINGPOOL', 0],
        [21, 'train', OVERLORD, 2],
      ]
    }
  },
  3: {
    economicStalkerColossi: {
      unitTypes: {
        mainCombatTypes: [ STALKER, COLOSSUS ],
        defenseTypes: [ IMMORTAL ],
        supportUnitTypes: [ OBSERVER, WARPPRISM ],
      },
      order: [
        [[...range(0, 23), ...range(31, 36)], 'buildWorkers'],
        [14, 'build', 'PYLON', 0, 'findSupplyPositions'],
        [[...range(14, 19)], 'scout', 'getEnemyMain', PYLON, 1,],
        [15, 'build', 'GATEWAY', 0],
        [[16], 'ability', EFFECT_CHRONOBOOSTENERGYCOST, NEXUS, 1, NEXUS, ],
        [19, 'build', 'ASSIMILATOR', 0],
        [19, 'build', 'GATEWAY', 1],
        [20, 'build', 'CYBERNETICSCORE', 0],
        [20, 'build', 'ASSIMILATOR', 1],
        [[...range(20, 26)], 'scout', 'getEnemyNatural'],
        [[21, 31, 33, ...range(61, 200)], 'manageSupply'],
        [23, 'train', STALKER, 0],
        [[25], 'ability', EFFECT_CHRONOBOOSTENERGYCOST, GATEWAY, 1, NEXUS, ],
        [25, 'train', STALKER, 1],
        [[27], 'ability', EFFECT_CHRONOBOOSTENERGYCOST, GATEWAY, 1, NEXUS, ],
        [27, 'upgrade', WARPGATERESEARCH],
        [27, 'train', STALKER, 2],
        // build shield battery if cheese
        [29, 'train', STALKER, 3],
        [31, 'build', 'NEXUS', 1],
        // defend
        // [31, 'harass', STALKER, 4],
        [32, 'build', 'ROBOTICSFACILITY', 0],
        [[...range(32, 200)], 'ability', EFFECT_CHRONOBOOSTENERGYCOST, ROBOTICSFACILITY ],
        [35, 'build', 'GATEWAY', 2],
        [36, 'train', OBSERVER, 0],
        [37, 'build', 'ROBOTICSBAY', 0],
        [37, 'train', STALKER, 4],
        // scout with observer at 37
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
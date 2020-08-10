//@ts-check
"use strict"

const PromiseBluebird = require('bluebird');

const { FACTORYTECHLAB, SUPPLYDEPOT, BARRACKS, REFINERY, BARRACKSREACTOR, COMMANDCENTER, FACTORY, MARINE, GATEWAY, HATCHERY, BUNKER, ORBITALCOMMAND, STARPORT, CYCLONE, VIKINGFIGHTER, SIEGETANK, STARPORTREACTOR, ENGINEERINGBAY, BARRACKSTECHLAB, SCV, STARPORTFLYING, ARMORY, ORBITALCOMMANDFLYING, MEDIVAC } = require("@node-sc2/core/constants/unit-type");
const { createSystem, taskFunctions } = require("@node-sc2/core");
const { CANCEL_QUEUE5, CANCEL_QUEUECANCELTOSELECTION, MOVE, MORPH_ORBITALCOMMAND, EFFECT_CALLDOWNMULE, EFFECT_REPAIR, RESEARCH_STIMPACK, MORPH_SIEGEMODE, } = require("@node-sc2/core/constants/ability");
const { Alliance } = require('@node-sc2/core/constants/enums');


const continuouslyBuild = require("../helper/continuously-build");
const handleIdleWorkers = require("../helper/handle-idle-workers");
const rallyUnits = require("../helper/rally-units");
const workerSetup = require("../helper/worker-setup");

const Ability = require("@node-sc2/core/constants/ability");
const { distance, avgPoints } = require("@node-sc2/core/utils/geometry/point");
const getRandom = require('@node-sc2/core/utils/get-random');
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const canAfford = require('../helper/can-afford');
const defend = require('../helper/defend');
const baseThreats = require('../helper/base-threats');
const isSupplyNeeded = require('../helper/supply');
const { TERRANINFANTRYWEAPONSLEVEL1, TERRANINFANTRYARMORSLEVEL1, COMBATSHIELD } = require('@node-sc2/core/constants/upgrade');
const liftMoveLand = require('../helper/lift-move-land');

let ATTACKFOOD = 194;
let pauseBuilding = false;
let RALLYFOOD = 23
let supplyLost = 0;
let totalFoodUsed = 0;

const {
  ability,
  build,
  train,
  upgrade,
} = taskFunctions;

const terran = createSystem({
  name: "Terran",
  type: "build",
  buildOrder: [
    [14, build(SUPPLYDEPOT)],
    [16, build(BARRACKS)],
    [16, build(REFINERY)],
    [19, ability(MORPH_ORBITALCOMMAND)],
    [19, build(BARRACKSREACTOR)],
    [19, build(COMMANDCENTER)],
    [20, build(SUPPLYDEPOT)],
    [20, build(FACTORY)],
    [24, ability(MORPH_ORBITALCOMMAND)],
    [24, build(FACTORYTECHLAB)],
    [25, build(STARPORT)],
    [25, build(REFINERY)],
    [29, train(CYCLONE)],
    [31, build(SUPPLYDEPOT, 2)],                // 41 vs 42
    [31, train(VIKINGFIGHTER)],                 // 44,46 vs 44
    [35, build(SUPPLYDEPOT, 2)],                // 46,46 vs 49
    [39, build(BARRACKS, 2)],                   // 59,59,58 vs 58
    [41, build(STARPORTREACTOR)],               // 61,61,61 vs 62
    // commandCenter                            // 62,62,61,62,62 vs 62
    [41, build(ENGINEERINGBAY)],                // 61,61,61,61 vs 62
    // 56, engineering bay                          // vs 62
    // 57, engineering bay                          // 67 vs 62
    // 58, engineering bay                          // 67 vs 62
    // 59, engineering bay                          // 67 vs 62
    // 60, engineering bay                          // 67,66 vs 62
    // 61, engineering bay                          // 67 vs 62
    [42, build(BARRACKSTECHLAB)],               // 69,68,67,68,68,67,69,69,68 vs 69
    // SwapBuildings                            // 71 vs 71
    // [42, build(REFINERY, 2)],                   // 69,68,67 vs 71
    // [43, build(REFINERY, 2)],                   // 70 vs 71
    [44, build(REFINERY, 2)],                   // 71,71,71,71,71 vs 71
    // [42, ability(RESEARCH_STIMPACK)],           // 78,70 vs 75
    // [43, ability(RESEARCH_STIMPACK)],           // 70,70 vs 75
    // [44, ability(RESEARCH_STIMPACK)],           // 71 vs 75
    // [45, ability(RESEARCH_STIMPACK)],           // 72 vs 75
    [46, ability(RESEARCH_STIMPACK)],           // 76,77,74 vs 75
    // [42, build(STARPORTREACTOR)],               // 78,76
    // [43, build(STARPORTREACTOR)],               // 78,78
    // [44, build(STARPORTREACTOR)],                  // 78,
    [46, build(STARPORTREACTOR)],               // 80,74,76,77,78
    // barracks                                 // 77,76,78,77,79,76,78,77,80 vs 77
    // [43, ability(RESEARCH_STIMPACK)],           // 79 vs 75
    // [46, upgrade(TERRANINFANTRYWEAPONSLEVEL1)], // 82,82 vs 86
    // [46, upgrade(TERRANINFANTRYARMORSLEVEL1)],  // 82,82 vs 86
    // [46, ability(MORPH_ORBITALCOMMAND)],        // 85,86 vs 87
    // [47, upgrade(TERRANINFANTRYWEAPONSLEVEL1)], // 90,82 vs 86
    // [47, upgrade(TERRANINFANTRYARMORSLEVEL1)],  // 90,82 vs 86
    // [47, ability(MORPH_ORBITALCOMMAND)],        // 90,84 vs 87
    // [48, upgrade(TERRANINFANTRYWEAPONSLEVEL1)], //  84 vs 86
    // [48, upgrade(TERRANINFANTRYARMORSLEVEL1)],  //  84 vs 86
    // [48, ability(MORPH_ORBITALCOMMAND)],        //  88 vs 87
    // [49, upgrade(TERRANINFANTRYWEAPONSLEVEL1)], //  83 vs 86
    // [49, upgrade(TERRANINFANTRYARMORSLEVEL1)],  //  83 vs 86
    // [49, ability(MORPH_ORBITALCOMMAND)],        //  90 vs 87
    [50, upgrade(TERRANINFANTRYWEAPONSLEVEL1)], //  84,86 vs 86
    [50, upgrade(TERRANINFANTRYARMORSLEVEL1)],  //  84,86 vs 86
    [50, ability(MORPH_ORBITALCOMMAND)],        //  88,90 vs 87
    // [51, upgrade(TERRANINFANTRYWEAPONSLEVEL1)], //  93 vs 86
    // [51, upgrade(TERRANINFANTRYARMORSLEVEL1)],  //  93 vs 86
    // [51, ability(MORPH_ORBITALCOMMAND)],        //  93 vs 87
    // 85, barracks                             // vs 91
    // 86, barracks                             // 101 vs 91
    // 87, barracks                             // 101 vs 91
    // 88, barracks                             // 99 vs 91
    // 89, barracks                             // 98 vs 91
    // 90, barracks                             // 102 vs 91
    // 91, barracks                             // 99 vs 91
    [57, build(BARRACKSREACTOR, 2)],            // vs 105
    // [58, build(BARRACKSREACTOR, 2)],            // 109 vs 105
    // [59, build(BARRACKSREACTOR, 2)],            // 112 vs 105   
    // [60, build(BARRACKSREACTOR, 2)],            // 112 vs 105   
    // [61, build(BARRACKSREACTOR, 2)],            // 115 vs 105   
    // [62, build(BARRACKSREACTOR, 2)],            // 121 vs 105
    [57, train(MEDIVAC, 2)],                    // vs 105, check reactor
    // [58, train(MEDIVAC, 2)],                    // 119 vs 105, check reactor
    //                                          // 115 orbital keeps lifting
    [69, upgrade(COMBATSHIELD)],                // vs 117
    [69, build(ARMORY)],                        // vs 117
  ],
  async onStep({
    agent,
    data,
    resources,
  }) {
    const { foodUsed } = agent;
    const {
      actions,
      map,
      units,
    } = resources.get();
    const collectedActions = [];
    let placementConfig = {};
    await baseThreats(resources, this.state);
    if (this.state.bunker) {
      const bunkerLocations = getBunkerLocation(resources);
      placementConfig = { toBuild: BUNKER, placement: BUNKER, countTypes: [ BUNKER ] };
      await buildBuilding(agent, data, resources, 24, 0, placementConfig, bunkerLocations);
    }
    const basesPlacementGrid = [];
    map.getOccupiedExpansions().forEach(expansion => {
      basesPlacementGrid.push(...expansion.areas.placementGrid);
    });
    await buildBuilding(agent, data, resources, 56, 1, { toBuild: ENGINEERINGBAY, placement: ENGINEERINGBAY, countTypes: [ ENGINEERINGBAY ] }, basesPlacementGrid);
    placementConfig = { toBuild: COMMANDCENTER, placement: COMMANDCENTER, countTypes: [ COMMANDCENTER, ORBITALCOMMAND, ORBITALCOMMANDFLYING ] };
    await buildBuilding(agent, data, resources, 58, 2, placementConfig, map.getMain().areas.placementGrid);   
    placementConfig = { toBuild: BARRACKS, placement: BARRACKSREACTOR, countTypes: [ BARRACKS ] };
    await buildBuilding(agent, data, resources, 76, 3, placementConfig, basesPlacementGrid);
    await buildBuilding(agent, data, resources, 85, 4, placementConfig, basesPlacementGrid);
    if (units.getById(BARRACKS).length === 1 && units.getById(BARRACKSREACTOR).length === 0) {
      const [ building ] = units.getById(BARRACKS);
      const foundPosition = await checkPlacement(data, resources, building, BARRACKSREACTOR);
      if (foundPosition) {
        liftMoveLand(actions, building, foundPosition);
      }
    }
    if (units.getById(FACTORY).length === 1 && units.getById(FACTORYTECHLAB).length === 0) {
      const building = units.getById(FACTORY)[0];
      const foundPosition = await checkPlacement(data, resources, units.getById(FACTORY)[0], FACTORYTECHLAB);
      if (foundPosition) {
        liftMoveLand(actions, building, foundPosition);
      }
    }
    if (totalFoodUsed >= 61 && units.getById(STARPORT).length === 1 && units.getById(STARPORTREACTOR).length === 0 && units.getById(VIKINGFIGHTER).length === 1) {
      const building = units.getById(STARPORT)[0];
      const foundPosition = await checkPlacement(data, resources, units.getById(STARPORT)[0], STARPORTREACTOR);
      if (foundPosition) {
        liftMoveLand(actions, building, foundPosition);
      }
    }
    if (units.getById(BARRACKS, { buildProgress: 1 }).length > 0 && !pauseBuilding) {
      await continuouslyBuild(agent, data, resources, [ MARINE ], true);
    }
    if (totalFoodUsed >= 46 && !pauseBuilding) {
      const unitTypes = [ SIEGETANK ];
      await continuouslyBuild(agent, data, resources, unitTypes);
    }
    if (totalFoodUsed >= 105 && !pauseBuilding) {
      const unitTypes = [ SIEGETANK ];
      await continuouslyBuild(agent, data, resources, unitTypes);
    }
    
    if (this.state.defenseMode && foodUsed < ATTACKFOOD) {
      await defend(resources);
    }
    await increaseSupply(agent, data, resources);
    if (totalFoodUsed >= 113) {
      await liftToThird(resources);
    }
    collectedActions.push(...mule(resources));
    if (!this.state.defenseMode && foodUsed < ATTACKFOOD && foodUsed >= RALLYFOOD) {
      collectedActions.push(...rallyUnits(resources, []));
    }
    collectedActions.push(...repairBurningStructures(resources));
    if (units.getById(BARRACKS).filter(barracks => barracks.buildProgress >= 1).length === 3) {
      if (totalFoodUsed >= 71 && units.getById(STARPORTREACTOR).filter(reactor => reactor.buildProgress >= 1).length === 1) {
        const [ starport ] = units.getById(STARPORT).filter(starport => starport.hasReactor());
        const [ barracks ] = units.getClosest(starport.pos, units.getById(BARRACKS).filter(barracks => barracks.buildProgress >= 1 && !barracks.hasReactor() && !barracks.hasTechLab()));
        if (starport && barracks) {
          if (barracks.abilityAvailable(CANCEL_QUEUE5)) {
            const unitCommand = {
              abilityId: CANCEL_QUEUE5,
              unitTags: [ barracks.tag ],
            }
            await actions.sendAction(unitCommand);
          }
          await actions.swapBuildings(starport, barracks);
        }
      }
    }
    if (this.state.earlyScout) {
      collectedActions.push(...scoutMain(this.state, resources));
    }
    collectedActions.push(...unitBehavior(resources));
    await actions.sendAction(collectedActions);
  },
  async onGameStart({ agent }) {
    const { foodUsed } = agent;
    totalFoodUsed = foodUsed;
    // await workerSplit(resources);
  },
  async onUnitCreated({ agent, resources }, newUnit) {
    const { foodUsed } = agent;
    const {
      actions,
      map,
    } = resources.get();
    const collectedActions = [];
    if (!pauseBuilding) {
      totalFoodUsed = foodUsed + supplyLost;
    }
    if (newUnit.isWorker() && foodUsed === 17) {
      collectedActions.push(...scout(resources, map.getEnemyNatural().centroid, newUnit));
      this.state.earlyScout = true;
    }
    const expansionPoints = [ 18, 19 ];
    workerSetup(agent, resources, newUnit, [], expansionPoints, totalFoodUsed);
    await actions.sendAction(collectedActions);
  },
  async onUnitDestroyed({ agent, data }, destroyedUnit) {
    const { foodUsed } = agent;
    if (destroyedUnit.alliance === 1 && !pauseBuilding) {
      supplyLost += data.getUnitTypeData(destroyedUnit.unitType).foodRequired;
      totalFoodUsed = foodUsed + supplyLost;
    }
  },
  async onUnitIdle({ data, resources }, idleUnit) {
    const { actions } = resources.get();
    await handleIdleWorkers(resources, idleUnit, ['builder', 'prepping']);
    if (idleUnit.unitType === STARPORTFLYING) {
      const foundPlacement = checkPlacement(data, resources, idleUnit, STARPORTREACTOR);
      if (foundPlacement) {
        await actions.do(Ability.LAND, idleUnit.tag, { target: idleUnit.pos, queue: true });
      }
    }
  },
  async onUnitFinished({ resources }, finishedUnit) {
    const {
      units
    } = resources.get();
    // get closest worker and tag.
    const [ closestWorker ] = units.getClosest(finishedUnit.pos, units.getWorkers());
    closestWorker.labels.set('builder', true);
    closestWorker.labels.set('prepping', false);
    if (finishedUnit.unitType === COMMANDCENTER) {
      const ownCommandCenters = [...units.getByType(COMMANDCENTER), ...units.getByType(ORBITALCOMMAND)].filter(commandCenter => !commandCenter.isEnemy());
      if (ownCommandCenters.length === 3) {
        finishedUnit.labels.set('base', 'third');
      }
    }
  }
});

function getBunkerLocation(resources) {
  const {
    map,
  } = resources.get();
  const natural = map.getNatural();
  const naturalWall = natural.getWall();
  const avg = avgPoints(naturalWall);
  const avgWallAndNatural = avgPoints([avg, natural.townhallPosition]);
  const nearPoints = gridsInCircle(avgWallAndNatural, 4);
  return nearPoints
      .map(pos => ({ pos, rand: Math.random() }))
      .sort((a, b) => a.rand - b.rand)
      .map(a => a.pos)
      .slice(0, 20);
}

async function buildBuilding(agent, data, resources, food, targetCount, placementConfig, candidatePositions) {
  const {
    actions,
    map,
    units,
  } = resources.get();
  if (totalFoodUsed >= food) {
    const buildAbilityId = data.getUnitTypeData(placementConfig.toBuild).abilityId;
    let count = 0;
    placementConfig.countTypes.forEach(type => {
      count += units.getById(type).length + units.withCurrentOrders(buildAbilityId).length
    });
    if (count === targetCount) {
      // find placement on main
      if (agent.canAfford(placementConfig.toBuild)) {
        const foundPosition = await findPosition(actions, placementConfig.placement, candidatePositions);
        if (foundPosition) {
          await actions.build(placementConfig.toBuild, foundPosition);
          pauseBuilding = false;
        }
      } else {
        pauseBuilding = true;
      }
    }
  }
}

async function checkPlacement(data, resources, building, unitTypeAddOn) {
  const {
    actions,
    units,
  } = resources.get();
  const abilityId = data.getUnitTypeData(unitTypeAddOn).abilityId;
  if (
    building.abilityAvailable(abilityId) &&
    units.getWorkers().filter(worker => distance(worker.pos, building.pos) < 2).length === 0
  ) {
    const nearPoints = gridsInCircle(building.pos, 4);
    const randomPositions = nearPoints
        .map(pos => ({ pos, rand: Math.random() }))
        .sort((a, b) => a.rand - b.rand)
        .map(a => a.pos)
        .slice(0, 20);
    // see if any of them are good    
    return await actions.canPlace(BARRACKSREACTOR, randomPositions);
  } else {
    return;
  }
}

async function findPosition(actions, unitType, candidatePositions) {
  const randomPositions = candidatePositions
    .map(pos => ({ pos, rand: Math.random() }))
    .sort((a, b) => a.rand - b.rand)
    .map(a => a.pos)
    .slice(0, 20);
  return await actions.canPlace(unitType, randomPositions);
}

async function liftToThird(resources) {
  const {
    actions,
    map,
    units,
  } = resources.get();
  // select third
  if (units.getByType(ORBITALCOMMAND).length === 3) {
    const [ third ] = units.getByType(ORBITALCOMMAND).filter(commandCenter => commandCenter.labels.get('base') === 'third');
    // lift, move, land logic
    if (third) {
      if (third.abilityAvailable(CANCEL_QUEUECANCELTOSELECTION)) {
        const unitCommand = {
          abilityId: CANCEL_QUEUECANCELTOSELECTION,
          unitTags: [ third.tag ],
        }
        await actions.sendAction(unitCommand);
      }
      const position = map.getAvailableExpansions()[0].townhallPosition;
      if (position) {
        liftMoveLand(actions, third, position);
      }
    }
  }
}

async function increaseSupply(agent, data, resources) {
  const { foodUsed } = agent;
  const {
    actions,
    map,
    units,
  } = resources.get();
  if (foodUsed >= 65) {
    if (isSupplyNeeded(agent, data, resources)) {
      const basesAreaFill = [];
      map.getOccupiedExpansions().forEach(expansion => {
        basesAreaFill.push(...expansion.areas.areaFill);
      });
      const randomPositions = basesAreaFill
        .map(pos => ({ pos, rand: Math.random() }))
        .sort((a, b) => a.rand - b.rand)
        .map(a => a.pos)
        .slice(0, 20); 
      const foundPosition = await actions.canPlace(SUPPLYDEPOT, randomPositions);
      if (foundPosition) {
        if (agent.canAfford(SUPPLYDEPOT) && units.getById(SCV).length > 0) {
          await actions.build(SUPPLYDEPOT, foundPosition);
        }
      }
    }
  }
}

function mule(resources) {
  const {
    actions,
    map,
    units,
  } = resources.get();
  const collectedActions = [];
  const orbitalCommand = units.getById(ORBITALCOMMAND).find(n => n.energy > 50);
  if (orbitalCommand) {
    const expansions = map.getOccupiedExpansions().filter(expansion => expansion.getBase().buildProgress >= 1);
    if (expansions.length >= 0) {
      const randomExpansion = getRandom(expansions);
      if (randomExpansion) {
        const [ closestMineralField ] = units.getClosest(randomExpansion.townhallPosition, units.getMineralFields())
        if (closestMineralField) {
          const unitCommand = {
            abilityId: EFFECT_CALLDOWNMULE,
            targetUnitTag: closestMineralField.tag,
            unitTags: [ orbitalCommand.tag ],
          }
          collectedActions.push(unitCommand)
          // actions.do(
          //   EFFECT_CALLDOWNMULE,
          //   orbitalCommand.tag,
          //   { target: randomMineral }
          // );
        }
      }
    }
  }
  return collectedActions;
}

function repairBurningStructures(resources) {
  const {
    units,
  } = resources.get();
  const collectedActions = [];
  // get burning structure.
  const [ burningStructure ] = units.getStructures(structure => structure.health / structure.healthMax < 1 / 3);
  if (burningStructure) {
    // select worker and repair stucture
    const [ closestWorker ] = units.getClosest(burningStructure.pos, units.getWorkers());
    const unitCommand = {
      abilityId: EFFECT_REPAIR,
      targetUnitTag: burningStructure.tag,
      unitTags: [ closestWorker.tag ]
    }
    collectedActions.push(unitCommand);
  }
  return collectedActions;
}

function scout(resources, target, unit) {
  const {
    map,
    units,
  } = resources.get();
  const collectedActions = [];
  const label = 'scout';
  // set scout
  if (units.withLabel(label).length === 0) {
    if (unit) {
      unit.labels.clear();
      unit.labels.set(label, true);
      const unitCommand = {
        abilityId: MOVE,
        targetWorldSpacePos: target,
        unitTags: [ unit.tag ],
        queue: false,
      }
      collectedActions.push(unitCommand);
    }
  } else {
    // while scouting main times
    let [ scout ] = units.withLabel(label);
    if (distance(scout.pos, map.getMain().centroid) < 1) {
      scout.labels.clear();
    } else {
      const unitCommand = {
        abilityId: MOVE,
        targetWorldSpacePos: target,
        unitTags: [ scout.tag ],
        queue: false,
      }
      collectedActions.push(unitCommand);
    }
  }
  return collectedActions;
}

function scoutMain(state, resources) {
  const {
    frame,
    map,
    units,
  } = resources.get();
  const collectedActions = [];
  const timePoints = { scoutMain: 105, finishScout: 120 };
  if (frame.timeInSeconds() < timePoints.scoutMain) {
    collectedActions.push(...scout(resources, map.getEnemyNatural().centroid));
  } else if (frame.timeInSeconds() >= timePoints.scoutMain && frame.timeInSeconds() <= timePoints.finishScout) {
    collectedActions.push(...scout(resources, map.getEnemyMain().centroid));
    state.bunker = (
      units.getById(BARRACKS, { alliance: Alliance.ENEMY }).length > 1 ||
      units.getById(GATEWAY, { alliance: Alliance.ENEMY }).length > 1 ||
      (
        units.getById(HATCHERY, { alliance: Alliance.ENEMY }).length > 0 &&
        units.getById(HATCHERY, { alliance: Alliance.ENEMY }).length < units.getById(COMMANDCENTER).length + units.getById(ORBITALCOMMAND).length
      )
    )
  } else if (frame.timeInSeconds() > 140) {
    state.earlyScout = false;
  }
  return collectedActions;
}

function unitBehavior(resources) {
  const {
    map,
    units,
  } = resources.get();
  // get siege tanks
  const collectedActions = [];
  let rallyPoint = map.getCombatRally();
  let [ bunker ] = units.getById(BUNKER).filter(bunker => bunker.buildProgress >= 1)
  if (bunker) {
    rallyPoint = bunker.pos;
  }
  units.getByType(SIEGETANK).filter(tank => {
    if (!tank.isEnemy() && distance(tank.pos, rallyPoint) < 4) {
      const unitCommand = {
        abilityId: MORPH_SIEGEMODE,
        unitTags: [ tank.tag ]
      }
      collectedActions.push(unitCommand)
    }
  });
  return collectedActions;
}

module.exports = terran;
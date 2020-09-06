//@ts-check
"use strict"


const { FACTORYTECHLAB, SUPPLYDEPOT, BARRACKS, REFINERY, BARRACKSREACTOR, COMMANDCENTER, FACTORY, MARINE, GATEWAY, HATCHERY, BUNKER, ORBITALCOMMAND, STARPORT, CYCLONE, VIKINGFIGHTER, SIEGETANK, STARPORTREACTOR, ENGINEERINGBAY, BARRACKSTECHLAB, SCV, STARPORTFLYING, ARMORY, ORBITALCOMMANDFLYING, MEDIVAC, LIBERATOR, MISSILETURRET, MARAUDER } = require("@node-sc2/core/constants/unit-type");
const { createSystem, taskFunctions } = require("@node-sc2/core");
const {
  CANCEL_QUEUE5, CANCEL_QUEUECANCELTOSELECTION, MOVE, MORPH_ORBITALCOMMAND, EFFECT_CALLDOWNMULE, EFFECT_REPAIR, RESEARCH_STIMPACK, RESEARCH_COMBATSHIELD, EFFECT_SALVAGE, UNLOADALL_BUNKER, LAND, LAND_BARRACKS, EFFECT_SCAN, LIFT_STARPORT, SMART,
} = require("@node-sc2/core/constants/ability");
const { Alliance } = require('@node-sc2/core/constants/enums');


const continuouslyBuild = require("../helper/continuously-build");
const handleIdleWorkers = require("../helper/handle-idle-workers");
const rallyUnits = require("../helper/rally-units");
const workerSetup = require("../helper/worker-setup");

const Ability = require("@node-sc2/core/constants/ability");
const { distance, avgPoints } = require("@node-sc2/core/utils/geometry/point");
const getRandom = require('@node-sc2/core/utils/get-random');
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const baseThreats = require('../helper/base-threats');
const isSupplyNeeded = require('../helper/supply');
const { TERRANINFANTRYWEAPONSLEVEL1, TERRANINFANTRYARMORSLEVEL1, TERRANINFANTRYWEAPONSLEVEL2, TERRANINFANTRYARMORSLEVEL2 } = require('@node-sc2/core/constants/upgrade');
const { attack, defend } = require("../helper/army-behavior");
const liftMoveLand = require('../helper/lift-move-land');
const expand = require('../helper/expand');
const buildWorkers = require('../helper/build-workers');
const shortOnWorkers = require('../helper/short-on-workers');
const balanceResources = require('../helper/balance-resources');
const { marineBehavior, tankBehavior, liberatorBehavior, supplyBehavior, orbitalCommandCenterBehavior } = require("../helper/unit-behavior");
const { getOccupiedExpansions, getAvailableExpansions, getBase } = require("../helper/expansions");

let ATTACKFOOD = 194;
let pauseBuilding = false;
let RALLYFOOD = 23
let supplyLost = 0;
let mainCombatTypes = [CYCLONE, MARINE, MARAUDER, SIEGETANK];
let supportUnitTypes = [LIBERATOR, MEDIVAC, VIKINGFIGHTER];
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
    [14, build(SUPPLYDEPOT)],                   // 14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14 vs 14+-
    [16, build(BARRACKS)],                      // 16,16,16,15,16,16,16,16,16,16,16,16,15,16,16,16,16,16,16,16,16,16,16,16,16 vs 16-2
    [16, build(REFINERY)],                      // 16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16 vs 16+-
    [19, ability(MORPH_ORBITALCOMMAND)],        // 19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19 vs 19+-
    [19, build(BARRACKSREACTOR)],               // 19,19,19,19,19,19,19,19,19,19,19,19,20,20,19,19,19,19,19,19,19,19,19,19,19 vs 19+2
    [19, build(COMMANDCENTER)],                 // 19,19,19,19,19,19,19,19,19,19,19,19,20,20,19,19,19,19,19,19,19,19,19 vs 19+2
    [19, build(SUPPLYDEPOT)],                   // 19,19,19,19,19,19,19,19,19,20,20,19,20,19,19,19,19,19,19,19,19,19,19 vs 20-18
    [19, build(FACTORY)],                       // 19,21,21,21,21,21,21,21,21,20,20,20,20,21,21,21,21,21,21,21,21,21,21 vs 20+17
    [24, ability(MORPH_ORBITALCOMMAND)],        // 30,29,32,32,33,32,32,32,31,31,32,32,32,32,32,32,32 vs 31+11
    [24, build(FACTORYTECHLAB)],                // 30,30,32,32,33,32,32,32,31,31,32,32,32,32,32,32,32 vs 31+12
    [25, build(STARPORT)],                      // 33,33,31,33,34,33,33,33,33,33,33,32,32,35,33,33,35,33,33,33,33 vs 33+1
    [25, build(REFINERY)],                      // 33,33,33,33,33,34,34,35,35,34,35,33,35,35,33,33,33 vs 34-4
    [28, train(CYCLONE)],                       // 38,38,38,38,39,39,40,40,40,40,40,38,38 vs 40-14
    [28, build(SUPPLYDEPOT, 2)],                // 41,41,43,42,42,44,43,45,43,43,41,41 vs 42+5
    [28, train(VIKINGFIGHTER)],                 // 43,43,45,44,44,47,47,47,47,45,45,43,45 vs 44+13
    [33, build(SUPPLYDEPOT, 2)],                // 48,50 vs 49+-/2
    // [34, build(SUPPLYDEPOT, 2)],                // 51 vs 49+2
    [37, build(BARRACKS, 2)],                   // 58,56 vs 58-2/2
    // [38, build(BARRACKS, 2)],                   // 60 vs 58+2
    [41, build(STARPORTREACTOR)],               // 63,61,68 vs 62+6/3
    // 55, commandCenter                        // 61,59,56 vs 62-10
    // 56, engineering bay1                     // 63,62,57 vs 62-4
    // 56, engineering bay2                     // 63,62,58 vs 62-3
    [43, build(BARRACKSTECHLAB)],               // 70,68,74 vs 69+5/3
    // SwapBuildings                            // 71 vs 71
    [45, build(REFINERY, 2)],                   // 72,70 vs 71+-
    [46, ability(RESEARCH_STIMPACK)],           // 76,74 vs 75+-
    // 74 barracks                              // 79,82 vs 77+7
    [48, build(STARPORTREACTOR)],               // 81,81
    [50, upgrade(TERRANINFANTRYWEAPONSLEVEL1)], // 86,86 vs 86+-
    [50, upgrade(TERRANINFANTRYARMORSLEVEL1)],  // 86,87 vs 86+-
    [50, ability(MORPH_ORBITALCOMMAND)],        // 89,88 vs 87+3
    // 89, barracks                                // 90 vs 91
    [56, build(BARRACKSREACTOR, 2)],               // 105,107 vs 105+2
    [57, ability(RESEARCH_COMBATSHIELD)],       // 107,120 vs 117-7
    [57, build(ARMORY)],                        // 116,120 vs 117+2
    [57, upgrade(TERRANINFANTRYWEAPONSLEVEL2)],   // 141
    [57, upgrade(TERRANINFANTRYARMORSLEVEL2)],    // 141
    // complete incomplete buildings
    // liberators staying sieged with no enemy.
    // scan, when damage an no enemy detected.
    // army stuck when trying to reach cc, following closest backfiring. Should follow closest by path.
  ],
  async onStep({
    agent,
    data,
    resources,
  }) {
    const {
      foodUsed,
      minerals
    } = agent;
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
      totalFoodUsed >= 24 ? collectedActions.push(...await buildBuilding(agent, data, resources, 0, placementConfig, bunkerLocations)) : false;
    }
    const basesPlacementGrid = [];
    getOccupiedExpansions(resources).forEach(expansion => {
      basesPlacementGrid.push(...expansion.areas.placementGrid);
    });
    placementConfig = { toBuild: COMMANDCENTER, placement: COMMANDCENTER, countTypes: [ COMMANDCENTER, ORBITALCOMMAND, ORBITALCOMMANDFLYING ] };
    if (totalFoodUsed >= 55) { await tryBuilding(agent, data, resources, 2, placementConfig, map.getMain().areas.placementGrid); }
    placementConfig = { toBuild: ENGINEERINGBAY, placement: ENGINEERINGBAY, countTypes: [ ENGINEERINGBAY ] };
    if (totalFoodUsed >= 56) { await tryBuilding(agent, data, resources, 0, placementConfig, basesPlacementGrid); }
    if (totalFoodUsed >= 56) { await tryBuilding(agent, data, resources, 1, placementConfig, basesPlacementGrid); }
    placementConfig = { toBuild: BARRACKS, placement: BARRACKSREACTOR, countTypes: [ BARRACKS ] };
    if (totalFoodUsed >= 74) { await tryBuilding(agent, data, resources, 3, placementConfig, basesPlacementGrid); }
    if (totalFoodUsed >= 89) { await tryBuilding(agent, data, resources, 4, placementConfig, basesPlacementGrid); }
    placementConfig = { toBuild: MISSILETURRET, placement: MISSILETURRET, countTypes: [ MISSILETURRET ] };
    if (totalFoodUsed >= 131) { await tryBuilding(agent, data, resources, 0, placementConfig, basesPlacementGrid); }
    if (totalFoodUsed >= 131) { await tryBuilding(agent, data, resources, 1, placementConfig, basesPlacementGrid); }
    if (totalFoodUsed >= 131) { await tryBuilding(agent, data, resources, 2, placementConfig, basesPlacementGrid); }
    if (totalFoodUsed >= 131) { await tryBuilding(agent, data, resources, 3, placementConfig, basesPlacementGrid); }
    await findAddonPlacement(data, resources, BARRACKS, 1, BARRACKSREACTOR, 0);
    await findAddonPlacement(data, resources, BARRACKS, 2, BARRACKSREACTOR, 0);
    await findAddonPlacement(data, resources, BARRACKS, 3, BARRACKSTECHLAB, 0);
    await findAddonPlacement(data, resources, BARRACKS, 4, BARRACKSREACTOR, 0);
    await findAddonPlacement(data, resources, BARRACKS, 3, BARRACKSTECHLAB, 1);
    await findAddonPlacement(data, resources, BARRACKS, 4, BARRACKSREACTOR, 2);
    await findAddonPlacement(data, resources, BARRACKS, 5, BARRACKSREACTOR, 2);
    await findAddonPlacement(data, resources, FACTORY, 1, FACTORYTECHLAB, 0);
    if (totalFoodUsed >= 61 && units.getById(VIKINGFIGHTER).length === 1) {
      await findAddonPlacement(data, resources, STARPORT, 1, STARPORTREACTOR, 0);
    }
    if (units.getById(BARRACKS, { buildProgress: 1 }).length > 0 && !pauseBuilding) {
      await continuouslyBuild(agent, data, resources, [ MARINE ], true);
      await continuouslyBuild(agent, data, resources, [ MARAUDER, MARINE ], true,);
    }
    if (totalFoodUsed >= 46 && !pauseBuilding) {
      const unitTypes = [ SIEGETANK ];
      await continuouslyBuild(agent, data, resources, unitTypes);
    }
    if (totalFoodUsed >= 105 && !pauseBuilding) {
      let unitTypes = [ LIBERATOR ];
      if (units.getById(MEDIVAC).length < 6) {
        unitTypes = [ MEDIVAC ];
      }
      await continuouslyBuild(agent, data, resources, unitTypes, true);
    }
    if (this.state.defenseMode && foodUsed < ATTACKFOOD) {
      collectedActions.push(...defend(resources, mainCombatTypes, supportUnitTypes));
      collectedActions.push(...liberatorBehavior(resources));
      collectedActions.push(...marineBehavior(resources));
      collectedActions.push(...tankBehavior(resources));
    }
    if (!this.state.defenseMode) {
      completeBuilding(resources)
    }
    await increaseSupply(agent, data, resources);
    if (totalFoodUsed >= 113) {
      await liftToThird(resources);
    }
    if (foodUsed >= 118) {
      this.state.bunker = false;
      collectedActions.push(...salvageBunker(resources));
      try { await balanceResources(agent, data, resources, 2.4); } catch(error) { }
      if (!shortOnWorkers(resources)) {
        try { await expand(agent, data, resources); } catch(error) { }
      } else {
        if (minerals <= 512) {
          try { await buildWorkers(agent, data, resources); } catch (error) { }
        }
      }
    }
    if (minerals <= 512) {
      collectedActions.push(...orbitalCommandCenterBehavior(resources, EFFECT_CALLDOWNMULE));
    } else {
      pauseBuilding = false;
    }
    if (foodUsed >= ATTACKFOOD) {
      collectedActions.push(...attack(resources, mainCombatTypes, supportUnitTypes));
      collectedActions.push(...liberatorBehavior(resources));
      collectedActions.push(...marineBehavior(resources));
      collectedActions.push(...tankBehavior(resources));
    }
    if (!this.state.defenseMode && foodUsed < ATTACKFOOD && foodUsed >= RALLYFOOD) {
      collectedActions.push(...rallyUnits(resources, []));
    }
    collectedActions.push(...repairBurningStructures(resources));
    collectedActions.push(...repairDamagedMechUnits(resources));
    if (units.getById(BARRACKS).filter(barracks => barracks.buildProgress >= 1).length === 3) {
      if (totalFoodUsed >= 71 && units.getById(STARPORTREACTOR).filter(reactor => reactor.buildProgress >= 1).length === 1) {
        const [ starport ] = units.getById(STARPORT).filter(starport => starport.hasReactor() && starport.abilityAvailable(LIFT_STARPORT));
        const [ barracks ] = units.getClosest(starport.pos, units.getById(BARRACKS).filter(barracks => barracks.buildProgress >= 1 && !barracks.hasReactor() && !barracks.hasTechLab()));
        if (starport && barracks) {
          if (barracks.abilityAvailable(CANCEL_QUEUE5)) {
            const unitCommand = {
              abilityId: CANCEL_QUEUE5,
              unitTags: [ barracks.tag ],
            }
            await actions.sendAction(unitCommand);
          }
          try { await actions.swapBuildings(starport, barracks); } 
          catch (error) {
            if (barracks.abilityAvailable(LAND_BARRACKS)) {
              const unitCommand = {
                abilityId: LAND_BARRACKS,
                unitTags: [ barracks.tag ],
              }
              await actions.sendAction(unitCommand);
            }
          }
        }
      }
    }
    if (this.state.earlyScout) {
      collectedActions.push(...scoutMain(this.state, resources));
    }
    collectedActions.push(...supplyBehavior(resources));
    await actions.sendAction(collectedActions);
  },
  async onGameStart({ agent }) {
    const { foodUsed } = agent;
    totalFoodUsed = foodUsed;
  },
  async onUnitCreated({ agent, resources }, newUnit) {
    const { foodUsed } = agent;
    const {
      actions,
      map,
    } = resources.get();
    const collectedActions = [];
    if (!pauseBuilding) { totalFoodUsed = foodUsed + supplyLost; }
    if (newUnit.isWorker() && foodUsed === 17) {
      collectedActions.push(...scout(resources, map.getEnemyNatural().centroid, newUnit));
      this.state.earlyScout = true;
    }
    const expansionPoints = [ 18, 19 ];
    workerSetup(agent, resources, newUnit, [], expansionPoints, totalFoodUsed);
    await actions.sendAction(collectedActions);
  },
  async onUnitDamaged({ resources }, damagedUnit) {
    const { units } = resources.get();
    //
    const collectedActions = [];
    const enemyUnits = units.getCombatUnits(Alliance.ENEMY);
    const [ closestEnemyCombatUnit ] = units.getClosest(damagedUnit.pos, enemyUnits);
    if (!closestEnemyCombatUnit || distance(damagedUnit.pos, closestEnemyCombatUnit.pos) > damagedUnit.radarRange) {
      const orbitalCommand = units.getById(ORBITALCOMMAND).find(n => n.energy > 50);
      if (orbitalCommand) {
        const unitCommand = {
          abilityId: EFFECT_SCAN,
          targetWorldSpacePos: damagedUnit.pos,
          unitTags: [ orbitalCommand.tag ],
        }
        collectedActions.push(unitCommand);
      }
    }
    return collectedActions;
  },
  async onUnitDestroyed({ agent, data }, destroyedUnit) {
    const { foodUsed } = agent;
    if (destroyedUnit.alliance === 1) {
      supplyLost += data.getUnitTypeData(destroyedUnit.unitType).foodRequired;
      if (!pauseBuilding) { totalFoodUsed = foodUsed + supplyLost; }
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

// async function buildBuilding(agent, data, resources, food, targetCount, placementConfig, candidatePositions) {
//   const {
//     actions,
//     units,
//   } = resources.get();
//   if (totalFoodUsed >= food) {
//     const buildAbilityId = data.getUnitTypeData(placementConfig.toBuild).abilityId;
//     let count = 0;
//     placementConfig.countTypes.forEach(type => {
//       count += units.getById(type).filter(type => type.buildProgress >= 1).length + units.withCurrentOrders(buildAbilityId).length;
//     });
//     if (count === targetCount) {
//       // find placement on main
//       if (agent.canAfford(placementConfig.toBuild)) {
//         const foundPosition = await findPosition(actions, placementConfig.placement, candidatePositions);
//         if (foundPosition) {
//           await actions.build(placementConfig.toBuild, foundPosition);
//           pauseBuilding = false;
//         }
//       } else {
//         pauseBuilding = true;
//       }
//     }
//   }
// }

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

function completeBuilding(resources) {
  // see if non complete buildings have a builder.
  const {
    units
  } = resources.get();
  const collectedActions = [];
  const mappedIncompleteStructure = units.getStructures(Alliance.SELF).filter(structure => structure.buildProgress < 1);
  const targetConstructingTargetTags = units.getConstructingWorkers().map(worker => {
    const [ closestUnfinished ] = units.getClosest(worker.pos, units.getStructures(structure => structure.buildProgress < 1));
    if (closestUnfinished && distance(closestUnfinished.pos, worker.pos) < closestUnfinished.radius) {
      return worker.tag;
    }
  });
  if (mappedIncompleteStructure.length > targetConstructingTargetTags.length) {
    mappedIncompleteStructure.forEach(structure => {
      const [ closestWorker ] = units.getClosest(structure.pos, units.getWorkers());
      if (closestWorker) {
        const unitCommand = {
          abilityId: SMART,
          targetUnitTag: structure.tag,
          unitTags: [ closestWorker.tag ]
        }
        collectedActions.push(unitCommand);
      }
    })
    // find lonely structure
    // let difference = mappedStructureTags.filter(tag => !targetConstructingTargetTags.includes(tag));

  };
  
  // [...new Set(units.getStructures(structure => structure.buildProgress < 1).map(incomplete => incomplete.unitType))]
}

async function findPosition(actions, unitType, candidatePositions) {
  const randomPositions = candidatePositions
    .map(pos => ({ pos, rand: Math.random() }))
    .sort((a, b) => a.rand - b.rand)
    .map(a => a.pos)
    .slice(0, 20);
  return await actions.canPlace(unitType, randomPositions);
}

async function findAddonPlacement(data, resources, buildingType, buildingCount, addonType, addonCount) {
  const {
    actions,
    units
  } = resources.get();
  if (units.getById(buildingType).length === buildingCount && units.getById(addonType).length === addonCount) {
    const [ building ] = units.getById(buildingType);
    const foundPosition = await checkPlacement(data, resources, building, addonType);
    if (foundPosition) {
      liftMoveLand(actions, building, foundPosition);
    }
  }
}

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

async function liftToThird(resources) {
  const {
    actions,
    units,
  } = resources.get();
  // select third
  const orbitalCommandCenters = units.getByType(ORBITALCOMMAND).filter(orbitalCommandCenter => !orbitalCommandCenter.isEnemy());
  if (orbitalCommandCenters.length === 3) {
    const [ third ] = orbitalCommandCenters.filter(commandCenter => commandCenter.labels.get('base') === 'third');
    // lift, move, land logic
    if (third) {
      const [ position ] = getAvailableExpansions(resources).map(expansion => ({ expansion, distance: distance(third.pos, expansion.townhallPosition) }))
      .sort((a, b) => a.distance - b.distance)
      .map(u => u.expansion.townhallPosition)
      .slice(0, 1);
      // find closest occupiedExpansion.townhallPosition, if less than 1 do not liftMoveLand.
      const foundExpansion = getOccupiedExpansions(resources).find(expansion => distance(expansion.townhallPosition, third.pos) < 1);
      if (position && distance(third.pos, position) > 1 && !foundExpansion) {
        if (third.abilityAvailable(CANCEL_QUEUECANCELTOSELECTION)) {
          const unitCommand = {
            abilityId: CANCEL_QUEUECANCELTOSELECTION,
            unitTags: [ third.tag ],
          }
          await actions.sendAction(unitCommand);
        }
        liftMoveLand(actions, third, position);
      }
    }
  }
}

async function increaseSupply(agent, data, resources) {
  const { foodUsed } = agent;
  const {
    actions,
    units,
  } = resources.get();
  if (foodUsed >= 65) {
    if (isSupplyNeeded(agent, data, resources)) {
      const placementGrids = [];
      getOccupiedExpansions(resources).forEach(expansion => {
        placementGrids.push(...expansion.areas.placementGrid);
      });
      const randomPositions = placementGrids
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
    units,
  } = resources.get();
  const collectedActions = [];
  const orbitalCommand = units.getById(ORBITALCOMMAND).find(n => n.energy > 50);
  if (orbitalCommand) {
    const expansions = getOccupiedExpansions(resources).filter(expansion => getBase(resources, expansion).buildProgress >= 1);
    if (expansions.length >= 0) {
      const randomExpansion = getRandom(expansions);
      if (randomExpansion) {
        const [ closestMineralField ] = units.getClosest(randomExpansion.townhallPosition, units.getMineralFields());
        if (closestMineralField) {
          const unitCommand = {
            abilityId: EFFECT_CALLDOWNMULE,
            targetUnitTag: closestMineralField.tag,
            unitTags: [ orbitalCommand.tag ],
          }
          collectedActions.push(unitCommand)
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
    const builders = [
      ...units.getMineralWorkers(),
      ...units.getWorkers().filter(w => w.noQueue),
      ...units.withLabel('builder').filter(w => !w.isConstructing()),
    ];
    const [ closestWorker ] = units.getClosest(burningStructure.pos, builders);
    if (closestWorker) {
      const unitCommand = {
        abilityId: EFFECT_REPAIR,
        targetUnitTag: burningStructure.tag,
        unitTags: [ closestWorker.tag ]
      }
      collectedActions.push(unitCommand);
    }
  }
  return collectedActions;
}

function repairDamagedMechUnits(resources) {
  const {
    units,
  } = resources.get();
  const collectedActions = [];
  // get burning structure.
  const [ damagedMechUnit ] = units.getById([ CYCLONE, LIBERATOR, MEDIVAC, SIEGETANK, VIKINGFIGHTER]).filter(unit => unit.health / unit.healthMax < 1 / 3);
  if (damagedMechUnit) {
    // select worker and repair stucture
    const [ closestWorker ] = units.getClosest(damagedMechUnit.pos, units.getWorkers());
    const unitCommand = {
      abilityId: EFFECT_REPAIR,
      targetUnitTag: damagedMechUnit.tag,
      unitTags: [ closestWorker.tag ]
    }
    collectedActions.push(unitCommand);
  }
  return collectedActions;
}

function salvageBunker(resources) {
  const {
    units,
  } = resources.get();
  const collectedActions = [];
  // get bunker
  const [ bunker ] = units.getByType(BUNKER);
  if (bunker) {
    let abilityIds = [ EFFECT_SALVAGE ];
    if (bunker.abilityAvailable(UNLOADALL_BUNKER)) {
      abilityIds.push(UNLOADALL_BUNKER);
    }
    abilityIds.forEach(abilityId => {
      const unitCommand = {
        abilityId: abilityId,
        unitTags: [ bunker.tag ]
      }
      collectedActions.push(unitCommand)
    })
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
    );
  } else if (frame.timeInSeconds() > timePoints.finishScout) {
    state.earlyScout = false;
  }
  return collectedActions;
}

async function tryBuilding(agent, data, resources, targetCount, placementConfig, candidatePositions) {
  const collectedActions = [];
  collectedActions.push(...await buildBuilding(agent, data, resources, targetCount, placementConfig, candidatePositions));
  pauseBuilding = collectedActions.length > 0 ? true : false;
  return collectedActions;
}

module.exports = terran;
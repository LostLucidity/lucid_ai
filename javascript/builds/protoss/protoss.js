//@ts-check
"use strict"
// https://www.youtube.com/watch?v=tfN1BdE8Vng
// https://lotv.spawningtool.com/build/115726/
const {
  createSystem,
} = require("@node-sc2/core");

const { WarpUnitAbility } = require('@node-sc2/core/constants');
const {
  EFFECT_CHRONOBOOSTENERGYCOST: CHRONOBOOST, MOVE, EFFECT_CHRONOBOOSTENERGYCOST,
} = require('@node-sc2/core/constants/ability');
const unitTypes = require("@node-sc2/core/constants/unit-type");
const {
  COLOSSUS,
  FORGE,
  GATEWAY,
  IMMORTAL,
  LARVA,
  NEXUS,
  OBSERVER,
  PHOTONCANNON,
  PYLON,
  ROBOTICSFACILITY,
  STALKER,
  WARPPRISM,
  WARPGATE,
  SHIELDBATTERY,
  HATCHERY,
  COMMANDCENTER,
  EGG,
  ORBITALCOMMAND,
} = require("@node-sc2/core/constants/unit-type");
const { Alliance } = require('@node-sc2/core/constants/enums');
const {
  CHARGE,
  EXTENDEDTHERMALLANCE,
  PROTOSSGROUNDWEAPONSLEVEL1,
  PROTOSSGROUNDWEAPONSLEVEL2,
  WARPGATERESEARCH,
} = require('@node-sc2/core/constants/upgrade');

const { gridsInCircle } = require('@node-sc2/core/utils/geometry/angle');
const { avgPoints, distance } = require('@node-sc2/core/utils/geometry/point');

let pauseBuilding = false;
let mainCombatTypes = [ STALKER, COLOSSUS, IMMORTAL ];
let supportUnitTypes = [ OBSERVER, WARPPRISM ];

const baseThreats = require("../../helper/base-threats");
const rallyUnits = require("../../helper/rally-units");
const { range } = require("../../helper/utilities");
const shadowUnit = require("../../helper/shadow-unit");
const balanceResources = require("../../helper/balance-resources");
const canAfford = require("../../helper/can-afford");
const { defend, attack } = require("../../helper/army-behavior");
const { tryBuilding } = require("../../helper/build");
const buildWorkers = require("../../helper/build-workers");
const placementConfigs = require("../../helper/placement-configs");
// const { AssemblePlan } = require("../../helper/assemblePlan");

let supplyLost = 0;
let totalFoodUsed = 0;
const ATTACKFOOD = 194;
const RALLYFOOD = 31;
const MINERALTOGASRATIO = 2.4;

const protoss = createSystem({
  name: 'Protoss',
  type: 'build',
  defaultOptions: {
    state: {
      buildComplete: false,
      defenseMode: false,
      enemyBuildType: 'standard',
    },
  },  
  buildOrder: [                                                                                                      
  ],
  async buildComplete() {
      this.setState({ buildComplete: true });
  },
  async onGameStart(world) {
    // const assemblePlan = new AssemblePlan(economicStalkerColossi);
    const { foodUsed } = world.agent;
    totalFoodUsed = foodUsed;
  },
  async onStep(world) {
    const { agent, data, resources } = world;
    const { foodUsed, minerals } = agent;
    const {
      actions,
      map,
      units,
    } = world.resources.get();
    // assemblePlan.onStep(world, this.state)
    const collectedActions = [];
    const protossSystem = world.agent.systems.find(system => system._system.name === "Protoss")._system;
    const supplySystem = world.agent.systems.find(system => system._system.name === "SupplySystem")._system;
    pauseBuilding ? protossSystem.pauseBuild() : protossSystem.resumeBuild();
    pauseBuilding ? supplySystem.pause() : supplySystem.unpause();
    // if (foodUsed >= 14) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 0, placementConfigs.PYLON, [...findSupplyPositions(resources)])); }
    // if (foodUsed >= 15) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 0, placementConfigs.GATEWAY)); }
    // if (foodUsed == 16) { collectedActions.push(...await abilityOrder(data, resources, EFFECT_CHRONOBOOSTENERGYCOST, 1, NEXUS, NEXUS)); }
    // if (foodUsed >= 19) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 0, placementConfigs.ASSIMILATOR)); }
    // if (foodUsed >= 19) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 1, placementConfigs.GATEWAY)); }
    // if (foodUsed >= 20) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 0, placementConfigs.CYBERNETICSCORE)); }
    // if (foodUsed >= 20) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 1, placementConfigs.ASSIMILATOR)); }
    // if (foodUsed < 20) { try { await buildWorkers(agent, data, resources); } catch(error) { console.log(error); } }
    // if (foodUsed >= 23) { collectedActions.push(...tryTraining(agent, data, resources, 0, STALKER)); }
    // if (foodUsed >= 23) { collectedActions.push(...tryTraining(agent, data, resources, 1, STALKER)); }
    // if (foodUsed >= 27) { collectedActions.push(...tryUpgrade(data, resources, WARPGATERESEARCH)); }
    // if (foodUsed >= 27) { collectedActions.push(...tryTraining(agent, data, resources, 2, STALKER)); }
    // if (foodUsed >= 27) { collectedActions.push(...tryTraining(agent, data, resources, 3, STALKER)); }
    // if (foodUsed >= 31) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 1, placementConfigs.NEXUS, [ map.getAvailableExpansions()[0].townhallPosition ])); }
    // if (foodUsed >= 32) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 0, placementConfigs.ROBOTICSFACILITY)); }
    // if (foodUsed >= 35) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 2, placementConfigs.GATEWAY)); }
    // if (foodUsed >= 36) { collectedActions.push(...tryTraining(agent, data, resources, 0, OBSERVER)); }
    // if (foodUsed >= 37) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 0, placementConfigs.ROBOTICSBAY)); }
    // if (foodUsed >= 37) { collectedActions.push(...tryTraining(agent, data, resources, 4, STALKER)); }
    // if (foodUsed >= 37) { collectedActions.push(...tryTraining(agent, data, resources, 5, STALKER)); }
    // if (foodUsed >= 45) { collectedActions.push(...tryTraining(agent, data, resources, 0, IMMORTAL)); }
    // if (foodUsed >= 53) { collectedActions.push(...tryTraining(agent, data, resources, 0, COLOSSUS)); }
    // if (foodUsed >= 61) { collectedActions.push(...tryUpgrade(data, resources, EXTENDEDTHERMALLANCE)); }
    // if (foodUsed >= 64) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 2, placementConfigs.NEXUS, [ map.getAvailableExpansions()[0].townhallPosition ])); }
    // if (foodUsed >= 74) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 0, placementConfigs.FORGE)); }
    // if (foodUsed >= 80) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 3, placementConfigs.GATEWAY)); }
    // if (foodUsed >= 80) { collectedActions.push(...tryUpgrade(data, resources, PROTOSSGROUNDWEAPONSLEVEL1)); }
    // if (foodUsed >= 91) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 0, placementConfigs.TWILIGHTCOUNCIL)); }
    // if (foodUsed >= 101) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 0, placementConfigs.PHOTONCANNON)); }
    // if (foodUsed >= 101) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 1, placementConfigs.PHOTONCANNON)); }
    // if (foodUsed >= 110) { collectedActions.push(...tryUpgrade(data, resources, CHARGE)); }
    // if (foodUsed >= 110) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 4, placementConfigs.GATEWAY)); }
    // if (foodUsed >= 110) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 5, placementConfigs.GATEWAY)); }
    // if (foodUsed >= 110) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 6, placementConfigs.GATEWAY)); }
    // if (foodUsed >= 120) { collectedActions.push(...tryTraining(agent, data, resources, 1, OBSERVER)); }
    // if (foodUsed >= 126) { collectedActions.push(...tryUpgrade(data, resources, PROTOSSGROUNDWEAPONSLEVEL2)); }
    // if (foodUsed >= 132) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 2, placementConfigs.NEXUS, [ map.getAvailableExpansions()[0].townhallPosition ])); }
    // if (foodUsed >= 151) { collectedActions.push(...tryTraining(agent, data, resources, 0, WARPPRISM)); }
    // if (foodUsed >= 151) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 7, placementConfigs.GATEWAY)); }
    // if (foodUsed >= 151) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 0, placementConfigs.TEMPLARARCHIVE)); }
    // if (foodUsed >= 151) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 8, placementConfigs.GATEWAY)); }
    // if (foodUsed >= 151) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 9, placementConfigs.GATEWAY)); }
    if (this.state.defenseMode && foodUsed < ATTACKFOOD) { collectedActions.push(...defend(resources, mainCombatTypes, supportUnitTypes)); }
    if (foodUsed >= ATTACKFOOD) { collectedActions.push(...attack(resources, mainCombatTypes, supportUnitTypes)); }
    checkEnemyBuild(this.state, resources)
    collectedActions.push(...await chronoboost(resources));
    await defenseSetup(this.state, data, resources);
    if (foodUsed >= 132 && !shortOnWorkers(resources)) {
      await expand(data, resources);
    }
    triggerSupplySystem(agent);
    if (this.state.enemyBuildType === 'standard') {
      await harass(this.state, resources);
    }
    if (this.state.defenseMode || minerals > 512 ) {
      try { await balanceResources(agent, data, resources, MINERALTOGASRATIO); } catch(error) { }
      try { await continuouslyBuild(agent, data, resources); } catch(error) { console.log(error); }
    } else if (
      this.state.buildComplete &&
      !this.state.defenseMode &&
      minerals < 512 &&
      shortOnWorkers(resources)
    ) {
      try { await buildWorkers(agent, data, resources); } catch(error) { console.log(error); }
      pauseBuilding = false;
    }
    await baseThreats(resources, this.state);
    await photonCannonsAtNaturalDrop(agent, data, resources);
    if (!this.state.defenseMode && foodUsed < ATTACKFOOD && foodUsed >= RALLYFOOD) {
      const [ shieldBattery ] = units.getById(SHIELDBATTERY);
      let rallyPosition = null;
      if (shieldBattery && foodUsed <= 134) {
        rallyPosition = shieldBattery.pos;
      }
      collectedActions.push(...rallyUnits(resources, supportUnitTypes, rallyPosition));
    }
    scout(resources);
    collectedActions.push(...scoutWithObserver(resources));
    await actions.sendAction(collectedActions);
  },
  async onUnitCreated({
    agent,
    resources,
  }, newUnit) {
    const { foodUsed } = agent;
    const {
      actions,
      map,
      units,
    } = resources.get();
    const collectedActions = [];
    totalFoodUsed = foodUsed + supplyLost;
    // const expansionPoints = [...range(29, 34), ...range(57, 67), ...range(130, 133)];
    // await workerSetup(agent, resources, newUnit, [], expansionPoints, totalFoodUsed);
    // first observer move to enemy
    if (newUnit.unitType === OBSERVER && units.getById(OBSERVER).length === 1) {
      if (totalFoodUsed < 46) {
        newUnit.labels.set('scout', true);
        const naturalCentroid = map.getEnemyNatural().centroid;
        const unitCommand = {
          abilityId: MOVE,
          targetWorldSpacePos: naturalCentroid,
          unitTags: [ newUnit.tag ]
        }
        collectedActions.push(unitCommand)
      }
    }
    await actions.sendAction(collectedActions);
  },
  async onUnitDestroyed({ agent, data }, destroyedUnit) {
    const { foodUsed } = agent;
    if (destroyedUnit.alliance === 1) {
      supplyLost += data.getUnitTypeData(destroyedUnit.unitType).foodRequired;
      totalFoodUsed = foodUsed + supplyLost;
    }
  },
  async onUnitIdle({ resources }, idleUnit) {
    const {
      units
    } = resources.get();
    if (idleUnit.isWorker()) {
      const { actions } = resources.get();
      if (units.getBases(Alliance.SELF).length > 0) {
        return actions.gather(idleUnit);
      }
    }
  },
});

function checkEnemyBuild(state, resources) {
  const { frame, units, } = resources.get();
  // if scouting probe and time is greater than 2 minutes. If no base, stay defensive.
  if (
    frame.timeInSeconds() > 132
    && frame.timeInSeconds() <= 240
  ) {
    if (units.getBases(Alliance.ENEMY).length < 2) {
      state.enemyBuildType = 'cheese';
    };
  }
}

async function chronoboost(resources) {
  const { units } = resources.get();
  const collectedActions = [];
  const nexus = units.getById(NEXUS).find(n => n.energy >= 50);
  if (nexus) {
    // chronoboost 15 probe
    const structures = units.getStructures();
    if (structures.length >= 0) {
      let target;
      let unitCommand = {
        abilityId: CHRONOBOOST,
        unitTags: [ nexus.tag ],
      }
      if (units.getById(STALKER).length === 0) {
        target = structures.find(u => (u.is(GATEWAY) && !u.noQueue && u.buffIds.indexOf(281) === -1));
        if (target) {
          unitCommand.targetUnitTag = target.tag;
          collectedActions.push(unitCommand);
        }
      } else {
        target = structures.find(u => (u.is(ROBOTICSFACILITY) && !u.noQueue && u.buffIds.indexOf(281) === -1));
        if (target) {
          unitCommand.targetUnitTag = target.tag;
          collectedActions.push(unitCommand);
        } else {
          if (units.getById(NEXUS).filter(n => n.energy >= 25).length > 1) {
            target = structures.find(u => (u.is(FORGE) && !u.noQueue && u.buffIds.indexOf(281) === -1));
            if (target) {
              unitCommand.targetUnitTag = target.tag;
              collectedActions.push(unitCommand);
            }
          }
        }
      }
    }
  }
  return collectedActions;
}

async function continuouslyBuild(agent, data, resources) {
  const { foodUsed } = agent;
  const {
    actions,
    units,
  } = resources.get();
  let unitToWarpIn = STALKER;
  let abilityId = WarpUnitAbility[unitToWarpIn];
  let qtyToWarp = agent.canAffordN(unitToWarpIn, 1);
  if (qtyToWarp > 0) {
    const warpGates = units.getById(WARPGATE).filter(wg => wg.abilityAvailable(abilityId)).slice(0, qtyToWarp);
    if (warpGates.length > 0 && foodUsed <= 198) {
      try { await actions.warpIn(unitToWarpIn) } catch (error) { console.log(error); }
    }
  }
  const idleRoboticsFacility = units.getById(ROBOTICSFACILITY, { noQueue: true, buildProgress: 1 });
  if (idleRoboticsFacility.length > 0 && foodUsed <= ATTACKFOOD) {
    if (canAfford(agent, data, COLOSSUS)) {
      return Promise.all(idleRoboticsFacility.map(roboticsFacility => actions.train(COLOSSUS, roboticsFacility)));
    }
  }  
}

async function defenseSetup(state, data, resources) {
  const {
    actions,
    map,
    units,
  } = resources.get();
  if (state.enemyBuildType === 'cheese') {
    const buildAbilityId = data.getUnitTypeData(SHIELDBATTERY).abilityId;
    if ((units.getById(SHIELDBATTERY).length + units.withCurrentOrders(buildAbilityId)) < 1 ) {
      const natural = map.getNatural();
      const naturalWall = natural.getWall();
      const avg = avgPoints(naturalWall);
      const [ closestPylon ] = units.getClosest(avg, units.getById(PYLON), 1);
      const points = gridsInCircle(closestPylon.pos, 6.5);
      const filteredPoints = points.filter(point => {
        return (
          distance(avg, point) > 3.25 &&
          distance(natural.townhallPosition, point) > 3.75
        );
      });
      // pick 10 random positions from the list
      const randomPositions = filteredPoints
        .map(pos => ({ pos, rand: Math.random() }))
        .sort((a, b) => a.rand - b.rand)
        .map(a => a.pos)
        .slice(0, 20);
      // see if any of them are good    
      const foundPosition = await actions.canPlace(SHIELDBATTERY, randomPositions);
      await actions.build(SHIELDBATTERY, foundPosition);
    }
  }
}

async function expand(data, resources) {
  const {
    actions,
    map,
    units,
  } = resources.get();
  const expansionLocation = map.getAvailableExpansions()[0].townhallPosition;
  const foundPosition = await actions.canPlace(NEXUS, [expansionLocation]);
  const buildAbilityId = data.getUnitTypeData(NEXUS).abilityId;
  if ((units.inProgress(NEXUS).length + units.withCurrentOrders(buildAbilityId).length) < 1 ) {
    return actions.build(NEXUS, foundPosition)
  }
}

function triggerSupplySystem(agent) {
  const { foodUsed } = agent;
  const supplyPoints = [19, ...range(21, 31), 32, ...range(34, 61)];
  if (supplyPoints.indexOf(foodUsed) > -1) {
    const foundSystem = agent.systems.find(system => system._system.name === "SupplySystem");
    foundSystem._system.pause();
  } else {
    const foundSystem = agent.systems.find(system => system._system.name === "SupplySystem");
    foundSystem._system.unpause();
  }
}

function findPlacements(resources) {
  const { map, units } = resources.get();
  const [main, natural] = map.getExpansions();
  const mainMineralLine = main.areas.mineralLine;
  let placements;
  const pylonsNearProduction = units.getById(PYLON)
    .filter(u => u.buildProgress >= 1)
    .filter(pylon => distance(pylon.pos, main.townhallPosition) < 50);

  if (pylonsNearProduction.length <= 0) return BuildResult.CANNOT_SATISFY;

  placements = [...main.areas.placementGrid, ...natural.areas.placementGrid]
    .filter((point) => {
      return (
        (distance(natural.townhallPosition, point) > 4.5) &&
        (pylonsNearProduction.some(p => distance(p.pos, point) < 6.5)) &&
        (mainMineralLine.every(mlp => distance(mlp, point) > 1.5)) &&
        (natural.areas.hull.every(hp => distance(hp, point) > 2)) &&
        (units.getStructures({ alliance: Alliance.SELF })
          .map(u => u.pos)
          .every(eb => distance(eb, point) > 3))
      );
    });
  return placements;
}

async function harass(state, resources) {
  const {
    actions,
    map,
    units
  } = resources.get();
  const label = 'harasser';
  if (units.getByType(STALKER).length == 4 && units.withLabel(label).length === 0) {
    state.harassOn = true;
    const stalkers = units.getById(STALKER);
    stalkers.forEach(stalker => stalker.labels.set(label, true));
  }
  if (state.harassOn === true) {
    // focus fire enemy
    const harassers = units.withLabel(label);
    const positionsOfHarassers = harassers.map(harasser => harasser.pos);
    const averagePoints = avgPoints(positionsOfHarassers);
    const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => {
      return (
        !(unit.unitType === EGG) &&
        !(unit.unitType === LARVA) &&
        !(unit.unitType === HATCHERY) &&
        !(unit.unitType === COMMANDCENTER) &&
        !(unit.unitType === ORBITALCOMMAND) &&
        !(unit.unitType === NEXUS)
      )
    });
    let closestEnemyUnit = units.getClosest(averagePoints, enemyUnits, 1)[0];
    if (units.withLabel(label).filter(harasser => harasser.labels.get(label)).length === 4) {
      if (closestEnemyUnit) {
        if (distance(closestEnemyUnit.pos, averagePoints) <= 10) {
          return actions.attack(harassers, closestEnemyUnit);
        } else {
          return actions.attackMove(harassers, map.getEnemyNatural().townhallPosition);
        }
      }
    } else {
      state.harassOn = false;
      const stalkers = units.getById(STALKER);
      stalkers.forEach(stalker => stalker.labels.set(label, false));
      return actions.move(harassers, map.getCombatRally());
    }
  }
}

function precautiousDefense() {
  // if cheese, shield battery at wall
}

async function photonCannonsAtNaturalDrop(agent, data, resources) {
  const { foodUsed } = agent;
  const {
    actions,
    map,
    units,
  } = resources.get();
  if (foodUsed >= 97) {
    const photonCannons = units.getById(PHOTONCANNON);
    const buildAbilityId = data.getUnitTypeData(PHOTONCANNON).abilityId;
    if ((photonCannons.length + units.withCurrentOrders(buildAbilityId)) < 2) {
      // get mineral field of natural closest to enemy main.
      const natural = map.getNatural();
      const naturalMineralField = units.getClosest(natural.townhallPosition, units.getMineralFields(), 8);
      const [ closestToEnemyMain ] = units.getClosest(map.getEnemyMain().townhallPosition, naturalMineralField);
      // get locations near closestToEnemyMain filtering out mineral line
      const points = gridsInCircle(closestToEnemyMain.pos, 3);
      const geysers = natural.cluster.vespeneGeysers;
      const filteredPoints = points.filter(point => {
        return (
          // far enough away to stay outta the mineral line
          distance(closestToEnemyMain.pos, point) > 2 &&
          // far enough away from gas line
          (geysers.every(gp => distance(gp.pos, point) > 3))
        );
      })
      // pick 10 random positions from the list
      const randomPositions = filteredPoints
        .map(pos => ({ pos, rand: Math.random() }))
        .sort((a, b) => a.rand - b.rand)
        .map(a => a.pos)
        .slice(0, 20);
      // see if any of them are good
      const foundPosition = await actions.canPlace(PHOTONCANNON, randomPositions);
      if (foundPosition) {
        await actions.build(PHOTONCANNON, foundPosition);
      }
    }
  }
}

function scout(resources) {
  const label = 'scout';
  const {
    actions,
    frame,
    map,
    units
  } = resources.get();
  if (units.withLabel(label).length === 0) {
    // probe setting the first pylon
    if (units.getByType(PYLON).length === 1) {
      const pylon = units.getById(PYLON)[0];
      const [ worker ] = units.getClosest(pylon.pos, units.getWorkers());
      worker.labels.clear();
      worker.labels.set(label, true);
      return actions.move(worker, map.getEnemyMain().townhallPosition);
    }
  } else {
    let probeScout = units.withLabel(label)[0];
    let enemyBases = units.getBases(Alliance.ENEMY);
    if (enemyBases.length < 2 && frame.timeInSeconds() >= 90 && frame.timeInSeconds() <= 120) {
      return actions.move(probeScout, map.getEnemyNatural().townhallPosition);
    }
    // when in enemy main, move to behind enemy mineral line.
  }
}

function scoutWithObserver(resources) {
  const {
    units
  } = resources.get();
  const label = 'scout';
  const collectedActions = [];
  // get observer with scout label.
  const [ observerScout ] = units.getById(OBSERVER).filter(unit => unit.labels.get(label));
  if (observerScout) {
    const [ closestEnemy ] = units.getClosest(observerScout.pos, units.getAlive(Alliance.ENEMY));
    if (closestEnemy) {
      collectedActions.push(...shadowUnit(observerScout, closestEnemy));
    }
  }
  return collectedActions;
}

function shortOnWorkers(resources) {
  const {
    units,
  } = resources.get();
  let idealHarvesters = 0
  let assignedHarvesters = 0
  const townhalls = units.getBases();
    townhalls.forEach(townhall => {
      idealHarvesters += townhall.idealHarvesters
      assignedHarvesters += townhall.assignedHarvesters
    });
  return idealHarvesters >= assignedHarvesters;
}

function tryTraining(agent, data, resources, targetCount, unitType) {
  const {
    units,
  } = resources.get();
  const collectedActions = [];
  const abilityId = data.getUnitTypeData(unitType).abilityId;
  const unitCount = units.getById(unitType).length + units.withCurrentOrders(abilityId).length
  if (unitCount === targetCount) {
    if (canAfford(agent, data, unitType)) {
      const trainer = units.getProductionUnits(unitType).find(unit => unit.noQueue);
      if (trainer) {
        const unitCommand = {
          abilityId,
          unitTags: [ trainer.tag ],
        }
        collectedActions.push(unitCommand);
      }
    }
    pauseBuilding = collectedActions.length === 0;
  };
  return collectedActions;
}

function tryUpgrade(data, resources, upgradeId) {
  const {
    units,
  } = resources.get();
  const collectedActions = [];
  const { abilityId } = data.getUpgradeData(upgradeId);
  const upgrader = units.getUpgradeFacilities(upgradeId).find(u => u.noQueue && u.availableAbilities(abilityId));
  if (upgrader) {
    collectedActions.push({ abilityId, unitTags: [upgrader.tag] });
  }
  return collectedActions;
}

module.exports = protoss;
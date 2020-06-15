//@ts-check
"use strict"
// https://www.youtube.com/watch?v=tfN1BdE8Vng
// https://lotv.spawningtool.com/build/115726/
const {
  createSystem,
  taskFunctions,
} = require("@node-sc2/core");

const { WarpUnitAbility } = require('@node-sc2/core/constants');
const {
  EFFECT_CHRONOBOOSTENERGYCOST: CHRONOBOOST,
} = require('@node-sc2/core/constants/ability');
const {
  ASSIMILATOR,
  COLOSSUS,
  CYBERNETICSCORE,
  FORGE,
  GATEWAY,
  IMMORTAL,
  LARVA,
  NEXUS,
  OBSERVER,
  PHOTONCANNON,
  PYLON,
  ROBOTICSBAY,
  ROBOTICSFACILITY,
  STALKER,
  WARPPRISM,
  TEMPLARARCHIVE,
  TWILIGHTCOUNCIL,
  WARPGATE,
  SHIELDBATTERY,
  ZEALOT,
} = require("@node-sc2/core/constants/unit-type")
const { Alliance } = require('@node-sc2/core/constants/enums');
const { GasMineRace, WorkerRace } = require('@node-sc2/core/constants/race-map');
const {
  CHARGE,
  EXTENDEDTHERMALLANCE,
  PROTOSSGROUNDWEAPONSLEVEL1,
  PROTOSSGROUNDWEAPONSLEVEL2,
  WARPGATERESEARCH
} = require('@node-sc2/core/constants/upgrade');

const { gridsInCircle } = require('@node-sc2/core/utils/geometry/angle');
const { avgPoints, distance } = require('@node-sc2/core/utils/geometry/point');
const getRandom = require('@node-sc2/core/utils/get-random');
const { state } = require("../systems/macro");

const {
  ability,
  build,
  train,
  upgrade
} = taskFunctions;

const MINERAL_TO_GAS_RATIO = 2.4;

const protoss = createSystem({
  name: 'Protoss',
  type: 'build',
  defaultOptions: {
      state: {
        // buildComplete: true,
        buildComplete: false,
        defenseMode: false,
        enemyBuildType: 'standard',
        harassOn: true
      },
  },  
  buildOrder: [
    [14, build(PYLON)], // at natural wall, scout,  0:20
    [16, build(GATEWAY)], // at wall,               0:40
    [17, ability(CHRONOBOOST, { target: NEXUS })],
    [17, build(ASSIMILATOR)], //                    0:48
    [18, build(ASSIMILATOR)], //                    0:58
    [19, build(GATEWAY)], // at wall,               1:13
    [20, build(CYBERNETICSCORE)], // at wall        1:28
    // scout again
    [23, train(STALKER, 2)], // chronoboost         2:02
    [27, ability(CHRONOBOOST, { target: GATEWAY })],
    [27, ability(CHRONOBOOST, { target: GATEWAY })],
    [27, upgrade(WARPGATERESEARCH)], //             2:08
    [27, train(STALKER, 2)], //                     2:24
    // [31, build(PYLON)],
    [31, build(NEXUS)], //                          2:56
    // attack if opponent is CC first and focus fire workers in natural. 
    //                                              2:57
    [32, build(ROBOTICSFACILITY)],
    // [33, build(PYLON)],
    [32, build(GATEWAY)],
    [34, train(OBSERVER)], // chronoboost, scout
    // [34, ability(CHRONOBOOST, { target: ROBOTICSFACILITY })],
    [34, build(ROBOTICSBAY)],
    [35, train(STALKER, 2)],
    [43, train(IMMORTAL)], // for defense
    [49, build(ASSIMILATOR, 2)],
    [51, train(COLOSSUS)], // chronoboost
    // [51, ability(CHRONOBOOST, { target: ROBOTICSFACILITY })],
    [58, upgrade(EXTENDEDTHERMALLANCE)],
    // [61, build(PYLON)],
    // [62, build(NEXUS)],
    [64, train(COLOSSUS)], // chronoboost, never stop colossus production
    // [64, ability(CHRONOBOOST, { target: ROBOTICSFACILITY })],
    [72, build(FORGE)], // have stalkers at terran drop locations.
    [74, train(STALKER, 2)],
    [78, build(GATEWAY)],
    [78, upgrade(PROTOSSGROUNDWEAPONSLEVEL1)],
    [78, train(COLOSSUS)], // chronoboost, never stop colossus production
    // [78, ability(CHRONOBOOST, { target: ROBOTICSFACILITY })],
    [86, build(TWILIGHTCOUNCIL)],
    // [97, build(PHOTONCANNON, 2)], // at drop locations
    [99, train(COLOSSUS)], // chronoboost
    // [99, ability(CHRONOBOOST, { target: ROBOTICSFACILITY })],
    [108, upgrade(CHARGE)],
    [109, build(GATEWAY, 3)],
    // Rally all combat units.
    [117, train(OBSERVER)], // follow main army
    [124, upgrade(PROTOSSGROUNDWEAPONSLEVEL2)],
    [124, train(COLOSSUS)], // chronoboost
    // [124, ability(CHRONOBOOST, { target: ROBOTICSFACILITY })],
    // [133, build(NEXUS)],
    // [144, train(WARPPRISM)], // chronoboost, follow main army, warp in units.
    [149, build(GATEWAY, 3)],
    // [149, build(TEMPLARARCHIVE)],
    [149, train(COLOSSUS)], // chronoboost
    [149, ability(CHRONOBOOST, { target: ROBOTICSFACILITY })],
    // keep building colossus and stalkers until 200
  ],
  async buildComplete() {
      this.setState({ buildComplete: true });
  },
  async onGameStart() {
    this.expansions = [];
  },
  async onStep({agent, data, resources}) {
    const { minerals } = agent;
    await attack(agent, resources);
    checkEnemyBuild(this.state, resources)
    chronoboost(resources);
    if (this.state.defenseMode) {
      await defend(resources);
    }
    await defenseSetup(this.state, data, resources);
    if (!shortOnWorkers(resources)) {
      await expand(agent, data, resources);
    }
    if (this.state.enemyBuildType === 'standard') {
      harass(this.state, resources);
    }
    if (this.state.buildComplete || this.state.defenseMode || minerals > 1028) {
      try { await balanceResources(agent, data, resources); } catch(error) {}
      try { await continuouslyBuild(agent, resources); } catch(error) {}
    }
    await pestControl(agent, resources, this.state);
    await photonCannonsAtNaturalDrop(agent, data, resources);
    if (!this.state.defenseMode) {
      await rallyUnits(agent, resources);
    }
    scout(resources);
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
    // if (foodUsed == 14) {
    //   const naturalWall = map.getNatural().getWall();
    //   const avg = avgPoints(naturalWall);      
    //   actions.move(newUnit, avg);
    // }
    // first observer move to enemy
    if (newUnit.unitType === OBSERVER || newUnit.unitType === WARPPRISM) {
      if (foodUsed < 42) {
        const naturalCentroid = map.getEnemyNatural().centroid;
        // enemy base positions
        // const avg = avgPoints(enemyNatural);
        return actions.move(newUnit, naturalCentroid);
      } else {
        // move to army. Label army, or just move to combat?
        return actions.move(newUnit, map.getCombatRally());
      }
    }
  },
  async onUnitIdle({ resources }, idleUnit) {
    if (idleUnit.isWorker()) {
      const { actions } = resources.get();
      return actions.gather(idleUnit);
    }
  },
});

async function attack(agent, resources) {
  const {
    actions,
    map,
    units
  } = resources.get();
  // attack when near maxed.
  const { foodUsed } = agent;
  if (foodUsed >= 194) {
    const combatUnits = units.getCombatUnits();
    const stalkers = units.getById(STALKER).filter(unit => !unit.labels['pest-control']);
    // closest enemy base
    let [ closestEnemyBase ] = units.getClosest(map.getCombatRally(), units.getBases(Alliance.ENEMY), 1);
    const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !(unit.unitType === LARVA));
    let [ closestEnemyUnit ] = units.getClosest(map.getCombatRally(), enemyUnits, 1);
    const nonStalkers = combatUnits.filter(unit => !(unit.unitType === STALKER));
    const supportUnits = units.getById(OBSERVER).concat(...units.getById(WARPPRISM));
    if (closestEnemyBase) {
      const [ stalkerPoint ] = units.getClosest(closestEnemyBase.pos, stalkers, 1);
      await actions.attackMove(nonStalkers, stalkerPoint.pos);
      try { await actions.move(supportUnits, stalkerPoint.pos); } catch(error) {}
      return await actions.attackMove(stalkers, closestEnemyBase.pos);
    } else if (closestEnemyUnit) {
      const [ stalkerPoint ] = units.getClosest(closestEnemyUnit.pos, stalkers, 1);
      await actions.attackMove(nonStalkers, stalkerPoint.pos);
      try { await actions.move(supportUnits, stalkerPoint.pos); } catch(error) {}
      return await actions.attackMove(stalkers, closestEnemyUnit.pos);
    } else {
      // order to location, 
      const expansions = map.getAvailableExpansions().concat(map.getEnemyMain());
      const idleCombatUnits = units.getCombatUnits().filter(u => u.noQueue);
      const randomExpansion = expansions[Math.floor(Math.random() * expansions.length)];
      const [ stalkerPoint ] = units.getClosest(randomExpansion.townhallPosition, stalkers, 1);
      try { await actions.move(supportUnits, stalkerPoint.pos); } catch(error) {}
      return await actions.attackMove(idleCombatUnits, randomExpansion.townhallPosition);
    }
  }
}

async function balanceResources(agent, data, resources) {
  const {
    actions,
    units,
  } = resources.get();
  const { minerals, vespene } = agent;
  const resourceRatio = minerals / vespene;
  const gasUnitId = GasMineRace[agent.race]
  const buildAbilityId = data.getUnitTypeData(gasUnitId).abilityId;
  const conditions = [
    resourceRatio > MINERAL_TO_GAS_RATIO,
    agent.canAfford(gasUnitId),
    units.withCurrentOrders(buildAbilityId).length <= 0
  ];
  if (conditions.every(c => c)) {
    await actions.buildGasMine();
  }
}

function checkEnemyBuild(state, resources) {
  const {
    actions,
    frame,
    map,
    units,
  } = resources.get();
  // if scouting probe and time is greater than 2 minutes. If no base, stay defensive.
  if (units.withLabel('scout').length == 1 && frame.timeInSeconds() > 132) {
    if (units.getBases(Alliance.ENEMY).length < 2) {
      state.enemyBuildType = 'cheese';
    };
  }
}

async function chronoboost(resources) {
  const { actions, units } = resources.get();
  const nexus = units.getById(NEXUS).find(n => n.energy > 50);
  if (nexus) {
    // chronoboost 15 probe
    const structures = units.getStructures();
    if (structures.length >= 0) {
      let target;        
      target = structures.find(u => (
        // u.is(CYBERNETICSCORE) && !u.noQueue ||
        // u.is(GATEWAY) && !u.noQueue ||
        u.is(ROBOTICSFACILITY) && !u.noQueue
        // u.is(NEXUS) && !u.noQueue ||
        // u.is(WARPGATE)
        ));
      // const getRandom = arr => arr[Math.floor(Math.random() * arr.length)];
      if (target) {
        actions.do(
          CHRONOBOOST,
          nexus.tag,
          { target: target }
          );
        }
      }
    }
}

async function continuouslyBuild(agent, resources) {
  const { foodUsed } = agent;
  const {
    actions,
    units,
  } = resources.get();
  let unitToWarpIn = STALKER;
  let abilityId = WarpUnitAbility[unitToWarpIn];
  let qtyToWarp = agent.canAffordN(unitToWarpIn, 1);
  if (qtyToWarp === 0) {
    unitToWarpIn = ZEALOT;
    abilityId = WarpUnitAbility[unitToWarpIn];
    qtyToWarp = agent.canAffordN(unitToWarpIn, 1);
  }
  const warpGates = units.getById(WARPGATE).filter(wg => wg.abilityAvailable(abilityId)).slice(0, qtyToWarp);
  if (warpGates.length > 0 && foodUsed <= 198) {
    await actions.warpIn(unitToWarpIn);
  }
  const idleRoboticsFacility = units.getById(ROBOTICSFACILITY, { noQueue: true, buildProgress: 1 });
  if (idleRoboticsFacility.length > 0 && foodUsed <= 194) {
    return Promise.all(idleRoboticsFacility.map(roboticsFacility => actions.train(COLOSSUS, roboticsFacility)));
  }  
}

async function defend(resources) {
  const {
    actions,
    map,
    units,
  } = resources.get();
  const combatUnits = units.getCombatUnits();
  const stalkers = units.getById(STALKER).filter(unit => !unit.labels['pest-control']);
  const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !(unit.unitType === LARVA));
  let [ closestEnemyUnit ] = units.getClosest(map.getCombatRally(), enemyUnits, 1);
  const nonStalkers = combatUnits.filter(unit => !(unit.unitType === STALKER));
  const supportUnits = units.getById(OBSERVER).concat(...units.getById(WARPPRISM));
  if (closestEnemyUnit) {
    const [ stalkerPoint ] = units.getClosest(closestEnemyUnit.pos, stalkers, 1);
    try { await actions.attackMove(nonStalkers, stalkerPoint.pos); } catch(error) {}
    try { await actions.move(supportUnits, stalkerPoint.pos); } catch(error) {}
    await actions.attackMove(stalkers, closestEnemyUnit.pos);
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
          distance(natural.townhallPosition, point) > 3.25
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
      return actions.build(SHIELDBATTERY, foundPosition);
    }
  }
}

async function expand(agent, data, resources) {
  const { foodUsed } = agent;
  const {
    actions,
    map,
    units,
  } = resources.get();
  if (foodUsed >= 62) {
    const expansionLocation = map.getAvailableExpansions()[0].townhallPosition;
    const foundPosition = await actions.canPlace(NEXUS, [expansionLocation]);
    const buildAbilityId = data.getUnitTypeData(NEXUS).abilityId;
    if ((units.inProgress(NEXUS).length + units.withCurrentOrders(buildAbilityId).length) < 1 ) {
      return actions.build(NEXUS, foundPosition)
    }
  }
}

function harass(state, resources) {
  const {
    actions,
    map,
    units
  } = resources.get();
  const label = 'harasser';
  if (state.harassOn === true) {
    if (units.withLabel(label).length === 0) {
      if (units.getByType(STALKER).length == 4) {
        state.harassOn = true;
        const stalkers = units.getById(STALKER);
        stalkers.forEach(stalker => stalker.labels.set(label, true));
      }
    } else {
      // focus fire enemy
      const harassers = units.withLabel(label);
      const positionsOfHarassers = harassers.map(harasser => harasser.pos);
      const averagePoints = avgPoints(positionsOfHarassers);
      const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !(unit.unitType === LARVA));
      let closestEnemyUnit = units.getClosest(averagePoints, enemyUnits, 1)[0];
      if (closestEnemyUnit) {
        if (units.withLabel(label).length === 4) {
          if (distance(closestEnemyUnit.pos, averagePoints) <= 10) {
            return actions.attack(harassers, closestEnemyUnit);
          } else {
            return actions.attackMove(harassers, map.getEnemyNatural().townhallPosition);
          }
        } else {
          state.harassOn = false;
          const stalkers = units.getById(STALKER);
          stalkers.forEach(stalker => stalker.labels.set(label, false));
          return actions.move(harassers, map.getCombatRally())
        }
      } else {
        return actions.attackMove(harassers, map.getEnemyNatural().townhallPosition);
      }
    }
  }
}

async function pestControl(agent, resources, state) {
  const {
    actions,
    units
  } = resources.get();
  // check for enemy worker near townhall.
  const label = 'pest-control';
  const townhalls = units.getBases();
  const enemyPush = [];
  townhalls.forEach(async townhall => {
    const enemyUnits = units.getAlive(Alliance.ENEMY);
    const inRange = enemyUnits.filter(unit => distance(unit.pos, townhall.pos) < 20);
    const enemyCount = inRange.length;
    if (enemyCount > 10) {
      enemyPush.push(true);
    } else {
      enemyPush.push(false);
    }
    const closestEnemyUnit = units.getClosest(townhall.pos, inRange, 1)[0];
    if (closestEnemyUnit) {
      const addControl = enemyCount - units.withLabel(label).length
      const position = closestEnemyUnit.pos;
      const combatUnits = units.getClosest(position, units.getCombatUnits(), addControl);
      if (combatUnits.length > 0) {
        combatUnits.forEach(unit => unit.labels.set(label, true));
      }
      await actions.attackMove(units.withLabel(label), position);
    } else {
      units.withLabel(label).forEach(unit => unit.labels.set(label, false));
    }
  });
  if (enemyPush.some(c => c)) {
    state.defenseMode = true;
  } else {
    state.defenseMode = false;
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
      const worker = units.getClosest(pylon.pos, units.getWorkers());
      worker[0].labels.set(label, true);
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

async function rallyUnits(agent, resources) {
  const { foodUsed } = agent;
  const {
    actions,
    map,
    units,
  } = resources.get();
  if (foodUsed >= 108 && foodUsed < 194) {
    const combatUnits = units.getCombatUnits().filter(unit => !unit.labels['pest-control']);
    const rallyPoint = map.getCombatRally();
    await actions.attackMove(combatUnits, rallyPoint);
    const supportUnits = units.getById(OBSERVER).concat(...units.getById(WARPPRISM));
    if (supportUnits.length > 0) {
      await actions.move(supportUnits, rallyPoint);
    }
  }
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

module.exports = protoss;
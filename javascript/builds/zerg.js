//@ts-check
// https://lotv.spawningtool.com/build/82510/
// https://www.youtube.com/watch?v=xpeJ-GAn0g0
"use strict"

const {
  createSystem,
  taskFunctions
} = require("@node-sc2/core");
const { Alliance } = require('@node-sc2/core/constants/enums');
const {
  LAIR,
  OVERLORD, HATCHERY, EXTRACTOR, SPAWNINGPOOL, QUEEN, ZERGLING, ROACHWARREN, EVOLUTIONCHAMBER, SPORECRAWLER, ROACH, HYDRALISKDEN, HYDRALISK, OVERSEER, INFESTATIONPIT, HIVE, CREEPTUMOR, CREEPTUMORBURROWED, LARVA, SPINECRAWLER, OVERLORDCOCOON,
} = require("@node-sc2/core/constants/unit-type");
const { RESEARCH_ZERGLINGMETABOLICBOOST, MORPH_LAIR, MORPH_OVERSEER, RESEARCH_GROOVEDSPINES, RESEARCH_MUSCULARAUGMENTS, EFFECT_INJECTLARVA, HARVEST_GATHER, MOVE, BUILD_CREEPTUMOR_QUEEN, BUILD_CREEPTUMOR_TUMOR, MORPH_HIVE } = require("@node-sc2/core/constants/ability");
const {
  GLIALRECONSTITUTION,
  ZERGGROUNDARMORSLEVEL1,
  ZERGGROUNDARMORSLEVEL2,
  ZERGMISSILEWEAPONSLEVEL1,
  ZERGMISSILEWEAPONSLEVEL2,
} = require("@node-sc2/core/constants/upgrade");
const { workerTypes } = require("@node-sc2/core/constants/groups");

const isSupplyNeeded = require("../helper/supply");

const {
  ability,
  build,
  train,
  upgrade,
} = taskFunctions;

const rallyUnits = require('../helper/rally-units');
const workerSetup = require('../helper/worker-setup');
const { toDegrees } = require("@node-sc2/core/utils/geometry/angle");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const baseThreats = require("../helper/base-threats");
const buildWorkers = require("../helper/build-workers");
const continuouslyBuild = require("../helper/continuously-build");
const range = require("../helper/range");
const expand = require("../helper/expand");
const shortOnWorkers = require("../helper/short-on-workers");
const canAfford = require("../helper/can-afford");
const { attack, defend } = require("../helper/army-behavior");
const balanceResources = require("../helper/balance-resources");
const { checkEnemyBuild, defenseSetup } = require("../helper/defense-setup");
const placementConfigs = require("../helper/placement-configs");
const { abilityOrder, checkBuildingCount, buildBuilding, findPlacements, upgradeOrder } = require("../helper/build-building");

const ATTACKFOOD = 194;
const MINERALTOGASRATIO = 2.4;
const RALLYFOOD = 31;

let pauseBuilding = false;
let supplyLost = 0;
let totalFoodUsed = 0;

let mainCombatTypes = [ ZERGLING, ROACH, HYDRALISK ];
let supportUnitTypes = [ OVERSEER ];

const zerg = createSystem({
  name: 'Zerg',
  type: 'build',
  defaultOptions: {
    state: {
      buildComplete: false,
      enemyBuildType: 'standard',
      paused: false,
      // buildComplete: true,
    }
  },
  buildOrder: [
    [13, train(OVERLORD)],                          //  0:12
    [17, build(HATCHERY)],                          //  0:53
    [18, build(EXTRACTOR)],                         //  1:02
    [18, build(SPAWNINGPOOL)],                      //  1:20
    [21, train(OVERLORD)],                          //  2:03
    [21, train(QUEEN, 2)],                          //  2:06
    [25, ability(RESEARCH_ZERGLINGMETABOLICBOOST)], //  2:09
    [25, train(ZERGLING, 2)],                       //  2:11
    [31, train(OVERLORD)],                          //  2:49
    [33, ability(MORPH_LAIR)],                      //  2:58
    [33, train(QUEEN)],                             //  3:03
    [35, build(ROACHWARREN)],                       //  3:10
    [34, train(OVERLORD)],                          //  3:12
    [34, build(EVOLUTIONCHAMBER)],                  //  3:13
    [37, train(OVERLORD)],                          //  3:29  38
    [39, build(SPORECRAWLER, 2)],                   //  3:36  40
    [41, upgrade(ZERGMISSILEWEAPONSLEVEL1)],        //  3:56  42
    [41, upgrade(GLIALRECONSTITUTION)],             //  3:57  42
    [41, build(EXTRACTOR)],                         //  4:03  42
    [42, train(ROACH)],                             //  4:09  42
    [45, train(ROACH, 5)],                          //  4:40  45
  ],
  async buildComplete() {
    this.setState({ buildComplete: true });
  },
  async onGameStart({ resources }){
    const {
      actions,
      map,
      units,
    } = resources.get();
    let collectedActions = [];
    const workers = units.getWorkers();
    const [main] = map.getExpansions();
    const mainMineralField = units.getClosest(main.townhallPosition, units.getMineralFields(), 8);
    workers.forEach((worker, index) => {
      const mineralIndex = index % 8;
      const target = mainMineralField[mineralIndex];
      const unitCommand = {
        abilityId: HARVEST_GATHER,
        targetUnitTag: target.tag,
        unitTags: [ worker.tag ]
      }
      collectedActions.push(unitCommand);
    });
    actions.sendAction(collectedActions);
  },
  async onStep({ agent, data, resources }) {
    const {
      foodUsed,
      minerals,
    } = agent;
    const { actions, map, units } = resources.get();
    let collectedActions = [];
    const zergSystem = agent.systems.find(system => system._system.name === "Zerg")._system;
    pauseBuilding ? zergSystem.pauseBuild() : zergSystem.resumeBuild();
    if (foodUsed >= ATTACKFOOD) {
      collectedActions.push(...attack(resources, mainCombatTypes, supportUnitTypes))
    }
    if (foodUsed >= 58) { collectedActions.push(...await tryBuilding(agent, data, resources, 2, placementConfigs.HATCHERY, [ map.getAvailableExpansions()[0].townhallPosition ])); }
    if (foodUsed >= 68) { collectedActions.push(...await tryBuilding(agent, data, resources, 1, placementConfigs.EVOLUTIONCHAMBER)); }
    if (foodUsed >= 78) { collectedActions.push(...upgradeOrder(data, resources, ZERGMISSILEWEAPONSLEVEL2)); }
    if (foodUsed >= 78) { collectedActions.push(...upgradeOrder(data, resources, ZERGGROUNDARMORSLEVEL1)); }
    if (foodUsed >= 78) { collectedActions.push(...await tryBuilding(agent, data, resources, 0, placementConfigs.HYDRALISKDEN)); }
    if (foodUsed >= 101) { collectedActions.push(...abilityOrder(data, resources, MORPH_OVERSEER, 0, [OVERSEER, OVERLORDCOCOON])); }
    if (foodUsed >= 119) { collectedActions.push(...abilityOrder(data, resources, RESEARCH_GROOVEDSPINES)); }
    if (foodUsed >= 138) { collectedActions.push(...await tryBuilding(agent, data, resources, 1, placementConfigs.HYDRALISKDEN)); }
    if (foodUsed >= 149) { collectedActions.push(...upgradeOrder(data, resources, ZERGGROUNDARMORSLEVEL2)); }
    if (foodUsed >= 149) { collectedActions.push(...abilityOrder(data, resources, RESEARCH_MUSCULARAUGMENTS)); }
    if (foodUsed >= 165) { collectedActions.push(...await tryBuilding(agent, data, resources, 0, placementConfigs.INFESTATIONPIT)); }
    if (foodUsed >= 198) { collectedActions.push(...abilityOrder(data, resources, MORPH_HIVE, 0, [HIVE])); }
    
    baseThreats(resources, this.state);
    checkEnemyBuild(resources, this.state);
    if (this.state.rushDetected === true) {
      try { await continuouslyBuild(agent, data, resources, mainCombatTypes); } catch (error) { console.log('continuouslyBuild error', error)}
    }
    if (this.state.defenseMode && foodUsed < ATTACKFOOD) {
      collectedActions.push(...defend(resources, mainCombatTypes, supportUnitTypes));
      try { await continuouslyBuild(agent, data, resources, mainCombatTypes); } catch (error) { console.log('continuouslyBuild error', error)}
    }
    if (minerals > 512) {
      try { await balanceResources(agent, data, resources, MINERALTOGASRATIO); } catch(error) { }
      try { await continuouslyBuild(agent, data, resources, mainCombatTypes); } catch (error) { console.log('continuouslyBuild error', error)}
    }
    collectedActions.push(...await defenseSetup(data, resources, this.state, SPINECRAWLER));
    if (this.state.buildComplete && !shortOnWorkers(resources)) {
      await expand(agent, data, resources);
    }
    if (shortOnWorkers(resources) && !this.state.defenseMode && this.state.buildComplete && minerals <= 512) {
      try { await buildWorkers(agent, data, resources); } catch (error) { console.log(error); }
    }
    collectedActions.push(...inject(resources));
    await increaseSupply(agent, data, resources);
    // lightPush(resources, this.state);
    if (totalFoodUsed > 42) {
      await maintainQueens(agent, data, resources);
    }
    collectedActions.push(...overlordCoverage(resources))
    if (!this.state.defenseMode && foodUsed < ATTACKFOOD && foodUsed >= RALLYFOOD) {
      let rallyPosition = null;
      const [ spinecrawler ] = units.getById(SPINECRAWLER);
      if (spinecrawler) {
        rallyPosition = spinecrawler.pos;
      }
      collectedActions.push(...rallyUnits(resources, [], rallyPosition));
    }
    collectedActions.push(...await spreadCreep(resources));
    collectedActions.push(...shadowEnemy(resources, this.state));
    if (collectedActions.length > 0) {
      await actions.sendAction(collectedActions);
    }
  },
  async onUnitCreated({ agent, data, resources }, newUnit) {
    const {
      actions,
      map,
      units,
    } = resources.get();
    const collectedActions = [];
    const expansionPoints = [ ...range(16, 18), ...range(57, 74) ];
    workerSetup(agent, resources, newUnit, [], expansionPoints, totalFoodUsed);
    const naturalCentroid = map.getEnemyNatural().centroid;
    if (newUnit.unitType === OVERLORD) {
      if (units.getByType(OVERLORD).length == 1) {
        return actions.move(newUnit, naturalCentroid);
      } else {
        collectedActions.push(...goToRandomPoint(map, newUnit));
      }
    }
    if (newUnit.unitType === QUEEN) {
      // label injector if townhalls more than queens.
      let label = 'injector';
      if (units.withLabel(label).length < units.getBases().length) {
        newUnit.labels.set(label, true);
      } else if (units.getById(QUEEN).length > units.getBases().length) {
        label = 'creeper';
        newUnit.labels.set(label, true);
      }
    }
    actions.sendAction(collectedActions);
  },
  async onUnitDestroyed({ agent, data, resources }, destroyedUnit) {
    const { foodUsed } = agent;
    const {
      actions,
      map,
      units,
    } = resources.get()
    if (destroyedUnit.unitType === OVERLORD) {
      await actions.train(OVERLORD);
      const overlords = [...units.getById(OVERLORD), ...units.getById(OVERSEER)];
      const [ closestOverlordToEnemyNatural ] = units.getClosest(map.getEnemyNatural().centroid, overlords);
      if (destroyedUnit.tag === closestOverlordToEnemyNatural.tag) {
        this.state.paused = true;
        this.state.rushDetected = true;
      }
    }
    if (destroyedUnit.alliance === 1) {
      supplyLost += data.getUnitTypeData(destroyedUnit.unitType).foodRequired;
      if (this.state.paused === false) {
        totalFoodUsed = foodUsed + supplyLost;
      }
    }
  },
  async onUnitDamaged({ resources }, damagedUnit) {
    if (damagedUnit.alliance === 1) {
      const collectedActions = [];
      const {
        actions,
        map,
      } = resources.get();
      const totalHealthShield = damagedUnit.health + damagedUnit.shield;
      const maxHealthShield = damagedUnit.healthMax + damagedUnit.shieldMax;
      if ((totalHealthShield / maxHealthShield) < 0.5) {
        const unitCommand = {
          abilityId: MOVE,
          targetWorldSpacePos: map.getCombatRally(),
          unitTags: [ damagedUnit.tag ],
        }
        collectedActions.push(unitCommand);
      }
      actions.sendAction(collectedActions);
    }
  },
  async onUnitIdle({ resources }, idleUnit) {
    if (idleUnit.isWorker() && !idleUnit.labels.has('builder')) {
      const { actions } = resources.get();
      return actions.gather(idleUnit);
    }
  },
});

function armyCompositionAndBuild(agent, data, resources) {
  const {
    minerals,
    vespene,
  } = agent;
  const unitTypes = [HYDRALISK];
  if ((minerals / vespene) > 2) { unitTypes.push(ROACH); }
  if ((minerals / vespene) > (175 / 75)) { unitTypes.push(ZERGLING); }
  return unitTypes;
}

function detectRush(map, units, state) {
  // if enemy natural overlord is killed
  const enemyBases = units.getBases(Alliance.ENEMY);
  const threateningUnits = units.getAlive(Alliance.ENEMY).filter(unit => {
    if (enemyBases.length > 0) {
      const [ closestBase ] = units.getClosest(unit.pos, enemyBases);
      if (distance(unit.pos, closestBase.pos) > 22) {
        return true; 
      }
    } else {
      const enemyMain = map.getEnemyMain();
      if (distance(unit.pos, enemyMain.townhallPosition) > 22) {
        return true; 
      }
    }
  })
  if (threateningUnits.length > 1) {
    state.paused = true;
    state.rushDetected = true;
  } else {
    state.paused = false;
    state.rushDetected = false;
  }
}

async function increaseSupply(agent, data, resources) {
  const { foodUsed } = agent;
  const {
    actions,
    units,
  } = resources.get();
  if (foodUsed >= 33) {
    if (isSupplyNeeded(agent, data, resources)) {
      if (agent.canAfford(OVERLORD) && units.getById(LARVA).length > 0) {
        await actions.train(OVERLORD);
      }
    }
  }
}

function lightPush(resources, state) {
  const { units } = resources.get();
  const label = 'lightPushOn';
  const collectedActions = [];
  const combatUnits = [];
  mainCombatTypes.forEach(type => {
    combatUnits.push(...units.getById(type).filter(unit => !unit.labels.get('scout')));
  });
  if (totalFoodUsed >= 71 && units.withLabel(label).length === 0) {
    state.lightPushOn = true;
    combatUnits.forEach(unit => unit.labels.set(label, true));
  }
  if (state.lightPushOn === true && units.withLabel(label).filter(pusher => pusher.labels.get(label)).length >= 0) {
    const pushers = units.withLabel(label);
    collectedActions.push(...attack(resources, mainCombatTypes, supportUnitTypes));
  }
}

function inject(resources) {
  const {
    actions,
    units,
  } = resources.get();
  const collectedActions = []
  // for each townhall, grab and label queen.
  const queen = units.withLabel('injector').find(injector => injector.energy >= 25);
  if (queen) {
    const nonInjectedBases = units.getBases().filter(base => !base.buffIds.includes(11));
    const [ townhall ] = units.getClosest(queen.pos, units.getClosest(queen.pos, nonInjectedBases));
    if (townhall) {
      const unitCommand = {
        abilityId: EFFECT_INJECTLARVA,
        targetUnitTag: townhall.tag,
        unitTags: [ queen.tag ]      
      }
      collectedActions.push(unitCommand);
    }
  }
  return collectedActions;
}

async function maintainQueens(agent, data, resources) {
  const {
    actions,
    units,
  } = resources.get();
  const queenBuildAbilityId = data.getUnitTypeData(QUEEN).abilityId;
  const queenCount = units.getById(QUEEN).length + units.withCurrentOrders(queenBuildAbilityId).length;
  const baseCount = units.getBases().length;
  if (queenCount <= baseCount) {
    if (canAfford(agent, data, QUEEN)) {
      try { await actions.train(QUEEN); } catch (error) { console.log(error) }
    }
  }
}

function overlordCoverage(resources) {
  const {
    units,
  } = resources.get();
  const collectedActions = [];
  const idleOverlords = [...units.getById(OVERLORD), ...units.getById(OVERSEER)].filter(over => over.orders.length === 0);
  if (idleOverlords.length > 0) {
    const randomOverlord = idleOverlords[Math.floor(Math.random() * idleOverlords.length)];
    const closestIdleOverlords = units.getClosest(randomOverlord.pos, idleOverlords, 2);
    if (closestIdleOverlords.length > 1) {
      const distanceToClosest = distance(randomOverlord.pos, closestIdleOverlords[1].pos);
      const overlordSightRange = randomOverlord.data().sightRange;
      if (distanceToClosest < overlordSightRange) {
        collectedActions.push(moveAway(randomOverlord, closestIdleOverlords[1]));
      }
    }
  }
  return collectedActions;
}

function shadowEnemy(resources, state) {
  const {
    map,
    units,
  } = resources.get();
  // stay within vision of enemy units
  const collectedActions = [];
  const overlords = [...units.getById(OVERLORD), ...units.getById(OVERSEER)];
  overlords.forEach(overlord => {
    // follow drones outside of overlord of natural expansion scout
    const [ closestEnemy ] = units.getClosest(overlord.pos, units.getAlive(Alliance.ENEMY).filter(unit => {
      const [ closestOverlordToEnemyNatural ] = units.getClosest(map.getEnemyNatural().centroid, overlords);
      if (overlord.tag === closestOverlordToEnemyNatural.tag) {
        return !workerTypes.includes(unit.unitType)
      } else {
        // count enemy units outside their range
        detectRush(map, units, state);
        return true;
      }
    }));
    if (closestEnemy) {
      const distanceToEnemy = distance(overlord.pos, closestEnemy.pos);
      const overlordSightRange = overlord.data().sightRange;
      const enemySightRange = closestEnemy.data().sightRange;
      const averageSightRange = (overlordSightRange + enemySightRange) / 2;
      // if (distanceToEnemy < overlordSightRange && distanceToEnemy > enemySightRange) {
      //   collectedActions.push(...holdPosition(overlord));
      // } else 
      if (distanceToEnemy < overlordSightRange && distanceToEnemy > averageSightRange) {
        if (overlord.health / overlord.healthMax > 0.5) {
          // move towards
          const unitCommand = {
            abilityId: MOVE,
            targetUnitTag: closestEnemy.tag,
            unitTags: [ overlord.tag ]
          }
          collectedActions.push(unitCommand);
        }
      } else if (distanceToEnemy < enemySightRange) {
        // move away
        // angle of enemy in grid.
        const angle = toDegrees(Math.atan2(closestEnemy.pos.y - overlord.pos.y, closestEnemy.pos.x - overlord.pos.x));
        const oppositeAngle = angle + 180 % 360;
        const awayPoint = {
          x: Math.cos(oppositeAngle * Math.PI / 180) * 2 + overlord.pos.x,
          y: Math.sin(oppositeAngle * Math.PI / 180) * 2 + overlord.pos.y
        }
        // Get opposite angle of enemy.
        // move to point with opposite angle and distance
        const unitCommand = {
          abilityId: MOVE,
          targetWorldSpacePos: awayPoint,
          unitTags: [ overlord.tag ]
        }
        collectedActions.push(unitCommand);
      }
    }
  });
  return collectedActions;
}

async function spreadCreep(resources) {
  const { units, } = resources.get();
  const collectedActions = [];
  const label = 'creeper';
  const idleCreeperQueens = units.withLabel(label).filter(unit => unit.abilityAvailable(BUILD_CREEPTUMOR_QUEEN) && unit.orders.length === 0);
  if (idleCreeperQueens.length > 0) {
    collectedActions.push(...await findAndPlaceCreepTumor(resources, idleCreeperQueens, BUILD_CREEPTUMOR_QUEEN));
  }
  const creepTumors = [...units.getById(CREEPTUMORBURROWED) ].filter(unit => unit.availableAbilities().length > 0 && !unit.labels.get('stuck'));
  if (creepTumors.length > 0) {
    collectedActions.push(...await findAndPlaceCreepTumor(resources, creepTumors, BUILD_CREEPTUMOR_TUMOR))
  }
  return collectedActions;
}

async function findAndPlaceCreepTumor(resources, spreaders, ability) {
  const {
    actions,
    map,
    units,
  } = resources.get();
  let collectedActions = [];
  let creepPoints = []
  const pointLimit = 1000;
  if (map.getCreep().length > pointLimit) {
    creepPoints = getRandom(map.getCreep(), pointLimit);
  } else {
    creepPoints = map.getCreep();
  }
  const creepCandidates = creepPoints.filter(point => {
    return filterPlacementsByRange(map, units, [ HATCHERY, LAIR, CREEPTUMORBURROWED, ], point, 9);
  });
  if (creepCandidates.length > 0) {
    // for every creepCandidate filter by finding at least one spreader less than 10.5 distance
    // no test for queens.
    const spreadableCreepCandidates = creepCandidates.filter(candidate => ability === BUILD_CREEPTUMOR_QUEEN ? true : spreaders.some(spreader => distance( candidate, spreader.pos, ) <= 10.5));
    const allSpreaders = [...units.getById(CREEPTUMORBURROWED)].filter(unit => unit.availableAbilities().length > 0);
    if (spreadableCreepCandidates.length > 0) {
      const foundPosition = await actions.canPlace(CREEPTUMOR, spreadableCreepCandidates);
      if (foundPosition) {
        // get closest spreader
        const [ closestSpreader ] = units.getClosest(foundPosition, spreaders);
        const unitCommand = {
          abilityId: ability,
          targetWorldSpacePos: foundPosition,
          unitTags: [ closestSpreader.tag ]
        }
        collectedActions.push(unitCommand);
        allSpreaders.forEach(spreader => spreader.labels.set('stuck', false));
      }
    } else {
      spreaders.forEach(spreader => spreader.labels.set('stuck', true));
    }
  }
  return collectedActions;
}

function filterPlacementsByRange(map, units, unitType, point, range) {
  return [...units.getById(unitType), ...map.getAvailableExpansions()]
    .map(creepGenerator => creepGenerator.pos || creepGenerator.townhallPosition)
    .every(position => {
      const [ closestEnemyStructure ] = units.getClosest(position, units.getStructures(Alliance.ENEMY));
      if (closestEnemyStructure) {
        return (
          distance(position, point) >= range &&
          map.getExpansions(Alliance.ENEMY).every(expansion => distance(point, expansion.townhallPosition) > 11.5)
        )
      } else {
        return distance(position, point) >= range;
      }
    });
}

function moveAway(unit, targetUnit) {
  // move away
  // angle of enemy in grid.
  const angle = toDegrees(Math.atan2(targetUnit.pos.y - unit.pos.y, targetUnit.pos.x - unit.pos.x));
  const oppositeAngle = angle + 180 % 360;
  const awayPoint = {
    x: Math.cos(oppositeAngle * Math.PI / 180) * 2 + unit.pos.x,
    y: Math.sin(oppositeAngle * Math.PI / 180) * 2 + unit.pos.y
  }
  // Get opposite angle of enemy.
  // move to point with opposite angle and distance
  const unitCommand = {
    abilityId: MOVE,
    targetWorldSpacePos: awayPoint,
    unitTags: [ unit.tag ]
  }
  return unitCommand;
}

function getRandom(arr, n) {
  var result = new Array(n),
      len = arr.length,
      taken = new Array(len);
  if (n > len)
      throw new RangeError("getRandom: more elements taken than available");
  while (n--) {
      var x = Math.floor(Math.random() * len);
      result[n] = arr[x in taken ? taken[x] : x];
      taken[x] = --len in taken ? taken[len] : len;
  }
  return result;
}

function goToRandomPoint(map, unit) {
  const collectedActions = [];
  const randomPoint = {
    x: Math.floor(Math.random() * Math.floor(map._mapSize.x)),
    y: Math.floor(Math.random() * Math.floor(map._mapSize.y)),
  }
  const unitCommand = {
    abilityId: MOVE,
    targetWorldSpacePos: randomPoint,
    unitTags: [ unit.tag ],
  }
  collectedActions.push(unitCommand);
  return collectedActions;
}

async function tryBuilding(agent, data, resources, targetCount, placementConfig, candidatePositions=null) {
  const collectedActions = [];
  if (checkBuildingCount(data, resources, targetCount, placementConfig)) {
    if (!candidatePositions) { candidatePositions = findPlacements(agent, resources)}
    collectedActions.push(...await buildBuilding(agent, data, resources, placementConfig, candidatePositions));
    pauseBuilding = collectedActions.length === 0;
  }
  return collectedActions;
}

module.exports = zerg;
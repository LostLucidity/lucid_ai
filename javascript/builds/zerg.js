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
  OVERLORD, HATCHERY, EXTRACTOR, SPAWNINGPOOL, QUEEN, ZERGLING, ROACHWARREN, EVOLUTIONCHAMBER, SPORECRAWLER, ROACH, HYDRALISKDEN, HYDRALISK, OVERSEER, INFESTATIONPIT, HIVE, CREEPTUMOR, CREEPTUMORBURROWED, LARVA,
} = require("@node-sc2/core/constants/unit-type");
const { RESEARCH_ZERGLINGMETABOLICBOOST, MORPH_LAIR, MORPH_OVERSEER, RESEARCH_GROOVEDSPINES, RESEARCH_MUSCULARAUGMENTS, EFFECT_INJECTLARVA, HARVEST_GATHER, STOP, MOVE, BUILD_CREEPTUMOR, BUILD_CREEPTUMOR_QUEEN, BUILD_CREEPTUMOR_TUMOR } = require("@node-sc2/core/constants/ability");
const {
  GLIALRECONSTITUTION,
  ZERGGROUNDARMORSLEVEL1,
  ZERGGROUNDARMORSLEVEL2,
  ZERGMISSILEWEAPONSLEVEL1,
  ZERGMISSILEWEAPONSLEVEL2,
} = require("@node-sc2/core/constants/upgrade");
const { workerTypes, constructionAbilities } = require("@node-sc2/core/constants/groups");

const isSupplyNeeded = require("../helper/supply");

const {
  ability,
  build,
  train,
  upgrade,
} = taskFunctions;

const defend = require('../helper/defend');
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
const attack = require("../helper/attack");
const canAfford = require("../helper/can-afford");

const ATTACKFOOD = 194;
const RALLYFOOD = 31;
let supplyLost = 0;
let totalFoodUsed = 0;

const zerg = createSystem({
  name: 'Zerg',
  type: 'build',
  defaultOptions: {
    state: {
      buildComplete: false,
      paused: false,
      // buildComplete: true,
    }
  },
  buildOrder: [
    [13, train(OVERLORD)],
    [17, build(HATCHERY)],
    [17, build(EXTRACTOR)],
    [18, build(SPAWNINGPOOL)],
    [21, train(OVERLORD)],
    [21, train(QUEEN, 2)],
    [25, ability(RESEARCH_ZERGLINGMETABOLICBOOST)],
    [25, train(ZERGLING, 4)],
    [32, train(OVERLORD)],
    [34, ability(MORPH_LAIR)],
    [34, train(QUEEN)],
    [36, build(ROACHWARREN)],
    [35, train(OVERLORD)],
    [35, build(EVOLUTIONCHAMBER)],
    [38, train(OVERLORD)],
    [40, build(SPORECRAWLER, 2)],
    [42, upgrade(ZERGMISSILEWEAPONSLEVEL1)],
    [42, upgrade(GLIALRECONSTITUTION)],
    [42, build(EXTRACTOR, 2)],
    [42, train(ROACH)],
    [45, train(ROACH, 5)],
    [58, train(ROACH, 4)],
    [58, build(HATCHERY)],
    [68, build(EVOLUTIONCHAMBER)],
    [74, build(EXTRACTOR)],
    [78, upgrade(ZERGMISSILEWEAPONSLEVEL2)],
    [78, upgrade(ZERGGROUNDARMORSLEVEL1)],
    [78, build(HYDRALISKDEN)],
    [87, build(EXTRACTOR, 2)],
    [97, train(HYDRALISK, 2)],
    [101, ability(MORPH_OVERSEER)],
    [101, train(HYDRALISK, 4)],
    [105, train(HYDRALISK, 2)],
    [113, train(HYDRALISK, 2)],
    [119, ability(RESEARCH_GROOVEDSPINES)],
    [119, build(HYDRALISKDEN)],
    [120, upgrade(ZERGGROUNDARMORSLEVEL2)],
    [120, ability(RESEARCH_MUSCULARAUGMENTS)],
    [120, build(INFESTATIONPIT)],
    [120, train(ZERGLING, 6)],
    [121, upgrade(HIVE)],
    // [138, build(HYDRALISKDEN)],
    // [149, upgrade(ZERGGROUNDARMORSLEVEL2)],
    // [149, ability(RESEARCH_MUSCULARAUGMENTS)],
    // [165, build(INFESTATIONPIT)],
    // [164, build(HATCHERY)],
    // [164, train(QUEEN)],
    // [191, train(ZERGLING, 6)],
    // [200, upgrade(HIVE)],
  ],
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
    const { actions } = resources.get();
    let collectedActions = [];
    if (foodUsed >= 194) {
      collectedActions.push(...attack(resources))
    }
    await baseThreats(resources, this.state);
    if (this.state.rushDetected === true) {
      const unitTypes = [ZERGLING, ROACH, HYDRALISK];
      try { await continuouslyBuild(agent, data, resources, unitTypes); } catch (error) { console.log('continuouslyBuild error', error)}
    }
    if (this.state.defenseMode && foodUsed < ATTACKFOOD) {
      await defend(resources);
      const unitTypes = [ZERGLING, ROACH, HYDRALISK];
      await continuouslyBuild(agent, data, resources, unitTypes);
    }
    if (minerals > 512) {
      const unitTypes = [ZERGLING, ROACH, HYDRALISK];
      await continuouslyBuild(agent, data, resources, unitTypes);
    }
    if (foodUsed >= 122) {
      if (!shortOnWorkers(resources)) {
        await expand(agent, data, resources);
      } else {
        if (minerals <= 512) {
          try { await buildWorkers(agent, data, resources); } catch (error) { console.log(error); }
        }
      }
    }
    collectedActions.push(...inject(resources));
    await increaseSupply(agent, data, resources);
    if (totalFoodUsed > 42) {
      await maintainQueens(agent, data, resources);
    }
    collectedActions.push(...overlordCoverage(resources))
    if (!this.state.defenseMode && foodUsed < ATTACKFOOD && foodUsed >= RALLYFOOD) {
      await rallyUnits(agent, resources, []);
    }
    collectedActions.push(...await spreadCreep(resources));
    collectedActions.push(...shadowEnemy(resources, this.state));
    if (collectedActions.length > 0) {
      actions.sendAction(collectedActions);
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

function inject(resources) {
  const {
    actions,
    units,
  } = resources.get();
  const collectedActions = []
  // for each townhall, grab and label queen.
  const queen = units.withLabel('injector').find(injector => injector.energy >= 25 && injector.orders.length === 0);
  if (queen) {
    const [ townhall ] = units.getClosest(queen.pos, units.getClosest(queen.pos, units.getBases().filter(base => !base.buffIds.includes(11))));
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

module.exports = zerg;
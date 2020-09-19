//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { PYLON, ASSIMILATOR, NEXUS, ADEPT, GATEWAY, STALKER, VOIDRAY, STARGATE } = require("@node-sc2/core/constants/unit-type");
const { EFFECT_CHRONOBOOSTENERGYCOST, MOVE } = require("@node-sc2/core/constants/ability");
const { tryBuilding, abilityOrder, trainOrder, upgradeOrder } = require("../../helper/build");
const placementConfigs = require("../../helper/placement-configs");
const { Alliance } = require("@node-sc2/core/constants/enums");
const buildWorkers = require("../../helper/build-workers");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { WARPGATERESEARCH } = require("@node-sc2/core/constants/upgrade");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { attack } = require("../../helper/army-behavior");

let ATTACKFOOD = 34;
let mainCombatTypes = [ VOIDRAY ];
let supportUnitTypes = [ ADEPT, STALKER];

const proxyVoidRay = createSystem({
  name: "Proxy Void Ray",
  type: 'build',
    defaultOptions: {
    state: {
      buildComplete: false,
      proxyPosition: null,
    },
  },
  buildOrder: [
  ],
  async onStep({ agent, data, resources }) {
    const { foodUsed } = agent;
    const { actions, units } = resources.get();
    const collectedActions = [];
    if (foodUsed >= 12) { await actions.sendAction(await tryBuilding(agent, data, resources, this.state, 0, placementConfigs.PYLON, [ await getFirstPylonPosition(resources)])); }
    // add first pylon closer to nexus.
    if (foodUsed >= 13) { await actions.sendAction(await tryBuilding(agent, data, resources, this.state, 0, placementConfigs.GATEWAY)); }
    if (foodUsed == 14) { collectedActions.push(...await abilityOrder(data, resources, EFFECT_CHRONOBOOSTENERGYCOST, 1, NEXUS, NEXUS)); }
    if (foodUsed >= 14) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 0, placementConfigs.ASSIMILATOR)); }
    if (foodUsed >= 16) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 1, placementConfigs.ASSIMILATOR)); }
    if (units.getById(ASSIMILATOR).length === 2) { collectedActions.push(...await moveToProxy(resources, this.state, 0)) }
    if (foodUsed >= 18) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 0, placementConfigs.CYBERNETICSCORE)); }
    if (foodUsed >= 19) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 1, placementConfigs.PYLON, [ this.state.proxyPosition ])); }
    if (foodUsed >= 21) { await actions.sendAction(await tryBuilding(agent, data, resources, this.state, 0, placementConfigs.STARGATE, gridsInCircle(this.state.proxyPosition, 6.5))); }
    if (foodUsed == 21) { collectedActions.push(...await trainOrder(data, units, ADEPT)); }
    if (foodUsed == 23) { collectedActions.push(...await abilityOrder(data, resources, EFFECT_CHRONOBOOSTENERGYCOST, 1, NEXUS, GATEWAY)); }
    if (foodUsed >= 23) { collectedActions.push(...await upgradeOrder(data, resources, WARPGATERESEARCH)); }
    if (foodUsed >= 23) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 2, placementConfigs.PYLON, [ await getThirdPylonPosition(resources, this.state) ])); }
    if (foodUsed == 23) { collectedActions.push(...await trainOrder(data, units, STALKER)); }
    if (foodUsed == 25 && !this.state.pauseBuilding) { await buildWorkers(agent, data, resources); }
    if (foodUsed == 26) { collectedActions.push(...await trainOrder(data, units, VOIDRAY)); }
    if (foodUsed == 30) { collectedActions.push(...await abilityOrder(data, resources, EFFECT_CHRONOBOOSTENERGYCOST, 1, NEXUS, STARGATE)); }
    if (foodUsed >= 30) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 0, placementConfigs.SHIELDBATTERY, gridsInCircle(this.state.thirdPylonPosition, 6.5))); }
    if (foodUsed == 30) { collectedActions.push(...await trainOrder(data, units, VOIDRAY)); }
    if (foodUsed == 34) { collectedActions.push(...await abilityOrder(data, resources, EFFECT_CHRONOBOOSTENERGYCOST, 1, NEXUS, STARGATE)); }
    if (foodUsed >= 34) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 1, placementConfigs.SHIELDBATTERY, gridsInCircle(this.state.thirdPylonPosition, 6.5))); }
    if (foodUsed >= 34) { collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 2, placementConfigs.SHIELDBATTERY, gridsInCircle(this.state.thirdPylonPosition, 6.5))); }
    if (foodUsed == 34) { collectedActions.push(...await trainOrder(data, units, VOIDRAY)); }
    if (foodUsed < ATTACKFOOD) { collectedActions.push(...attack(resources, mainCombatTypes, supportUnitTypes)); }
    if (foodUsed >= ATTACKFOOD) { collectedActions.push(...attack(resources, mainCombatTypes, supportUnitTypes)); }
    // state proxy position.
    if (foodUsed < 21 && !this.state.pauseBuilding) { await buildWorkers(agent, data, resources); }
    await actions.sendAction(collectedActions);
  },
  async onUnitDamaged({agent, data, resources}, damagedUnit) {
    // near proxy position
    const collectedActions = [];
    if (distance(damagedUnit.pos, this.state.proxyPosition) < 6.5) {
      collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 2, placementConfigs.SHIELDBATTERY, gridsInCircle(damagedUnit.pos, 6.5)));
      collectedActions.push(...await tryBuilding(agent, data, resources, this.state, 3, placementConfigs.SHIELDBATTERY, gridsInCircle(damagedUnit.pos, 6.5)));
    }
    return collectedActions
  },
  async onUnitIdle({ resources }, idleUnit) {
    const {
      units
    } = resources.get();
    if (idleUnit.isWorker() && !idleUnit.labels.get('proxy')) {
      const { actions } = resources.get();
      if (units.getBases(Alliance.SELF).length > 0) {
        return actions.gather(idleUnit);
      }
    }
  },
})

async function defendProxyPosition() {
  // if marine starts attacking.
}

async function getProxyPosition(resources) {
  const { actions, map } = resources.get();
  const enemyMainPosition = map.getEnemyMain().townhallPosition;
  const [ proxyExpansion ] = map.getExpansions()
    .sort((a, b) => distance(a.townhallPosition, enemyMainPosition) - distance(b.townhallPosition, enemyMainPosition))
    .filter(expansion => distance(expansion.townhallPosition, map.getEnemyMain().townhallPosition) > 1 && distance(expansion.townhallPosition, map.getEnemyNatural().townhallPosition) > 1);
  const placementGrids = proxyExpansion.areas.placementGrid;
  const position = await actions.canPlace(PYLON, placementGrids);
  console.log(distance(position, proxyExpansion.townhallPosition));
  return position;
};

async function getFirstPylonPosition(resources) {
  const { actions, map } = resources.get();
  // get main position
  const main = map.getMain()
  const mainMineralLine = main.areas.mineralLine;
  const placementGrids = main.areas.placementGrid
    .filter(grid => {
      return (
        (distance(main.townhallPosition, grid) < 4.5) &&
        (mainMineralLine.every(mlp => distance(mlp, grid) > 1.5))
      )
    });
  return await actions.canPlace(PYLON, placementGrids);
}

async function getThirdPylonPosition(resources, state) {
  const { actions, map } = resources.get();
  // get near second pylon that's closer to enemy main
  const enemyMainPosition = map.getEnemyMain().townhallPosition;
  const placementGrids = gridsInCircle(state.proxyPosition, 13)
    .filter(grid => {
      return (
        distance(grid, enemyMainPosition) < distance(state.proxyPosition, enemyMainPosition)
      );
    })
  let position = await actions.canPlace(PYLON, placementGrids);
  state.thirdPylonPosition = position;
  return position;
}

async function moveToProxy(resources, state, targetCount) {
  const { map, units } = resources.get();
  const collectedActions = [];
  const label = 'proxy';
  const count = units.getWorkers().filter(unit => unit.labels.get(label)).length;
  if (count === targetCount) {
    if (units.getById(PYLON).length == 2) {
      state.proxyPosition = state.proxyPosition || units.getClosest(map.getEnemyMain().townhallPosition, units.getById(PYLON))[0].pos;
    }
    state.proxyPosition = state.proxyPosition ? state.proxyPosition : await getProxyPosition(resources);
    if (state.proxyPosition) {
      console.log('state.proxyPosition', state.proxyPosition);
      const [ proxyUnit ] = units.getClosest(state.proxyPosition, units.getWorkers());
      proxyUnit.labels.set(label, true);
      const unitCommand = {
        abilityId: MOVE,
        targetWorldSpacePos: state.proxyPosition,
        unitTags: [proxyUnit.tag]
      }
      collectedActions.push(unitCommand);
    }
  }
  return collectedActions;
}

module.exports = proxyVoidRay;
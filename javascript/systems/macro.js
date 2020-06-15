const { createSystem } = require('@node-sc2/core');
const { Alliance } = require('@node-sc2/core/constants/enums');
const { GasMineRace, SupplyUnitRace, WorkerRace } = require('@node-sc2/core/constants/race-map')
const { distance } = require('@node-sc2/core/utils/geometry/point');

const MINERAL_TO_GAS_RATIO = 2.4;

const macro = createSystem({
  name: 'macro',
  type: 'agent',
  async onStep({ agent, data, resources }) {
    const { actions, units } = resources.get();
    if (isSupplyNeeded(agent, data, units)) {
      await buildSupply(actions, agent, resources)
    }
    const idleDeficitTownhalls = units.getBases(Alliance.SELF).filter(townhall => {
      // check 
      deficitGasMines = units.getGasMines().filter(mine => mine.idealHarvesters - mine.assignedHarvesters > 0 && distance(townhall.pos, mine.pos) < 8.36);
      deficitMinerals = townhall.idealHarvesters - townhall.assignedHarvesters;
      return townhall.buildProgress >= 1 && townhall.noQueue && (deficitMinerals > 0 || deficitGasMines.length > 0);
    });
    if (idleDeficitTownhalls.length > 0) {
      return Promise.all(idleDeficitTownhalls.map(townhall => actions.train(WorkerRace[agent.race], townhall)));
    }
    if (balanceResources(agent, data, units)) {
      await buildGas(actions)
    }
  },
  async onUnitCreated({ resources }, newUnit) {
    const { actions, units } = resources.get();
    if (newUnit.isWorker()) {
      const mineralWorkers = units.getMineralWorkers().length;
      const gasWorkers = units.getWorkers().filter(worker => worker.labels.gasWorker);
      if (mineralWorkers / gasWorkers < MINERAL_TO_GAS_RATIO) {
        return actions.gather(newUnit);
      } else {
        deficitMines = units.getGasMines().filter(mine => mine.idealHarvesters - mine.assignedHarvesters > 0)
        if (deficitMines.length > 0) {
          closestDeficitMine = units.getClosest(newUnit.pos, deficitMines);
          newUnit.labels.set('gasWorker', true);
          return actions.mine(newUnit, closestDeficitMine);
        }
      }
    }
  },
  async onUnitFinished({ resources }, newBuilding) {
    if (newBuilding.isGasMine()) {
      const { units, actions } = resources.get();
      const threeWorkers = units.getClosest(newBuilding.pos, units.getMineralWorkers(), 3);
      threeWorkers.forEach(worker => worker.labels.set('gasWorker', true));
      return actions.mine(threeWorkers, newBuilding);
    }
  },
  async onUnitIdle({ resources }, idleUnit) {
    if (idleUnit.isWorker()) {
      const { actions } = resources.get();
      return actions.gather(idleUnit);
    }
  },
})

function balanceResources(agent, data, units) {
  const { minerals, vespene } = agent;
  resourceRatio = minerals / vespene;
  const gasUnitId = GasMineRace[agent.race]
  const buildAbilityId = data.getUnitTypeData(gasUnitId).abilityId;
  
  const conditions = [
    resourceRatio > MINERAL_TO_GAS_RATIO,
    agent.canAfford(gasUnitId),
    units.withCurrentOrders(buildAbilityId).length <= 0
  ];
  if (conditions.every(c => c)) {
    return true
  } else {
    return false
  }
}

async function buildGas(actions) {
  await actions.buildGasMine();
}

async function buildSupply(actions, agent, resources) {
  const { map } = resources.get();
  const supplyUnitId = SupplyUnitRace[agent.race];
  const myExpansions = map.getOccupiedExpansions(Alliance.SELF);
  const randomExpansion = myExpansions[Math.floor(Math.random() * myExpansions.length)];
  const mainMineralLine = randomExpansion.areas.mineralLine;
  const geysers = randomExpansion.cluster.vespeneGeysers;
  const locations = randomExpansion.areas.areaFill.filter((point) => {
    return (
      // far enough away to stay outta the mineral line
      (mainMineralLine.every(mlp => distance(mlp, point) > 2)) &&
      // far enough away from gas line
      (geysers.every(gp => distance(gp.pos, point) > 3))
    );
  });
  // pick 10 random positions from the list
  const randomPositions = locations
    .map(pos => ({ pos, rand: Math.random() }))
    .sort((a, b) => a.rand - b.rand)
    .map(a => a.pos)
    .slice(0, 20);
  // see if any of them are good
  const foundPosition = await actions.canPlace(supplyUnitId, randomPositions);
  if (foundPosition) {
      await actions.build(supplyUnitId, foundPosition);
  }
}

function isSupplyNeeded(agent, data, units) {
  const { foodCap, foodUsed } = agent;
  const supplyUnitId = SupplyUnitRace[agent.race];
  const buildAbilityId = data.getUnitTypeData(supplyUnitId).abilityId;
  const pendingSupply = (
    (units.inProgress(supplyUnitId).length * 8) + 
    (units.withCurrentOrders(buildAbilityId).length * 8)
  );
  const pendingSupplyCap = foodCap + pendingSupply;
  const supplyLeft = foodCap - foodUsed; 
  const pendingSupplyLeft = supplyLeft + pendingSupply;
  const conditions = [
    pendingSupplyLeft < pendingSupplyCap * 0.2,
    !(foodCap == 200),
    agent.canAfford(supplyUnitId), // can afford to build a pylon
    units.withCurrentOrders(buildAbilityId).length <= 0
  ];
  if (conditions.every(c => c)) {
    return true
  } else {
    return false
  }
}


module.exports = macro;
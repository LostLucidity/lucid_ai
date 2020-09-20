//@ts-check
"use strict"

const { distance, distanceX, distanceY } = require("@node-sc2/core/utils/geometry/point");
const { Alliance, Race } = require('@node-sc2/core/constants/enums');
const { PYLON, ASSIMILATOR } = require("@node-sc2/core/constants/unit-type");
const { getOccupiedExpansions } = require("./expansions");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");

module.exports = {
  abilityOrder: async (data, resources, abilityId, targetCount, unitTypes, unitTypeTarget) => {
    const collectedActions = [];
    const { actions, units } = resources.get();
    if (typeof targetCount !== 'undefined') {
      if (units.getById(unitTypes).length !== targetCount) {
        return collectedActions;
      } 
    }
    let canDoTypes = data.findUnitTypesWithAbility(abilityId);
    if (canDoTypes.length === 0) {
      canDoTypes = units.getAlive(Alliance.SELF).filter(unit => unit.abilityAvailable(abilityId)).map(canDoUnit => canDoUnit.unitType);
    }
    const unitsCanDo = units.getByType(canDoTypes).filter(u => u.abilityAvailable(abilityId));
    let unitCanDo = unitsCanDo[Math.floor(Math.random() * unitsCanDo.length)];
    if (unitCanDo) {
      const unitCommand = { abilityId, unitTags: [unitCanDo.tag] }
      if (unitTypeTarget) {
        const [ target ] = units.getById(unitTypeTarget);
        unitCommand.targetUnitTag = target.tag;
      }
      collectedActions.push(unitCommand);
    }
    return collectedActions;
  },
  checkBuildingCount: (agent, data, resources, targetCount, placementConfig) => {
    const { race } = agent;
    const { units } = resources.get();
    const buildAbilityId = data.getUnitTypeData(placementConfig.toBuild).abilityId;
    let count = units.withCurrentOrders(buildAbilityId).length;
    placementConfig.countTypes.forEach(type => {
      let unitsToCount = units.getById(type);
      if (race === Race.TERRAN) {
        unitsToCount = unitsToCount.filter(unit => unit.buildProgress >= 1);
      }
      count += unitsToCount.length;
    });
    return count === targetCount;
  },
  buildBuilding: async (agent, data, resources, placementConfig, candidatePositions) => {
    const {
      actions,
      units,
    } = resources.get();
    const collectedActions = [];
    // find placement on main
    if (agent.canAfford(placementConfig.toBuild)) {
      const foundPosition = await findPosition(actions, placementConfig.placement, candidatePositions);
      if (foundPosition) {
        const builders = [
          ...units.getMineralWorkers(),
          ...units.getWorkers().filter(w => w.noQueue),
          ...units.withLabel('builder').filter(w => !w.isConstructing()),
          ...units.withLabel('proxy').filter(w => !w.isConstructing()),
        ];
        const [ builder ] = units.getClosest(foundPosition, builders);
        if (builder) {
          const unitCommand = {
            abilityId: data.getUnitTypeData(placementConfig.toBuild).abilityId,
            unitTags: [builder.tag],
            targetWorldSpacePos: foundPosition,
          };
          collectedActions.push(unitCommand);
        }
      }
    }
    return collectedActions;
  },
  findPlacements: (agent, resources, placementConfig) => {
    const { race } = agent;
    const { map, units } = resources.get();
    const [main, natural] = map.getExpansions();
    const mainMineralLine = main.areas.mineralLine;
    let placements = [];
    if (race === Race.PROTOSS) {
      if (placementConfig.toBuild === PYLON) {
        placements = [...main.areas.placementGrid, ...natural.areas.placementGrid]
          .filter((point) => {
            return (
              (distance(natural.townhallPosition, point) > 4.5) &&
              (mainMineralLine.every(mlp => distance(mlp, point) > 1.5)) &&
              (natural.areas.hull.every(hp => distance(hp, point) > 3)) &&
              (units.getStructures({ alliance: Alliance.SELF })
                .map(u => u.pos)
                .every(eb => distance(eb, point) > 3))
            );
          });
      } else {
        const pylonsNearProduction = units.getById(PYLON)
          .filter(u => u.buildProgress >= 1)
          .filter(pylon => distance(pylon.pos, main.townhallPosition) < 50);
        pylonsNearProduction.forEach(pylon => {
          placements.push(...gridsInCircle(pylon.pos, 6.5));
        })
        // getOccupiedExpansions(resources).forEach(expansion => {
        //   placements.push(...expansion.areas.placementGrid);
        // });
        placements.filter((point) => {
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
      }
    } else if (race === Race.TERRAN) {
      // placements = main.areas.placementGrid
      //   .filter((point) => {
      //     return (
      //       (mainMineralLine.every((mlp) => {
      //         return ((distanceX(mlp, point) >= 5 || distanceY(mlp, point) >= 1.5)); // for addon room
      //       })) &&
      //       (main.areas.hull.every((hp) => {
      //         return ((distanceX(hp, point) >= 3.5 || distanceY(hp, point) >= 1.5));
      //       })) &&
      //       (units.getStructures({ alliance: Alliance.SELF })
      //         .map(u => u.pos)
      //         .every((eb) => {
      //           return (
      //             (distanceX(eb, point) >= 5 || distanceY(eb, point) >= 3) // for addon room
      //           );
      //         })
      //       )
      //     );
      // });
      const placementGrids = [];
      getOccupiedExpansions(resources).forEach(expansion => {
        placementGrids.push(...expansion.areas.placementGrid);
      });
      const randomPositions = placementGrids
        .map(pos => ({ pos, rand: Math.random() }))
        .sort((a, b) => a.rand - b.rand)
        .map(a => a.pos)
        .slice(0, 20); 
    } else if (race === Race.ZERG) {
      placements = map.getCreep()
        .filter((point) => {
          return (
            (mainMineralLine.every(mlp => distance(mlp, point) > 1.5)) &&
            (units.getStructures({ alliance: Alliance.SELF })
              .map(u => u.pos)
              .every(eb => distance(eb, point) > 3))
          );
        });
    }
    return placements;
  },
  trainOrder(data, units, unitType) {
    const collectedActions = [];
    const [ trainer ] = units.getProductionUnits(unitType).filter(unit => unit.noQueue);
    if (trainer) {
      const abilityId = data.getUnitTypeData(unitType).abilityId;
      const unitCommand = {
        abilityId,
        unitTags: [ trainer.tag ],
      }
      collectedActions.push(unitCommand);
    }
    return collectedActions;
  },
  async tryBuilding(agent, data, resources, state, targetCount, placementConfig, candidatePositions) {
    const { actions } = resources.get()
    const collectedActions = [];
    if (module.exports.checkBuildingCount(agent, data, resources, targetCount, placementConfig)) {
      if (placementConfig.toBuild === ASSIMILATOR) { await actions.buildGasMine() } 
      else {
        if (!candidatePositions) { candidatePositions = module.exports.findPlacements(agent, resources, placementConfig) }
        collectedActions.push(...await module.exports.buildBuilding(agent, data, resources, placementConfig, candidatePositions));
        state.pauseBuilding = collectedActions.length === 0;
      }
    }
    return collectedActions;
  },
  async upgradeOrder(data, resources, upgradeId, sendNow=false) {
    const {
      actions,
      units,
    } = resources.get();
    const collectedActions = [];
    const { abilityId } = data.getUpgradeData(upgradeId);
    const upgrader = units.getUpgradeFacilities(upgradeId).find(u => u.noQueue && u.availableAbilities(abilityId));
    if (upgrader) {
      const unitCommand = { abilityId, unitTags: [upgrader.tag] };
      if (sendNow) {
        await actions.sendAction(unitCommand);
      } else {
        collectedActions.push(unitCommand);
      }
    }
    return collectedActions;
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
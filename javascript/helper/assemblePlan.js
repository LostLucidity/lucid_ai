//@ts-check
"use strict"

const { ASSIMILATOR, PYLON } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getOccupiedExpansions } = require("./expansions");
const placementConfigs = require("./placement-configs");
const { Alliance, Race } = require('@node-sc2/core/constants/enums');
const { frontOfGrid } = require("@node-sc2/core/utils/map/region");
const buildWorkers = require("./build-workers");

let actions;
let race;

class AssemblePlan {
  constructor(plan) {
    this.plan = plan;
  }
  onGameStart(world) {
    actions = world.resources.get().actions;
    race = world.agent.race;
  }
  onStep(world, state) {
    this.collectedActions = [];
    this.state = state;
    this.units = world.resources.get().units;
    this.resources = world.resources;
    this.world = world;
    this.runPlan();
  }
  async ability(food, abilityId, targetCount, unitTypes, unitTypeTarget) {
    if (foodUsed == food)
    const collectedActions = [];
    const { units } = this.resources.get();
    if (typeof targetCount !== 'undefined') {
      if (units.getById(unitTypes).length !== targetCount) {
        return collectedActions;
      } 
    }
    let canDoTypes = this.world.data.findUnitTypesWithAbility(abilityId);
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
  }
  async build(food, unitType, targetCount, candidatePositions) {
    const { actions } = this.world.resources.get();
    const { foodUsed } = this.world.agent;
    const placementConfig = placementConfigs[unitType];
    if (foodUsed > food) {
      if (this.checkBuildingCount(targetCount, placementConfig)) {
        if (placementConfigs[unitType].toBuild === ASSIMILATOR) { await actions.buildGasMine() } 
        else {
          if (!candidatePositions) { candidatePositions = this.findPlacements(placementConfig) }
          this.collectedActions.push(...await this.buildBuilding(placementConfig, candidatePositions));
          this.state.pauseBuilding = this.collectedActions.length === 0;
        }
      }
    }
  }
  async buildWorkers() {
    try { await buildWorkers(this.world.agent, this.world.data, this.world.resources); } catch(error) { console.log(error); }
  }
  async buildBuilding(placementConfig, candidatePositions) {
    const collectedActions = [];
    // find placement on main
    if (this.world.agent.canAfford(placementConfig.toBuild)) {
      const foundPosition = await this.findPosition(actions, placementConfig.placement, candidatePositions);
      if (foundPosition) {
        const builders = [
          ...this.units.getMineralWorkers(),
          ...this.units.getWorkers().filter(w => w.noQueue),
          ...this.units.withLabel('builder').filter(w => !w.isConstructing()),
          ...this.units.withLabel('proxy').filter(w => !w.isConstructing()),
        ];
        const [ builder ] = this.units.getClosest(foundPosition, builders);
        if (builder) {
          const unitCommand = {
            abilityId: this.world.data.getUnitTypeData(placementConfig.toBuild).abilityId,
            unitTags: [builder.tag],
            targetWorldSpacePos: foundPosition,
          };
          collectedActions.push(unitCommand);
        }
      }
    }
    return collectedActions;
  }
  checkBuildingCount(targetCount, placementConfig) {
    const buildAbilityId = this.world.data.getUnitTypeData(placementConfig.toBuild).abilityId;
    let count = this.units.withCurrentOrders(buildAbilityId).length;
    placementConfig.countTypes.forEach(type => {
      let unitsToCount = this.units.getById(type);
      if (race === Race.TERRAN) {
        unitsToCount = unitsToCount.filter(unit => unit.buildProgress >= 1);
      }
      count += unitsToCount.length;
    });
    return count === targetCount;
  }
  findPlacements(placementConfig) {
    const { map } = this.world.resources.get();
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
              (this.units.getStructures({ alliance: Alliance.SELF })
                .map(u => u.pos)
                .every(eb => distance(eb, point) > 3))
            );
          });
      } else {
        const pylonsNearProduction = this.units.getById(PYLON)
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
            (this.units.getStructures({ alliance: Alliance.SELF })
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
      getOccupiedExpansions(this.world.resources).forEach(expansion => {
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
            (this.units.getStructures({ alliance: Alliance.SELF })
              .map(u => u.pos)
              .every(eb => distance(eb, point) > 3))
          );
        });
    }
    return placements;
  }
  findSupplyPositions() {
    const { map } = this.resources.get();
    const myExpansions = map.getOccupiedExpansions(Alliance.SELF);
    // front of natural pylon for great justice
    const naturalWall = map.getNatural().getWall();
    let possiblePlacements = frontOfGrid(this.world, map.getNatural().areas.areaFill)
        .filter(point => naturalWall.every(wallCell => (
            (distance(wallCell, point) <= 6.5) &&
            (distance(wallCell, point) >= 3)
        )));
  
    if (possiblePlacements.length <= 0) {
        possiblePlacements = frontOfGrid(this.resources, map.getNatural().areas.areaFill)
            .map(point => {
                point.coverage = naturalWall.filter(wallCell => (
                    (distance(wallCell, point) <= 6.5) &&
                    (distance(wallCell, point) >= 1)
                )).length;
                return point;
            })
            .sort((a, b) => b.coverage - a.coverage)
            .filter((cell, i, arr) => cell.coverage === arr[0].coverage);
    }
  
    return possiblePlacements;
  }
  async findPosition(actions, unitType, candidatePositions) {
    const randomPositions = candidatePositions
      .map(pos => ({ pos, rand: Math.random() }))
      .sort((a, b) => a.rand - b.rand)
      .map(a => a.pos)
      .slice(0, 20);
    return await actions.canPlace(unitType, randomPositions);
  }
  async runPlan() {
    for (let step = 0; step < this.plan.length; step++) {
      const planStep = this.plan[step];
      const targetCount = planStep[3];
      const foodTarget = planStep[0];
      const unitType = planStep[2];
      await this[planStep[1]](foodTarget, unitType, targetCount, planStep[4] ? this[planStep[4]]() : null);
    }
    await actions.sendAction(this.collectedActions);
  }
}

module.exports = AssemblePlan;
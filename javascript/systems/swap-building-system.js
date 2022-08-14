//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Ability } = require("@node-sc2/core/constants");
const { liftingAbilities, landingAbilities } = require("@node-sc2/core/constants/groups");
const { BARRACKS, REACTOR } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getAddOnBuildingPosition } = require("../helper/placement/placement-utilities");
const planService = require("../services/plan-service");
const sharedService = require("../services/shared-service");
const { repositionBuilding } = require("../services/world-service");
const { setPendingOrders } = require("./unit-resource/unit-resource-service");

module.exports = createSystem({
  name: 'SwapBuildingSystem',
  type: 'agent',
  async onStep(world) {
    const collectedActions = [];
    const { actions, units } = world.resources.get();
    sharedService.removePendingOrders(units);
    const swapBuildings = units.withLabel('swapBuilding');
    for (let step = 0; step < swapBuildings.length; step++) {
      const building = swapBuildings[step];
      if (building.availableAbilities().find(ability => liftingAbilities.includes(ability)) && !building.labels.has('pendingOrders')) {
        if (distance(building.pos, building.labels.get('swapBuilding')) > 1) {
          const unitCommand = {
            abilityId: Ability.LIFT,
            unitTags: [building.tag],
          }
          await actions.sendAction(unitCommand);
          setPendingOrders(building, unitCommand);
        } else {
          building.labels.delete('swapBuilding');
        }
      }
      if (building.availableAbilities().find(ability => landingAbilities.includes(ability))) {
        const unitCommand = {
          abilityId: Ability.LAND,
          unitTags: [building.tag],
          targetWorldSpacePos: building.labels.get('swapBuilding')
        }
        await actions.sendAction(unitCommand);
        planService.pausePlan = false;
        setPendingOrders(building, unitCommand);
      }
    }
    collectedActions.push(...setReposition(world));
    collectedActions.push(...repositionBuilding(world));
    if (collectedActions.length > 0) {
      await actions.sendAction(collectedActions);
    }
  }
});

/**
 * @param {World} world 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function setReposition(world) {
  const { data, resources } = world;
  const { units } = resources.get();
  const collectedActions = [];
  // check if there are any orphan reactors
  const liftableNoAddOnBarracks = units.getById(BARRACKS).filter(unit => {
    return !unit.hasTechLab() && !unit.hasReactor() && unit.availableAbilities().find(ability => liftingAbilities.includes(ability));
  });
  const orphanReactors = units.getById(REACTOR).filter(reactor =>!reactor.labels.has('reposition'));
  if (orphanReactors.length > 0) {
    liftableNoAddOnBarracks.forEach(unit => {
      const { orders, pos, unitType } = unit;
      if (orders === undefined || pos === undefined || unitType === undefined) return;
      if (unitType === BARRACKS) {
        // find closest orphan reactor
        const closestReactor = orphanReactors.reduce((/** @type {Unit | undefined} */ closest, reactor) => {
          if (reactor.pos === undefined) return closest;
          const distanceToReactor = distance(pos, reactor.pos);
          if (closest === undefined || closest.pos === undefined) return reactor;
          const distanceToClosest = distance(pos, closest.pos);
          if (closest === undefined || distanceToReactor < distanceToClosest) {
            return reactor;
          }
          return closest;
        }, undefined);
        if (closestReactor !== undefined) {
          // add reposition label to unit
          unit.labels.set('reposition', getAddOnBuildingPosition(closestReactor.pos));
          closestReactor.labels.set('reposition', unit.tag);
        }
      }
    });
  }
  return collectedActions;
}
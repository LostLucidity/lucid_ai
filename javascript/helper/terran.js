//@ts-check
"use strict"

const { UnitType, UnitTypeId } = require("@node-sc2/core/constants");
const Ability = require("@node-sc2/core/constants/ability");
const { EFFECT_SCAN, CANCEL_QUEUECANCELTOSELECTION } = require("@node-sc2/core/constants/ability");
const { liftingAbilities, landingAbilities, townhallTypes, rallyWorkersAbilities, addonTypes } = require("@node-sc2/core/constants/groups");
const { ORBITALCOMMAND } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { checkAddOnPlacement } = require("../builds/terran/swap-buildings");
const loggingService = require("../services/logging-service");
const { addEarmark } = require("../services/plan-service");
const planService = require("../services/plan-service");
const { setPendingOrders } = require("../services/units-service");
const { checkBuildingCount } = require("../services/world-service");
const { getAvailableExpansions } = require("./expansions");
const { getClosestPosition } = require("./get-closest");
const { countTypes, flyingTypesMapping } = require("./groups");
const { getAddOnPlacement, getAddOnBuildingPosition } = require("./placement/placement-utilities");

const terran = {
  /**
   * Adds addon, with placement checks and relocating logic.
   * @param {World} world 
   * @param {Unit} unit 
   * @param {UnitTypeId} addOnType 
   * @returns {Promise<void>}
   */
  addAddOn: async (world, unit, addOnType) => {
    const { agent, data, resources } = world;
    const { actions, frame, map } = resources.get();
    const unitTypeToBuild = UnitType[`${UnitTypeId[flyingTypesMapping.get(unit.unitType) || unit.unitType]}${UnitTypeId[addOnType]}`];
    let { abilityId } = data.getUnitTypeData(unitTypeToBuild);
    if (unit.noQueue && !unit.labels.has('swapBuilding')) {
      if (unit.availableAbilities().some(ability => ability === abilityId)) {
        const unitCommand = {
          abilityId,
          unitTags: [unit.tag]
        }
        if (map.isPlaceableAt(addOnType, getAddOnPlacement(unit.pos))) {
          unitCommand.targetWorldSpacePos = unit.pos;
          await actions.sendAction(unitCommand);
          planService.pausePlan = false;
          loggingService.setAndLogExecutedSteps(agent, frame.timeInSeconds(), UnitTypeId[addOnType]);
          setPendingOrders(unit, unitCommand);
          addEarmark(data, data.getUnitTypeData(addOnType));
          return;
        }
      }
      if (unit.availableAbilities().find(ability => liftingAbilities.includes(ability)) && !unit.labels.has('pendingOrders')) {
        const addOnPosition = unit.labels.get('addAddOn');
        if (addOnPosition && distance(getAddOnPlacement(unit.pos), addOnPosition) < 1) {
          unit.labels.delete('addAddOn');
        } else {
          const unitCommand = {
            abilityId: Ability.LIFT,
            unitTags: [unit.tag],
          }
          await actions.sendAction(unitCommand);
          setPendingOrders(unit, unitCommand);
        }
      }
      if (unit.availableAbilities().find(ability => landingAbilities.includes(ability))) {
        const foundPosition = await checkAddOnPlacement(world, unit, addOnType);
        if (foundPosition) {
          unit.labels.set('addAddOn', foundPosition);
          const unitCommand = {
            abilityId: abilityId,
            unitTags: [unit.tag],
            targetWorldSpacePos: foundPosition
          }
          await actions.sendAction(unitCommand);
          planService.pausePlan = false;
          loggingService.setAndLogExecutedSteps(agent, frame.timeInSeconds(), UnitTypeId[addOnType]);
          setPendingOrders(unit, unitCommand);
          addEarmark(data, addOnType);
        }
      }
    }
  },
  liftToThird: async (resources) => {
    const { actions, map, units } = resources.get();
    const label = 'liftToThird';
    let [liftToThird] = units.withLabel(label);
    if (!liftToThird) {
      [liftToThird] = units.getById(townhallTypes).filter(base => {
        const [closestTownhallPosition] = getClosestPosition(base.pos, map.getExpansions().map(expansion => expansion.townhallPosition));
        return distance(base.pos, closestTownhallPosition) > 1 || base.isFlying;
      })
      if (liftToThird) {
        liftToThird.labels.set('liftToThird');
      }
    } else {
      const [position] = getAvailableExpansions(resources).map(expansion => ({ expansion, distance: distance(liftToThird.pos, expansion.townhallPosition) }))
        .sort((a, b) => a.distance - b.distance)
        .map(u => u.expansion.townhallPosition)
        .slice(0, 1);
      if (position) {
        const [closestTownhallPosition] = getClosestPosition(liftToThird.pos, map.getExpansions().map(expansion => expansion.townhallPosition));
        const rallyAbility = rallyWorkersAbilities.find(ability => liftToThird.abilityAvailable(ability));
        if (distance(liftToThird.pos, closestTownhallPosition) < 1 && rallyAbility) {
          liftToThird.labels.clear();
          const [mineralFieldTarget] = units.getClosest(liftToThird.pos, units.getMineralFields());
          await actions.sendAction({
            abilityId: rallyAbility,
            targetUnitTag: mineralFieldTarget.tag,
            unitTags: [liftToThird.tag]
          });
        } else {
          if (liftToThird.noQueue) {
            if (liftToThird.abilityAvailable(CANCEL_QUEUECANCELTOSELECTION)) {
              const unitCommand = {
                abilityId: CANCEL_QUEUECANCELTOSELECTION,
                unitTags: [liftToThird.tag],
              }
              await actions.sendAction(unitCommand);
            }
            if (liftToThird.availableAbilities().find(ability => liftingAbilities.includes(ability))) { await actions.do(Ability.LIFT, liftToThird.tag); }
            if (liftToThird.availableAbilities().includes(Ability.MOVE)) { await actions.move([liftToThird], position, true); }
            if (liftToThird.availableAbilities().find(ability => landingAbilities.includes(ability))) { await actions.do(Ability.LAND, liftToThird.tag, { target: position, queue: true }); }
          }
        }
      }
    }
  },
  scanCloakedEnemy: (units, target, selfUnits) => {
    const collectedActions = []
    if (target.cloak === 1) {
      let position = null;
      if (target.cloak === 1) {
        const [closestToCloak] = units.getClosest(target.pos, selfUnits);
        if (distance(closestToCloak.pos, target.pos) < 8) {
          position = target.pos;
        }
        const orbitalCommand = units.getById(ORBITALCOMMAND).find(n => n.energy > 50);
        if (position && orbitalCommand) {
          const unitCommand = {
            abilityId: EFFECT_SCAN,
            targetWorldSpacePos: position,
            unitTags: [orbitalCommand.tag],
          }
          collectedActions.push(unitCommand);
        }
      }
    }
    return collectedActions;
  },
  swapBuildings: async (world, conditions = []) => {
    // get first building, if addon get building offset
    const { actions, units } = world.resources.get();
    const label = 'swapBuilding';
    let buildingsToSwap = [...conditions].map((condition, index) => {
      const addOnValue = `addOn${index}`;
      const unitType = condition[0];
      let [building] = units.withLabel(label).filter(unit => unit.labels.get(label) === index);
      if (!checkBuildingCount(world, unitType, condition[1]) && !building) { return };
      let [addOn] = units.withLabel(label).filter(unit => unit.labels.get(label) === addOnValue);
      if (!building) {
        if (addonTypes.includes(unitType)) {
          [addOn] = addOn ? [addOn] : units.getById(unitType).filter(unit => unit.buildProgress >= 1);
          const [building] = addOn ? units.getClosest(getAddOnBuildingPosition(addOn.pos), units.getStructures()) : [];
          if (addOn && building) {
            addOn.labels.set(label, addOnValue);
            building.labels.set(label, index);
            return building;
          }
        } else {
          const [building] = units.getById(countTypes.get(unitType)).filter(unit => unit.noQueue && (unit.addOnTag === '0' || unit.addOnTag === 0) && unit.buildProgress >= 1);
          if (building) {
            building.labels.set(label, index);
            return building;
          }
        }
      } else {
        return building;
      }
    });
    if (buildingsToSwap.every(building => building)) {
      if (buildingsToSwap.every(building => building.noQueue && !building.labels.has('pendingOrders'))) {
        if (buildingsToSwap.some(building => building.availableAbilities().find(ability => liftingAbilities.includes(ability)))) {
          await actions.do(Ability.LIFT, buildingsToSwap[0].tag);
          await actions.do(Ability.LIFT, buildingsToSwap[1].tag);
        }
        if (buildingsToSwap.every(building => building.availableAbilities().find(ability => landingAbilities.includes(ability)))) {
          await actions.do(Ability.LAND, buildingsToSwap[0].tag, { target: buildingsToSwap[1].pos });
          await actions.do(Ability.LAND, buildingsToSwap[1].tag, { target: buildingsToSwap[0].pos });
        }
      }
      terran.removeLabelsWhenInTargetRange(units.withLabel(label), label);
    } else {
      units.withLabel(label).forEach((building) => {
        building.labels.delete(label);
      });
    }
  },
  removeLabelsWhenInTargetRange: (buildings, label) => {
    buildings.forEach((building) => {
      if (building.orders.length > 0) {
        const foundOrder = building.orders.find(order => landingAbilities.includes(order.abilityId));
        if (foundOrder && foundOrder.targetWorldSpacePos && distance(building.pos, foundOrder.targetWorldSpacePos) < 1) {
          console.log('remove label', label);
          building.labels.delete(label);
        }
      }
    });
  },
}

module.exports = terran;
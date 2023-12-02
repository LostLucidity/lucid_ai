//@ts-check
"use strict";

// External library imports
const { UnitType } = require("@node-sc2/core/constants");

// Internal module imports
const { hasAddOn } = require("./buildingSharedUtils");
const { getAddOnPlacement } = require("./placementUtils");
const { canLiftOff } = require("./unitConfig");


/**
 * @param {World} world
 * @param {Unit} unit 
 * @param {boolean} logCondition
 * @returns {Point2D | undefined}
 */
function findBestPositionForAddOn(world, unit, logCondition = false) {
  const { resources } = world;
  const { map } = resources.get();
  const { isFlying, pos } = unit; if (isFlying === undefined || pos === undefined) return undefined;

  // use logCondition to log the reason why the function returned undefined
  if (logCondition) {
    console.log(`findBestPositionForAddOn: ${unit.unitType} ${unit.tag} ${unit.isFlying ? 'is flying' : 'is grounded'} and ${unit.isIdle() ? 'is idle' : 'is busy'} and ${hasAddOn(unit) ? 'has an add-on' : 'does not have an add-on'}`);
  }

  // Scenario 0: The building is idle, doesn't have an add-on, and is flying.
  if (unit.isIdle() && !hasAddOn(unit) && isFlying) {
    const landingSpot = this.checkAddOnPlacement(world, unit);
    if (landingSpot !== undefined) {
      // If a suitable landing spot is available, return it
      return landingSpot;
    } else {
      // If no suitable landing spot is available, we can't handle this scenario
      return undefined;
    }
  }

  // Scenario 1: The building is idle, doesn't have an add-on, and is grounded.
  if (unit.isIdle() && !hasAddOn(unit) && !isFlying) {
    const addonPosition = getAddOnPlacement(pos); // get the position where the add-on would be built
    if (map.isPlaceableAt(UnitType.REACTOR, addonPosition)) { // check if the add-on can be placed there
      return undefined; // The building is idle and can build an add-on, return null and check it again later.
    }
  }

  // Scenario 2: The building is busy but will become idle after current action.
  if (!unit.isIdle() && !hasAddOn(unit)) {
    // Here, it depends on the urgency of the add-on and your strategy
    // You might wait for the unit to be idle or cancel the current action
    // Then, it becomes Scenario 1 again.
    // For simplicity, we assume we wait until it's idle and can use the same logic to find position
    return undefined; // The building is currently busy, return null and check it again later.
  }

  // Scenario 3: The building is under construction.
  if (unit.buildProgress !== undefined && unit.buildProgress < 1) {
    // The building is still being constructed, so it cannot build an add-on yet.
    // Similar to Scenario 2, we will check it again later.
    return undefined;
  }

  // Scenario 4: The building already has an add-on.
  if (hasAddOn(unit)) {
    // Find a suitable landing spot
    const landingSpot = this.checkAddOnPlacement(world, unit);
    if (logCondition) {
      console.log(`findBestPositionForAddOn: ${unit.unitType} ${unit.tag} has an add-on and ${landingSpot ? 'has a suitable landing spot' : 'does not have a suitable landing spot'}`);
    }
    if (landingSpot !== undefined) {
      // If a suitable landing spot is available, return it
      return landingSpot;
    } else {
      // If no suitable landing spot is available, we can't handle this scenario
      return undefined;
    }
  }

  // Scenario 5: The building can lift off and there is a nearby location with enough space.
  if (canLiftOff(unit)) {
    // You will have to define the function findNearbyLocationWithSpace()
    // which finds a nearby location with enough space for the building and an add-on.
    const newLocation = this.checkAddOnPlacement(world, unit);
    if (newLocation) {
      // In this case, you will want to move your unit to the new location before building the add-on.
      // You might want to store this information (that the unit needs to move before building the add-on) somewhere.
      return newLocation;
    }
  }

  // If no suitable position was found, return null
  return undefined;
}

// Export the functions to be used in other modules
module.exports = {
  findBestPositionForAddOn,
};

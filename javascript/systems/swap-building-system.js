//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Ability, UnitType } = require("@node-sc2/core/constants");
const { liftingAbilities, landingAbilities } = require("@node-sc2/core/constants/groups");
const { BARRACKS, REACTOR } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getAddOnBuildingPosition, getAddOnBuildingPlacement } = require("../helper/placement/placement-utilities");
const planService = require("../services/plan-service");
const { setPendingOrders } = require("../services/unit-service");
const { repositionBuilding } = require("../services/world-service");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const groupTypes = require("@node-sc2/core/constants/groups");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { pointsOverlap } = require("../helper/utilities");
const unitResourceService = require("./unit-resource/unit-resource-service");
const { getDistance } = require("../services/position-service");

module.exports = createSystem({
  name: 'SwapBuildingSystem',
  type: 'agent',
  async onStep(world) {
    const { actions, units } = world.resources.get();
    const swapBuildings = units.withLabel('swapBuilding');

    /**
     * @param {Unit} building
     * @param {AbilityId[]} abilities
     * @returns {boolean}
     */
    function hasAbility(building, abilities) {
      return building.availableAbilities().some(ability => abilities.includes(ability)) && !building.labels.has('pendingOrders');
    }

    /**
     * @param {Unit} building
     * @returns {Promise<void>}
     */
    async function liftBuilding(building) {
      const { pos, tag } = building; if (pos === undefined || tag === undefined) return;
      if (hasAbility(building, liftingAbilities) && distance(pos, building.labels.get('swapBuilding')) > 1) {
        const unitCommand = {
          abilityId: Ability.LIFT,
          unitTags: [tag],
        }
        await actions.sendAction(unitCommand);
        setPendingOrders(building, unitCommand);
      } else {
        building.labels.delete('swapBuilding');
      }
    }

    /**
     * @param {Unit} building
     * @returns {Promise<void>}
     */
    async function landBuilding(building) {
      if (hasAbility(building, landingAbilities)) {
        const { tag } = building; if (tag === undefined) return;
        const unitCommand = {
          abilityId: Ability.LAND,
          unitTags: [tag],
          targetWorldSpacePos: building.labels.get('swapBuilding')
        }
        await actions.sendAction(unitCommand);
        planService.pausePlan = false;
        setPendingOrders(building, unitCommand);
      }
    }

    // Execute lift and land actions
    for (let step = 0; step < swapBuildings.length; step++) {
      const building = swapBuildings[step];
      await liftBuilding(building);
      await landBuilding(building);
    }

    const addOnUnits = units.withLabel('addAddOn').filter(unit => unit.pos !== undefined && unit.labels.has('addAddOn') && distance(unit.pos, unit.labels.get('addAddOn')) < 1);

    // Modifying the labels
    addOnUnits.forEach(unit => {
      unit.labels.delete('addAddOn');
      console.log('deleting addAddOn label');
    });

    const collectedActions = [
      ...setReposition(world),
      ...repositionBuilding(world),
    ];

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
  const { resources } = world;
  const { units } = resources.get();

  const liftableNoAddOnBarracks = getLiftableNoAddOnBarracks(units);
  const orphanReactors = getOrphanReactors(units);

  if (orphanReactors.length > 0) {
    assignRepositionLabelsToBarracks(liftableNoAddOnBarracks, orphanReactors);
  }

  repositionIdleFlyingBuildings(world);

  return [];
}

/**
 * @param {World} world 
 * @param {Unit} structure
 * @returns {Point2D | undefined}
 */
function getLandingPosition(world, structure) {
  const { units } = world.resources.get();

  // First, find all orphaned reactors
  const orphanAddOns = units.getById(groupTypes.addonTypes).filter(addOn => {
    const { pos, unitType } = addOn; if (pos === undefined || unitType === undefined) return false;
    if (addOn.labels.has('reposition')) return false;
    // unitType must be REACTOR or TECHLAB
    if (![REACTOR, UnitType.TECHLAB].includes(unitType)) return false;
    const footprint = getFootprint(UnitType.BARRACKS); if (footprint === undefined) return false;
    return !pointsOverlap(cellsInFootprint(getAddOnBuildingPlacement(pos), footprint), unitResourceService.landingGrids);
  });
  /** @type {Point2D[]} */
  let landingPositions;

  // If there are orphan reactors, get landing positions near them
  if (orphanAddOns.length > 0) {
    landingPositions = orphanAddOns.reduce((/** @type {Point2D[]} */acc, addOn) => {
      const { pos } = addOn; if (pos === undefined) return acc;
      const landingPositions = getAddOnBuildingPlacement(pos);
      return [...acc, landingPositions];
    }, []);
  } else {
    // Otherwise, get all placeable positions on the map
    landingPositions = findClosestPlaceablePositions(world, structure);
  }

  // get closest landing position
  const closestLandingPosition = landingPositions.reduce((/** @type {Point2D | undefined} */closest, landingPosition) => {
    const { pos } = structure; if (pos === undefined) return closest;
    const distanceToLandingPosition = getDistance(pos, landingPosition);
    if (closest === undefined) return landingPosition;
    const distanceToClosest = getDistance(pos, closest);
    if (distanceToLandingPosition < distanceToClosest) {
      return landingPosition;
    }
    return closest;
  }, undefined);

  return closestLandingPosition;
}

/**
 * @param {World} world 
 * @param {Unit} unit
 * @returns {Point2D[]}
 */
function findClosestPlaceablePositions(world, unit) {
  const { map } = world.resources.get();
  const { pos, unitType } = unit; if (pos === undefined || unitType === undefined) return [];
  const mapSize = map.getSize();
  const { x: mapWidth, y: mapHeight } = mapSize; if (mapWidth === undefined || mapHeight === undefined) return [];

  let closestPositions = [];
  let closestDistance = Infinity;

  for (let x = 0; x < mapWidth; x++) {
    for (let y = 0; y < mapHeight; y++) {
      const mapPos = { x, y };
      if (map.isPlaceableAt(unitType, pos)) {
        const distance = getDistance(mapPos, pos);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestPositions = [pos];
        } else if (distance === closestDistance) {
          closestPositions.push(pos);
        }
      }
    }
  }

  return closestPositions;
}

/**
 * @param {UnitResource} units
 * @returns {Unit[]}
 */
function getLiftableNoAddOnBarracks(units) {
  return units.getById(BARRACKS).filter(unit =>
    !unit.hasTechLab() && !unit.hasReactor() && unit.availableAbilities().find(ability => liftingAbilities.includes(ability))
  );
}

/**
 * @param {UnitResource} units
 * @returns {Unit[]}
 */
function getOrphanReactors(units) {
  return units.getById(REACTOR).filter(reactor => isOrphanReactor(reactor));
}

/**
 * @param {Unit} reactor
 * @returns {boolean}
 */
function isOrphanReactor(reactor) {
  const { pos } = reactor;
  if (pos === undefined) return false;

  const addOnBuildingPlacement = getAddOnBuildingPlacement(pos);
  const footprint = getFootprint(UnitType.BARRACKS);
  if (footprint === undefined) return false;

  return !pointsOverlap(cellsInFootprint(addOnBuildingPlacement, footprint), unitResourceService.landingGrids) && reactor.labels.size === 0;
}

/**
 * @param {Unit[]} barracks
 * @param {Unit[]} reactors
 * @returns {void}
 */
function assignRepositionLabelsToBarracks(barracks, reactors) {
  barracks.forEach(unit => assignRepositionLabelToBarrack(unit, reactors));
}

/**
 * @param {Unit} unit
 * @param {Unit[]} reactors
 * @returns {void}
 */
function assignRepositionLabelToBarrack(unit, reactors) {
  const { orders, pos, unitType } = unit;
  if (orders === undefined || pos === undefined || unitType !== BARRACKS) return;

  const closestReactor = getClosestReactor(pos, reactors);
  if (closestReactor !== undefined) {
    unit.labels.set('reposition', getAddOnBuildingPosition(closestReactor.pos));
    closestReactor.labels.set('reposition', unit.tag);
  }
}

/**
 * @param {Point2D} position
 * @param {Unit[]} reactors
 * @returns {Unit | undefined}
 */
function getClosestReactor(position, reactors) {
  return reactors.reduce((/** @type {Unit | undefined} */closest, reactor) => getClosestReactorReducerCallback(position, closest, reactor), undefined);
}

/**
 * @param {Point2D} position
 * @param {Unit | undefined} closest
 * @param {Unit} reactor
 * @returns {Unit | undefined}
 */
function getClosestReactorReducerCallback(position, closest, reactor) {
  if (reactor.pos === undefined) return closest;

  const distanceToReactor = distance(position, reactor.pos);
  if (closest === undefined || closest.pos === undefined) return reactor;

  const distanceToClosest = distance(position, closest.pos);
  if (distanceToReactor < distanceToClosest) {
    return reactor;
  }
  return closest;
}

/**
 * @param {World} world
 * @returns {void}
 */
function repositionIdleFlyingBuildings(world) {
  const { resources } = world;
  const { units } = resources.get();
  units.getStructures().forEach(structure => repositionIdleFlyingBuilding(world, structure));
}

/**
 * @param {World} world
 * @param {Unit} structure
 * @returns {void}
 */
function repositionIdleFlyingBuilding(world, structure) {
  const { resources } = world;
  const { units } = resources.get();
  if (structure.availableAbilities().find(ability => landingAbilities.includes(ability))) {
    const { orders } = structure;
    if (orders === undefined || orders.length !== 0 || !structure.isFlying || structure.labels.size !== 0) return;

    const { pos } = structure;
    if (pos === undefined) return;

    const landingPosition = getLandingPosition(world, structure);
    if (landingPosition) {
      structure.labels.set('reposition', landingPosition);
      repositionOrphanAddOnAtLandingPosition(units, structure, landingPosition);
    }
  }
}

/**
 * @param {UnitResource} units
 * @param {Unit} structure
 * @param {Point2D} landingPosition
 * @returns {void}
 */
function repositionOrphanAddOnAtLandingPosition(units, structure, landingPosition) {
  const orphanAddOn = getOrphanAddOnAtLandingPosition(units, landingPosition);
  if (orphanAddOn) {
    orphanAddOn.labels.set('reposition', structure.tag);
  }
}

/**
 * @param {UnitResource} units
 * @param {Point2D} landingPosition
 * @returns {Unit | undefined}
 */
function getOrphanAddOnAtLandingPosition(units, landingPosition) {
  return units.getById(groupTypes.addonTypes).find(addOn => isOrphanAddOnAtLandingPosition(addOn, landingPosition));
}

/**
 * @param {Unit} addOn
 * @param {Point2D} landingPosition
 * @returns {boolean}
 */
function isOrphanAddOnAtLandingPosition(addOn, landingPosition) {
  const { pos } = addOn;
  if (pos === undefined) return false;

  return distance(pos, getAddOnBuildingPosition(landingPosition)) < 1;
}
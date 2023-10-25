//@ts-check
"use strict"

const { MOVE, ATTACK_ATTACK, BUILD_CREEPTUMOR_QUEEN, SMART } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { mineralFieldTypes, vespeneGeyserTypes } = require("@node-sc2/core/constants/groups");
const { PHOTONCANNON, CREEPTUMORBURROWED } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { createUnitCommand } = require("../../src/services/command-service");
const { getTravelDistancePerStep } = require("../../services/frames-service");
const { isInMineralLine } = require("../../systems/map-resource-system/map-resource-service");
const { isFacing } = require("../../services/micro-service");
const { getDistance, getClusters, getDistanceSquared } = require("../../services/position-service");
const { canAttack } = require("../../services/resources-service");
const { getUnitTypeCount } = require("../../src/world-service");
const { gatherOrMine } = require("../../systems/manage-resources");
const { getRandomPoints, getAcrossTheMap } = require("../location");
const unitService = require("../../services/unit-service");
const armyManagementService = require("../../src/services/army-management/army-management-service");
const { getEnemyUnits, getClosestEnemyByPath } = require("../../src/services/enemy-tracking/enemy-tracking-service");
const { calculateTotalHealthRatio, getDPSHealth } = require("../../src/services/combat-statistics");
const { isMining } = require("../../systems/unit-resource/unit-resource-service");
const { getClosestPathWithGasGeysers } = require("../../src/services/utility-service");
const pathFindingService = require("../../src/services/pathfinding/pathfinding-service");
const { getGasGeysers } = require("../../src/services/unit-retrieval");
const { getCreepEdges } = require("../../services/resource-manager-service");
const { isByItselfAndNotAttacking, getPotentialCombatantsInRadius } = require("../../src/services/unit-analysis");
const enemyTrackingService = require("../../src/services/enemy-tracking/enemy-tracking-service");
const { filterEnemyUnits } = require("../../src/services/shared-utilities/combat-utilities");

module.exports = {
  /**
   * Handles the behavior for units moving across the map.
   *
   * @param {World} world - The current state of the world including resources and units.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - An array of raw unit commands.
   */
  acrossTheMapBehavior: (world) => {
    const { resources } = world;
    const { map, units } = resources.get();
    const [unit] = units.withLabel('scoutAcrossTheMap');

    if (!unit || !unit.pos) return [];

    const enemyUnits = filterEnemyUnits(unit, enemyTrackingService.mappedEnemyUnits);

    if (enemyUnits.length === 0) {
      const unitCommand = createUnitCommand(ATTACK_ATTACK, [unit]);
      unitCommand.targetWorldSpacePos = getAcrossTheMap(map);
      return [unitCommand];
    }

    // Directly use getUnitsForEngagement here
    const unitsForEngagement = armyManagementService.getUnitsForEngagement(world, unit, 16);

    const [closestEnemyUnit] = pathFindingService.getClosestUnitByPath(
      resources,
      unit.pos,
      enemyUnits,
      getGasGeysers(units),
      1
    );

    if (!closestEnemyUnit || !closestEnemyUnit.pos) return [];

    return armyManagementService.engageOrRetreat(
      world,
      unitsForEngagement,
      enemyUnits,
      closestEnemyUnit.pos,
      false
    );
  },
  /**
   * Directs a unit to clear from enemies, making sure it doesn't run into other threats.
   *
   * @param {World} world - The game world containing all data and resources.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - Array of actions for units to execute.
   */
  clearFromEnemyBehavior: (world) => {
    const { resources } = world;
    const { units } = resources.get();
    const label = 'clearFromEnemy';
    const collectedActions = [];
    const combatRallyPosition = armyManagementService.getCombatRally(resources);

    // Find the unit with the specified label
    const [unit] = units.withLabel(label);

    if (!unit || !unit.pos) return [];

    const threateningUnits = getThreateningUnits(world, unit);
    const [closestEnemyUnit] = units.getClosest(unit.pos, threateningUnits);

    if (!closestEnemyUnit || distance(unit.pos, combatRallyPosition) < 2) {
      unit.labels.clear();
      console.log('clear!');
      collectedActions.push(...gatherOrMine(resources, unit));
    } else {
      const retreatPosition = armyManagementService.retreat(world, unit, threateningUnits, true);

      if (retreatPosition) {
        const action = createUnitCommand(MOVE, [unit]);
        action.targetWorldSpacePos = retreatPosition;
        collectedActions.push(action);
      }
    }
    return collectedActions;
  },
  /**
   * @param {World} world
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  creeperBehavior: (world) => {
    const { resources } = world;
    const { units } = resources.get();
    const collectedActions = [];

    const creeperQueens = units.withLabel('creeper');

    for (const unit of creeperQueens) {
      if (!unit.pos) continue;

      // Always check for threats regardless of whether the unit is idle
      if (!handleThreats(world, unit, collectedActions)) {
        // If no threats and unit is idle, then handle creep spread
        if (unit.isIdle()) {
          handleCreepSpread(world, unit, collectedActions);
        }
      }
    }

    return collectedActions;
  },
  /**
   * @param {UnitResource} units 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  recruitToBattleBehavior: (units) => {
    const label = 'recruitToBattle';
    const collectedActions = [];
    units.withLabel(label).forEach(unit => {
      const targetPosition = unit.labels.get(label);
      if (distance(unit.pos, targetPosition) < 16) {
        unit.labels.delete(label);
      } else {
        const unitCommand = createUnitCommand(ATTACK_ATTACK, [unit]);
        unitCommand.targetWorldSpacePos = targetPosition;
        collectedActions.push(unitCommand);
      }
    });
    return collectedActions;
  },
  /**
   * @param {World} world 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  scoutEnemyMainBehavior: (world) => {
    const { resources } = world;
    const { units } = resources.get();
    const scoutUnit = units.withLabel('scoutEnemyMain')[0];
    if (!scoutUnit) return [];
    const { pos } = scoutUnit;
    if (!pos) return [];

    const threateningUnits = getThreateningUnits(world, scoutUnit);

    // Check for threats first
    if (threateningUnits.length > 0) {
      const healthRatio = calculateTotalHealthRatio(units, scoutUnit);
      if (healthRatio > 0.5) {
        const closestThreateningUnit = getClosestByWeaponRange(world, scoutUnit, threateningUnits);
        if (closestThreateningUnit) {
          return handleThreateningUnits(world, scoutUnit, threateningUnits, closestThreateningUnit);
        }
      }
    }

    // If no threats, handle non-threatening units
    return handleNonThreateningUnits(world, scoutUnit);
  },
  scoutEnemyNaturalBehavior: async (/** @type {ResourceManager} */ resources) => {
    const { actions, map, units } = resources.get();
    const [unit] = units.withLabel('scoutEnemyNatural');
    const collectedActions = [];
    if (unit) {
      const [inRangeEnemyCannon] = units.getById(PHOTONCANNON, Alliance.ENEMY).filter((/** @type {{ pos: Point2D; }} */ cannon) => distance(cannon.pos, unit.pos) < 16);
      if (calculateTotalHealthRatio(units, unit) > 1 / 2 && !inRangeEnemyCannon) {
        const enemyNatural = map.getEnemyNatural();
        const randomPointsOfInterest = [...getRandomPoints(map, 3, enemyNatural.areas.areaFill)];
        if (randomPointsOfInterest.length > unit.orders.length) {
          randomPointsOfInterest.forEach(point => {
            const unitCommand = {
              abilityId: MOVE,
              unitTags: [unit.tag],
              queueCommand: true,
              targetWorldSpacePos: point,
            };
            collectedActions.push(unitCommand);
          });
        }
      } else {
        const unitCommand = {
          abilityId: MOVE,
          unitTags: [unit.tag],
          targetWorldSpacePos: armyManagementService.getCombatRally(resources),
        };
        collectedActions.push(unitCommand);
      }
    }
    collectedActions.length > 0 && await actions.sendAction(collectedActions);
  },
}
/**
 * @param {ResourceManager} resources 
 * @returns {Expansion[]}
 */
function getEmptyExpansions(resources) {
  const { map, units } = resources.get();
  const emptyExpansions = map.getExpansions().filter(expansion => {
    const enemyUnits = units.getAlive({ alliance: Alliance.ENEMY }).filter(unit => distance(unit.pos, expansion.centroid) < 16);
    const selfUnits = units.getAlive({ alliance: Alliance.SELF }).filter(unit => distance(unit.pos, expansion.centroid) < 16);
    return enemyUnits.length === 0 && selfUnits.length === 0;
  });
  return emptyExpansions;
}
/**
 * @param {World} world
 * @param {Unit} unit
 * @returns {Unit[]}
 */
function getThreateningUnits(world, unit) {
  const { data, resources } = world;
  const { map, units } = resources.get();
  const { pos, radius } = unit; if (pos === undefined || radius === undefined) return [];
  const enemyUnits = unit['enemyUnits'] || getEnemyUnits(unit);
  const threateningUnits = enemyUnits && enemyUnits.filter((/** @type {Unit} */ enemyUnit) => {
    const { pos: enemyPos, radius: enemyRadius, unitType } = enemyUnit;
    if (enemyPos === undefined || enemyRadius === undefined || unitType === undefined) return false;
    if (enemyUnit.isWorker() && (isInMineralLine(map, enemyPos) || isByItselfAndNotAttacking(units, enemyUnit, enemyTrackingService.mappedEnemyUnits))) return false;
    const weaponThatCanAttack = unitService.getWeaponThatCanAttack(data, unitType, unit);
    if (weaponThatCanAttack) {
      const distanceToEnemy = getDistance(pos, enemyPos);
      const { range } = weaponThatCanAttack; if (range === undefined) return false;
      const getSightRange = enemyUnit.data().sightRange || 0;
      const weaponRangeOfEnemy = range + radius + enemyRadius + getTravelDistancePerStep(map, enemyUnit) + getTravelDistancePerStep(map, unit);
      const inWeaponRange = distanceToEnemy <= weaponRangeOfEnemy;
      const degrees = inWeaponRange ? 180 / 4 : 180 / 8;
      const higherRange = weaponRangeOfEnemy > getSightRange ? weaponRangeOfEnemy : getSightRange;
      const enemyFacingUnit = enemyUnit.isMelee() ? isFacing(enemyUnit, unit, degrees) : true;

      console.log(`Unit: ${unit.unitType}, Enemy: ${enemyUnit.unitType}, Weapon: ${weaponThatCanAttack ? weaponThatCanAttack.name : 'none'}, Range: ${range}, Distance to enemy: ${distanceToEnemy}, Weapon range of enemy: ${weaponRangeOfEnemy}, In weapon range: ${inWeaponRange}, Higher range: ${higherRange}, Enemy facing unit: ${enemyFacingUnit}`);

      return distanceToEnemy <= higherRange && enemyFacingUnit;
    }
  });
  return threateningUnits || [];
}
/**
 * @param {World} world
 * @param {Unit} unit
 * @param {Unit[]} threateningUnits
 * @returns Unit
 */
function getClosestByWeaponRange(world, unit, threateningUnits) {
  const { data, resources } = world;
  const { map } = resources.get();
  const { pos, radius } = unit; if (pos === undefined || radius === undefined) return;
  const closestThreateningUnit = threateningUnits.reduce((/** @type {{distance: number; unit: Unit;} | undefined} */ closest, threateningUnit) => {
    const { pos: threateningUnitPos, radius: threateningUnitRadius, unitType } = threateningUnit; if (threateningUnitPos === undefined || threateningUnitRadius === undefined || unitType === undefined) return closest;
   const distanceToThreateningUnit = getDistance(pos, threateningUnitPos);
    const weaponThatCanAttack = unitService.getWeaponThatCanAttack(data, unitType, unit);
    if (weaponThatCanAttack) {
      const { range } = weaponThatCanAttack; if (range === undefined) return closest;
      const weaponRangeOfThreateningUnit = range + radius + threateningUnitRadius + getTravelDistancePerStep(map, threateningUnit) + getTravelDistancePerStep(map, unit);
      if (distanceToThreateningUnit <= weaponRangeOfThreateningUnit) {
        return closest && closest.distance < distanceToThreateningUnit ? closest : { distance: distanceToThreateningUnit, unit: threateningUnit };
      }
    }
    return closest;
  }, undefined);
  return closestThreateningUnit && closestThreateningUnit.unit; 
}
/**
 * @param {UnitResource} units
 * @param {Unit} unit
 * @param {"minerals" | "vespene" | undefined} type
 * @returns {boolean}
 */
function isGathering(units, unit, type=undefined) {
  const pendingOrders = unitService.getPendingOrders(unit);
  if (pendingOrders.length > 0) {
    return pendingOrders.some(order => {
      const { abilityId } = order; if (abilityId === undefined) return false;
      const smartOrder = abilityId === SMART;
      if (smartOrder) {
        const { targetUnitTag } = order; if (targetUnitTag === undefined) return false;
        const targetUnit = units.getByTag(targetUnitTag);
        if (targetUnit) {
          const { unitType } = targetUnit; if (unitType === undefined) return false;
          return mineralFieldTypes.includes(unitType) || vespeneGeyserTypes.includes(unitType);
        }
      }
    });
  } else {
    return unit.isGathering(type);
  } 
}

/**
 * Get units close to a target unit.
 *
 * @param {UnitResource} units - The set of all units to filter.
 * @param {Unit} targetUnit - The unit to measure distance from.
 * @param {number} range - The maximum distance from the target unit a unit can be.
 * @returns {Unit[]} - The units within range of the target unit.
 */
function getUnitsCloseTo(units, targetUnit, range) {
  const { pos: targetPos } = targetUnit;
  if (targetPos === undefined) return [];

  return units.getAlive().filter(unit => {
    const { pos } = unit; if (pos === undefined) return false;
    const distance = getDistance(targetPos, pos);
    return distance < range && unit.alliance === Alliance.SELF;
  });
}

/**
 * Handle the case where there are threatening units near the scout.
 *
 * @param {World} world The current world state.
 * @param {Unit} scoutUnit The scouting unit.
 * @param {Unit[]} threateningUnits The threatening units.
 * @param {Unit} closestThreateningUnit The closest threatening unit.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions to perform.
 */
function handleThreateningUnits(world, scoutUnit, threateningUnits, closestThreateningUnit) {
  const { units } = world.resources.get();
  const collectedActions = [];
  const selfUnits = getUnitsCloseTo(units, scoutUnit, 16);
  const threateningUnitsDPSHealth = getDPSHealth(world, closestThreateningUnit, selfUnits.reduce((/** @type {UnitTypeId[]} */ unitTypes, unit) => {
    const { unitType } = unit; if (unitType === undefined) return unitTypes;
    if (!unitTypes.includes(unitType)) {
      unitTypes.push(unitType);
    }
    return unitTypes;
  }, []));
  const enemyUnitTypes = threateningUnits.reduce((/** @type {UnitTypeId[]} */ unitTypes, unit) => {
    const { unitType } = unit; if (unitType === undefined) return unitTypes;
    if (!unitTypes.includes(unitType)) {
      unitTypes.push(unitType);
    }
    return unitTypes;
  }, []);
  const selfUnitDPSHealth = getDPSHealth(world, scoutUnit, enemyUnitTypes);

  const BUFFER_DISTANCE = 2; // Set the buffer distance

  if (closestThreateningUnit && threateningUnitsDPSHealth > selfUnitDPSHealth) {
    scoutUnit.labels.set('Threatened', true);
    const { pos, tag } = scoutUnit; if (pos === undefined || tag === undefined) return [];
    const { pos: enemyPos } = closestThreateningUnit;
    if (!pos || !enemyPos) return [];
    const farthestEmptyExpansionCloserToUnit = getEmptyExpansions(world.resources).find(expansion => {
      if (!expansion.centroid) {
        return false;
      }
      const scoutDistance = pathFindingService.getDistanceByPath(world.resources, pos, expansion.centroid);
      const enemyDistance = pathFindingService.getDistanceByPath(world.resources, enemyPos, expansion.centroid);

      // Check if the scout's distance to the expansion (plus the buffer) is less than the enemy's distance
      return scoutDistance + BUFFER_DISTANCE < enemyDistance;
    });

    collectedActions.push({
      abilityId: MOVE,
      unitTags: [tag],
      targetWorldSpacePos: farthestEmptyExpansionCloserToUnit ? farthestEmptyExpansionCloserToUnit.centroid : armyManagementService.retreat(world, scoutUnit, [closestThreateningUnit], false),
    });
  }

  return collectedActions;
}

/**
 * Handle the case where there are no threatening units near the scout.
 *
 * @param {World} world The current world state.
 * @param {Unit} scoutUnit The scouting unit.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions to perform.
 */
function handleNonThreateningUnits(world, scoutUnit) {
  const { map, units } = world.resources.get();
  const { orders, tag } = scoutUnit; if (orders === undefined || tag === undefined) return [];
  const collectedActions = [];
  const nonPlaceableOrderFound = scoutUnit.orders?.some(order => order.abilityId === MOVE && order.targetWorldSpacePos !== undefined && !map.isPathable(order.targetWorldSpacePos));
  const { areas } = map.getEnemyMain();
  if (areas === undefined) return [];
  const pathableAreasFill = areas.areaFill.filter(pos => map.isPathable(pos));
  const randomPointsOfInterest = [...getRandomPoints(map, 3, pathableAreasFill)];
  if (nonPlaceableOrderFound) {
    collectedActions.push({
      abilityId: MOVE,
      unitTags: [tag],
      targetWorldSpacePos: randomPointsOfInterest[0],
      queueCommand: false,
    });
  } else {
    if (randomPointsOfInterest.length > orders.length) {
      let queueCommand = isGathering(units, scoutUnit) && !isMining(units, scoutUnit) ? false : true;
      randomPointsOfInterest.forEach(point => {
        collectedActions.push({
          abilityId: MOVE,
          unitTags: [scoutUnit.tag],
          targetWorldSpacePos: point,
          queueCommand,
        });
        queueCommand = true;
      });
    }
  }
  return collectedActions;
}
/**
 * Determines if there are any threats to the provided unit and takes appropriate actions.
 * Engages or retreats based on the proximity of the threat.
 * 
 * @param {World} world - The current game world state.
 * @param {Unit} unit - The unit under consideration for threats.
 * @param {SC2APIProtocol.ActionRawUnitCommand[]} collectedActions - Actions determined to be taken by the unit.
 * @returns {boolean} - True if a threat was identified and handled; otherwise, false.
 */
function handleThreats(world, unit, collectedActions) {
  if (!unit.pos) return false;
  
  const nearbyEnemyUnits = getNearbyEnemyUnits(unit.pos, unit);
  if (!nearbyEnemyUnits.length) return false;
  
  const closestEnemyUnit = getClosestEnemyByPath(world.resources, unit.pos, nearbyEnemyUnits);
  if (!closestEnemyUnit) return false;

  handleEngageOrRetreat(world, unit, closestEnemyUnit, nearbyEnemyUnits, collectedActions);
  return true;
}
/**
 * @param {World} world
 * @param {Unit} unit
 * @param {SC2APIProtocol.ActionRawUnitCommand[]} collectedActions
 * @returns {void}
 */
function handleCreepSpread(world, unit, collectedActions) {
  const { resources } = world;
  const { pos } = unit;
  if (!pos) return;

  const isFewCreepTumors = getUnitTypeCount(world, CREEPTUMORBURROWED) <= 3;
  const selectedCreepEdge = isFewCreepTumors
    ? getCreepEdgeCloseToEnemy(resources)
    : getCreepEdgeCloseToEnemy(resources, pos);

  if (selectedCreepEdge) {
    issueCreepCommand(unit, selectedCreepEdge, collectedActions);
  }
}

/**
 * Finds the closest creep edge to an enemy based on the provided position or, if no position is provided, based on townhall positions.
 *
 * @param {ResourceManager} resources - The resource manager containing map and other data.
 * @param {Point2D} [pos] - The position to use as a reference for finding the closest creep edge. If not provided, the function will use the townhall positions.
 * @returns {Point2D | undefined} The coordinates of the closest creep edge to the enemy or undefined if none found.
 */
function getCreepEdgeCloseToEnemy(resources, pos = undefined) {
  const { map } = resources.get();

  if (!pos) {
    return getCreepEdgeClosestToEnemyTownhall(resources, map);
  } else {
    return getCreepEdgeCloseToGivenPosition(resources, pos);
  }
}

/**
 * @param {Unit} unit
 * @param {Point2D} selectedCreepEdge
 * @param {SC2APIProtocol.ActionRawUnitCommand[]} collectedActions
 * @returns {void}
 */
function issueCreepCommand(unit, selectedCreepEdge, collectedActions) {
  const { pos, tag } = unit;
  if (pos === undefined || tag === undefined) return;

  const distanceToCreepEdge = getDistance(pos, selectedCreepEdge);
  const isCloseEnough = distanceToCreepEdge <= 0.8;
  const canBuildTumor = unit.abilityAvailable(BUILD_CREEPTUMOR_QUEEN);

  if (!isCloseEnough) {
    // If the unit isn't close enough to the creep edge, command it to MOVE
    collectedActions.push({
      abilityId: MOVE,
      targetWorldSpacePos: selectedCreepEdge,
      unitTags: [tag]
    });
  } else if (isCloseEnough && canBuildTumor) {
    // If the unit is close enough and can build the tumor, issue the BUILD_CREEPTUMOR_QUEEN command
    collectedActions.push({
      abilityId: BUILD_CREEPTUMOR_QUEEN,
      targetWorldSpacePos: selectedCreepEdge,  // Assuming the tumor is built on the creep edge
      unitTags: [tag]
    });
  }
}
/**
 * Filters and returns nearby enemy units that can attack the specified unit based on its position.
 * 
 * @param {Point2D} position - The position from which to gauge proximity of enemies.
 * @param {Unit} ourUnit - The unit for which threats are being assessed.
 * @returns {Unit[]} - An array of enemy units that pose a threat to our unit.
 */
function getNearbyEnemyUnits(position, ourUnit) {
  return enemyTrackingService.mappedEnemyUnits
    .filter((/** @type {Unit} */ enemy) =>
      enemy.pos &&
      getDistanceSquared(position, enemy.pos) <= 16 * 16 &&
      canAttack(enemy, ourUnit)
    );
}
/**
 * Handles the engage or retreat logic for a unit based on a threat.
 *
 * @param {World} world - The current state of the world.
 * @param {Unit} unit - The unit to engage or retreat.
 * @param {Unit} enemyUnit - The closest enemy unit.
 * @param {Unit[]} nearbyEnemyUnits - List of nearby enemy units.
 * @param {SC2APIProtocol.ActionRawUnitCommand[]} collectedActions - An array to collect the actions taken.
 */
function handleEngageOrRetreat(world, unit, enemyUnit, nearbyEnemyUnits, collectedActions) {
  if (!enemyUnit.pos) return; // Make sure the enemy unit's position is defined

  const potentialCombatUnits = getPotentialCombatantsInRadius(world, unit, 16);

  collectedActions.push(...armyManagementService.engageOrRetreat(world, potentialCombatUnits, nearbyEnemyUnits, enemyUnit.pos, false));
}

/**
 * Finds the closest creep edge to the enemy townhall from the positions of occupied townhalls.
 *
 * @param {ResourceManager} resources - The resource manager containing map and other data.
 * @param {MapResource} map - The game map.
 * @returns {Point2D | undefined} The coordinates of the closest creep edge or undefined if none found.
 */
function getCreepEdgeClosestToEnemyTownhall(resources, map) {
  const occupiedTownhalls = map.getOccupiedExpansions().map(e => e.getBase());
  const { townhallPosition } = map.getEnemyNatural();

  for (const townhall of occupiedTownhalls) {
    const pos = townhall.pos;
    if (!pos) continue;

    const pathData = getClosestPathWithGasGeysers(resources, pos, townhallPosition);
    const creepEdgeAndPath = pathData.pathCoordinates.filter(path => pathFindingService.isCreepEdge(map, path));

    if (creepEdgeAndPath.length > 0) {
      return pathFindingService.getClosestPositionByPath(resources, pos, creepEdgeAndPath, creepEdgeAndPath.length)[creepEdgeAndPath.length - 1];
    }
  }
}

/**
 * Finds the closest creep edge to the provided position.
 *
 * @param {ResourceManager} resources - The resource manager containing map and other data.
 * @param {Point2D} pos - The position to use as a reference for finding the closest creep edge.
 * @returns {Point2D | undefined} The coordinates of the closest creep edge or undefined if none found.
 */
function getCreepEdgeCloseToGivenPosition(resources, pos) {
  let clusteredCreepEdges = getClusters(getCreepEdges(resources, pos));
  const creepEdgeAndPathWithinRange = clusteredCreepEdges.filter(position => getDistanceSquared(pos, position) <= 100); // using square distance

  if (creepEdgeAndPathWithinRange.length > 0) {
    clusteredCreepEdges = creepEdgeAndPathWithinRange;
  }

  return pathFindingService.getClosestPositionByPath(resources, pos, clusteredCreepEdges)[0];
}
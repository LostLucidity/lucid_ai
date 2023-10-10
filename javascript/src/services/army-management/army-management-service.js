//@ts-check
"use strict";

// /src/services/army-management/army-management-service.js

const groupTypes = require("@node-sc2/core/constants/groups");
const { getDistance, moveAwayPosition, getBorderPositions, getDistanceSquared, dbscan } = require("../../../services/position-service");
const enemyTrackingService = require("../../../systems/enemy-tracking/enemy-tracking-service");
const unitService = require("../../../services/unit-service");
const { createUnitCommand } = require("../../../services/actions-service");
const { MOVE, STOP, ATTACK_ATTACK, LOAD_BUNKER, SMART, HARVEST_GATHER } = require("@node-sc2/core/constants/ability");
const { QUEEN, ADEPTPHASESHIFT, BUNKER, BARRACKS, FACTORY, STARPORT } = require("@node-sc2/core/constants/unit-type");
const { canAttack } = require("../../../services/resources-service");
const { getTravelDistancePerStep, getTimeInSeconds } = require("../../../services/frames-service");
const MapResourceService = require("../../../systems/map-resource-system/map-resource-service");
const { getPathCoordinates } = require("../../../services/path-service");
const { WeaponTargetType, Alliance } = require("@node-sc2/core/constants/enums");
const { UnitType, Ability } = require("@node-sc2/core/constants");
const microService = require("../../../services/micro-service");
const resourceManagerService = require("../../../services/resource-manager-service");
const dataService = require("../../../services/data-service");
const { getClosestPosition } = require("../../../helper/get-closest");
const unitResourceService = require("../../../systems/unit-resource/unit-resource-service");
const { getEnemyUnits, getClosestEnemyByPath } = require("../enemy-tracking/enemy-tracking-service");
const trackUnitsService = require("../../../systems/track-units/track-units-service");
const { pointsOverlap } = require("../../../helper/utilities");
const positionService = require("../../../services/position-service");
const { existsInMap, getRallyPointByBases } = require("../../../helper/location");
const { getClosestSafeMineralField } = require("../shared-functions");
const pathFindingService = require("../pathfinding/pathfinding-service");
const { getWeaponDPS, getWeapon, getWeaponDamage, setDamageForTag, getDamageForTag } = require("../shared-utilities/combat-utilities");
const enemyTrackingServiceV2 = require("../enemy-tracking/enemy-tracking-service");

class ArmyManagementService {
  constructor() {
  }
  /** @type {Point2D} */
  combatRally = null;
  outpowered = false;

  /**
   * Creates a retreat command for a given unit.
   *
   * @param {World} world - The game world.
   * @param {Unit} unit - The unit that needs to retreat.
   * @param {Unit[]} enemyUnits - The enemy units that the unit is retreating from.
   * @returns {SC2APIProtocol.ActionRawUnitCommand | undefined} - The retreat command.
   */
  createRetreatCommand(world, unit, enemyUnits) {
    const retreatPosition = this.retreat(world, unit, enemyUnits);

    // If a valid retreat position is found, create and return the retreat command
    if (retreatPosition) {
      return {
        abilityId: MOVE, // Replace with the actual ability ID for moving or retreating
        unitTags: [unit.tag],
        targetWorldSpacePos: retreatPosition,
      };
    }

    // If no valid retreat position is found, return undefined or handle accordingly
    return undefined;
  }

  /**
   * Determines the best pathable retreat point for the unit.
   * 
   * @param {World} world - The game world.
   * @param {Unit} unit - The unit to retreat.
   * @param {Unit} targetUnit - The unit to retreat from.
   * @param {number} travelDistancePerStep - Distance traveled per step.
   * @returns {Point2D | undefined} - The best pathable retreat point, or undefined.
   */
  determineBestRetreatPoint(world, unit, targetUnit, travelDistancePerStep) {
    const { resources } = world;
    const { map } = resources.get();
    const { pos } = unit;
    const { pos: targetPos } = targetUnit;

    // Return early if positions are undefined.
    if (!pos || !targetPos) return undefined;

    let retreatPoint = this.getBestRetreatCandidatePoint(world, unit, targetUnit);
    if (retreatPoint) return retreatPoint;

    retreatPoint = getPathRetreatPoint(world.resources, unit, this.getRetreatCandidates(world, unit, targetUnit));
    if (retreatPoint) return retreatPoint;

    retreatPoint = this.findClosestSafePosition(world, unit, targetUnit, travelDistancePerStep);
    if (retreatPoint) return retreatPoint;

    return moveAwayPosition(map, targetPos, pos, travelDistancePerStep);
  }

  /**
   * Generates unit commands to direct given units to either engage in battle or retreat.
   *
   * @param {World} world - The game world containing all the game information.
   * @param {Unit[]} selfUnits - The array of player's units.
   * @param {Unit[]} enemyUnits - The array of enemy units.
   * @param {Point2D} position - The point to either move towards or retreat from.
   * @param {boolean} [clearRocks=true] - Flag indicating whether destructible rocks should be targeted.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - The array of generated unit commands.
   */
  engageOrRetreat(world, selfUnits, enemyUnits, position, clearRocks = true) {
    const collectedActions = [];

    // Filtering units based on their types and labels
    const injectorQueens = selfUnits.filter(unit => unit.is(QUEEN) && unit.labels.has('injector'));
    const meleeUnits = selfUnits.filter(unit => unit.isMelee());
    const otherUnits = selfUnits.filter(unit => !injectorQueens.includes(unit) && !meleeUnits.includes(unit));

    // Adding necessary units for the battle to the otherUnits array
    otherUnits.push(
      ...this.getNecessaryUnits(world, injectorQueens, otherUnits, enemyUnits),
      ...this.getNecessaryUnits(world, meleeUnits, otherUnits, enemyUnits)
    );

    // Handling injector queens
    injectorQueens
      .filter(queen => !otherUnits.includes(queen) && queen.isAttacking() && queen.tag)
      .forEach(queen => collectedActions.push({ abilityId: STOP, unitTags: [queen.tag] }));

    // Processing melee and other units
    [...meleeUnits, ...otherUnits].forEach(unit => {
      const safetyBuffer = calculateSafetyBuffer(world, unit, enemyUnits);
      const totalHealthShield = (unit.health || 0) + (unit.shield || 0);

      if (totalHealthShield <= safetyBuffer && unit.tag) {
        collectedActions.push(this.createRetreatCommand(world, unit, enemyUnits));
      } else {
        this.processSelfUnitLogic(world, otherUnits, unit, position, enemyUnits, collectedActions, clearRocks);
      }
    });

    return collectedActions;
  }

  /**
   * @param {World} world
   * @param {Unit} unit 
   * @param {Unit} targetUnit 
   * @param {number} radius
   * @returns {Point2D|undefined}
   */
  findClosestSafePosition(world, unit, targetUnit, radius = 1) {
    const { resources } = world;
    const { units } = resources.get();
    const safePositions = getSafePositions(world, unit, targetUnit, radius);
    const { pos } = unit; if (pos === undefined) return;

    // Derive safetyRadius based on unit and potential threats
    const safetyRadius = deriveSafetyRadius(world, unit, units.getAlive(Alliance.ENEMY));

    // Filter the safe positions to avoid positions too close to enemy units
    const trulySafePositions = safePositions.filter(position => isTrulySafe(world, position, safetyRadius));

    // Return early if no safe positions are found
    if (trulySafePositions.length === 0) return;

    // If the unit is flying, simply get the closest position
    if (unit.isFlying) {
      const [closestPoint] = getClosestPosition(pos, trulySafePositions);
      return closestPoint;
    }

    // If the unit has a current destination, find the closest position by path
    const currentDestination = unitResourceService.getOrderTargetPosition(units, unit);
    if (currentDestination !== undefined) {
      const [closestPoint] = pathFindingService.getClosestPositionByPath(resources, currentDestination, trulySafePositions);
      return closestPoint;
    }

    // Fallback mechanism: Return closest position based on simple distance if no other criteria are met
    const [fallbackPosition] = getClosestPosition(pos, trulySafePositions);
    return fallbackPosition;
  }

  /**
   * Determines the actions for micro-management of a unit in response to a target unit and other nearby threats.
   * 
   * @param {World} world - The current game world state.
   * @param {Unit} unit - The unit to be micro-managed.
   * @param {Unit} targetUnit - The primary target unit to engage or evade.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - An array of raw unit commands for the micro-management actions.
   */
  getActionsForMicro(world, unit, targetUnit) {
    const nearbyThreats = findNearbyThreats(world, unit, targetUnit);
    const allThreats = [targetUnit, ...nearbyThreats];

    const optimalDistance = getOptimalAttackDistance(world, unit, allThreats);

    // Projected positions of all threats
    const projectedPositions = allThreats.reduce((/** @type {Point2D[]} */acc, threat) => {
      if (threat.tag) {
        const positions = enemyTrackingService.enemyUnitsPositions.get(threat.tag);
        const projectedPosition = positions ? getProjectedPosition(
          positions.current.pos,
          positions.previous.pos,
          positions.current.lastSeen,
          positions.previous.lastSeen
        ) : threat.pos;

        if (projectedPosition) {  // Ensure projectedPosition is defined before pushing
          acc.push(projectedPosition);
        }
      }
      return acc;
    }, []);

    // Finding positions that are in optimal range for attack for each projected position
    const attackPositions = projectedPositions.flatMap(projPos =>
      findOptimalAttackPositions(world, projPos, optimalDistance, unit)
    ).filter(position => {
      // Ensure that the position is at the optimal distance from all threats
      return allThreats.every(threat => {
        const distance = getDistance(position, threat.pos);
        return distance >= optimalDistance;
      });
    });

    if (!attackPositions.length) return [];

    // Select the attack position that is closest to the unit and is in optimal attack range
    const selectedPosition = attackPositions.reduce((/** @type {Point2D|undefined} */closest, position) => {
      if (!closest) return position;  // If closest is undefined, return the current position

      // Ensure unit.pos is defined before calculating the distance
      if (unit.pos) {
        return getDistance(unit.pos, position) < getDistance(unit.pos, closest) ? position : closest;
      }
      return closest;
    }, undefined);

    if (!selectedPosition) {
      // Handle the scenario when selectedPosition is undefined, return an empty array or a default action
      return [];
    }

    const unitCommand = createUnitCommand(MOVE, [unit]);
    unitCommand.targetWorldSpacePos = selectedPosition;

    return [unitCommand];
  }

  /**
   * @param {World} world
   * @param {Unit} unit
   * @param {Unit} targetUnit
   * @returns {Point2D | undefined}
   */
  getBestRetreatCandidatePoint(world, unit, targetUnit) {
    const retreatCandidates = this.getRetreatCandidates(world, unit, targetUnit);
    if (!retreatCandidates || retreatCandidates.length === 0) return;

    const bestRetreatCandidate = retreatCandidates.find(candidate => candidate.safeToRetreat);
    return bestRetreatCandidate ? bestRetreatCandidate.point : undefined;
  }

  /**
   * @param {ResourceManager} resources 
   * @param {Unit[]} units 
   * @param {Unit} targetUnit 
   * @returns {Unit}
   */
  getCombatPoint(resources, units, targetUnit) {
    const label = 'combatPoint';
    const combatPoint = units.find(unit => unit.labels.get(label));
    if(combatPoint) {
      let sameTarget = false;
      if (combatPoint.orders[0]) {
        const filteredOrder = combatPoint.orders.filter(order => !!order.targetWorldSpacePos)[0];
        sameTarget = filteredOrder && (Math.round(filteredOrder.targetWorldSpacePos.x * 2) / 2) === targetUnit.pos.x && (Math.round(filteredOrder.targetWorldSpacePos.y * 2) / 2) === targetUnit.pos.y;
      }
      if (sameTarget) {
        return combatPoint;
      } else {
        combatPoint.labels.delete(label);
        return this.setCombatPoint(resources, units, targetUnit);
      }
    } else {
      return this.setCombatPoint(resources, units, targetUnit);
    }
  }

  /**
   * @param {ResourceManager} resources 
   * @returns {Point2D}
   */
  getCombatRally(resources) {
    const { map, units } = resources.get();
    if (this.combatRally) {
      return this.combatRally;
    } else {
      return map.getCombatRally() || getRallyPointByBases(map, units);
    }
  }

  /**
   * Determines which enemy units can deal damage to the specified unit.
   * @param {World} world
   * @param {Unit} unit
   * @param {Unit[]} enemyUnits
   * @returns {Unit[]}
   */
  getDamageDealingUnits(world, unit, enemyUnits) {
    return enemyUnits.filter(enemyUnit =>
      canAttack(enemyUnit, unit) && inCombatRange(world, enemyUnit, unit));
  }

  /**
   * Returns necessary units to engage in battle.
   * 
   * @param {World} world - The game world context.
   * @param {Unit[]} candidateUnits - Units to consider adding to the battle.
   * @param {Unit[]} currentUnits - Current units excluding candidate units.
   * @param {Unit[]} enemyUnits - Enemy units.
   * @returns {Unit[]} - Necessary units required to engage.
   */
  getNecessaryUnits(world, candidateUnits, currentUnits, enemyUnits) {
    const necessaryUnits = [];

    for (const unit of candidateUnits) {
      necessaryUnits.push(unit);
      const combinedUnits = [...currentUnits, ...necessaryUnits];

      if (this.shouldEngage(world, combinedUnits, enemyUnits)) {
        break;
      }
    }

    return necessaryUnits;
  }

  /**
   * @param {World} world
   * @param {Unit} unit
   * @param {Unit} targetUnit
   * @returns {(import("../../../interfaces/retreat-candidate").RetreatCandidate)[]}
   */
  getRetreatCandidates(world, unit, targetUnit) {
    const { data, resources } = world;
    const { map } = resources.get();
    const { centroid } = map.getMain();
    const { pos, radius: unitRadius = 0 } = unit;

    if (!centroid || !pos) return [];

    const expansionLocations = getCentroids(map.getExpansions());
    const damageDealingEnemies = this.getDamageDealingUnits(
      world,
      unit,
      targetUnit['selfUnits'] || getEnemyUnits(targetUnit)
    );

    const safeExpansionLocations = expansionLocations.filter(location => {
      return isPathSafe(world, unit, location);
    });

    if (damageDealingEnemies.length === 0 && safeExpansionLocations.length > 0) {
      return mapToRetreatCandidates(resources, safeExpansionLocations, pos);
    }

    const unitsFromClustering = this.getUnitsFromClustering(damageDealingEnemies);

    return expansionLocations.flatMap(point => {
      const closestEnemy = getClosestEnemyByPath(resources, point, unitsFromClustering);
      if (!closestEnemy || !closestEnemy.unitType) return [];

      const { pos: enemyPos, radius: enemyRadius = 0, unitType } = closestEnemy;

      if (!enemyPos || typeof enemyPos.x !== 'number' || typeof enemyPos.y !== 'number') return [];

      const weapon = unitService.getWeaponThatCanAttack(data, unitType, unit);
      const attackRange = (weapon?.range || 0) + unitRadius + enemyRadius;

      const point2D = { x: enemyPos.x, y: enemyPos.y };
      const adjustedDistanceToEnemy = calculateDistances(resources, point2D, MapResourceService.getPathablePositions(map, point)).distance - attackRange;
      const distanceToRetreat = calculateDistances(resources, pos, MapResourceService.getPathablePositions(map, point)).distance;

      const expansionsInPath = getExpansionsInPath(map, pos, point);
      const pathToRetreat = expansionsInPath.reduce((/** @type {Point2D[]} */ acc, expansion) => {
        if (map.isPathable(expansion.townhallPosition)) {
          acc.push(expansion.townhallPosition);
        } else {
          const nearbyPathable = findNearbyPathablePosition(world, expansion.townhallPosition);
          if (nearbyPathable) acc.push(nearbyPathable); // Only push if a pathable position was found
        }
        return acc;
      }, []);

      const safeToRetreat = isSafeToRetreat(world, unit, pathToRetreat, point);

      if (distanceToRetreat !== Infinity && distanceToRetreat < adjustedDistanceToEnemy && safeToRetreat) {
        return mapToRetreatCandidates(resources, [point], pos);
      }
      return [];
    });
  }

  /**
   * 
   * @param {Unit[]} units
   * @returns {Unit[]}
   */
  getUnitsFromClustering(units) {
    // Perform clustering on builderCandidates
    let unitPoints = units.reduce((/** @type {Point2D[]} */accumulator, builder) => {
      const { pos } = builder; if (pos === undefined) return accumulator;
      accumulator.push(pos);
      return accumulator;
    }, []);
    // Apply DBSCAN to get clusters
    const clusters = dbscan(unitPoints);
    // Find the closest builderCandidate to each centroid
    let closestUnits = clusters.reduce((/** @type {Unit[]} */acc, builderCandidateCluster) => {
      let closestBuilderCandidate;
      let shortestDistance = Infinity;
      for (let unit of units) {
        const { pos } = unit; if (pos === undefined) return acc;
        let distance = getDistance(builderCandidateCluster, pos);
        if (distance < shortestDistance) {
          shortestDistance = distance;
          closestBuilderCandidate = unit;
        }
      }
      if (closestBuilderCandidate) {
        acc.push(closestBuilderCandidate);
      }
      return acc;
    }, []);
    return closestUnits;
  }

  /**
   * Handle logic for melee units in combat scenarios.
   *
   * @param {World} world - The world context.
   * @param {Unit} selfUnit - The melee unit.
   * @param {Unit} targetUnit - The target unit.
   * @param {Point2D} attackablePosition - The position where the unit can attack.
   * @param {SC2APIProtocol.ActionRawUnitCommand[]} collectedActions - A collection of actions to execute.
   */
  handleMeleeUnitLogic(world, selfUnit, targetUnit, attackablePosition, collectedActions) {
    if (!selfUnit.pos || !selfUnit.radius || !targetUnit.pos) return;

    const { data, resources: { get } } = world;
    const { map, units } = get();

    const FALLBACK_MULTIPLIER = -1;
    const attackRadius = targetUnit.radius + selfUnit.radius;
    const isValidUnit = createIsValidUnitFilter(data, targetUnit);

    let queueCommand = false;
    const rangedUnitAlly = units.getClosest(selfUnit.pos, selfUnit['selfUnits'].filter(isValidUnit))[0];

    if (!rangedUnitAlly) {
      moveToSurroundOrAttack();
      return;
    }

    const nearbyAllies = unitService.getUnitsInRadius(units.getAlive(Alliance.SELF), selfUnit.pos, 16);
    const meleeNearbyAllies = nearbyAllies.filter(unit => !isValidUnit(unit));
    const nearbyEnemies = unitService.getUnitsInRadius(enemyTrackingServiceV2.mappedEnemyUnits, targetUnit.pos, 16);

    if (this.shouldEngage(world, meleeNearbyAllies, nearbyEnemies)) {
      moveToSurroundPosition();
    } else if (rangedUnitAlly.pos && shouldFallback(world, selfUnit, rangedUnitAlly, targetUnit)) {
      moveToFallbackPosition();
    }

    attackIfApplicable();

    /**
     * @returns {boolean} - Indicates if the melee unit can attack the target unit.
     */
    function isAttackAvailable() {
      const distance = getDistance(selfUnit.pos, targetUnit.pos);
      const weapon = unitService.getWeaponThatCanAttack(data, selfUnit.unitType, targetUnit);
      return selfUnit.weaponCooldown <= 8 && distance <= (weapon?.range || 0) + attackRadius;
    }

    function moveToSurroundOrAttack() {
      const surroundPosition = getOptimalSurroundPosition();
      const command = isAttackAvailable() || !surroundPosition ? ATTACK_ATTACK : MOVE;
      createAndAddUnitCommand(command, selfUnit, surroundPosition || attackablePosition, collectedActions, queueCommand);
      queueCommand = !isAttackAvailable() && !!surroundPosition;
    }

    function moveToSurroundPosition() {
      const surroundPosition = getOptimalSurroundPosition();
      if (surroundPosition) {
        createAndAddUnitCommand(MOVE, selfUnit, surroundPosition, collectedActions);
        queueCommand = true;
      }
    }

    function moveToFallbackPosition() {
      const fallbackDirection = getDirection(rangedUnitAlly.pos, targetUnit.pos);
      const fallbackDistance = (rangedUnitAlly.radius + selfUnit.radius) * FALLBACK_MULTIPLIER;
      const position = moveInDirection(rangedUnitAlly.pos, fallbackDirection, fallbackDistance);
      createAndAddUnitCommand(MOVE, selfUnit, position, collectedActions);
      queueCommand = true;
    }

    function attackIfApplicable() {
      if (attackablePosition && selfUnit.weaponCooldown <= 8) {
        createAndAddUnitCommand(ATTACK_ATTACK, selfUnit, attackablePosition, collectedActions, queueCommand);
      }
    }

    /**
     * @returns {Point2D|null} - The optimal pathable surround position, or null if none is found.
     */
    function getOptimalSurroundPosition() {
      const pathablePositions = getBorderPositions(targetUnit.pos, attackRadius).filter(pos => map.isPathable(pos));
      if (pathablePositions.length === 0) return null;
      return pathablePositions.sort((a, b) => getDistance(b, selfUnit.pos) - getDistance(a, selfUnit.pos))[0];
    }
  }

  /**
   * Checks if the player's units are stronger at a specific position compared to enemy units.
   *
   * @param {World} world - The current game world state.
   * @param {Point2D} position - The position to check.
   * @returns {boolean} - Returns true if the player's units are stronger at the given position, otherwise false.
   */
  isStrongerAtPosition(world, position)  {
    const { units } = world.resources.get();

    /**
     * Retrieves units within a specified radius from a position.
     * @param {Unit[]} unitArray - Array of units.
     * @param {number} rad - Radius to filter units by.
     * @returns {Unit[]} - Units within the specified radius.
     */
    const getUnitsInRadius = (unitArray, rad) =>
      unitArray.filter(unit => unit.pos && getDistance(unit.pos, position) < rad);

    let enemyUnits = getUnitsInRadius(enemyTrackingServiceV2.mappedEnemyUnits, 16).filter(unitService.potentialCombatants);

    // If there's only one enemy and it's a non-combatant worker, disregard it
    if (enemyUnits.length === 1 && !unitService.potentialCombatants(enemyUnits[0])) {
      enemyUnits = [];
    }

    // If no potential enemy combatants, player is stronger by default
    if (!enemyUnits.length) return true;

    const selfUnits = getUnitsInRadius(units.getAlive(Alliance.SELF), 16).filter(unitService.potentialCombatants);

    return this.shouldEngage(world, selfUnits, enemyUnits);
  }

  /**
   * @param {World} world
   * @param {Unit} unit 
   * @param {Unit} targetUnit 
   * @param {Unit[]} enemyUnits 
   * @returns 
   */
  microB(world, unit, targetUnit, enemyUnits) {
    const { ADEPTPHASESHIFT } = UnitType;
    const { resources } = world;
    const { map } = resources.get();
    const collectedActions = [];
    const { pos, health, radius, shield, tag, unitType, weaponCooldown } = unit;
    if (pos === undefined || health === undefined || radius === undefined || shield === undefined || tag === undefined || unitType === undefined || weaponCooldown === undefined) { return collectedActions; }
    const { pos: targetPos, health: targetHealth, radius: targetRadius, shield: targetShield, unitType: targetUnitType } = targetUnit;
    if (targetPos === undefined || targetHealth === undefined || targetRadius === undefined || targetShield === undefined || targetUnitType === undefined) { return collectedActions; }
    const retreatCommand = createUnitCommand(MOVE, [unit]);
    if (unit.isWorker()) {
      // describe the logic block below
      // get worker retreat position
      let closestCandidateMineralField = getClosestSafeMineralField(resources, pos, targetPos);
      if (closestCandidateMineralField !== undefined) {
        retreatCommand.abilityId = HARVEST_GATHER;
        retreatCommand.targetUnitTag = closestCandidateMineralField.tag;
      } else {
        const awayPos = moveAwayPosition(map, targetPos, pos);
        if (awayPos !== null) {
          retreatCommand.targetWorldSpacePos = awayPos;
        }
      }
    } else {
      const awayPos = moveAwayPosition(map, targetPos, pos);
      if (awayPos !== null) {
        retreatCommand.targetWorldSpacePos = awayPos;
      }
    }
    const meleeTargetsInRangeFacing = enemyUnits.filter(enemyUnit => {
      const { pos: enemyPos, radius: enemyRadius } = enemyUnit; if (enemyPos === undefined || enemyRadius === undefined) { return false; }
      const meleeTargetInRangeFacing = (
        enemyUnit.isMelee() &&
        (getDistance(pos, enemyPos) + 0.05) - (radius + enemyRadius) < 0.5 &&
        microService.isFacing(targetUnit, unit)
      );
      return meleeTargetInRangeFacing;
    });
    const targetUnitsWeaponDPS = meleeTargetsInRangeFacing.reduce((acc, meleeTargetInRangeFacing) => {
      const { unitType: meleeTargetInRangeFacingUnitType } = meleeTargetInRangeFacing; if (meleeTargetInRangeFacingUnitType === undefined) { return acc; }
      return acc + getWeaponDPS(world, meleeTargetInRangeFacingUnitType, Alliance.ENEMY, [unitType]);
    }, 0);
    const totalUnitHealth = health + shield;
    const timeToBeKilled = totalUnitHealth / targetUnitsWeaponDPS * 22.4;
    if (
      meleeTargetsInRangeFacing.length > 0 &&
      (weaponCooldown > 8 || timeToBeKilled < 24)
    ) {
      console.log('unit.weaponCooldown', unit.weaponCooldown);
      console.log('distance(unit.pos, targetUnit.pos)', getDistance(pos, targetPos));
      collectedActions.push(retreatCommand);
    } else {
      const inRangeMeleeEnemyUnits = enemyUnits.filter(enemyUnit => enemyUnit.isMelee() && ((getDistance(pos, enemyUnit.pos) + 0.05) - (radius + enemyUnit.radius) < 0.25));
      const [weakestInRange] = inRangeMeleeEnemyUnits.sort((a, b) => (a.health + a.shield) - (b.health + b.shield));
      targetUnit = weakestInRange || targetUnit;
      /** @type {SC2APIProtocol.ActionRawUnitCommand} */
      const unitCommand = {
        abilityId: ATTACK_ATTACK,
        unitTags: [tag],
      }
      if (targetUnit.unitType === ADEPTPHASESHIFT) {
        unitCommand.targetWorldSpacePos = targetUnit.pos;
      } else {
        unitCommand.targetUnitTag = targetUnit.tag;
      }
      collectedActions.push(unitCommand);
    }
    return collectedActions;
  }

  /**
   * @param {World} world 
   * @param {Unit} unit 
   * @param {Unit} targetUnit 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  microRangedUnit(world, unit, targetUnit) {
    const { data } = world;

    if (shouldReturnEarly(unit) || shouldReturnEarly(targetUnit)) {
      return [];
    }

    if (this.shouldMicro(data, unit, targetUnit)) {
      return this.getActionsForMicro(world, unit, targetUnit);
    } else {
      // Another function for the logic in the 'else' block. It will make the main function cleaner.
      return getActionsForNotMicro(world, unit, targetUnit);
    }
  }

  /**
   * Processes the actions for non-worker units.
   *
   * Handles the decision-making logic for combat units based on their proximity to enemies, their health,
   * and other game state variables. Determines whether a unit should engage the enemy, retreat, or take
   * other specific actions.
   *
   * @param {World} world - The current state of the game world containing resources and units.
   * @param {Unit[]} selfUnits - An array of the player’s own units.
   * @param {Unit} selfUnit - The specific non-worker unit being processed.
   * @param {Point2D} position - The position to either move towards or retreat from.
   * @param {Unit[]} enemyUnits - An array of enemy units.
   * @param {SC2APIProtocol.ActionRawUnitCommand[]} collectedActions - An array of actions that are being collected to be executed.
   * @param {boolean} clearRocks - Indicates if destructible rocks should be targeted.
   */
  processNonWorkerUnit(world, selfUnits, selfUnit, position, enemyUnits, collectedActions, clearRocks) {
    const { getInRangeDestructables, getMovementSpeed, getWeaponThatCanAttack, setPendingOrders } = unitService;
    const { data, resources } = world;
    const { map, units } = resources.get();
    const { pos, radius, tag } = selfUnit;
    if (pos === undefined || radius === undefined || tag === undefined) return;

    const selfUnitsAttackingInRange = getUnitsAttackingInRange(world, selfUnits);
    let targetPosition = position;
    const [closestAttackableEnemyUnit] = units.getClosest(selfUnit.pos, enemyUnits.filter(enemyUnit => canAttack(selfUnit, enemyUnit, false)));
    const attackablePosition = closestAttackableEnemyUnit ? closestAttackableEnemyUnit.pos : null;
    if (closestAttackableEnemyUnit && getDistance(selfUnit.pos, closestAttackableEnemyUnit.pos) < 16) {
      const { pos: closestAttackableEnemyUnitPos, radius: closestAttackableEnemyUnitRadius, unitType: closestAttackableEnemyUnitType } = closestAttackableEnemyUnit; if (closestAttackableEnemyUnitPos === undefined || closestAttackableEnemyUnitRadius === undefined || closestAttackableEnemyUnitType === undefined) return;
      const engagementDistanceThreshold = 16; // Or whatever distance you choose
      const relevantSelfUnits = selfUnits.filter(unit => {
        if (!selfUnit.pos || !unit.pos) return false;
        return getDistance(unit.pos, selfUnit.pos) <= engagementDistanceThreshold;
      });
      const relevantEnemyUnits = enemyUnits.filter(unit => {
        if (unit.pos && selfUnit.pos) {
          return getDistance(unit.pos, selfUnit.pos) <= engagementDistanceThreshold;
        }
        return false;
      });
      const shouldEngageGroup = this.shouldEngage(world, relevantSelfUnits, relevantEnemyUnits);
      if (!shouldEngageGroup) {
        if (getMovementSpeed(map, selfUnit) < getMovementSpeed(map, closestAttackableEnemyUnit) && closestAttackableEnemyUnit.unitType !== ADEPTPHASESHIFT) {
          if (selfUnit.isMelee()) {
            collectedActions.push(...this.microB(world, selfUnit, closestAttackableEnemyUnit, enemyUnits));
          } else {
            const enemyInAttackRange = isEnemyInAttackRange(data, selfUnit, closestAttackableEnemyUnit);
            if (enemyInAttackRange) {
              collectedActions.push(...this.microRangedUnit(world, selfUnit, closestAttackableEnemyUnit));
            } else {
              const unitCommand = createUnitCommand(MOVE, [selfUnit]);
              unitCommand.targetWorldSpacePos = this.retreat(world, selfUnit, [closestAttackableEnemyUnit]);
              collectedActions.push(unitCommand);
            }
          }
        } else {
          const unitCommand = createUnitCommand(MOVE, [selfUnit]);
          if (selfUnit.isFlying) {
            if (attackablePosition) {
              createAndAddUnitCommand(MOVE, selfUnit, moveAwayPosition(map, attackablePosition, pos), collectedActions);
            }
          } else {
            if (selfUnit['pendingOrders'] === undefined || selfUnit['pendingOrders'].length === 0) {
              const closestEnemyRange = getClosestEnemyByRange(world, selfUnit, enemyUnits); if (closestEnemyRange === null) return;
              const { pos: closestEnemyRangePos } = closestEnemyRange; if (closestEnemyRangePos === undefined) return;
              if (!selfUnit.isMelee()) {
                const foundEnemyWeapon = getWeaponThatCanAttack(data, closestEnemyRange.unitType, selfUnit);
                if (foundEnemyWeapon) {
                  const bufferDistance = (foundEnemyWeapon.range + radius + closestEnemyRange.radius + getTravelDistancePerStep(map, closestEnemyRange) + getTravelDistancePerStep(map, selfUnit) * 1.1);
                  if ((bufferDistance) < getDistance(pos, closestEnemyRangePos)) {
                    // Check for ally units in the path
                    const pathToEnemy = MapResourceService.getMapPath(map, pos, closestEnemyRangePos);
                    if (pos && pos.x !== undefined && pos.y !== undefined) {
                      const offset = {
                        x: pos.x - Math.floor(pos.x),
                        y: pos.y - Math.floor(pos.y),
                      };

                      /**
                       * @param {Unit} unit 
                       * @returns {boolean}
                       */
                      const isNotAttackingNorHasAttackOrder = (unit) => {
                        // Replace this with your own function to check if the unit is not attacking and does not have a pending attack order
                        return !unit.isAttacking() && !unitService.getPendingOrders(unit).some(order => order.abilityId === ATTACK_ATTACK);
                      }

                      const allyUnitsInPath = selfUnits.filter(unit => {
                        return getPathCoordinates(pathToEnemy).some(pathPos => {
                          if (pathPos.x !== undefined && pathPos.y !== undefined) {
                            const adjustedPathPos = {
                              x: pathPos.x + offset.x,
                              y: pathPos.y + offset.y,
                            };

                            return unit.pos && getDistance(adjustedPathPos, unit.pos) <= (unit.radius !== undefined ? unit.radius : 0.5);
                          }
                          return false;
                        });
                      }).filter(isNotAttackingNorHasAttackOrder);

                      if (allyUnitsInPath.length === 0) {
                        // If no ally units are in the path, proceed with micro
                        collectedActions.push(...this.microRangedUnit(world, selfUnit, closestEnemyRange));
                      } else {
                        // If ally units are in the path, set the target world space position to retreat
                        unitCommand.targetWorldSpacePos = this.retreat(world, selfUnit, [closestEnemyRange] || [closestAttackableEnemyUnit]);
                        unitCommand.unitTags = selfUnits.filter(unit => getDistance(unit.pos, selfUnit.pos) <= 1).map(unit => {
                          setPendingOrders(unit, unitCommand);
                          return unit.tag;
                        });
                      }
                    }

                    return;
                  } else {
                    // retreat if buffer distance is greater than actual distance
                    unitCommand.targetWorldSpacePos = this.retreat(world, selfUnit, [closestEnemyRange] || [closestAttackableEnemyUnit]);
                    unitCommand.unitTags = selfUnits.filter(unit => getDistance(unit.pos, selfUnit.pos) <= 1).map(unit => {
                      setPendingOrders(unit, unitCommand);
                      return unit.tag;
                    });
                  }
                } else {
                  // no weapon found, micro ranged unit
                  collectedActions.push(...this.microRangedUnit(world, selfUnit, closestEnemyRange || closestAttackableEnemyUnit));
                  return;
                }
              } else {
                // retreat if melee
                unitCommand.targetWorldSpacePos = this.retreat(world, selfUnit, [closestEnemyRange || closestAttackableEnemyUnit]);
              }
            } else {
              // skip action if pending orders
              return;
            }
          }
          collectedActions.push(unitCommand);
        }
      } else {
        setRecruitToBattleLabel(selfUnit, attackablePosition);
        if (canAttack(selfUnit, closestAttackableEnemyUnit, false)) {
          if (!selfUnit.isMelee()) {
            collectedActions.push(...this.microRangedUnit(world, selfUnit, closestAttackableEnemyUnit));
          } else {
            this.handleMeleeUnitLogic(world, selfUnit, closestAttackableEnemyUnit, attackablePosition, collectedActions);
          }
        } else {
          collectedActions.push({
            abilityId: ATTACK_ATTACK,
            targetWorldSpacePos: attackablePosition,
            unitTags: [tag],
          });
        }
      }
    } else {
      if (selfUnit.unitType !== QUEEN) {
        const unitCommand = {
          abilityId: ATTACK_ATTACK,
          unitTags: [tag],
        }
        const destructableTag = getInRangeDestructables(units, selfUnit);
        if (destructableTag && clearRocks && !this.outpowered) {
          const destructable = units.getByTag(destructableTag);
          const { pos, radius } = destructable; if (pos === undefined || radius === undefined) { return; }
          const { pos: selfPos, radius: selfRadius, unitType: selfUnitType } = selfUnit; if (selfPos === undefined || selfRadius === undefined || selfUnitType === undefined) { return; }
          const weapon = getWeaponThatCanAttack(data, selfUnitType, destructable); if (weapon === undefined) { return; }
          const { range } = weapon; if (range === undefined) { return; }
          const attackRadius = radius + selfRadius + range;
          const destructableBorderPositions = getBorderPositions(pos, attackRadius);
          const fitablePositions = destructableBorderPositions
            .filter(borderPosition => {
              // Adding a check for pathability
              if (!map.isPathable(borderPosition)) {
                return false;
              }

              return selfUnitsAttackingInRange.every(attackingInRangeUnit => {
                const { pos: attackingInRangePos, radius: attackingInRangeRadius } = attackingInRangeUnit;
                if (attackingInRangePos === undefined || attackingInRangeRadius === undefined) {
                  return false;
                }

                const distanceFromAttackingInRangeUnit = getDistance(borderPosition, attackingInRangePos);
                return distanceFromAttackingInRangeUnit > attackingInRangeRadius + selfRadius;
              });
            })
            .sort((a, b) => getDistance(a, selfPos) - getDistance(b, selfPos));
          if (fitablePositions.length > 0 && getDistance(pos, selfPos) > attackRadius + 1) {
            targetPosition = fitablePositions[0];
            const moveUnitCommand = createUnitCommand(MOVE, [selfUnit]);
            moveUnitCommand.targetWorldSpacePos = targetPosition;
            collectedActions.push(moveUnitCommand);
            unitCommand.queueCommand = true;
          }
          unitCommand.targetUnitTag = destructable.tag;
        }
        else {
          const [closestCompletedBunker] = units.getClosest(selfUnit.pos, units.getById(BUNKER).filter(bunker => bunker.buildProgress >= 1));
          if (closestCompletedBunker && closestCompletedBunker.abilityAvailable(LOAD_BUNKER)) {
            unitCommand.abilityId = SMART;
            unitCommand.targetUnitTag = closestCompletedBunker.tag;
          } else {
            unitCommand.targetWorldSpacePos = targetPosition;
          }
        }
        collectedActions.push(unitCommand);
      }
    }
  }

  /**
   * Process the logic for a single unit of the player.
   *
   * @param {World} world - The game world.
   * @param {Unit[]} selfUnits - Array of player units.
   * @param {Unit} selfUnit - The player's unit.
   * @param {Point2D} position - Point to either move towards or retreat from.
   * @param {Unit[]} enemyUnits - Array of enemy units.
   * @param {SC2APIProtocol.ActionRawUnitCommand[]} collectedActions - Array of collected actions.
   * @param {boolean} clearRocks - Indicates if destructible rocks should be targeted.
   */
  processSelfUnitLogic(world, selfUnits, selfUnit, position, enemyUnits, collectedActions, clearRocks) {
    // Your specific implementations and constants, such as groupTypes, need to be defined elsewhere in your code
    const { workerTypes } = groupTypes;
    const { pos, radius, tag } = selfUnit;
    if (pos === undefined || radius === undefined || tag === undefined) return;

    // Log condition based on game world time
    const logCondition = world.resources.get().frame.timeInSeconds() > 215 && world.resources.get().frame.timeInSeconds() < 245;

    // Process logic for non-worker units
    if (!workerTypes.includes(selfUnit.unitType) || selfUnit.labels.has('defending')) {
      this.processNonWorkerUnit(world, selfUnits, selfUnit, position, enemyUnits, collectedActions, clearRocks);
    }

    // Log actions if specific conditions are met (for debugging or analysis)
    if (selfUnit.unitType === QUEEN && logCondition) {
      const queenActions = collectedActions.filter(action => action.unitTags && action.unitTags.includes(tag));
      console.log(`Queen ${tag} collectedActions: ${JSON.stringify(queenActions)}`);
    }
  }

  /**
   * @param {World} world 
   * @param {Unit} unit 
   * @param {Unit[]} targetUnits 
   * @returns {Point2D|undefined}
   */
  retreat(world, unit, targetUnits = [], toCombatRally = true) {
    const { data, resources } = world;
    const { map } = resources.get();
    const { pos } = unit;

    // Early return conditions
    if (!pos || targetUnits.length === 0) return;

    const threats = targetUnits.reduce((/** @type {{ unit: Unit, weapon: SC2APIProtocol.Weapon | undefined, attackRange: number | undefined }[]} */ acc, target) => {
      if (target.unitType !== undefined) {
        const weapon = unitService.getWeaponThatCanAttack(data, target.unitType, unit);
        const attackRange = weapon?.range;
        acc.push({
          unit: target,
          weapon,
          attackRange
        });
      }
      return acc;
    }, []);

    const travelDistancePerStep = 2 * getTravelDistancePerStep(map, unit);
    // Sort threats based on a certain criteria, for this example, based on attack range, descending.
    const sortedThreats = threats.sort((a, b) => (b.attackRange || 0) - (a.attackRange || 0));

    const primaryThreat = sortedThreats[0];

    if (primaryThreat.weapon === undefined || primaryThreat.attackRange === undefined) return;

    if (this.shouldRetreatToCombatRally(world, unit, primaryThreat.unit, toCombatRally, travelDistancePerStep)) {
      return this.getCombatRally(resources);
    }

    if (shouldRetreatToBunker(resources, pos)) {
      const bunkerPosition = getClosestBunkerPosition(resources, pos);
      return bunkerPosition !== null ? bunkerPosition : undefined;
    }

    if (targetUnits.length > 1) {
      const targetPositions = targetUnits.reduce((/** @type {Point2D[]} */ acc, t) => {
        if (t.pos) {
          acc.push(t.pos);
        }
        return acc;
      }, []);
      return moveAwayFromMultiplePositions(map, targetPositions, pos);
    } else if (targetUnits.length === 1) {
      return this.determineBestRetreatPoint(world, unit, targetUnits[0], travelDistancePerStep);
    }
  }

  /**
   * @param {ResourceManager} resources 
   * @param {Unit[]} units 
   * @param {Unit} target 
   * @returns {Unit}
   */
  setCombatPoint(resources, units, target) {
    const [combatPoint] = pathFindingService.getClosestUnitByPath(resources, target.pos, units);
    combatPoint.labels.set('combatPoint', true);
    return combatPoint;
  }
  
  /**
   * @param {ResourceManager} resources
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  setCombatBuildingsRallies(resources) {
    const { map, units } = resources.get();
    const collectedActions = [];
    units.getById([BARRACKS, FACTORY, STARPORT]).forEach(building => {
      const { pos, buildProgress } = building;
      if (!pos || !buildProgress) return;
      if (buildProgress < 1) return;
      const foundRallyAbility = building.availableAbilities().find(ability => ability === Ability.RALLY_BUILDING);
      if (foundRallyAbility) {
        const unitCommand = createUnitCommand(foundRallyAbility, [building]);
        let rallyPosition = this.getCombatRally(resources);
        const [closestEnemyUnit] = units.getClosest(pos, units.getAlive(Alliance.ENEMY)).filter(enemyUnit => enemyUnit.pos && getDistance(enemyUnit.pos, pos) < 16);
        if (closestEnemyUnit && building['selfDPSHealth'] < closestEnemyUnit['selfDPSHealth']) {
          if (!closestEnemyUnit.pos) return;
          const movedAwayPosition = moveAwayPosition(map, closestEnemyUnit.pos, pos);
          if (movedAwayPosition) {
            rallyPosition = movedAwayPosition;
          }
        }
        if (rallyPosition) {
          unitCommand.targetWorldSpacePos = rallyPosition;
          collectedActions.push(unitCommand);
        }
      }
    });
    return collectedActions;
  }

  /**
   * Determines if a group of selfUnits should engage against a group of enemyUnits.
   * @param {World} world
   * @param {Unit[]} selfUnits
   * @param {Unit[]} enemyUnits
   * @returns {boolean}
   */
  shouldEngage(world, selfUnits, enemyUnits) {
    const combatantSelfUnits = selfUnits.filter(unitService.potentialCombatants);
    const combatantEnemyUnits = enemyUnits.filter(unitService.potentialCombatants);

    const selfGroupDPS = calculateGroupDPS(world, combatantSelfUnits, combatantEnemyUnits);
    const enemyGroupDPS = calculateGroupDPS(world, combatantEnemyUnits, combatantSelfUnits);
    const selfGroupHealthAndShields = calculateGroupHealthAndShields(combatantSelfUnits);
    const enemyGroupHealthAndShields = calculateGroupHealthAndShields(combatantEnemyUnits);

    // Defensive measures against division by zero
    const dpsRatio = (enemyGroupDPS !== 0) ? selfGroupDPS / enemyGroupDPS : (selfGroupDPS > 0 ? Infinity : 1);
    const healthRatio = (enemyGroupHealthAndShields !== 0) ? selfGroupHealthAndShields / enemyGroupHealthAndShields : (selfGroupHealthAndShields > 0 ? Infinity : 1);

    const dpsThreshold = 1.0;
    const healthThreshold = 1.0;

    return dpsRatio >= dpsThreshold && healthRatio >= healthThreshold;
  }

  /**
   * @param {DataStorage} data
   * @param {Unit} unit 
   * @param {Unit} targetUnit
   * @returns {boolean}
   */
  shouldMicro(data, unit, targetUnit) {
    const { enemyUnitsPositions } = enemyTrackingService;
    const { pos, radius, unitType, weaponCooldown } = unit; if (pos === undefined || radius === undefined || unitType === undefined || weaponCooldown === undefined) return false;
    const { pos: targetPos, radius: targetRadius, tag } = targetUnit; if (targetPos === undefined || targetRadius === undefined || tag === undefined) return false;
    const weaponCooldownOverStepSize = weaponCooldown > 8;
    const targetPositions = enemyUnitsPositions.get(tag);
    let projectedTargetPosition = targetPositions !== undefined && getProjectedPosition(targetPositions.current.pos, targetPositions.previous.pos, targetPositions.current.lastSeen, targetPositions.previous.lastSeen);
    projectedTargetPosition = projectedTargetPosition ? projectedTargetPosition : targetPos;
    const weapon = getWeapon(data, unit, targetUnit); if (weapon === undefined) return false;
    const { range } = weapon; if (range === undefined) return false;
    const distanceToProjectedPosition = getDistance(projectedTargetPosition, pos);
    const isProjectedPositionInRange = distanceToProjectedPosition < (range + radius + targetRadius);
    return (weaponCooldownOverStepSize || unitType === UnitType.CYCLONE) && isProjectedPositionInRange;
  }

  /**
   * @param {World} world
   * @param {Unit} unit
   * @param {Unit} targetUnit
   * @param {boolean} toCombatRally
   * @param {number} travelDistancePerStep
   * @returns {boolean}
   */
  shouldRetreatToCombatRally(world, unit, targetUnit, toCombatRally, travelDistancePerStep) {
    if (!toCombatRally || !unit.pos || !targetUnit.pos || !targetUnit.unitType) return false;

    const { resources } = world;
    const { map, units } = resources.get();
    const combatRally = this.getCombatRally(resources);

    // Check if we're stronger at the combatRally position
    if (!this.isStrongerAtPosition(world, combatRally)) return false;

    const unitToCombatRallyDistance = pathFindingService.getDistanceByPath(resources, unit.pos, combatRally);
    if (unitToCombatRallyDistance <= travelDistancePerStep || unitToCombatRallyDistance === Infinity) return false;

    const targetUnitToCombatRallyDistance = pathFindingService.getDistanceByPath(resources, targetUnit.pos, combatRally);
    if (unitToCombatRallyDistance > targetUnitToCombatRallyDistance) return false;

    const bunkerPositions = units.getById(UnitType.BUNKER).reduce((/** @type {Point2D[]} */acc, unit) => {
      if (unit.buildProgress === 1 && unit.pos) {
        acc.push(unit.pos);
      }
      return acc;
    }, []);

    const [closestBunkerPositionByPath] = getClosestPositionByPathSorted(resources, unit.pos, bunkerPositions);

    const distanceFromCombatRallyToUnit = pathFindingService.getDistanceByPath(resources, combatRally, unit.pos);
    const distanceFromBunkerToUnit = closestBunkerPositionByPath ? pathFindingService.getDistanceByPath(resources, closestBunkerPositionByPath.point, unit.pos) : Infinity;
    if (distanceFromCombatRallyToUnit >= distanceFromBunkerToUnit) return false;

    const pathToRally = MapResourceService.getMapPath(map, unit.pos, combatRally);
    return isSafePathToRally(world, unit, pathToRally);
  }
}

module.exports = new ArmyManagementService();

/**
 * Identify enemy units in proximity to a primary target.
 *
 * @param {World} _world The current game state.
 * @param {Unit} _unit The unit we're focusing on.
 * @param {Unit} targetUnit The primary enemy unit we're concerned about.
 * @returns {Unit[]} Array of enemy units near the target.
 */
function findNearbyThreats(_world, _unit, targetUnit) {
  const NEARBY_THRESHOLD = 16; // Define the threshold value based on the game's logic

  // Use the enemy tracking service to get all enemy units
  const allEnemyUnits = enemyTrackingServiceV2.mappedEnemyUnits;

  return allEnemyUnits.filter((enemy) => {
    const { tag, pos } = enemy;

    // Use early returns to filter out non-threatening or irrelevant units
    if (tag === targetUnit.tag || isNonThreateningUnit(enemy)) {
      return false;
    }

    // Check proximity to target unit
    return getDistance(pos, targetUnit.pos) <= NEARBY_THRESHOLD;
  });
}
/**
 * Determine if the provided unit is considered non-threatening, such as workers.
 *
 * @param {Unit} unit - The unit to evaluate.
 * @returns {boolean} - True if the unit is non-threatening; otherwise, false.
 */
function isNonThreateningUnit(unit) {
  return groupTypes.workerTypes.includes(unit.unitType);
}

/**
 * Calculates the optimal distance a unit should maintain from enemies to effectively utilize its attack range and their sizes.
 *
 * @param {World} world - The current state of the game world.
 * @param {Unit} unit - The unit being controlled.
 * @param {Unit[]} enemies - Array of enemy units that pose a threat.
 * @returns {number} - The calculated optimal distance from the enemies, considering both attack range and unit sizes.
 * @throws {Error} When there is no weapon data available for the given unit.
 */
function getOptimalAttackDistance(world, unit, enemies) {
  if (!enemies.length) {
    throw new Error('No enemies provided');
  }

  const { data } = world;

  // Handle the case where weapon or range data is not available
  const unitWeapon = unitService.getWeaponThatCanAttack(data, unit.unitType, enemies[0]);
  if (!unitWeapon || typeof unitWeapon.range !== 'number') {
    throw new Error('Weapon data unavailable for the specified unit');
  }

  const unitAttackRange = unitWeapon.range;

  const unitRadius = unit.radius || 0; // Assume default unit radius property; replace as needed
  const threatRadius = enemies[0].radius || 0; // Assume default threat radius property; replace as needed

  return unitAttackRange + unitRadius + threatRadius;
}


/**
 * @description Returns projected position of unit.
 * @param {Point2D} pos
 * @param {Point2D} pos1
 * @param {number} time
 * @param {number} time1
 * @param {number} [stepSize=8]
 * @returns {Point2D}
 */
function getProjectedPosition(pos, pos1, time, time1, stepSize = 8) {
  const { x, y } = pos; if (x === undefined || y === undefined) return pos;
  const { x: x1, y: y1 } = pos1; if (x1 === undefined || y1 === undefined) return pos;
  const timeDiff = time1 - time;
  if (timeDiff === 0) return pos;
  const adjustedTimeDiff = timeDiff / stepSize;
  const xDiff = x1 - x;
  const yDiff = y1 - y;
  const projectedPosition = {
    x: x + xDiff / adjustedTimeDiff,
    y: y + yDiff / adjustedTimeDiff,
  };
  return projectedPosition;
}

/**
 * Calculates the potential damage a unit can receive from the most dangerous enemy
 * and estimates a safety buffer for retreat. This safety buffer is calculated based
 * on the maximum damage that any single nearby enemy unit can inflict on the given
 * unit, considering unit types and alliances.
 * 
 * @param {World} world - An object representing the game state or environment, 
 *                        containing data and resources needed for calculations.
 * @param {Unit} unit - The player’s unit for which the potential damage and safety 
 *                      buffer is to be calculated.
 * @param {Unit[]} enemyUnits - An array of nearby enemy units that may pose a threat
 *                              to the player’s unit.
 * @returns {number} - The safety buffer, representing the maximum potential damage 
 *                     that the given unit can receive from any single enemy unit.
 */
function calculateSafetyBuffer(world, unit, enemyUnits) {
  const maxPotentialDamage = enemyUnits.reduce((maxDamage, enemy) => {
    if (enemy.unitType !== undefined) {
      const damage = getWeaponDamage(world, enemy.unitType, unit);
      return Math.max(maxDamage, damage);
    }
    return maxDamage;
  }, 0);

  return maxPotentialDamage;
}

/**
 * @param {World} world
 * @param {Unit[]} units
 * @returns {Unit[]}
 * @description returns units that are attacking something in range
 */
function getUnitsAttackingInRange(world, units) {
  const { data, resources } = world;
  const { units: unitsResource } = resources.get();
  const { getWeaponThatCanAttack } = unitService;
  return units.filter(unit => {
    if (unit.isAttacking()) {
      const { orders, pos, radius, unitType } = unit; if (orders === undefined || pos === undefined || radius === undefined || unitType === undefined) { return false; }
      const attackingOrder = orders.find(order => order.abilityId === ATTACK_ATTACK); if (attackingOrder === undefined) { return false; }
      const { targetUnitTag } = attackingOrder; if (targetUnitTag === undefined) { return false; }
      const targetUnit = unitsResource.getByTag(targetUnitTag); if (targetUnit === undefined) { return false; }
      const { pos: targetPos, radius: targetRadius } = targetUnit; if (targetPos === undefined || targetRadius === undefined) { return false; }
      const weapon = getWeaponThatCanAttack(data, unitType, targetUnit); if (weapon === undefined) { return false; }
      const { range } = weapon; if (range === undefined) { return false; }
      const shootingRange = range + radius + targetRadius;
      return getDistance(pos, targetPos) < shootingRange;
    }
  });
}

/**
 * @param {DataStorage} data
 * @param {Unit} unit 
 * @param {Unit} targetUnit 
 * @returns {Boolean}
 */
function isEnemyInAttackRange(data, unit, targetUnit) {
  const { getWeaponThatCanAttack } = unitService;
  const { pos, radius, unitType } = unit;
  if (!pos || !radius || !unitType || !targetUnit.pos || !targetUnit.radius) return false;
  // check if properties exist
  const foundWeapon = getWeaponThatCanAttack(data, unitType, targetUnit);
  return foundWeapon && foundWeapon.range ? (foundWeapon.range >= getDistance(pos, targetUnit.pos) + radius + targetUnit.radius) : false;
}

/**
 * Create a command and add it to the collected actions.
 * @param {AbilityId} abilityId - The ability or command ID.
 * @param {Unit} selfUnit - The unit issuing the command.
 * @param {Point2D} targetPosition - The target position for the command.
 * @param {SC2APIProtocol.ActionRawUnitCommand[]} collectedActions - A collection of actions to execute.
 * @param {boolean} [queue=false] - Whether to queue this command or not.
 * @returns {SC2APIProtocol.ActionRawUnitCommand}
 */
function createAndAddUnitCommand(abilityId, selfUnit, targetPosition, collectedActions, queue = false) {
  const unitCommand = createUnitCommand(abilityId, [selfUnit]);
  unitCommand.targetWorldSpacePos = targetPosition;

  if (queue) {
    // Assuming your SC2APIProtocol.ActionRawUnitCommand has a queue attribute, if not, adjust accordingly.
    unitCommand.queueCommand = true;
  }

  collectedActions.push(unitCommand);
  return unitCommand;  // Return the created unitCommand
}

/**
 * @param {World} world
 * @param {Unit} unit
 * @param {Unit[]} enemyUnits
 * @returns {Unit|null}
 */
function getClosestEnemyByRange(world, unit, enemyUnits) {
  const { data, resources } = world;
  const { map } = resources.get();
  const { getWeaponThatCanAttack } = unitService;
  let shortestDifference = Number.MAX_VALUE;
  return enemyUnits.reduce((closestEnemyByRange, enemyUnit) => {
    const weapon = getWeaponThatCanAttack(data, enemyUnit.unitType, unit);
    if (weapon) {
      const range = weapon.range + unit.radius + enemyUnit.radius + getTravelDistancePerStep(map, enemyUnit);
      const distanceToUnit = getDistance(unit.pos, enemyUnit.pos);
      const difference = distanceToUnit - range;
      if (difference < shortestDifference) {
        shortestDifference = difference;
        closestEnemyByRange = enemyUnit;
      }
    }
    return closestEnemyByRange;
  });
}

/**
 * @param {Unit} unit 
 * @param {Point2D} position 
 */
function setRecruitToBattleLabel(unit, position) {
  unit['selfUnits'].forEach((/** @type {Unit} */ selfUnit) => {
    if (getDistance(selfUnit.pos, position) > 16) {
      if (selfUnit.isWorker()) {
        if (selfUnit.isHarvesting() || selfUnit.isConstructing() || selfUnit.labels.has('retreating')) {
          return;
        }
      }
      selfUnit.labels.set('recruitToBattle', position);
    }
  });
}

/**
 * @param {DataStorage} data
 * @param {Unit} targetUnit
 * @returns {(unit: Unit) => boolean | undefined}
 */
function createIsValidUnitFilter(data, targetUnit) {
  return (/** @type {Unit} */ unit) => {
    const hasValidWeapon = unit.data().weapons?.some(w => w.range !== undefined && w.range > 1);
    return unit.unitType !== undefined && hasValidWeapon && unitService.getWeaponThatCanAttack(data, unit.unitType, targetUnit) !== undefined;
  };
}

/**
 * Determine if the unit should fallback to a defensive position.
 * @param {World} world 
 * @param {Unit} selfUnit
 * @param {Unit} rangedUnitAlly
 * @param {Unit} targetUnit
 * @returns {boolean} - True if the unit should fallback, false otherwise.
 */
function shouldFallback(world, selfUnit, rangedUnitAlly, targetUnit) {
  const { pos: rangedUnitAllyPos, radius: rangedUnitAllyRadius } = rangedUnitAlly;
  if (!rangedUnitAllyPos || !rangedUnitAllyRadius) return false;
  return checkPositionValidityForAttack(world, selfUnit, rangedUnitAlly, targetUnit) === 'fallback';
}

/**
 * @param {World} world
 * @param {Unit} selfUnit
 * @param {Unit} rangedUnitAlly
 * @param {Unit} targetUnit
 * @returns {string} 'fallback' or 'engage'
 */
function checkPositionValidityForAttack(world, selfUnit, rangedUnitAlly, targetUnit) {
  const { data, resources } = world;
  const { map } = resources.get();
  const { pos } = selfUnit;
  if (pos === undefined) return 'engage';

  const { pos: rangedUnitAllyPos, radius: rangedUnitAllyRadius, unitType: rangedUnitAllyUnitType } = rangedUnitAlly;
  if (rangedUnitAllyPos === undefined || rangedUnitAllyRadius === undefined || rangedUnitAllyUnitType === undefined) return 'engage';

  const { pos: targetUnitPos, radius: targetUnitRadius, unitType: targetUnitType } = targetUnit;
  if (targetUnitPos === undefined || targetUnitRadius === undefined || targetUnitType === undefined) return 'engage';

  const distanceBetweenUnits = getDistance(pos, rangedUnitAllyPos);
  const rangedAllyEdgeDistance = getDistance(rangedUnitAllyPos, targetUnitPos) - rangedUnitAllyRadius - targetUnitRadius;
  const rangedAllyWeapon = unitService.getWeaponThatCanAttack(data, rangedUnitAllyUnitType, targetUnit);

  if (!rangedAllyWeapon) return 'engage'; // Exit if the ranged ally has no weapon that can attack the target

  const enemyWeapon = unitService.getWeaponThatCanAttack(data, targetUnitType, rangedUnitAlly);
  const enemyRange = enemyWeapon ? enemyWeapon.range ?? 0 : 0; // If the enemy has no weapon, assume 0 range

  const enemyTravelDistancePerStep = getTravelDistancePerStep(map, targetUnit);
  const meleeTravelDistancePerStep = getTravelDistancePerStep(map, selfUnit);
  const minDistanceForMove = Math.max(0, enemyRange + enemyTravelDistancePerStep + meleeTravelDistancePerStep);

  const allyTravelDistancePerStep = getTravelDistancePerStep(map, rangedUnitAlly);
  const rangedAllyWeaponRange = rangedAllyWeapon.range || 0;

  if (rangedAllyEdgeDistance > rangedAllyWeaponRange + allyTravelDistancePerStep &&
    distanceBetweenUnits > minDistanceForMove) {
    return 'fallback';
  }

  return 'engage';
}

/**
 * Calculates the directional vector from one position to another.
 * @param {Point2D} startPos - The starting position with x and y properties.
 * @param {Point2D} targetPos - The target position with x and y properties.
 * @returns {Point2D} - The directional vector with x and y properties.
 */
function getDirection(startPos, targetPos) {
  let dx = (targetPos.x ?? 0) - (startPos.x ?? 0);
  let dy = (targetPos.y ?? 0) - (startPos.y ?? 0);

  // Calculate the length of the vector to normalize it to a unit vector.
  let length = Math.sqrt(dx * dx + dy * dy);

  // Normalize the vector to a length of 1 (if length is not 0).
  if (length > 0) {
    dx /= length;
    dy /= length;
  }

  return {
    x: dx,
    y: dy
  };
}

/**
 * Move in a specified direction from a starting point by a certain distance.
 *
 * @param {Object} startPos - Starting position with x and y properties.
 * @param {Object} direction - Direction with normalized x and y properties.
 * @param {number} distance - The distance to move in the given direction.
 * @returns {Object} - New position after moving.
 */
function moveInDirection(startPos, direction, distance) {
  if (startPos.x === undefined || startPos.y === undefined || direction.x === undefined || direction.y === undefined) {
    // Handle the error as needed, e.g., throw an error or return a default value
    throw new Error("Position or direction properties are undefined.");
  }

  return {
    x: startPos.x + direction.x * distance,
    y: startPos.y + direction.y * distance
  };
}

/**
 * Calculates the total DPS of a group of units based on enemy composition.
 * 
 * @param {World} world - The game world.
 * @param {Unit[]} unitsGroup - Array of units whose total DPS needs to be calculated.
 * @param {Unit[]} enemyUnits - Array of enemy units.
 * @returns {number} - Total DPS of the group against the provided enemy units.
 */
function calculateGroupDPS(world, unitsGroup, enemyUnits) {
  let totalDPS = 0;

  for (let unit of unitsGroup) {
    // Check if unitType is defined before proceeding
    if (unit.unitType !== undefined) {
      // Fetch the DPS values for each weapon of the unit type
      const unitDPSArray = getUnitDPS(world, unit.unitType);

      // If the unit has multiple weapons, choose the best one based on enemy composition
      const bestWeaponDPS = chooseBestWeaponDPS(unitDPSArray, enemyUnits);

      totalDPS += bestWeaponDPS;
    }
  }

  return totalDPS;
}

/**
 * Calculates the Damage Per Second (DPS) for each weapon of a given unit type.
 * 
 * @param {World} world - The game world.
 * @param {number} unitType - The type ID of the unit.
 * @returns {import("../../../interfaces/weapon-dps").WeaponDPS[]} - An array of DPS values for each weapon of the unit.
 */
function getUnitDPS(world, unitType) {
  // Fetch unit data
  const unitData = world.data.getUnitTypeData(unitType);

  // If the unit doesn't exist or doesn't have weapons, return an empty array
  if (!unitData?.weapons?.length) {
    return [];
  }

  // Map each weapon to its DPS
  const dpsArray = unitData.weapons.map(weapon => {
    // Using optional chaining to safely access properties
    const damage = weapon?.damage ?? 0;  // Default to 0 if undefined
    const speed = weapon?.speed ?? 1;    // Default to 1 if undefined to prevent division by zero
    const attacks = weapon?.attacks ?? 1; // Default to 1 if undefined

    // Compute DPS considering multiple attacks
    const dps = speed > 0 ? (damage * attacks) / speed : 0;

    // Generate a descriptor for the weapon
    const descriptor = `Type: ${weapon.type}, Damage: ${damage}, Range: ${weapon.range}, Speed: ${speed}, Attacks: ${attacks}`;

    return {
      name: descriptor,
      dps: dps,
      type: weapon?.type ?? WeaponTargetType.ANY, // default to ANY if type is undefined
    };
  });

  return dpsArray;
}

/**
 * Chooses the average of the best weapon's DPS against each enemy unit.
 * 
 * @param {import("../../../interfaces/weapon-dps").WeaponDPS[]} dpsArray - DPS values for each weapon of a unit.
 * @param {Unit[]} enemyUnits - Array of enemy units.
 * @returns {number} - Average of the best DPS values against each of the provided enemy units.
 */
function chooseBestWeaponDPS(dpsArray, enemyUnits) {
  let totalBestDPS = 0;

  for (let enemy of enemyUnits) {
    let bestDPSForEnemy = 0;
    let targetPreference = enemy.isFlying ? WeaponTargetType.AIR : WeaponTargetType.GROUND;

    for (let dps of dpsArray) {
      switch (targetPreference) {
        case WeaponTargetType.AIR:
          if (dps.type === WeaponTargetType.AIR && dps.dps > bestDPSForEnemy) {
            bestDPSForEnemy = dps.dps;
          }
          break;
        case WeaponTargetType.GROUND:
          if (dps.type === WeaponTargetType.GROUND && dps.dps > bestDPSForEnemy) {
            bestDPSForEnemy = dps.dps;
          }
          break;
        default:
          if (dps.dps > bestDPSForEnemy) {
            bestDPSForEnemy = dps.dps;
          }
          break;
      }
    }

    totalBestDPS += bestDPSForEnemy;
  }

  return enemyUnits.length > 0 ? totalBestDPS / enemyUnits.length : 0;
}

/**
 * Calculate the combined health and shields of a group of units.
 * @param {Unit[]} units
 * @returns {number}
 */
function calculateGroupHealthAndShields(units) {
  return units.reduce((total, unit) => total + (unit.health || 0) + (unit.shield || 0), 0);
}

/**
 * @param {Unit} unit
 * @returns {boolean}
 */
function shouldReturnEarly(unit) {
  const properties = ['alliance', 'pos', 'radius', 'tag', 'unitType'];
  return properties.some(prop => unit[prop] === undefined);
}

/**
 * Computes and returns the actions for a given unit when not micro-managing.
 *
 * @param {World} world - The game state or environment.
 * @param {Unit} unit - The unit we're calculating actions for.
 * @param {Unit} targetUnit - A specific target unit.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of commands or actions for the unit.
 */
function getActionsForNotMicro(world, unit, targetUnit) {
  const MAX_DISTANCE = 16; // Maximum distance to consider for engagement

  const { data, resources } = world;
  const currentStep = resources.get().frame.getGameLoop();

  if (!isUnitDataComplete(unit) || !unit.pos) return [];

  const weaponResults = computeWeaponsResults(unit, targetUnit);
  if (!weaponResults) return [];

  let immediateThreat = findImmediateThreat(data, unit, weaponResults.targetableEnemyUnits);
  if (immediateThreat) return [createAttackCommand(unit, immediateThreat)];

  let optimalTarget = findOptimalTarget(world, unit, weaponResults.targetableEnemyUnits, currentStep, MAX_DISTANCE);

  if (optimalTarget && optimalTarget.tag && typeof optimalTarget.unitType === 'number' && typeof unit.unitType === 'number' && unit.alliance !== undefined) {
    const unitDamagePerHit = getWeaponDamage(world, unit.unitType, optimalTarget);
    if (unitDamagePerHit > 0) {
      setDamageForTag(optimalTarget.tag, unitDamagePerHit, currentStep);
      return [createAttackCommand(unit, optimalTarget)];
    }
  }

  // Default action: Attack the first enemy unit in range
  if (weaponResults.targetableEnemyUnits.length > 0) {
    return [createAttackCommand(unit, weaponResults.targetableEnemyUnits[0])];
  }

  return [];
}

/**
 * Checks if the provided unit has all necessary data properties.
 * 
 * @param {Unit} unit - The unit object to check.
 * @returns {boolean} - Returns true if the unit has all required properties, otherwise false.
 */
function isUnitDataComplete(unit) {
  return Boolean(
    unit.pos &&
    unit.radius &&
    unit.unitType &&
    unit.alliance
  );
}


/**
 * Computes weapon results, specifically determining which enemy units are in weapon range,
 * which are targetable by weapon type, and if the target unit is in range.
 * @param {Unit} unit - The unit object.
 * @param {Unit} targetUnit - The target unit object.
 * @returns {{ targetUnitInRange: boolean, enemyUnitsInRange: Unit[], targetableEnemyUnits: Unit[] }}
 */
function computeWeaponsResults(unit, targetUnit) {
  const { pos, radius } = unit;
  const { weapons } = unit.data();

  if (!weapons || !pos || !targetUnit.pos) return {
    targetUnitInRange: false,
    enemyUnitsInRange: [],
    targetableEnemyUnits: []
  };

  const unitEffectiveRadius = radius || 0;
  const targetPos = targetUnit.pos;

  let targetUnitInRange = false;
  const enemyUnitsInRange = new Set();
  const targetableEnemyUnitsSet = new Set();

  weapons.forEach(weapon => {
    const { range, type } = weapon;
    if (range === undefined) return;

    const weaponRange = range + unitEffectiveRadius + (targetUnit.radius || 0);
    if (!targetUnitInRange) targetUnitInRange = getDistance(pos, targetPos) < weaponRange;

    const currentTargetableEnemyUnits = getTargetableEnemyUnits(type);
    currentTargetableEnemyUnits.forEach(targetableEnemyUnit => {
      targetableEnemyUnitsSet.add(targetableEnemyUnit);

      const { pos: enemyPos, radius: enemyUnitRadius } = targetableEnemyUnit;
      if (enemyPos === undefined || enemyUnitRadius === undefined) return;

      const targetableUnitEffectiveRadius = enemyUnitRadius || 0;
      const weaponRangeToMappedEnemyUnit = range + unitEffectiveRadius + targetableUnitEffectiveRadius;

      if (getDistance(pos, enemyPos) < weaponRangeToMappedEnemyUnit) {
        enemyUnitsInRange.add(targetableEnemyUnit);
      }
    });
  });

  return {
    targetUnitInRange: targetUnitInRange,
    enemyUnitsInRange: [...enemyUnitsInRange],
    targetableEnemyUnits: [...targetableEnemyUnitsSet]
  };
}

/**
 * @param {WeaponTargetType | undefined} weaponType
 * @returns {Unit[]}
 */
function getTargetableEnemyUnits(weaponType) {
  switch (weaponType) {
    case WeaponTargetType.ANY:
      return enemyTrackingServiceV2.mappedEnemyUnits;
    case WeaponTargetType.GROUND:
      return enemyTrackingServiceV2.mappedEnemyUnits.filter(unit => !unit.isFlying);
    case WeaponTargetType.AIR:
      return enemyTrackingServiceV2.mappedEnemyUnits.filter(unit => unit.isFlying);
    default:
      return [];
  }
}

/**
 * Finds an immediate threat among enemy units.
 * 
 * @param {DataStorage} data - Game data.
 * @param {Unit} unit - The player's unit.
 * @param {Unit[]} enemyUnits - Array of enemy units that can be targeted.
 * @returns {Unit|null} The immediate threat unit or null if not found.
 */
function findImmediateThreat(data, unit, enemyUnits) {
  for (const enemy of enemyUnits) {
    if (!enemy.pos || !unit.pos) continue; // Skip if either position is undefined
    const unitAttackRange = dataService.getAttackRange(data, unit, enemy);
    if (isActivelyAttacking(data, enemy, unit) && getDistance(unit.pos, enemy.pos) <= unitAttackRange) {
      return enemy;
    }
  }
  return null;
}

/**
 * Tries to determine if enemyUnit is likely attacking targetUnit based on indirect information.
 * @param {DataStorage} data - The data required to get the attack range.
 * @param {Unit} enemyUnit - The enemy unit we're checking.
 * @param {Unit} targetUnit - The unit we want to see if it's being attacked by the enemyUnit.
 * @returns {boolean} - True if it seems the enemyUnit is attacking the targetUnit, false otherwise.
 */
function isActivelyAttacking(data, enemyUnit, targetUnit) {
  if (!enemyUnit.pos || !targetUnit.pos) {
    return false; // If position is undefined for either unit, they can't be actively attacking.
  }

  // Check if the enemy unit has weapons capable of attacking the target unit.
  const weaponThatCanAttack = unitService.getWeaponThatCanAttack(data, enemyUnit.unitType, targetUnit);
  if (!weaponThatCanAttack) {
    return false; // If enemy unit can't attack the target unit, then it's not a threat.
  }

  // Determine the dynamic threat range.
  const threatRange = calculateThreatRange(data, enemyUnit, targetUnit);

  // Check proximity based on the dynamic threat range.
  const distance = getDistance(enemyUnit.pos, targetUnit.pos);

  return distance <= threatRange;
}

/**
 * Creates an attack command for the given unit targeting another unit.
 *
 * @param {Unit} sourceUnit - The attacking unit.
 * @param {Unit} targetUnit - The target unit.
 * @returns {SC2APIProtocol.ActionRawUnitCommand} The created attack command.
 */
function createAttackCommand(sourceUnit, targetUnit) {
  const unitCommand = createUnitCommand(ATTACK_ATTACK, [sourceUnit]);
  unitCommand.targetUnitTag = targetUnit.tag;
  return unitCommand;
}

/**
 * @param {World} world
 * @param {Unit} unit
 * @param {number[][]} pathToRally
 * @returns {boolean}
 */
function isSafePathToRally(world, unit, pathToRally) {
  const { pos: unitPos } = unit;
  if (!unitPos) return false;

  const { data, resources } = world;
  const { units } = resources.get();

  const aliveEnemies = units.getAlive(Alliance.ENEMY).filter(e => e.pos);
  if (!aliveEnemies.length) return true;

  return !getPathCoordinates(pathToRally).some(point => {
    const closestEnemies = units.getClosest(point, aliveEnemies);
    if (!closestEnemies.length) return false;

    const closestEnemy = closestEnemies[0];
    const { radius: enemyRadius, tag: enemyTag, unitType: enemyType, pos: enemyPos } = closestEnemy;

    if (!enemyPos || typeof enemyType !== 'number') return false;

    const targetPositions = enemyTag ? enemyTrackingService.enemyUnitsPositions.get(enemyTag) : null;
    const projectedTargetPosition = targetPositions ?
      getProjectedPosition(
        targetPositions.current.pos,
        targetPositions.previous.pos,
        targetPositions.current.lastSeen,
        targetPositions.previous.lastSeen
      ) : enemyPos;

    if (!projectedTargetPosition) return false;

    const weapon = unitService.getWeaponThatCanAttack(data, enemyType, unit);
    const attackRange = weapon?.range;
    if (!attackRange) return false;

    const effectiveAttackRange = attackRange + (unit.radius || 0) + (enemyRadius || 0);
    const distanceSquared = getDistanceSquared(point, projectedTargetPosition);

    if (distanceSquared <= effectiveAttackRange * effectiveAttackRange) {
      const directionToEnemy = subtractVectors(projectedTargetPosition, unitPos);
      const directionOfMovement = subtractVectors(point, unitPos);
      return dotVectors(directionToEnemy, directionOfMovement) < 0;
    }

    return false;
  });
}

/**
 * @param {ResourceManager} resources
 * @param {Point2D} pos
 * @param {number} thresholdDistance
 * @returns {boolean}
 */
const shouldRetreatToBunker = (resources, pos, thresholdDistance = 16) => {
  const { units } = resources.get();
  const bunkerPositions = getBunkerPositions(units);
  if (bunkerPositions.length === 0) return false;

  const [closestBunker] = resourceManagerService.getClosestPositionByPath(resources, pos, bunkerPositions);
  if (!closestBunker) return false;
  const distanceToClosestBunker = pathFindingService.getDistanceByPath(resources, pos, closestBunker);

  // Only retreat to bunker if it's within a certain threshold distance.
  return distanceToClosestBunker < thresholdDistance;
}

/**
 * @param {UnitResource} units
 * @returns {Point2D[]}
 */
const getBunkerPositions = (units) => {
  return units.getById(UnitType.BUNKER)
    .filter(unit => unit.buildProgress === 1 && unit.pos)
    .reduce((/** @type {Point2D[]} */acc, unit) => {
      const { pos } = unit;
      if (pos) acc.push(pos);
      return acc;
    }, []);
}

/**
 * Gets the closest bunker position from the provided position.
 * @param {ResourceManager} resources - The resources object.
 * @param {Point2D} pos - The position from which the distance needs to be calculated.
 * @returns {Point2D | null} - The position of the closest bunker or null if no bunker is found.
 */
const getClosestBunkerPosition = (resources, pos) => {
  const { units } = resources.get();
  const bunkerUnits = units.getById(UnitType.BUNKER).filter(unit => unit.buildProgress === 1 && unit.pos);

  if (bunkerUnits.length === 0) {
    return null;
  }

  const bunkerPositions = bunkerUnits.map(unit => unit.pos);
  const distances = bunkerPositions.map(bunkerPos => {
    if (bunkerPos) {
      return pathFindingService.getDistanceByPath(resources, pos, bunkerPos);
    }
    return Infinity;  // or some other default value indicating an undefined position
  });

  const minDistanceIndex = distances.indexOf(Math.min(...distances));

  const bunkerPosition = bunkerUnits[minDistanceIndex].pos;
  return bunkerPosition ? bunkerPosition : null;
}

/**
 * Checks whether the retreat path and point are safe based on the allies and enemies near the path and point.
 *
 * @param {World} world - The collection of all units in the game.
 * @param {Unit} unit - The unit we are considering the retreat for.
 * @param {Point2D[]} pathToRetreat - The series of points defining the path to the retreat point.
 * @param {Point2D} retreatPoint - The final retreat point.
 * @returns {boolean} - Returns true if the path and point are safe to retreat to.
 */
function isSafeToRetreat(world, unit, pathToRetreat, retreatPoint) {
  // First, check the safety of the path
  for (let point of pathToRetreat) {
    if (!isPointSafe(world, unit, point)) {
      return false;  // Unsafe path segment found
    }
  }

  // Then, check the safety of the retreat point itself
  return isPointSafe(world, unit, retreatPoint);
}



/**
 * Helper function that checks the safety of a specific point.
 *
 * @param {World} world - The collection of all units in the game.
 * @param {Unit} unit - The unit we are considering the safety for.
 * @param {Point2D} point - The point to check.
 * @returns {boolean} - Returns true if the point is safe.
 */
function isPointSafe(world, unit, point) {
  if (!unit.pos) {
    return false;
  }

  const { data } = world;
  const directionOfMovement = subtractVectors(point, unit.pos);
  const unitRadius = unit.radius || 0;

  for (const enemy of enemyTrackingServiceV2.mappedEnemyUnits) {
    const { radius = 0, tag: enemyTag, unitType, pos: enemyPos } = enemy; // Default to 0 if radius is undefined

    if (!enemyPos || typeof unitType !== 'number') continue;

    const targetPositions = enemyTag && enemyTrackingService.enemyUnitsPositions.get(enemyTag);
    const projectedTargetPosition = targetPositions ? getProjectedPosition(
      targetPositions.current.pos,
      targetPositions.previous.pos,
      targetPositions.current.lastSeen,
      targetPositions.previous.lastSeen
    ) : enemyPos;

    if (!projectedTargetPosition) continue;

    const weapon = unitService.getWeaponThatCanAttack(data, unitType, unit);
    if (!weapon?.range) continue;

    const effectiveAttackRange = weapon.range + unitRadius + radius;
    const distanceSquared = getDistanceSquared(point, projectedTargetPosition);
    const directionToEnemy = subtractVectors(projectedTargetPosition, unit.pos);

    if (dotVectors(directionToEnemy, directionOfMovement) > 0 && distanceSquared <= effectiveAttackRange * effectiveAttackRange) {
      return false;
    }
  }

  const alliesAtPoint = getUnitsInRangeOfPosition(trackUnitsService.selfUnits, point, 16).filter(ally => !ally.isWorker());
  const enemiesNearUnit = getUnitsInRangeOfPosition(enemyTrackingServiceV2.mappedEnemyUnits, point, 16);

  const { timeToKill, timeToBeKilled } = calculateTimeToKill(world, alliesAtPoint, enemiesNearUnit);

  return timeToKill < timeToBeKilled;
}



/**
 * @param {ResourceManager} resources
 * @param {Unit} unit
 * @param {import("../../../interfaces/retreat-candidate").RetreatCandidate[]} retreatCandidates
 * @returns {Point2D | undefined}
 */
const getPathRetreatPoint = (resources, unit, retreatCandidates) => {
  const { pos } = unit; if (pos === undefined) return;
  const retreatPoints = gatherRetreatPoints(retreatCandidates);
  if (!retreatPoints || retreatPoints.length === 0) return;

  const retreatMap = new Map(retreatPoints.map(retreat => [retreat.point, retreat]));
  const pointsArray = retreatPoints.map(retreat => retreat.point);
  const [largestPathDifferencePoint] = getClosestPositionByPathSorted(resources, pos, pointsArray);

  if (largestPathDifferencePoint) {
    const largestPathDifferenceRetreat = retreatMap.get(largestPathDifferencePoint.point);
    if (largestPathDifferenceRetreat) {
      logExpansionInPath(resources, unit, largestPathDifferenceRetreat);
      return largestPathDifferenceRetreat.point;
    }
  }
}

/**
 * @param {import('../../../interfaces/retreat-candidate').RetreatCandidate[]} retreatCandidates
 * @returns {{ point: Point2D; expansionsInPath: Point2D[]; }[]}
 */
const gatherRetreatPoints = (retreatCandidates) => {
  return retreatCandidates.reduce((/** @type {{ point: Point2D; expansionsInPath: Point2D[]; }[]}} */acc, retreat) => {
    if (retreat?.point) {
      acc.push({
        point: retreat.point,
        expansionsInPath: retreat.expansionsInPath
      });
    }
    return acc;
  }, []);
}

const logExpansionInPath = (resources, unit, retreat) => {
  const timeInSeconds = getTimeInSeconds(resources.get().frame.getGameLoop());
  if (unit.isWorker() && timeInSeconds > 100 && timeInSeconds < 121) {
    console.log('expansionsInPath', retreat.expansionsInPath);
  }
}

/**
 * @param {ResourceManager} resources
 * @param {SC2APIProtocol.Point} pos
 * @param {SC2APIProtocol.Point[]} mapPoints
 */
function getClosestPositionByPathSorted(resources, pos, mapPoints) {
  const { map } = resources.get();
  return mapPoints.map(point => {
    const [closestPathablePosition] = resourceManagerService.getClosestPositionByPath(resources, pos, MapResourceService.getPathablePositions(map, point));
    return {
      point,
      distanceByPath: pathFindingService.getDistanceByPath(resources, pos, closestPathablePosition)
    };
  }).sort((a, b) => a.distanceByPath - b.distanceByPath);
}

/**
 * @param {Unit[]} units
 * @param {Point2D} position
 * @param {number} range
 * @returns {Unit[]}
 */
function getUnitsInRangeOfPosition(units, position, range) {
  return units.filter(unit => {
    const { pos } = unit; if (pos === undefined) return false;
    return getDistance(pos, position) <= range;
  });
}

/**
 * @param {World} world
 * @param {Unit[]} selfUnits
 * @param {Unit[]} enemyUnits
 * @returns {{timeToKill: number, timeToBeKilled: number}}
 */
function calculateTimeToKill(world, selfUnits, enemyUnits) {
  if (selfUnits.length === 0) {
    return { timeToKill: Infinity, timeToBeKilled: 0 };
  }

  if (enemyUnits.length === 0) {
    return { timeToKill: 0, timeToBeKilled: Infinity };
  }

  const timeToKill = enemyUnits.reduce((timeToKill, threat) => {
    const { health, shield, unitType } = threat; if (health === undefined || shield === undefined || unitType === undefined) return timeToKill;
    const totalHealth = health + shield;
    const totalWeaponDPS = selfUnits.reduce((totalWeaponDPS, unit) => {
      const { unitType } = unit; if (unitType === undefined) return totalWeaponDPS;
      const weaponDPS = getWeaponDPS(world, unitType, Alliance.SELF, enemyUnits.map(threat => threat.unitType));
      return totalWeaponDPS + weaponDPS;
    }, 0);
    const timeToKillCurrent = totalHealth / (totalWeaponDPS === 0 ? 1 : totalWeaponDPS);
    return (timeToKill === Infinity) ? timeToKillCurrent : timeToKill + timeToKillCurrent;
  }, Infinity);
  const timeToBeKilled = selfUnits.reduce((timeToBeKilled, unit) => {
    const { health, shield, unitType } = unit; if (health === undefined || shield === undefined || unitType === undefined) return timeToBeKilled;
    const totalHealth = health + shield;
    const totalWeaponDPS = enemyUnits.reduce((totalWeaponDPS, threat) => {
      const { unitType } = threat; if (unitType === undefined) return totalWeaponDPS;
      const weaponDPS = getWeaponDPS(world, unitType, Alliance.ENEMY, selfUnits.map(unit => unit.unitType));
      return totalWeaponDPS + weaponDPS;
    }, 0);
    const timeToBeKilledCurrent = totalHealth / (totalWeaponDPS === 0 ? 1 : totalWeaponDPS);
    return (timeToBeKilled === Infinity) ? timeToBeKilledCurrent : timeToBeKilled + timeToBeKilledCurrent;
  }, Infinity);
  return { timeToKill, timeToBeKilled };
}

/**
 * @param {ResourceManager} resources
 * @param {Point2D[]} expansionLocations
 * @param {Point2D} pos
 * @return {import("../../../interfaces/retreat-candidate").RetreatCandidate[]}
 */
function mapToRetreatCandidates(resources, expansionLocations, pos) {
  const { map } = resources.get();
  return expansionLocations.map(point => {
    const { distance } = calculateDistances(resources, pos, MapResourceService.getPathablePositions(map, point));
    return {
      point,
      safeToRetreat: true,
      expansionsInPath: getCentroids(getExpansionsInPath(map, pos, point)),
      getDistanceByPathToRetreat: distance,
      getDistanceByPathToTarget: distance,
      closerOrEqualThanTarget: true,
    };
  });
}

/**
 * @param {MapResource} map
 * @param {Point2D} unitPos
 * @param {Point2D} point
 * @returns {Expansion[]}
 */
function getExpansionsInPath(map, unitPos, point) {
  const pathCoordinates = getPathCoordinates(MapResourceService.getMapPath(map, unitPos, point));
  const pathCoordinatesBoundingBox = getBoundingBox(pathCoordinates);

  const expansionsInPath = map.getExpansions().filter(expansion => {
    const areaFill = expansion?.areas?.areaFill;
    const centroid = expansion?.centroid;

    if (!areaFill || !centroid) return false;  // If either is undefined, filter out

    // Filter out the expansion where the point is where the centroid is.
    if (getDistance(point, centroid) < 1) return false;

    // Filter out expansions where the centroid is within a distance of 16 from unitPos.
    if (getDistance(unitPos, centroid) <= 16) return false;

    const areaFillBoundingBox = getBoundingBox(areaFill);

    return boundingBoxesOverlap(pathCoordinatesBoundingBox, areaFillBoundingBox)
      && pointsOverlap(pathCoordinates, areaFill);
  });

  return expansionsInPath;
}

function getBoundingBox(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  points.forEach(({ x, y }) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  });

  return { minX, minY, maxX, maxY };
}

function boundingBoxesOverlap(box1, box2) {
  return !(box2.minX > box1.maxX ||
    box2.maxX < box1.minX ||
    box2.minY > box1.maxY ||
    box2.maxY < box1.minY);
}

/**
 * Finds the optimal target based on the potential damage, health after the attack, and time to kill.
 *
 * @param {World} world - The game world state.
 * @param {Unit} unit - The player's unit.
 * @param {Unit[]} enemyUnits - Array of enemy units that can be targeted.
 * @param {number} currentStep - The current game step.
 * @param {number} maxDistance - The maximum distance to consider for engagement.
 * @returns {Unit|null} - The optimal target unit or null if not found.
 */
function findOptimalTarget(world, unit, enemyUnits, currentStep, maxDistance) {
  if (!unit.pos) return null;

  let optimalTarget = null;
  let smallestRemainingHealth = Infinity;
  let quickestTimeToKill = Infinity;  // Initialize to a high value for comparison

  const isValidEnemy = (/** @type {Unit} */ enemy) => enemy.pos && enemy.tag !== undefined;

  for (const enemy of enemyUnits) {
    if (!isValidEnemy(enemy)) continue;

    // Compute unitDamagePerHit for the current enemy in the loop
    const unitDamagePerHit = getWeaponDamage(world, unit.unitType, enemy);

    const KILLING_BLOW_THRESHOLD = unitDamagePerHit;

    // Only calculate the distance if both unit.pos and enemy.pos are defined
    if (!unit.pos || !enemy.pos) continue;

    const distance = getDistance(unit.pos, enemy.pos);
    if (distance > maxDistance) continue;

    const enemyTag = /** @type {string} */ (enemy.tag);  // Type assertion
    const currentDamage = getDamageForTag(enemyTag, currentStep) || 0;
    const computation = computeTimeToKillWithMovement(world, unit, enemy, currentDamage);

    if (!computation?.tag) continue;

    const { timeToKillWithMovement, damagePotential } = computation;
    const potentialDamage = currentDamage + damagePotential;
    const remainingHealthAfterAttack = (enemy.health ?? 0) + (enemy.shield ?? 0) - potentialDamage;

    if (remainingHealthAfterAttack >= (0 - KILLING_BLOW_THRESHOLD) && remainingHealthAfterAttack <= 0
      || (remainingHealthAfterAttack < smallestRemainingHealth
        || timeToKillWithMovement < quickestTimeToKill)) {
      smallestRemainingHealth = remainingHealthAfterAttack;
      quickestTimeToKill = timeToKillWithMovement;
      optimalTarget = enemy;
    }
  }

  return optimalTarget;
}

/**
 * Returns a nearby pathable position given an unpathable position.
 *
 * @param {World} world - The game world data.
 * @param {Point2D} unpathablePoint - The unpathable position.
 * @param {number} maxSearchRadius - The maximum radius to search for a pathable point.
 * @returns {Point2D | undefined} - A nearby pathable position or undefined if none found.
 */
function findNearbyPathablePosition(world, unpathablePoint, maxSearchRadius = 5) {
  if (unpathablePoint.x === undefined || unpathablePoint.y === undefined) {
    return undefined; // Or throw an error, depending on your use case
  }

  const { map } = world.resources.get();
  for (let r = 1; r <= maxSearchRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) {
          continue; // Only consider points on the outer perimeter of the search area
        }
        const testPoint = {
          x: unpathablePoint.x + dx,
          y: unpathablePoint.y + dy
        };
        if (map.isPathable(testPoint)) {
          return testPoint;
        }
      }
    }
  }
  return undefined;
}


/**
 * Check if the path to a given location is safe.
 * 
 * @param {World} world - The game world containing various game state information.
 * @param {Unit} unit - The unit that we're considering moving.
 * @param {Point2D} location - The destination point that we're evaluating the safety of reaching.
 * @returns {boolean} - Returns true if the path is deemed safe, and false otherwise.
 */
const isPathSafe = (world, unit, location) => {
  const { resources } = world;
  const { map } = resources.get();
  const { pos: unitPos } = unit;

  if (!unitPos) return false;

  // Obtain the path using your existing getMapPath function
  const path = MapResourceService.getMapPath(map, unitPos, location);

  // Convert path to an array of Point2D for easier handling
  const pathPoints = path.map(coord => ({ x: coord[0], y: coord[1] }));

  const aliveEnemies = resources.get().units.getAlive(Alliance.ENEMY).filter(e => e.pos);

  if (!aliveEnemies.length) return true; // Return early if there are no live enemies

  return !pathPoints.some(point => {
    const closestEnemies = resources.get().units.getClosest(point, aliveEnemies);

    if (!closestEnemies.length) return false;

    const closestEnemy = closestEnemies[0];
    const { unitType, pos: enemyPos } = closestEnemy;

    if (!enemyPos || typeof unitType !== 'number') return false;

    // Projected position logic can be added here if needed
    // const projectedEnemyPos = getProjectedPosition(...);

    const weapon = unitService.getWeaponThatCanAttack(world.data, unitType, unit);
    const attackRange = weapon?.range;

    if (!attackRange) return false;

    const effectiveAttackRange = attackRange + (unit.radius || 0) + (closestEnemy.radius || 0);
    const distance = getDistance(point, enemyPos);

    if (distance <= effectiveAttackRange) {
      const directionToEnemy = subtractVectors(enemyPos, unitPos);
      const directionOfMovement = subtractVectors(point, unitPos);

      return dotVectors(directionToEnemy, directionOfMovement) < 0;
    }

    return false;
  });
};

/**
 * Compute the time required to kill a target with movement factored in.
 *
 * @param {World} world - The game world state.
 * @param {Unit} unit - The player's unit.
 * @param {Unit} target - The enemy unit to be targeted.
 * @param {number} currentDamage - The current cumulative damage on the enemy unit.
 * @returns {{ tag: string; timeToKillWithMovement: number; damagePotential: number } | null}
 */
function computeTimeToKillWithMovement(world, unit, target, currentDamage) {
  // Destructure required fields from unit and target for better readability
  const { unitType, alliance, pos, radius } = unit;
  const { health, shield, pos: enemyPos, radius: enemyRadius, unitType: enemyType, tag } = target;

  // Check for mandatory fields
  if (!unitType || !alliance || !pos || !radius || !health || !enemyPos || !enemyRadius || !enemyType || !tag) {
    return null;
  }

  const totalHealth = health + (shield ?? 0) - currentDamage;

  // Fetch weapon data
  const weapon = getWeapon(world.data, unit, target);
  if (!weapon || weapon.range === undefined || weapon.damage === undefined) return null;

  // Calculate enemy armor-adjusted damage
  const enemyArmor = (world.data.getUnitTypeData(enemyType)?.armor) || 0;
  const adjustedDamage = Math.max(1, weapon.damage - enemyArmor);

  // Fetch positions and speed for unit movement calculations
  const positions = enemyTrackingService.enemyUnitsPositions.get(tag);
  if (!positions?.current || !positions.previous) return null;

  const speed = unitService.getMovementSpeed(world.resources.get().map, unit, true);
  if (!speed) return null;

  // Compute movement related values
  const distanceToTarget = getDistance(pos, enemyPos);
  const distanceToEngage = distanceToTarget - radius - enemyRadius - weapon.range;
  const requiredDistance = Math.max(0, distanceToEngage);

  const elapsedFrames = positions.current.lastSeen - positions.previous.lastSeen;
  const enemySpeed = elapsedFrames ? (getDistance(pos, positions.current.pos) - getDistance(pos, positions.previous.pos)) / elapsedFrames : 0;
  const timeToReach = requiredDistance / Math.max(1e-6, speed - enemySpeed);

  // Compute adjusted DPS and time to kill
  const weaponsDPS = getWeaponDPS(world, unitType, alliance, [enemyType]);
  const adjustedDPS = weaponsDPS - enemyArmor * weaponsDPS / weapon.damage;
  const timeToKill = totalHealth / adjustedDPS;

  return { tag, timeToKillWithMovement: timeToKill + timeToReach, damagePotential: adjustedDamage };
}

/**
 * @param {Expansion[]} expansions
 * @returns {Point2D[]}
 */
function getCentroids(expansions) {
  return expansions.reduce((/** @type {Point2D[]} */acc, expansion) => {
    if (expansion.centroid) {
      acc.push(expansion.centroid);
    }
    return acc;
  }, []);
}

/**
 * @param {ResourceManager} resources
 * @param {Point2D} fromPos
 * @param {Point2D[]} toPoints
 * @returns {{ closestPosition: Point2D; distance: number; }}
 */
function calculateDistances(resources, fromPos, toPoints) {
  const [closestPosition] = pathFindingService.getClosestPositionByPath(resources, fromPos, toPoints);
  const distance = pathFindingService.getDistanceByPath(resources, fromPos, closestPosition);
  return { closestPosition, distance };
}

/**
 * Calculate a dynamic threat range based on the enemy unit's characteristics.
 * @param {DataStorage} data - The data required to get the attack range.
 * @param {Unit} enemyUnit
 * @param {Unit} targetUnit
 * @returns {number} - The calculated threat range.
 */
function calculateThreatRange(data, enemyUnit, targetUnit) {
  const attackRange = dataService.getAttackRange(data, enemyUnit, targetUnit);

  // Get the projected position for the enemy unit.
  const targetPositions = enemyUnit.tag ? enemyTrackingService.enemyUnitsPositions.get(enemyUnit.tag) : null;
  const projectedTargetPosition = targetPositions ?
    getProjectedPosition(
      targetPositions.current.pos,
      targetPositions.previous.pos,
      targetPositions.current.lastSeen,
      targetPositions.previous.lastSeen
    ) : enemyUnit.pos;

  // If we can't determine a projected position, we'll stick to the current position
  const currentPosition = projectedTargetPosition || enemyUnit.pos;

  // This might overestimate the actual threat range a bit, but it's safer to be cautious.
  // Calculate anticipated movement as the distance between current position and projected position.
  let anticipatedMovement = 0;
  if (enemyUnit.pos && currentPosition) {
    anticipatedMovement = getDistance(enemyUnit.pos, currentPosition);
  }

  return attackRange + anticipatedMovement;
}

/**
 * Return position away from multiple target positions.
 * @param {MapResource} map
 * @param {Point2D[]} targetPositions 
 * @param {Point2D} position 
 * @param {number} distance 
 * @param {boolean} isFlyingUnit 
 * @returns {Point2D | undefined}
 */
function moveAwayFromMultiplePositions(map, targetPositions, position, distance = 2, isFlyingUnit = false) {
  if (targetPositions.length === 0 || position.x === undefined || position.y === undefined) return;

  // Calculate the average threat direction
  let avgDX = 0;
  let avgDY = 0;
  for (const target of targetPositions) {
    if (target.x !== undefined && target.y !== undefined) {
      avgDX += target.x - position.x;
      avgDY += target.y - position.y;
    }
  }
  avgDX /= targetPositions.length;
  avgDY /= targetPositions.length;

  // Compute the point moving away from the threat direction
  const awayPoint = {
    x: position.x - avgDX * distance,
    y: position.y - avgDY * distance
  };

  const { x: mapWidth, y: mapHeight } = map.getSize();

  if (typeof mapWidth === 'undefined' || typeof mapHeight === 'undefined') {
    console.error("Map dimensions are undefined");
    return;
  }

  const clampedPoint = positionService.clampPointToBounds(awayPoint, 0, mapWidth, 0, mapHeight);

  // Skip pathability check for flying units
  if (isFlyingUnit) {
    return clampedPoint;
  }

  return map.isPathable(clampedPoint) ? clampedPoint : positionService.findPathablePointByAngleAdjustment(map, position, avgDX, avgDY);
}

/**
 * @param {Point2D} a
 * @param {Point2D} b
 * @returns {Point2D}
 */
function subtractVectors(a, b) {
  return {
    x: (a.x || 0) - (b.x || 0),
    y: (a.y || 0) - (b.y || 0)
  };
}

/**
 * @param {Point2D} a
 * @param {Point2D} b
 * @returns {number}
 */
function dotVectors(a, b) {
  return (a.x ?? 0) * (b.x ?? 0) + (a.y ?? 0) * (b.y ?? 0);
}

/**
 * @param {World} world
 * @param {Unit} unit 
 * @param {Unit} targetUnit 
 */
function inCombatRange(world, unit, targetUnit) {
  const { data, resources } = world;
  const { map } = resources.get();
  const { getWeaponThatCanAttack } = unitService;
  const { pos, radius, unitType } = unit;
  if (pos === undefined || radius === undefined || unitType === undefined) return false;
  const { pos: targetPos, radius: targetRadius } = targetUnit;
  if (targetPos === undefined || targetRadius === undefined) return false;
  const { weapons } = targetUnit.data();
  if (weapons === undefined) return false;
  const weapon = getWeaponThatCanAttack(data, unitType, targetUnit);
  if (weapon === undefined) return false;
  const { range } = weapon;
  if (range === undefined) return false;
  return getDistance(pos, targetPos) <= range + radius + targetRadius + getTravelDistancePerStep(map, targetUnit) + getTravelDistancePerStep(map, unit);
}


/**
 * @param {World} world
 * @param {Unit} unit
 * @param {Unit} targetUnit
 * @param {number} radius
 * @returns {Point2D[]}
 **/
function getSafePositions(world, unit, targetUnit, radius = 0.5) {
  const { resources } = world;
  const { map, units } = resources.get();
  let safePositions = [];
  const { pos } = unit; if (pos === undefined || radius === undefined) return safePositions;
  const { x, y } = pos; if (x === undefined || y === undefined) return safePositions;
  const { pos: targetPos } = targetUnit; if (targetPos === undefined) return safePositions;
  const { x: targetX, y: targetY } = targetPos; if (targetX === undefined || targetY === undefined) return safePositions;
  const enemyUnits = enemyTrackingServiceV2.mappedEnemyUnits.filter(enemyUnit => {
    // Check if the unit has a position and is not a peaceful worker
    if (!enemyUnit.pos || enemyTrackingServiceV2.isPeacefulWorker(resources, enemyUnit)) {
      return false;
    }

    // Check if the unit is within a certain range
    if (getDistance(pos, enemyUnit.pos) > 16) {
      return false;
    }

    // Check if the unit can attack the worker
    return canAttack(enemyUnit, unit);
  });

  // get the angle to the target enemy unit
  let angleToEnemy = Math.atan2(targetY - y, targetX - x);
  let startAngle = angleToEnemy + Math.PI - Math.PI / 2; // 180 degree cone
  let endAngle = angleToEnemy + Math.PI + Math.PI / 2;

  while (safePositions.length === 0 && radius <= 16) {
    for (let i = startAngle; i < endAngle; i += 2.5 * Math.PI / 180) {  // Half the original step size
      const { x, y } = pos;
      if (x === undefined || y === undefined) return safePositions;
      const point = {
        x: x + radius * Math.cos(i),
        y: y + radius * Math.sin(i),
      };
      if (existsInMap(map, point) && map.isPathable(point)) {
        const [closestEnemyUnit] = units.getClosest(point, enemyUnits, 1);
        if (closestEnemyUnit && closestEnemyUnit.pos && getDistance(point, closestEnemyUnit.pos) > getDistance(pos, closestEnemyUnit.pos)) {
          const pointWithHeight = { ...point, z: map.getHeight(point) };
          const safePositionFromTargets = isSafePositionFromTargets(map, unit, enemyUnits, pointWithHeight);
          if (safePositionFromTargets) {
            safePositions.push(point);
          }
        }
      }
    }
    radius += 0.5;  // Increment radius by smaller steps
  }

  // Get the worker's destination
  const workerDestination = unitResourceService.getOrderTargetPosition(units, unit);

  // If workerDestination is defined, then sort the safe positions based on their proximity to the worker's destination
  if (workerDestination) {
    safePositions.sort((a, b) => {
      const distanceA = getDistance(a, workerDestination);
      const distanceB = getDistance(b, workerDestination);
      return distanceA - distanceB; // Sorting in ascending order of distance to worker's destination
    });
  }

  return safePositions;
}

/**
 * Derives a safety radius based on the unit's characteristics and potential threats
 * @param {World} world
 * @param {Unit} unit
 * @param {Array<Unit>} potentialThreats
 * @returns {number}
 */
const deriveSafetyRadius = (world, unit, potentialThreats) => {
  const { data, resources } = world;
  const { map } = resources.get();
  let baseSafetyRadius = 0
  let maxThreatRange = 0;

  for (let threat of potentialThreats) {
    const { radius, unitType } = threat; if (radius === undefined || unitType === undefined) continue;
    const weapon = unitService.getWeaponThatCanAttack(data, unitType, unit); if (weapon === undefined) continue;
    const threatRange = weapon.range || 0;
    if (threatRange > maxThreatRange) {
      maxThreatRange = threatRange + radius + getTravelDistancePerStep(map, threat);
    }
  }

  const { radius } = unit; if (radius === undefined) return baseSafetyRadius;
  baseSafetyRadius += maxThreatRange + radius + getTravelDistancePerStep(map, unit);
  return baseSafetyRadius;
}

/**
 * Utility function to check if a position is truly safe based on all known threats
 * @param {World} world
 * @param {Point2D} position
 * @param {number} safetyRadius - Defines how close a threat can be to consider a position unsafe
 * @returns {boolean}
 */
const isTrulySafe = (world, position, safetyRadius) => {
  const { units } = world.resources.get();

  for (let potentialThreat of units.getAlive(Alliance.ENEMY)) {
    const { pos } = potentialThreat; if (pos === undefined) continue;
    if (getDistance(position, pos) <= safetyRadius) {
      return false;
    }
  }
  return true;
}

/**
 * @param {MapResource} map
 * @param {Unit} unit 
 * @param {Unit[]} targetUnits
 * @param {Point3D} point 
 * @returns {boolean}
 */
function isSafePositionFromTargets(map, unit, targetUnits, point) {
  const { getHighestRangeWeapon } = unitService;
  if (!existsInMap(map, point)) return false;
  let weaponTargetType = null;
  const { pos, radius } = unit;
  if (pos === undefined || radius === undefined) return false;
  if (point.z === undefined || pos === undefined || pos.z === undefined) return false;
  if (point.z > pos.z + 2) {
    weaponTargetType = WeaponTargetType.AIR;
  } else {
    weaponTargetType = WeaponTargetType.GROUND;
    // return false if point is outside of map and point is not pathable
    if (!map.isPathable(point)) return false;
  }
  return targetUnits.every((targetUnit) => {
    const { pos } = targetUnit;
    if (pos === undefined || targetUnit.radius === undefined) return true;
    const weapon = getHighestRangeWeapon(targetUnit, weaponTargetType);
    if (weapon === undefined || weapon.range === undefined) return true;
    const weaponRange = weapon.range;
    const distanceToTarget = getDistance(point, pos);
    const safeDistance = (weaponRange + radius + targetUnit.radius + getTravelDistancePerStep(map, targetUnit) + getTravelDistancePerStep(map, unit));
    return distanceToTarget > safeDistance;
  });
}

/**
 * Finds optimal positions around an enemy's projected position where the unit can attack effectively.
 *
 * @param {World} world - The current game world state.
 * @param {Point2D} enemyProjectedPosition - The projected position of the enemy unit.
 * @param {number} optimalDistance - The optimal distance to maintain from the enemy for effective attack.
 * @param {Unit} unit - The unit to be positioned for attack.
 * @returns {Point2D[]} - An array of optimal positions for attack.
 */
function findOptimalAttackPositions(world, enemyProjectedPosition, optimalDistance, unit) {
  const attackPositions = [];

  // Iterate around the enemy's projected position to find spots at the optimal attack distance
  const angles = Array.from({ length: 360 }, (_, index) => index); // One degree increments, adjust as needed

  angles.forEach(angle => {
    const xOffset = optimalDistance * Math.cos(angle * (Math.PI / 180));
    const yOffset = optimalDistance * Math.sin(angle * (Math.PI / 180));

    const potentialPosition = {
      x: (enemyProjectedPosition.x ?? 0) + xOffset,
      y: (enemyProjectedPosition.y ?? 0) + yOffset
    };

    if (isValidPosition(world, potentialPosition, unit)) {
      attackPositions.push(potentialPosition);
    }
  });

  return attackPositions;
}

/**
 * Check if a position is valid for the unit to move to and attack from.
 *
 * @param {World} world - The current game world state.
 * @param {Point2D} position - The position to check.
 * @param {Unit} unit - The unit to check.
 * @returns {boolean} - Returns true if the position is valid, otherwise false.
 */
function isValidPosition(world, position, unit) {
  const { map } = world.resources.get();

  // Check if x or y is undefined
  if (position.x === undefined || position.y === undefined) {
    return false;
  }

  const mapSize = map.getSize();

  // Check if mapSize x or y is undefined
  if (mapSize.x === undefined || mapSize.y === undefined) {
    return false;
  }

  // Check if the position is out of bounds
  if (position.x < 0 || position.x >= mapSize.x || position.y < 0 || position.y >= mapSize.y) {
    return false;
  }

  // Check if the position is on an untraversable terrain using isPathable, if the unit is not flying
  if (!unit.isFlying && !map.isPathable(position)) {
    return false;
  }

  // Check if there are other units at the position
  // Assuming there is a method world.isOccupied(position) that returns a boolean
  if (isPositionOccupied(world, position)) {
    return false;
  }

  return true;
}

/**
 * @param {World} world
 * @param {Point2D} position
 * @returns {boolean}
 */
function isPositionOccupied(world, position) {
  return world.resources.get().units.getAlive().some(unit => {
    if (!unit.pos || unit.pos.x === undefined || unit.pos.y === undefined
      || position.x === undefined || position.y === undefined
      || unit.radius === undefined || unit.isBurrowed) {  // Check if the unit is burrowed
      return false; // Skip if undefined positions or radius are encountered, or if the unit is burrowed
    }

    const distance = Math.sqrt(Math.pow(unit.pos.x - position.x, 2) + Math.pow(unit.pos.y - position.y, 2));
    return distance < unit.radius;
  });
}

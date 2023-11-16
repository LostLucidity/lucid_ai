//@ts-check
"use strict";

// Import necessary services, constants, and utilities
const { MOVE, ATTACK_ATTACK } = require("@node-sc2/core/constants/ability");
const enemyTrackingService = require("../../../../systems/enemy-tracking/enemy-tracking-service");
const { getProjectedPosition } = require("../../../shared-utilities/vector-utils");
const { getDistance } = require("../../../../services/position-service");
const { createUnitCommand } = require("../../../shared-utilities/command-utilities");
const { getWeapon, getWeaponDamage, setDamageForTag, getDamageForTag, getWeaponDPS } = require("../../../shared-utilities/combat-utilities");
const { UnitType } = require("@node-sc2/core/constants");
const { WeaponTargetType } = require("@node-sc2/core/constants/enums");
const dataService = require("../../../../services/data-service");
const unitService = require("../../../../services/unit-service");
const groupTypes = require("@node-sc2/core/constants/groups");
const { getCachedAlive } = require("../../cache-service");

class MicroManagementService {

  constructor() {
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
}

module.exports = MicroManagementService;

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

  const { resources } = world;
  const currentStep = resources.get().frame.getGameLoop();

  if (!isUnitDataComplete(unit) || !unit.pos) return [];

  const weaponResults = computeWeaponsResults(unit, targetUnit);
  if (!weaponResults) return [];

  let immediateThreat = findImmediateThreat(world, unit, weaponResults.targetableEnemyUnits);
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
      return enemyTrackingService.mappedEnemyUnits;
    case WeaponTargetType.GROUND:
      return enemyTrackingService.mappedEnemyUnits.filter(unit => !unit.isFlying);
    case WeaponTargetType.AIR:
      return enemyTrackingService.mappedEnemyUnits.filter(unit => unit.isFlying);
    default:
      return [];
  }
}

/**
 * Finds an immediate threat among enemy units.
 * 
 * @param {World} world - The game world.
 * @param {Unit} unit - The player's unit.
 * @param {Unit[]} enemyUnits - Array of enemy units that can be targeted.
 * @returns {Unit|null} The immediate threat unit or null if not found.
 */
function findImmediateThreat(world, unit, enemyUnits) {
  const { data, resources } = world;
  const currentStep = resources.get().frame.getGameLoop();
  const currentTime = resources.get().frame.timeInSeconds();

  if (!unit.pos) return null;

  const immediateThreats = [];

  // Collecting all immediate threats
  for (const enemy of enemyUnits) {
    if (!enemy.pos || !unit.pos) continue; // Skip if either position is undefined
    const unitAttackRange = dataService.getAttackRange(data, unit, enemy);
    if (isActivelyAttacking(data, enemy, unit) && getDistance(unit.pos, enemy.pos) <= unitAttackRange) {
      immediateThreats.push(enemy);
    }
  }

  if (immediateThreats.length === 0) return null;

  // Selecting the immediate threat with the lowest total health
  let optimalThreat = null;
  let lowestHealth = Infinity;
  const logData = []; // Added to store the logs

  for (const threat of immediateThreats) {
    if (threat.tag !== undefined) {
      const currentDamage = getDamageForTag(threat.tag, currentStep) || 0;
      const totalHealthAfterAttack = (threat.health ?? 0) + (threat.shield ?? 0) - currentDamage;

      if (totalHealthAfterAttack < lowestHealth) {
        lowestHealth = totalHealthAfterAttack;
        optimalThreat = threat;
      }

      // Collecting log data if the current time is between 233 and 239 seconds
      if (currentTime >= 233 && currentTime <= 239) {
        logData.push(`Threat ID: ${threat.tag}, Health After Attack: ${totalHealthAfterAttack}`);
      }
    }
  }

  // Logging all at once to avoid clogging the logs
  if (logData.length > 0) {
    console.log(logData.join('\n'));
  }

  return optimalThreat;
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
  const allEnemyUnits = enemyTrackingService.mappedEnemyUnits;

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

  const xBase = enemyProjectedPosition.x ?? 0;
  const yBase = enemyProjectedPosition.y ?? 0;

  const DEFAULT_RADIUS = 1; // Adjust as needed

  const unitRadius = unit.radius ?? DEFAULT_RADIUS;
  const circumference = 2 * Math.PI * optimalDistance;
  const numberOfPositions = Math.max(1, Math.floor(circumference / (2 * unitRadius)));
  const angleIncrement = 360 / numberOfPositions;

  for (let angle = 0; angle < 360; angle += angleIncrement) {
    const xOffset = optimalDistance * Math.cos(angle * (Math.PI / 180));
    const yOffset = optimalDistance * Math.sin(angle * (Math.PI / 180));

    const potentialPosition = {
      x: xBase + xOffset,
      y: yBase + yOffset
    };

    if (isValidPosition(world, potentialPosition, unit)) {
      attackPositions.push(potentialPosition);
    }
  }

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
 * Determine if the provided unit is considered non-threatening, such as workers.
 *
 * @param {Unit} unit - The unit to evaluate.
 * @returns {boolean} - True if the unit is non-threatening; otherwise, false.
 */
function isNonThreateningUnit(unit) {
  return groupTypes.workerTypes.includes(unit.unitType);
}


/**
 * @param {World} world
 * @param {Point2D} position
 * @returns {boolean}
 */
function isPositionOccupied(world, position) {
  return getCachedAlive(world.resources.get().units).some(unit => {
    if (!unit.pos || unit.pos.x === undefined || unit.pos.y === undefined
      || position.x === undefined || position.y === undefined
      || unit.radius === undefined || unit.isBurrowed) {  // Check if the unit is burrowed
      return false; // Skip if undefined positions or radius are encountered, or if the unit is burrowed
    }

    const distance = Math.sqrt(Math.pow(unit.pos.x - position.x, 2) + Math.pow(unit.pos.y - position.y, 2));
    return distance < unit.radius;
  });
}

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
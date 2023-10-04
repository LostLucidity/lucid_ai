// /src/services/army-management/army-management-service.js

const groupTypes = require("@node-sc2/core/constants/groups");
const { getDistance, moveAwayPosition, getBorderPositions } = require("../../../services/position-service");
const enemyTrackingService = require("../../../systems/enemy-tracking/enemy-tracking-service");
const unitService = require("../../../services/unit-service");
const { avgPoints } = require("@node-sc2/core/utils/geometry/point");
const { getDistanceByPath } = require("../../../services/resource-manager-service");
const { createUnitCommand } = require("../../../services/actions-service");
const { MOVE, STOP, ATTACK_ATTACK, LOAD_BUNKER, SMART } = require("@node-sc2/core/constants/ability");
const { QUEEN, ADEPTPHASESHIFT, BUNKER } = require("@node-sc2/core/constants/unit-type");
const worldService = require("../../world-service");
const { canAttack } = require("../../../services/resources-service");
const { getTravelDistancePerStep } = require("../../../services/frames-service");
const MapResourceService = require("../../../systems/map-resource-system/map-resource-service");
const { getPathCoordinates } = require("../../../services/path-service");
const { Alliance } = require("@node-sc2/core/constants/enums");

class ArmyManagementService {
  constructor() {
    // Initialization code, setting up variables, etc.
  }

  /**
   * Generates unit commands to direct given units to either engage in battle or retreat.
   *
   * @param {World} world - The game world.
   * @param {Unit[]} selfUnits - Array of player's units.
   * @param {Unit[]} enemyUnits - Array of enemy units.
   * @param {Point2D} position - Point to either move towards or retreat from.
   * @param {boolean} [clearRocks=true] - Indicates if destructible rocks should be targeted.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} Array of commands.
   */
  engageOrRetreat(world, selfUnits, enemyUnits, position, clearRocks = true) {
    const collectedActions = [];

    // Separate out the injector queens and melee units
    const injectorQueens = selfUnits.filter(unit => unit.is(QUEEN) && unit.labels.has('injector'));
    const meleeUnits = selfUnits.filter(unit => unit.isMelee());
    const otherUnits = selfUnits.filter(unit => !unit.is(QUEEN) && !unit.isMelee());

    // Determine which units are needed for battle
    otherUnits.push(...getNecessaryUnits(world, injectorQueens, otherUnits, enemyUnits));
    otherUnits.push(...getNecessaryUnits(world, meleeUnits, otherUnits, enemyUnits)); // This is a new function to implement

    // Issue a stop command to queens that aren't needed
    injectorQueens.forEach(queen => {
      if (!otherUnits.includes(queen) && queen.isAttacking() && queen.tag) {
        const stopCommand = {
          abilityId: STOP,
          unitTags: [queen.tag]
        };
        collectedActions.push(stopCommand);
      }
    });

    // Check the conditions for melee units, similar to queens
    meleeUnits.forEach(melee => {
      const SAFETY_BUFFER = calculateSafetyBuffer(world, melee, enemyUnits);
      const totalHealthShield = (melee.health || 0) + (melee.shield || 0); // Considering shield along with health

      if (!otherUnits.includes(melee) && totalHealthShield <= SAFETY_BUFFER && melee.tag) {
        const retreatCommand = createRetreatCommand(world, melee, enemyUnits);
        collectedActions.push(retreatCommand);
      } else if (otherUnits.includes(melee)) {
        processSelfUnitLogic(world, otherUnits, melee, position, enemyUnits, collectedActions, clearRocks);
      }
    });

    // Process all other units
    otherUnits.forEach(unit => {
      if (!unit.isMelee() && !unit.is(QUEEN)) {
        processSelfUnitLogic(world, otherUnits, unit, position, enemyUnits, collectedActions, clearRocks);
      }
    });

    return collectedActions;
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
    const { resources } = world;
    const { map } = resources.get();

    const nearbyThreats = findNearbyThreats(world, unit, targetUnit);
    const allThreats = [targetUnit, ...nearbyThreats];

    const optimalDistance = getOptimalAttackDistance(world, unit, allThreats);

    const relevantThreats = allThreats.filter(threat =>
      getDistance(unit.pos, threat.pos) < optimalDistance
    );

    if (!relevantThreats.length) return [];

    const threatPositions = relevantThreats.flatMap(target =>
      findPositionsInRangeOfEnemyUnits(world, unit, [target])
    );

    const safePositions = threatPositions.filter(position =>
      relevantThreats.every(threat =>
        getDistance(position, threat.pos) >= optimalDistance
      )
    );

    const projectedTargetPositions = relevantThreats.map(targetUnit => {
      const targetPositions = enemyTrackingService.enemyUnitsPositions.get(targetUnit.tag);
      return targetPositions ? getProjectedPosition(
        targetPositions.current.pos,
        targetPositions.previous.pos,
        targetPositions.current.lastSeen,
        targetPositions.previous.lastSeen
      ) : targetUnit.pos;
    });

    const combinedThreatPosition = avgPoints(projectedTargetPositions);

    const closestSafePosition = safePositions.length > 0 ?
      safePositions.reduce((closest, position) =>
        getDistanceByPath(resources, combinedThreatPosition, position) <
          getDistanceByPath(resources, combinedThreatPosition, closest) ? position : closest
      ) : moveAwayPosition(map, combinedThreatPosition, unit.pos);

    const unitCommand = createUnitCommand(MOVE, [unit]);
    unitCommand.targetWorldSpacePos = closestSafePosition;

    return [unitCommand];
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
  const enemyAttackRanges = enemies.map(enemy => {
    const enemyWeapon = unitService.getWeaponThatCanAttack(data, enemy.unitType, unit);
    return enemyWeapon && typeof enemyWeapon.range === 'number' ? enemyWeapon.range : 0;
  });

  // Calculate the minimum attack range among enemies and include unit/threat sizes
  const minEnemyAttackRange = Math.min(...enemyAttackRanges);
  const unitRadius = unit.radius || 0; // Assume default unit radius property; replace as needed
  const threatRadius = enemies[0].radius || 0; // Assume default threat radius property; replace as needed

  return unitAttackRange + minEnemyAttackRange + unitRadius + threatRadius;
}

/**
 * @description Returns positions that are in range of the unit's weapons from enemy units.
 * @param {World} world
 * @param {Unit} unit
 * @param {Unit[]} enemyUnits
 * @returns {Point2D[]}
 */
function findPositionsInRangeOfEnemyUnits(world, unit, enemyUnits) {
  const { data, resources } = world;
  const { map } = resources.get();
  const { enemyUnitsPositions } = enemyTrackingService;
  const { getWeaponThatCanAttack } = unitService;
  const { pos, radius, unitType } = unit; if (pos === undefined || radius === undefined || unitType === undefined) return [];
  return enemyUnits.reduce((/** @type {Point2D[]} */ acc, enemyUnit) => {
    const { pos: enemyUnitPos, radius: enemyUnitRadius, tag, unitType: enemyUnitType } = enemyUnit;
    if (enemyUnitPos === undefined || enemyUnitRadius === undefined || tag === undefined || enemyUnitType === undefined) { return acc; }
    const weaponThatCanAttack = getWeaponThatCanAttack(data, unitType, enemyUnit); if (weaponThatCanAttack === undefined) { return acc; }
    const { range } = weaponThatCanAttack; if (range === undefined) { return acc; }
    const targetPositions = enemyUnitsPositions.get(tag);
    if (targetPositions === undefined) {
      const pointsInRange = getPointsInRange(enemyUnitPos, range + radius + enemyUnitRadius);
      acc.push(...pointsInRange);
      return acc;
    }
    const projectedEnemyUnitPos = getProjectedPosition(targetPositions.current.pos, targetPositions.previous.pos, targetPositions.current.lastSeen, targetPositions.previous.lastSeen);
    const pointsInRange = getPointsInRange(projectedEnemyUnitPos, range + radius + enemyUnitRadius);
    const pathablePointsInRange = pointsInRange.filter(point => map.isPathable(point));
    acc.push(...pathablePointsInRange);
    return acc;
  }, []);
}
/**
 * @description Returns boolean if the unit is in range of the enemy unit's weapons.
 * @param {Point2D} position
 * @param {number} range
 * @returns {Point2D[]}
 */
function getPointsInRange(position, range) {
  const { x, y } = position; if (x === undefined || y === undefined) return [];
  // get points around enemy unit that are in range of the unit's weapons, at least 16 points
  const pointsInRange = [];
  for (let i = 0; i < 16; i++) {
    const angle = i * 2 * Math.PI / 16;
    const point = {
      x: x + range * Math.cos(angle),
      y: y + range * Math.sin(angle),
    };
    pointsInRange.push(point);
  }
  return pointsInRange;
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
 * Returns necessary units to engage in battle.
 * 
 * @param {World} world - The game world context.
 * @param {Unit[]} candidateUnits - Units to consider adding to the battle.
 * @param {Unit[]} currentUnits - Current units excluding candidate units.
 * @param {Unit[]} enemyUnits - Enemy units.
 * @returns {Unit[]} - Necessary units required to engage.
 */
function getNecessaryUnits(world, candidateUnits, currentUnits, enemyUnits) {
  const necessaryUnits = [];

  for (const unit of candidateUnits) {
    necessaryUnits.push(unit);
    const combinedUnits = [...currentUnits, ...necessaryUnits];

    if (worldService.shouldEngage(world, combinedUnits, enemyUnits)) {
      break;
    }
  }

  return necessaryUnits;
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
      const damage = worldService.getWeaponDamage(world, enemy.unitType, unit.unitType, unit.alliance);
      return Math.max(maxDamage, damage);
    }
    return maxDamage;
  }, 0);

  return maxPotentialDamage;
}

/**
 * Creates a retreat command for a given unit.
 *
 * @param {World} world - The game world.
 * @param {Unit} unit - The unit that needs to retreat.
 * @param {Unit[]} enemyUnits - The enemy units that the unit is retreating from.
 * @returns {SC2APIProtocol.ActionRawUnitCommand | undefined} - The retreat command.
 */
function createRetreatCommand(world, unit, enemyUnits) {
  const retreatPosition = worldService.retreat(world, unit, enemyUnits);

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
function processSelfUnitLogic(world, selfUnits, selfUnit, position, enemyUnits, collectedActions, clearRocks) {
  // Your specific implementations and constants, such as groupTypes, need to be defined elsewhere in your code
  const { workerTypes } = groupTypes;
  const { pos, radius, tag } = selfUnit;
  if (pos === undefined || radius === undefined || tag === undefined) return;

  // Log condition based on game world time
  const logCondition = world.resources.get().frame.timeInSeconds() > 215 && world.resources.get().frame.timeInSeconds() < 245;

  // Process logic for non-worker units
  if (!workerTypes.includes(selfUnit.unitType) || selfUnit.labels.has('defending')) {
    processNonWorkerUnit(world, selfUnits, selfUnit, position, enemyUnits, collectedActions, clearRocks);
  }

  // Log actions if specific conditions are met (for debugging or analysis)
  if (selfUnit.unitType === QUEEN && logCondition) {
    const queenActions = collectedActions.filter(action => action.unitTags && action.unitTags.includes(tag));
    console.log(`Queen ${tag} collectedActions: ${JSON.stringify(queenActions)}`);
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
function processNonWorkerUnit(world, selfUnits, selfUnit, position, enemyUnits, collectedActions, clearRocks) {
  const { getInRangeDestructables, getMovementSpeed, getWeaponThatCanAttack, setPendingOrders } = unitService;
  const { microB, microRangedUnit, retreat } = worldService;
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
    const shouldEngageGroup = worldService.shouldEngage(world, relevantSelfUnits, relevantEnemyUnits);
    if (!shouldEngageGroup) {
      if (getMovementSpeed(map, selfUnit) < getMovementSpeed(map, closestAttackableEnemyUnit) && closestAttackableEnemyUnit.unitType !== ADEPTPHASESHIFT) {
        if (selfUnit.isMelee()) {
          collectedActions.push(...microB(world, selfUnit, closestAttackableEnemyUnit, enemyUnits));
        } else {
          const enemyInAttackRange = isEnemyInAttackRange(data, selfUnit, closestAttackableEnemyUnit);
          if (enemyInAttackRange) {
            collectedActions.push(...microRangedUnit(world, selfUnit, closestAttackableEnemyUnit));
          } else {
            const unitCommand = createUnitCommand(MOVE, [selfUnit]);
            unitCommand.targetWorldSpacePos = retreat(world, selfUnit, [closestAttackableEnemyUnit]);
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
                      collectedActions.push(...microRangedUnit(world, selfUnit, closestEnemyRange));
                    } else {
                      // If ally units are in the path, set the target world space position to retreat
                      unitCommand.targetWorldSpacePos = retreat(world, selfUnit, [closestEnemyRange] || [closestAttackableEnemyUnit]);
                      unitCommand.unitTags = selfUnits.filter(unit => getDistance(unit.pos, selfUnit.pos) <= 1).map(unit => {
                        setPendingOrders(unit, unitCommand);
                        return unit.tag;
                      });
                    }
                  }

                  return;
                } else {
                  // retreat if buffer distance is greater than actual distance
                  unitCommand.targetWorldSpacePos = retreat(world, selfUnit, [closestEnemyRange] || [closestAttackableEnemyUnit]);
                  unitCommand.unitTags = selfUnits.filter(unit => getDistance(unit.pos, selfUnit.pos) <= 1).map(unit => {
                    setPendingOrders(unit, unitCommand);
                    return unit.tag;
                  });
                }
              } else {
                // no weapon found, micro ranged unit
                collectedActions.push(...microRangedUnit(world, selfUnit, closestEnemyRange || closestAttackableEnemyUnit));
                return;
              }
            } else {
              // retreat if melee
              unitCommand.targetWorldSpacePos = retreat(world, selfUnit, [closestEnemyRange || closestAttackableEnemyUnit]);
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
          collectedActions.push(...microRangedUnit(world, selfUnit, closestAttackableEnemyUnit));
        } else {
          handleMeleeUnitLogic(world, selfUnit, closestAttackableEnemyUnit, attackablePosition, collectedActions);
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
      if (destructableTag && clearRocks && !worldService.outpowered) {
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
 * Handle logic for melee units in combat scenarios.
 *
 * @param {World} world - The world context.
 * @param {Unit} selfUnit - The melee unit.
 * @param {Unit} targetUnit - The target unit.
 * @param {Point2D} attackablePosition - The position where the unit can attack.
 * @param {SC2APIProtocol.ActionRawUnitCommand[]} collectedActions - A collection of actions to execute.
 */
function handleMeleeUnitLogic(world, selfUnit, targetUnit, attackablePosition, collectedActions) {
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
  const nearbyEnemies = unitService.getUnitsInRadius(enemyTrackingService.mappedEnemyUnits, targetUnit.pos, 16);

  if (worldService.shouldEngage(world, meleeNearbyAllies, nearbyEnemies)) {
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
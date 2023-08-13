//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { MOVE, ATTACK_ATTACK } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getRandomPoint } = require("../../helper/location");
const { createUnitCommand } = require("../../services/actions-service");
const { getDistance, getStructureCells } = require("../../services/position-service");
const { getClosestUnitByPath, getCombatRally, getDistanceByPath } = require("../../services/resource-manager-service");
const { canAttack } = require("../../services/resources-service");
const { micro, getWorkerDefenseCommands } = require("../../services/world-service");
const enemyTrackingService = require("../enemy-tracking/enemy-tracking-service");
const { getWeaponThatCanAttack } = require("../../services/unit-service");
const { getMapPath } = require("../../services/map-resource-service");
const Ability = require("@node-sc2/core/constants/ability");

module.exports = createSystem({
  name: 'AttackSystem',
  type: 'agent',
  async onStep(world) {
    const { agent, data, resources } = world;
    const { foodUsed } = agent;
    if (foodUsed === undefined) { return; }
    const { map } = resources.get();
    const { actions, units } = resources.get();

    let unitsReadyForAttack = groupUnitsByProximity(getUnitsToAttackWith(units));
    /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
    const actionQueue = [];

    if (unitsReadyForAttack.length > 0) {
      const isWorkerDefending = unitsReadyForAttack.some(unitGroup => unitGroup.some(unit => unit.isWorker()));
      const enemyUnits = isWorkerDefending ? getUnitsWithinBaseRange(units) : enemyTrackingService.mappedEnemyUnits;

      if (enemyUnits.length > 0) {
        if (isWorkerDefending) {
          const [nearestEnemy] = getClosestUnitByPath(resources, getCombatRally(resources), enemyUnits);
          actionQueue.push(...getWorkerDefenseCommands(world, unitsReadyForAttack.flat(), nearestEnemy));
        } else {
          let attackableUnitGroups = unitsReadyForAttack.filter(myUnitGroup => {
            // Group the enemy targets by proximity.
            const enemyGroups = groupUnitsByProximity(enemyUnits);
            const closestEnemyGroup = getClosestEnemyGroupWithSafePath(world, myUnitGroup, enemyGroups);
            return closestEnemyGroup && wouldWinFight(data, myUnitGroup, closestEnemyGroup);
          });

          const allEnemiesUnreachable = enemyUnits.every(unit => isUnreachable(world, unit, unitsReadyForAttack.flat()));

          if (attackableUnitGroups.length > 0) {
            actionQueue.push(...attackTargets(world, attackableUnitGroups.flat(), enemyUnits));
          } else if (allEnemiesUnreachable) {
            actionQueue.push(...findEnemy(map, unitsReadyForAttack.flat()));
          } else {
            actionQueue.push(...handleFallbackStrategy(resources, unitsReadyForAttack, enemyUnits));
          }
        }
      } else {
        actionQueue.push(...findEnemy(map, unitsReadyForAttack.flat()));
      }
    }

    if (actionQueue.length > 0) {
      return actions.sendAction(actionQueue);
    }
  }
});
/**
 * @param {UnitResource} units 
 * @returns {Unit[]}
 */
function getUnitsWithinBaseRange(units) {
  // get all self structures and enemy units in range of structures
  const selfStructures = units.getAlive(Alliance.SELF).filter(unit => unit.isStructure());
  return units.getAlive(Alliance.ENEMY).filter(unit => selfStructures.some(structure => distance(unit.pos, structure.pos) <= 16));
}
/**
 * @param {World} world
 * @param {Unit[]} unitsToAttackWith 
 * @param {Unit[]} enemyTargets
 */
function attackTargets(world, unitsToAttackWith, enemyTargets) {
  const { resources } = world;
  const { units } = resources.get();
  const collectedActions = [];
  unitsToAttackWith.forEach(unit => {
    const { orders, pos, unitType } = unit; if (orders === undefined || pos === undefined || unitType === undefined) { return; }
    const abilityId = unit.abilityAvailable(ATTACK_ATTACK) ? ATTACK_ATTACK : MOVE;
    const attackableTargets = enemyTargets.filter(target => canAttack(unit, target, false));
    if (orders.length > 0 && orders[0].abilityId === ATTACK_ATTACK && orders[0].targetUnitTag !== undefined) {
      const { targetUnitTag } = orders[0];
      const target = units.getByTag(targetUnitTag);
      if (target !== undefined && !attackableTargets.some(target => target.tag === targetUnitTag)) {
        attackableTargets.push(target);
      }
    }
    const [closestEnemyUnit] = getClosestUnitByPath(resources, pos, attackableTargets);
    if (closestEnemyUnit) {
      const { pos: closestEnemyUnitPos } = closestEnemyUnit; if (closestEnemyUnitPos === undefined) { return; }
      if (getDistance(pos, closestEnemyUnitPos) > 16) {
        const unitCommand = createUnitCommand(abilityId, [unit]);
        // If the unit is not visible, target its last known position
        if (!closestEnemyUnit.isCurrent()) {
          unitCommand.targetWorldSpacePos = closestEnemyUnitPos;
        } else {
          unitCommand.targetUnitTag = closestEnemyUnit.tag;
        }
        collectedActions.push(unitCommand);
      } else {
        collectedActions.push(...micro(world, unit));
      }
    }
  });
  return collectedActions;
}

/**
 * @param {MapResource} map
 * @param {Unit[]} unitsToAttackWith
 */
function findEnemy(map, unitsToAttackWith) {
  const collectedActions = [];
  unitsToAttackWith.forEach(unit => {
    if (unit.isIdle() && !unit.isWorker()) {
      const randomPosition = getRandomPoint(map);
      if (randomPosition) {
        const unitCommand = createUnitCommand(MOVE, [unit]);
        unitCommand.targetWorldSpacePos = randomPosition;
        collectedActions.push(unitCommand);
      }
    }
  });
  return collectedActions;
}
/**
 * @param {UnitResource} units 
 * @returns {Unit[]}
 */
function getUnitsToAttackWith(units) {
  // exclude overlords, structures, workers and can't move
  const unitsToAttackWith = units.getAlive(Alliance.SELF).filter(unit => {
    return (
      !unit.isStructure() &&
      !unit.isWorker() &&
      unit.abilityAvailable(MOVE)
    );
  });
  if (unitsToAttackWith.length === 0) {
    return units.getAlive(Alliance.SELF).filter(unit => unit.isWorker());
  }
  return unitsToAttackWith;
}
/**
 * @param {DataStorage} data
 * @param {Unit[]} myUnits
 * @param {Unit[]} enemyUnits
 * @returns {boolean}
 */
const wouldWinFight = (data, myUnits, enemyUnits) => {
  if (enemyUnits.length === 0) {
    return true;
  }

  let myTotalDPS = 0;
  let myTotalHealthShield = 0;
  let enemyTotalDPS = 0;
  let enemyTotalHealthShield = 0;

  myUnits.forEach(unit => {
    // Get the maximum DPS this unit can deal against any enemy unit
    const maxDPS = Math.max(...enemyUnits.map(enemy => getDPS(data, unit, enemy)));
    myTotalDPS += maxDPS;
    myTotalHealthShield += (unit.health ?? 0) + (unit.shield ?? 0);
  });

  enemyUnits.forEach(unit => {
    // Get the maximum DPS this unit can deal against any of my units
    const maxDPS = Math.max(...myUnits.map(enemy => getDPS(data, unit, enemy)));
    enemyTotalDPS += maxDPS;
    enemyTotalHealthShield += (unit.health ?? 0) + (unit.shield ?? 0);
  });

  const mySurvivalTime = enemyTotalDPS > 0 ? myTotalHealthShield / enemyTotalDPS : Infinity;
  const enemySurvivalTime = myTotalDPS > 0 ? enemyTotalHealthShield / myTotalDPS : Infinity;

  return mySurvivalTime > enemySurvivalTime;
};
/**
 * @param {DataStorage} data
 * @param {Unit} unit
 * @param {Unit} target
 * @returns {number}
 */
const getDPS = (data, unit, target) => {
  // Ensure unitType is defined
  if (unit.unitType !== undefined) {
    const weapon = getWeaponThatCanAttack(data, unit.unitType, target);
    if (weapon && weapon.damage !== undefined && weapon.speed !== undefined && weapon.speed > 0) {
      let totalDamage = weapon.damage;

      const targetAttributes = target.data()?.attributes ?? [];
      const targetArmor = target.data()?.armor ?? 0;

      // If the weapon has damage bonuses
      if (weapon.damageBonus && weapon.damageBonus.length > 0) {
        for (const bonus of weapon.damageBonus) {
          if (bonus.attribute !== undefined && targetAttributes.includes(bonus.attribute) && bonus.bonus !== undefined) {
            totalDamage += bonus.bonus;
          }
        }
      }

      // Subtract armor from total damage, but don't let it go below 0
      totalDamage = Math.max(0, totalDamage - targetArmor);

      // Calculate DPS
      const dps = totalDamage / weapon.speed;

      return dps;
    } else {
      // If there is no suitable weapon, or its speed is 0 or undefined, return 0
      return 0;
    }
  } else {
    // If unitType is undefined, return 0
    return 0;
  }
};


/**
 * @param {Unit[]} unitGroup
 * @returns {{x: number, y: number} | undefined}
 */
const getCenterPosition = (unitGroup) => {
  if (unitGroup.length === 0) {
    return undefined;
  }

  let totalX = 0;
  let totalY = 0;
  let count = 0;

  for (const unit of unitGroup) {
    if (unit.pos && unit.pos.x !== undefined && unit.pos.y !== undefined) {
      totalX += unit.pos.x;
      totalY += unit.pos.y;
      count++;
    }
  }

  // If no valid positions were found, return undefined
  if (count === 0) {
    return undefined;
  }

  return {
    x: totalX / count,
    y: totalY / count,
  };
};

/**
 * @param {Unit[]} units
 * @returns {Unit[][]}
 */
function groupUnitsByProximity(units) {
  const unitGroups = [];
  const maxDistance = 5;  // You'll need to set this to the maximum distance between units in the same group.

  for (const unit of units) {
    // Skip this unit if its position is not defined
    if (!unit.pos) {
      continue;
    }

    let addedToGroup = false;

    for (const group of unitGroups) {
      const center = getCenterPosition(group);

      // Make sure center is defined
      if (center && getDistance(center, unit.pos) <= maxDistance) {
        group.push(unit);
        addedToGroup = true;
        break;
      }
    }

    if (!addedToGroup) {
      // This unit is too far away from any existing groups, so start a new group.
      unitGroups.push([unit]);
    }
  }

  return unitGroups;
}
/**
 * @param {World} world
 * @param {Unit[]} myUnitGroup
 * @param {Unit[][]} enemyGroups
 * @returns {Unit[] | undefined}
 */
const getClosestEnemyGroupWithSafePath = (world, myUnitGroup, enemyGroups) => {
  const { data, resources } = world;
  const { map } = resources.get();
  const groupCenter = getCenterPosition(myUnitGroup);

  if (!groupCenter) {
    return undefined;
  }

  const enemyGroupRadius = 16;

  // Sorting enemy groups based on their center's distance to myUnitGroup.
  enemyGroups.sort((groupA, groupB) => {
    const centerA = getCenterPosition(groupA);
    const centerB = getCenterPosition(groupB);

    const distanceToA = centerA ? getDistanceByPath(resources, centerA, groupCenter) : Infinity;
    const distanceToB = centerB ? getDistanceByPath(resources, centerB, groupCenter) : Infinity;

    return distanceToA - distanceToB;
  });

  for (const enemyGroup of enemyGroups) {
    const enemyCenter = getCenterPosition(enemyGroup);

    if (!enemyCenter) {
      continue;
    }

    // Make structures temporarily pathable
    const structureAtEnemyGroupCells = getStructureCells(enemyCenter, enemyGroup);
    const originalCellStates = new Map();

    structureAtEnemyGroupCells.forEach(cell => {
      originalCellStates.set(cell, map.isPathable(cell));
      map.setPathable(cell, true);
    });

    // Compute the path
    const path = getMapPath(map, groupCenter, enemyCenter);

    // Restore the original pathability of cells
    structureAtEnemyGroupCells.forEach(cell => {
      const originalState = originalCellStates.get(cell);
      map.setPathable(cell, originalState);
    });

    const unitsAlongPath = enemyGroup.filter(enemy => {
      if (enemy.pos) {
        const proximityThreshold = 16;
        return path.some(pathPoint =>
          getDistance(
            toPoint2D(pathPoint),
            toPoint2D(toPointArray(enemy.pos || { x: 0, y: 0, z: 0 }))
          ) <= proximityThreshold
        );
      }
      return false;
    });

    if (!wouldWinFight(data, myUnitGroup, unitsAlongPath)) {
      continue;
    }

    /**
     * @param {Unit} enemy
     * @param {number[][]} path
     * @param {number} enemyGroupRadius
     * @returns {boolean}
     */
    const enemyGroupFilter = (enemy, path, enemyGroupRadius) => {
      if (enemy.pos) {
        const { x, y } = enemy.pos;
        if (x !== undefined && y !== undefined) {
          return path.some(pathPoint =>
            getDistance(
              toPoint2D(pathPoint),
              toPoint2D([x, y])
            ) <= enemyGroupRadius
          );
        }
      }
      return false;
    };

    const relevantEnemyGroup = enemyGroup.filter(enemy => enemyGroupFilter(enemy, path, enemyGroupRadius));

    if (relevantEnemyGroup.length > 0) {
      return relevantEnemyGroup;
    }
  }

  return undefined;
};

/**
 * @param {number[]} point
 * @param {number[][]} path
 * @returns {boolean}
 */
function pathIncludesPoint(point, path) {
  return path.some(([x, y]) => x === point[0] && y === point[1]);
}

/**
 * @param {ResourceManager} resources
 * @param {Unit[]} units
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function goToRallyPoint(resources, units) {
  const rallyPoint = getCombatRally(resources);
  const collectedActions = [];

  for (const unit of units) {
    if (unit.tag) {
      collectedActions.push({
        abilityId: Ability.SMART,
        targetWorldSpacePos: rallyPoint,
        unitTags: [unit.tag],
      });
    }
  }

  return collectedActions;
}

/**
 * @param {Point2D} point
 * @returns {number[]}
 */
function toPointArray(point) {
  return [point.x, point.y];
}

/**
 * @param {number[]} arr
 * @returns {Point2D}
 */
function toPoint2D(arr) {
  return { x: arr[0], y: arr[1] };
}

/**
 * @param {World} world
 * @param {Unit} enemyUnit
 * @param {Unit[]} myUnits
 * @returns {boolean}
 */
function isUnreachable(world, enemyUnit, myUnits) {
  const { data, resources } = world;
  const { map } = resources.get();

  // Check if any of my units has a weapon that can attack enemyUnit
  const canAttack = myUnits.some(unit => {
    // Ensure the unitType is defined
    if (unit.unitType === undefined) return false;
    const weapon = getWeaponThatCanAttack(data, unit.unitType, enemyUnit);
    return weapon !== undefined;
  });
  if (canAttack) return false;

  // Check if any of my units can reach the enemyUnit by path
  const canReach = myUnits.some(unit => {
    // Ensure the unit and enemyUnit positions are defined
    if (unit.pos === undefined || enemyUnit.pos === undefined) return false;

    // Make structures temporarily pathable
    const structureAtEnemyPositionCells = getStructureCells(enemyUnit.pos, myUnits);
    const originalCellStates = new Map();
    structureAtEnemyPositionCells.forEach(cell => {
      originalCellStates.set(cell, map.isPathable(cell));
      map.setPathable(cell, true);
    });

    const path = getMapPath(map, unit.pos, enemyUnit.pos);

    // Restore the original pathability of cells
    structureAtEnemyPositionCells.forEach(cell => {
      const originalState = originalCellStates.get(cell);
      map.setPathable(cell, originalState);
    });

    return path && path.length > 0;
  });
  return !canReach;
}

/**
 * This function finds the safest fallback position on the map
 * @param {MapResource} map
 * @param {Unit[]} enemyUnits
 * @returns {Point2D | undefined} The safest position, or undefined if there's no safe position
 */
function findSafestFallbackPosition(map, enemyUnits) {
  let safestPosition;
  let greatestMinimumDistance = 0;
  const allPositions = getAllPositions(map); // This function should return all positions on the map

  for (const position of allPositions) {
    const minimumDistance = getMinimumDistanceToEnemy(position, enemyUnits); // This function should calculate the minimum distance from the position to any enemy unit
    if (minimumDistance !== undefined && minimumDistance > greatestMinimumDistance) {
      greatestMinimumDistance = minimumDistance;
      safestPosition = position;
    }
  }

  return safestPosition;
}
/**
 * This function returns all positions on the map
 * @param {MapResource} map
 * @returns {Point2D[]} All positions on the map
 */
function getAllPositions(map) {
  const positions = [];
  const size = map.getSize();

  // Make sure the size is defined before proceeding
  if (size && size.x !== undefined && size.y !== undefined) {
    const { x: width, y: height } = size;

    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        positions.push({ x, y });
      }
    }
  }

  return positions;
}
/**
 * This function returns the minimum distance from a position to any unit in a list of enemy units
 * @param {Point2D} position The position from which to calculate the distance
 * @param {Unit[]} enemyUnits A list of enemy units
 * @returns {number | undefined} The minimum distance to any enemy unit, or undefined if there are no enemy units
 */
const getMinimumDistanceToEnemy = (position, enemyUnits) => {
  return enemyUnits.reduce((minDistance, unit) => {
    if (unit.pos) {
      const distance = getDistance(position, unit.pos);
      return distance < minDistance ? distance : minDistance;
    }
    return minDistance;
  }, Infinity);
};

/**
 * This function gets the commands to move all units to the fallback position
 * @param {Unit[]} units - The units that should move to the fallback position
 * @param {Point2D} fallbackPosition - The position to move to
 * @returns {SC2APIProtocol.ActionRawUnitCommand[] | null} The commands to send the units to the fallback position
 */
function goToFallbackPosition(units, fallbackPosition) {
  const commands = units.reduce((/** @type {SC2APIProtocol.ActionRawUnitCommand[]} */ acc, unit) => {
    if (unit.tag !== undefined) {
      const command = createMoveCommand(unit, fallbackPosition);
      if (command !== null) {
        acc.push(command);
      }
    }
    return acc;
  }, []);
  return commands.length > 0 ? commands : null;
}

/**
 * This function creates a command to move a unit to a certain position
 * @param {Unit} unit - The unit that should move
 * @param {Point2D} position - The position to move to
 * @returns {SC2APIProtocol.ActionRawUnitCommand | null} The command to move the unit
 */
function createMoveCommand(unit, position) {
  if (unit.tag) {
    return {
      abilityId: MOVE, // The ability ID for "Move" (you'll need to replace this with the actual ID)
      targetWorldSpacePos: position,
      unitTags: [unit.tag],
    };
  } else {
    return null;
  }
}

/**
 * @param {ResourceManager} resources
 * @param {Unit[][]} unitsReadyForAttack
 * @param {Unit[]} enemyUnits
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function handleFallbackStrategy(resources, unitsReadyForAttack, enemyUnits) {
  const { map } = resources.get();
  const actionQueue = [];
  const groupCenter = getCenterPosition(unitsReadyForAttack.flat());

  if (groupCenter !== undefined) {
    const rallyPoint = getCombatRally(resources);
    const pathToRallyPoint = getMapPath(map, groupCenter, rallyPoint);
    const enemiesAlongPath = enemyUnits.filter(enemy => enemy.pos && pathIncludesPoint(toPointArray(enemy.pos), pathToRallyPoint));

    if (enemiesAlongPath.length === 0) {
      actionQueue.push(...goToRallyPoint(resources, unitsReadyForAttack.flat()));
    } else {
      const fallbackPosition = findSafestFallbackPosition(map, enemyUnits);
      if (fallbackPosition) {
        const fallbackCommands = goToFallbackPosition(unitsReadyForAttack.flat(), fallbackPosition);
        if (fallbackCommands) {
          actionQueue.push(...fallbackCommands);
        }
      } else {
        actionQueue.push(...handleDefendCurrentPosition(unitsReadyForAttack, enemyUnits));
      }
    }
  }
  // Implement logic here for when the group center is undefined
  // For example, select a default group center or select a different group of units
  return actionQueue;
}

/**
 * @param {Unit[][]} unitsReadyForAttack
 * @param {Unit[]} enemyUnits
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function handleDefendCurrentPosition(unitsReadyForAttack, enemyUnits) {
  const actionQueue = [];
  const defendCommands = unitsReadyForAttack.flat().reduce((/** @type {SC2APIProtocol.ActionRawUnitCommand[]} */ commands, unit) => {
    if (unit.tag) {
      commands.push({
        abilityId: Ability.ATTACK,
        targetUnitTag: enemyUnits[0].tag,
        unitTags: [unit.tag],
      });
    }
    return commands;
  }, []);

  if (defendCommands.length > 0) {
    actionQueue.push(...defendCommands);
  }
  return actionQueue;
}
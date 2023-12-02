//@ts-check
"use strict";

// /src/services/army-management/army-management-service.js

const groupTypes = require("@node-sc2/core/constants/groups");
const { getDistance, moveAwayPosition, getBorderPositions, dbscan } = require("../../../services/position-service");
const enemyTrackingService = require("../../../systems/enemy-tracking/enemy-tracking-service");
const unitService = require("../../../services/unit-service");
const { MOVE, STOP, ATTACK_ATTACK, LOAD_BUNKER, SMART, HARVEST_GATHER } = require("@node-sc2/core/constants/ability");
const { QUEEN, ADEPTPHASESHIFT, BUNKER, BARRACKS, FACTORY, STARPORT } = require("@node-sc2/core/constants/unit-type");
const { canAttack } = require("../../../services/resources-service");
const { getTravelDistancePerStep } = require("../../../services/frames-service");
const MapResourceService = require("../../../systems/map-resource-system/map-resource-service");
const { getPathCoordinates } = require("../../../services/path-service");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { UnitType, Ability } = require("@node-sc2/core/constants");
const microService = require("../../../services/micro-service");
const pathFindingService = require("../pathfinding/pathfinding-service");
const { getWeaponDPS, getWeaponDamage } = require("../../shared-utilities/combat-utilities");
const enemyTrackingServiceV2 = require("../enemy-tracking/enemy-tracking-service");
const { getClosestSafeMineralField } = require("../utility-service");
const { getPotentialCombatantsInRadius } = require("../unit-analysis");
const { createUnitCommand } = require("../../shared-utilities/command-utilities");
const { getProjectedPosition } = require("../../shared-utilities/vector-utils");
const { EngagementLogicService } = require("./engagement-logic");
const { MicroManagementService } = require("./micro-management");
const { getCombatRally } = require("../shared-config/combatRallyConfig");

/**
 * @typedef {import("../../interfaces/i-army-management-service-minimal").IArmyManagementServiceMinimal} IArmyManagementServiceMinimal
 */
/**
 * Implements the IArmyManagementServiceMinimal interface.
 * @implements {IArmyManagementServiceMinimal}
 */
class ArmyManagementService {
  /**
   * @param {import("../../interfaces/i-retreat-management-service").IRetreatManagementService} retreatService - The retreat management service.
   */
  constructor(retreatService) {
    /** @private @type {import("../interfaces/i-retreat-management-service").IRetreatManagementService} */
    this.retreatService = retreatService;
  }
  /** @type {Boolean} */
  outpowered = false;

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

    const classifications = classifyUnits(selfUnits);
    const { injectorQueens, allMeleeUnits, otherUnits } = classifications;

    const healthStatus = evaluateUnitHealth(allMeleeUnits, world, enemyUnits);
    const { lowHealthMeleeUnits, healthyMeleeUnits } = healthStatus; // Assume healthyMeleeUnits is also returned by evaluateUnitHealth

    const necessaryUnits = this.evaluateNecessaryUnits(world, injectorQueens, lowHealthMeleeUnits, otherUnits, enemyUnits);
    const { necessaryInjectorQueens, necessaryLowHealthMeleeUnits, battleUnits } = necessaryUnits;

    issueStopOrders(injectorQueens, necessaryInjectorQueens, collectedActions);
    this.issueRetreatOrders(world, lowHealthMeleeUnits, necessaryLowHealthMeleeUnits, enemyUnits, collectedActions);

    // Including healthyMeleeUnits in the units to be processed
    const allUnitsToProcess = battleUnits.concat(healthyMeleeUnits);

    allUnitsToProcess.forEach(unit => {
      this.processSelfUnitLogic(world, allUnitsToProcess, unit, position, enemyUnits, collectedActions, clearRocks);
    });

    return collectedActions;
  }

  /**
   * Evaluates and classifies the necessary units for battle including injector queens and low health melee units.
   *
   * @param {World} world - The game world containing all the game information.
   * @param {Unit[]} injectorQueens - The array of injector queens.
   * @param {Unit[]} lowHealthMeleeUnits - The array of low health melee units.
   * @param {Unit[]} otherUnits - The array of other types of units.
   * @param {Unit[]} enemyUnits - The array of enemy units.
   * @returns {{necessaryInjectorQueens: Unit[], necessaryLowHealthMeleeUnits: Unit[], battleUnits: Unit[]}} - The necessary units for battle.
   */
  evaluateNecessaryUnits(world, injectorQueens, lowHealthMeleeUnits, otherUnits, enemyUnits) {
    /** @type {Unit[]} */
    const necessaryInjectorQueens = this.getNecessaryUnits(world, injectorQueens, otherUnits, enemyUnits);

    /** @type {Unit[]} */
    const necessaryLowHealthMeleeUnits = this.getNecessaryUnits(world, lowHealthMeleeUnits, otherUnits, enemyUnits);

    // Combining all units needed for the battle
    const battleUnits = [...necessaryInjectorQueens, ...necessaryLowHealthMeleeUnits, ...otherUnits];

    return {
      necessaryInjectorQueens,
      necessaryLowHealthMeleeUnits,
      battleUnits
    };
  }  

  /**
   * @returns {boolean}
   */
  getOutpoweredStatus() {
    return this.outpowered;
  }  

  /**
   * Issues retreat orders to low-health melee units that are not deemed necessary for the battle.
   * Unnecessary units are identified and assigned a retreat command to move away from the battle.
   *
   * @param {World} world - The game world containing all the game information.
   * @param {Unit[]} lowHealthMeleeUnits - The array of low-health melee units.
   * @param {Unit[]} necessaryLowHealthMeleeUnits - The array of necessary low-health melee units for the battle.
   * @param {Unit[]} enemyUnits - The array of enemy units.
   * @param {SC2APIProtocol.ActionRawUnitCommand[]} collectedActions - The collection of unit commands to be executed.
   */
  issueRetreatOrders(world, lowHealthMeleeUnits, necessaryLowHealthMeleeUnits, enemyUnits, collectedActions) {
    lowHealthMeleeUnits
      .filter(unit => !necessaryLowHealthMeleeUnits.includes(unit) && unit.tag)
      .forEach(unit => {
        const retreatCommand = this.retreatService.createRetreatCommand(world, unit, enemyUnits);

        if (retreatCommand) {
          collectedActions.push(retreatCommand);
        }
      });
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

    const engagementLogic = new EngagementLogicService();
    if (enemyUnits.length === 0 || engagementLogic.shouldEngage(world, currentUnits, enemyUnits)) {
      // If there are no enemy units nearby or the current units are already sufficient to engage
      return necessaryUnits;
    }

    for (const unit of candidateUnits) {
      necessaryUnits.push(unit); // Add the candidate unit
      const combinedUnits = [...currentUnits, ...necessaryUnits];

      if (engagementLogic.shouldEngage(world, combinedUnits, enemyUnits)) {
        // If adding the unit makes engagement favorable, stop adding more units
        break;
      }
    }

    return necessaryUnits;
  }

  /**
   * Retrieves units that are suitable for engagement.
   *
   * @param {World} world - The current state of the world.
   * @param {Unit} unit - The reference unit.
   * @param {number} radius - The radius to check for units.
   * @returns {Unit[]} - Array of units selected for engagement.
   */
  getUnitsForEngagement(world, unit, radius) {
    return getPotentialCombatantsInRadius(world, unit, radius);
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
    const logMessages = [];  // Create an array to store log messages
    // Validations for necessary properties
    if (!selfUnit.pos || !selfUnit.radius || !targetUnit.pos) return;

    const self = this;  // Store 'this' reference in a variable for use in nested functions
    const { data, resources: { get } } = world;
    const { map, units } = get();
    
    const FALLBACK_MULTIPLIER = -1;
    const weapon = selfUnit.unitType !== undefined
      ? unitService.getWeaponThatCanAttack(data, selfUnit.unitType, targetUnit)
      : undefined;

    const weaponRange = weapon && weapon.range !== undefined ? +weapon.range : 0;
    const attackRadius = weaponRange + Number(selfUnit.radius ?? 0) + Number(targetUnit.radius ?? 0);

    const isValidUnit = createIsValidUnitFilter(data, targetUnit);
    let queueCommand = false;

    const rangedUnitAlly = units.getClosest(selfUnit.pos, selfUnit['selfUnits'].filter(isValidUnit))[0];
    const nearbyAllies = unitService.getUnitsInRadius(units.getAlive(Alliance.SELF), selfUnit.pos, 16);
    const meleeNearbyAllies = nearbyAllies.filter(unit =>
      unit.isMelee() && unit.unitType !== undefined && unitService.getWeaponThatCanAttack(data, unit.unitType, targetUnit) !== undefined
    );

    const nearbyEnemies = unitService.getUnitsInRadius(enemyTrackingServiceV2.mappedEnemyUnits, targetUnit.pos, 16);
    const engagementLogic = new EngagementLogicService();
    // Handling the melee unit's actions based on the surrounding context
    if (!rangedUnitAlly || engagementLogic.shouldEngage(world, meleeNearbyAllies, nearbyEnemies)) {
      logMessages.push(`rangedUnitAlly exists: ${Boolean(rangedUnitAlly)}`);
      logMessages.push(`shouldEngage result: ${engagementLogic.shouldEngage(world, meleeNearbyAllies, nearbyEnemies)}`);
      logMessages.push(`meleeNearbyAllies count: ${meleeNearbyAllies.length}`);
      logMessages.push(`nearbyEnemies count: ${nearbyEnemies.length}`);

      logMessages.push('Decision: Engaging - shouldEngage returned true or no rangedUnitAlly found');
      moveToSurroundOrAttack();
    } else {
      logMessages.push('Decision: Not engaging immediately - checking if need to fallback');
      if (rangedUnitAlly.pos && shouldFallback(world, selfUnit, rangedUnitAlly, targetUnit)) {
        logMessages.push('Decision: Fallback - shouldFallback returned true');
        moveToFallbackPosition();
      } else {
        logMessages.push('Decision: Check Surround or Attack');
        moveToSurroundOrAttack();
      }
    }

    attackIfApplicable();

    if (world.resources.get().frame.timeInSeconds() >= 198 && world.resources.get().frame.timeInSeconds() <= 223) {
      console.log(logMessages.join('; '));  // Print all log messages as a single string
    }

    /**
     * Determines if the melee unit can attack the target unit.
     *
     * @returns {boolean} True if the attack is available, otherwise false.
     */
    function isAttackAvailable() {
      if (!selfUnit.pos || !targetUnit.pos || selfUnit.unitType === undefined || selfUnit.weaponCooldown === undefined) {
        return false;  // Handle undefined properties
      }

      const distance = getDistance(selfUnit.pos, targetUnit.pos);
      const dynamicAttackRadius = attackRadius + getTravelDistancePerStep(map, selfUnit);

      return selfUnit.weaponCooldown <= 8 && distance <= dynamicAttackRadius;
    }

    /**
     * Determines if the melee unit is in an optimal surround position.
     *
     * @returns {boolean} True if in optimal position, false otherwise.
     */
    function isInOptimalSurroundPosition() {
      if (!selfUnit.pos || !targetUnit.pos) return false;  // Handling potential undefined values

      let projectedPosition;

      if (targetUnit.tag) {
        const enemyUnitInfo = enemyTrackingService.enemyUnitsPositions.get(targetUnit.tag);

        if (enemyUnitInfo) {
          // Predict the target unit's position
          projectedPosition = getProjectedPosition(
            enemyUnitInfo.current.pos,
            enemyUnitInfo.previous.pos,
            enemyUnitInfo.current.lastSeen,
            enemyUnitInfo.previous.lastSeen
          );
        }
      }

      // Use current position if projectedPosition is not calculated
      if (!projectedPosition) {
        projectedPosition = targetUnit.pos;
      }

      return getDistance(selfUnit.pos, projectedPosition) <= attackRadius;
    }

    /**
     * Directs the melee unit to a position to surround or attack the enemy.
     */
    function moveToSurroundOrAttack() {
      if (isAttackAvailable()) {
        logMessages.push('Decision: Attacking - attack is available');
        attackIfApplicable();
      } else if (isInOptimalSurroundPosition()) {
        logMessages.push('Decision: In optimal surround position - ready to attack when possible');
      } else {
        const surroundPosition = getOptimalSurroundPosition();
        if (surroundPosition) {
          logMessages.push('Decision: Moving to optimal surround position');
          createAndAddUnitCommand(MOVE, selfUnit, surroundPosition, collectedActions, queueCommand);
          queueCommand = true;
        }
      }
    }

    /**
     * Directs the melee unit to a fallback position when needed.
     */
    function moveToFallbackPosition() {
      if (rangedUnitAlly.pos && targetUnit.pos) {
        const rangedAllyRadius = rangedUnitAlly.radius ?? 0;
        const selfUnitRadius = selfUnit.radius ?? 0;

        const fallbackDirection = getDirection(rangedUnitAlly.pos, targetUnit.pos);
        const fallbackDistance = (rangedAllyRadius + selfUnitRadius) * FALLBACK_MULTIPLIER;
        const position = moveInDirection(rangedUnitAlly.pos, fallbackDirection, fallbackDistance);

        createAndAddUnitCommand(MOVE, selfUnit, position, collectedActions);
        queueCommand = true;
      }
    }

    /**
     * Initiates an attack if applicable conditions are met.
     */
    function attackIfApplicable() {
      if (attackablePosition && selfUnit.weaponCooldown !== undefined && selfUnit.weaponCooldown <= 8) {
        // Added a check for undefined
        createAndAddUnitCommand(ATTACK_ATTACK, selfUnit, attackablePosition, collectedActions, queueCommand);
      }
    }

    /**
     * Determines the optimal surround position for the melee unit.
     *
     * @returns {Point2D|null} The optimal pathable surround position, or null if none is found.
     */
    function getOptimalSurroundPosition() {
      if (!targetUnit.pos) return null;

      let projectedPosition;

      if (targetUnit.tag) {
        const enemyUnitInfo = enemyTrackingService.enemyUnitsPositions.get(targetUnit.tag);

        if (enemyUnitInfo) {
          // Predict the target unit's position
          projectedPosition = getProjectedPosition(
            enemyUnitInfo.current.pos,
            enemyUnitInfo.previous.pos,
            enemyUnitInfo.current.lastSeen,
            enemyUnitInfo.previous.lastSeen
          );
        }
      }

      // Use current position if projectedPosition is not calculated
      if (!projectedPosition) {
        projectedPosition = targetUnit.pos;
      }

      const pathablePositions = getBorderPositions(projectedPosition, attackRadius).filter(pos => map.isPathable(pos));

      if (pathablePositions.length === 0 || !selfUnit.pos) return null;

      const optimalPositions = pathablePositions.filter(pos =>
        !self.isOccupiedByAlly(units, selfUnit, pos, meleeNearbyAllies, collectedActions) &&
        !isOccupiedByEnemy(selfUnit, pos, nearbyEnemies));  // Added this condition

      if (optimalPositions.length === 0) return null;

      return optimalPositions
        .sort((a, b) => {
          if (selfUnit.pos) { // ensure selfUnit.pos is not undefined
            return getDistance(b, selfUnit.pos) - getDistance(a, selfUnit.pos);
          } else {
            return 0; // or handle appropriately if selfUnit.pos can be undefined
          }
        })[0];
    }

    /**
     * Determines whether a specific position is occupied by an enemy unit.
     *
     * @param {Unit} selfUnit - The unit to check against occupation.
     * @param {Point2D} position - The location to be checked.
     * @param {Unit[]} enemies - A list of enemy units to evaluate for occupation.
     * @returns {boolean} - Indicates if the position is occupied by an enemy unit.
     */
    function isOccupiedByEnemy(selfUnit, position, enemies) {
      return enemies.some(enemy =>
        enemy.pos && getDistance(enemy.pos, position) < (enemy.radius ?? 0) + (selfUnit.radius ?? 0));
    }

  }

  /**
   * Determines whether a specific position is occupied by an ally or has an impending order.
   *
   * @param {UnitResource} units - The unit resource.
   * @param {Unit} selfUnit - The unit to check against occupation and orders.
   * @param {Point2D} position - The location to be checked.
   * @param {Unit[]} allies - A list of allied units to evaluate for occupation.
   * @param {SC2APIProtocol.ActionRawUnitCommand[]} collectedActions - Pending actions to be evaluated.
   * @returns {boolean} - Indicates if the position is either occupied or has a pending order.
   */
  isOccupiedByAlly(units, selfUnit, position, allies, collectedActions) {
    const isOccupied = allies.some(ally =>
      ally.pos && getDistance(ally.pos, position) < (ally.radius ?? 0) + (selfUnit.radius ?? 0));

    const hasOrderToPosition = collectedActions.some(action => {
      if (action.targetWorldSpacePos) {
        const orderDistance = getDistance(action.targetWorldSpacePos, position);

        // If specific units associated with the order are available, consider their radius
        if (action.unitTags && action.unitTags.length > 0) {
          const orderedUnits = action.unitTags.map(tag => units.getByTag(tag)).filter(unit => unit != null); // Assuming a getByTag function or similar to get unit by tag
          return orderedUnits.some(unit => orderDistance < (unit.radius ?? 0) + (selfUnit.radius ?? 0));
        } else {
          // If not, just consider the self unit's radius or another default value
          return orderDistance < (selfUnit.radius ?? 0);
        }
      }
      return false;
    });

    return isOccupied || hasOrderToPosition;
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
    const logMessages = [];  // Initialize an array to collect log messages
    const { getInRangeDestructables, getMovementSpeed, getWeaponThatCanAttack, setPendingOrders } = unitService;
    const { data, resources } = world;
    const { map, units } = resources.get();
    const { pos, radius, tag } = selfUnit;
    if (pos === undefined || radius === undefined || tag === undefined) return;

    const selfUnitsAttackingInRange = getUnitsAttackingInRange(world, selfUnits);
    let targetPosition = position;
    const [closestAttackableEnemyUnit] = units.getClosest(selfUnit.pos, enemyUnits.filter(enemyUnit => canAttack(selfUnit, enemyUnit, false)));
    const attackablePosition = closestAttackableEnemyUnit ? closestAttackableEnemyUnit.pos : null;
    const engagementDistanceThreshold = 16; // Or whatever distance you choose
    const relevantSelfUnits = selfUnits.filter(unit => {
      if (!selfUnit.pos || !unit.pos) return false;
      return getDistance(unit.pos, selfUnit.pos) <= engagementDistanceThreshold;
    });
    if (closestAttackableEnemyUnit && getDistance(selfUnit.pos, closestAttackableEnemyUnit.pos) < 16) {
      const engagementLogic = new EngagementLogicService();
      const microManagement = new MicroManagementService();
      logMessages.push('Closest attackable enemy unit found within distance < 16');
      const { pos: closestAttackableEnemyUnitPos, radius: closestAttackableEnemyUnitRadius, unitType: closestAttackableEnemyUnitType } = closestAttackableEnemyUnit; if (closestAttackableEnemyUnitPos === undefined || closestAttackableEnemyUnitRadius === undefined || closestAttackableEnemyUnitType === undefined) return;
      const relevantEnemyUnits = enemyUnits.filter(unit => {
        if (unit.pos && selfUnit.pos) {
          return getDistance(unit.pos, selfUnit.pos) <= engagementDistanceThreshold;
        }
        return false;
      });
      const shouldEngageGroup = engagementLogic.shouldEngage(world, relevantSelfUnits, relevantEnemyUnits);
      logMessages.push(`shouldEngageGroup: ${shouldEngageGroup}`);
      if (!shouldEngageGroup) {
        if (getMovementSpeed(map, selfUnit) < getMovementSpeed(map, closestAttackableEnemyUnit) && closestAttackableEnemyUnit.unitType !== ADEPTPHASESHIFT) {
          logMessages.push('selfUnit is slower than closestAttackableEnemyUnit and enemy unit is not ADEPTPHASESHIFT');

          if (selfUnit.isMelee()) {
            logMessages.push('selfUnit is melee');
            collectedActions.push(...this.microB(world, selfUnit, closestAttackableEnemyUnit, enemyUnits));
          } else {
            const enemyInAttackRange = isEnemyInAttackRange(data, selfUnit, closestAttackableEnemyUnit);

            if (enemyInAttackRange) {
              logMessages.push('enemy is in attack range');
              collectedActions.push(...microManagement.microRangedUnit(world, selfUnit, closestAttackableEnemyUnit));
            } else {
              logMessages.push('enemy is not in attack range');
              const unitCommand = createUnitCommand(MOVE, [selfUnit]);
              unitCommand.targetWorldSpacePos = this.retreatService.retreat(world, selfUnit, [closestAttackableEnemyUnit]);
              collectedActions.push(unitCommand);
            }
          }
        } else {
          logMessages.push('selfUnit is faster than closestAttackableEnemyUnit or enemy unit is ADEPTPHASESHIFT');
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
                        collectedActions.push(...microManagement.microRangedUnit(world, selfUnit, closestEnemyRange));
                      } else {
                        // If ally units are in the path, set the target world space position to retreat
                        unitCommand.targetWorldSpacePos = this.retreatService.retreat(world, selfUnit, [closestEnemyRange] || [closestAttackableEnemyUnit]);
                        unitCommand.unitTags = selfUnits.filter(unit => getDistance(unit.pos, selfUnit.pos) <= 1).map(unit => {
                          setPendingOrders(unit, unitCommand);
                          return unit.tag;
                        });
                      }
                    }

                    return;
                  } else {
                    // retreat if buffer distance is greater than actual distance
                    unitCommand.targetWorldSpacePos = this.retreatService.retreat(world, selfUnit, [closestEnemyRange] || [closestAttackableEnemyUnit]);
                    unitCommand.unitTags = selfUnits.filter(unit => getDistance(unit.pos, selfUnit.pos) <= 1).map(unit => {
                      setPendingOrders(unit, unitCommand);
                      return unit.tag;
                    });
                  }
                } else {
                  // no weapon found, micro ranged unit
                  collectedActions.push(...microManagement.microRangedUnit(world, selfUnit, closestEnemyRange || closestAttackableEnemyUnit));
                  return;
                }
              } else {
                // retreat if melee
                unitCommand.targetWorldSpacePos = this.retreatService.retreat(world, selfUnit, [closestEnemyRange || closestAttackableEnemyUnit]);
              }
            } else {
              // skip action if pending orders
              return;
            }
          }
          collectedActions.push(unitCommand);
        }
      } else {
        logMessages.push('shouldEngageGroup is true');
        setRecruitToBattleLabel(selfUnit, attackablePosition);
        if (canAttack(selfUnit, closestAttackableEnemyUnit, false)) {
          if (!selfUnit.isMelee()) {
            collectedActions.push(...microManagement.microRangedUnit(world, selfUnit, closestAttackableEnemyUnit));
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
      logMessages.push('No closest attackable enemy unit found within distance < 16 or closestAttackableEnemyUnit is undefined');
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
          let fitablePositions = destructableBorderPositions
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

            // Filter out positions that are occupied by an ally or have a pending order
            fitablePositions = fitablePositions.filter(position =>
              !this.isOccupiedByAlly(units, selfUnit, position, relevantSelfUnits, collectedActions)
            );

            if (fitablePositions.length === 0) {
              return; // All fitable positions are already assigned or occupied, so no action to take
            }

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
      } else {
        if (selfUnit.tag) {
          const stopCommand = {
            abilityId: STOP,
            unitTags: [selfUnit.tag],
          };
          collectedActions.push(stopCommand);
          logMessages.push('Issued STOP command to QUEEN to allow other behaviors');
        }
      }
    }

    if (world.resources.get().frame.timeInSeconds() >= 198 && world.resources.get().frame.timeInSeconds() <= 223) {
      console.log(logMessages.join('; '));  // Print all log messages as a single string
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
    const { workerTypes } = groupTypes;
    const workerTypesSet = new Set(workerTypes);  // Convert to a set for faster lookup
    const { pos, radius, tag } = selfUnit;

    if (!pos || !radius || !tag) return;

    const worldTimeInSeconds = world.resources.get().frame.timeInSeconds();

    if (!workerTypesSet.has(selfUnit.unitType) || selfUnit.labels.has('defending')) {
      this.processNonWorkerUnit(world, selfUnits, selfUnit, position, enemyUnits, collectedActions, clearRocks);
    }

    if (selfUnit.unitType === QUEEN && worldTimeInSeconds > 215 && worldTimeInSeconds < 245) {
      const queenActions = collectedActions.filter(action => action.unitTags?.includes(tag));  // Optional chaining
      console.log(`Queen ${tag} collectedActions: ${JSON.stringify(queenActions)}`);
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
        let rallyPosition = getCombatRally(resources);
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

}

module.exports = ArmyManagementService;

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
 * Classifies units into different categories based on their types and labels.
 *
 * @param {Unit[]} selfUnits - The array of the player's units to classify.
 * @returns {{ injectorQueens: Unit[]; allMeleeUnits: Unit[]; otherUnits: Unit[] }} - The classified units.
 */
function classifyUnits(selfUnits) {
  /** @type {Unit[]} */
  const injectorQueens = [];
  /** @type {Unit[]} */
  const allMeleeUnits = [];
  /** @type {Unit[]} */
  const otherUnits = [];

  selfUnits.forEach(unit => {
    const isInjectorQueen = unit.is(QUEEN) && unit.labels.has('injector');
    const isMelee = unit.isMelee();

    if (isInjectorQueen) {
      injectorQueens.push(unit);
    } else if (isMelee) {
      allMeleeUnits.push(unit);
    } else {
      otherUnits.push(unit);
    }
  });

  return {
    injectorQueens,
    allMeleeUnits,
    otherUnits
  };
}

/**
 * Evaluates the health status of each melee unit and classifies them into
 * low health and healthy categories. The classification is based on the
 * comparison of each unit's total health (health + shield) with a safety buffer
 * calculated considering the current game world and enemy units.
 *
 * @param {Unit[]} allMeleeUnits - An array of all melee units to be evaluated.
 * @param {World} world - The current state of the game world.
 * @param {Unit[]} enemyUnits - An array of all current enemy units.
 * @returns {Object} - An object containing two arrays: lowHealthMeleeUnits and healthyMeleeUnits.
 */
function evaluateUnitHealth(allMeleeUnits, world, enemyUnits) {
  /** @type {Unit[]} */
  const lowHealthMeleeUnits = [];
  /** @type {Unit[]} */
  const healthyMeleeUnits = [];

  allMeleeUnits.forEach(unit => {
    const safetyBuffer = calculateSafetyBuffer(world, unit, enemyUnits);
    const totalHealthShield = (unit.health || 0) + (unit.shield || 0);

    if (totalHealthShield <= safetyBuffer) {
      lowHealthMeleeUnits.push(unit);
    } else {
      healthyMeleeUnits.push(unit);
    }
  });

  return { lowHealthMeleeUnits, healthyMeleeUnits };
}

/**
 * Issue stop orders to unnecessary injector queens that are currently attacking.
 * 
 * @param {Unit[]} injectorQueens - The array of all injector queens.
 * @param {Unit[]} necessaryInjectorQueens - The array of injector queens that are necessary for the battle.
 * @param {SC2APIProtocol.ActionRawUnitCommand[]} collectedActions - The array where the stop action commands will be collected.
 */
function issueStopOrders(injectorQueens, necessaryInjectorQueens, collectedActions) {
  injectorQueens
    .filter(queen => !necessaryInjectorQueens.includes(queen) && queen.isAttacking() && queen.tag)
    .forEach(queen => {
      if (queen.tag) {
        collectedActions.push({ abilityId: STOP, unitTags: [queen.tag] });
      }
    });
}



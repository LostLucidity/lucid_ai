// @ts-check
"use strict";

/**
 * @typedef {Object} IRetreatManagementService
 * @property {function(World, Unit, Unit[]): SC2APIProtocol.ActionRawUnitCommand | undefined} createRetreatCommand Creates a retreat command for a given unit.
 * @property {function(World, Unit, Unit, number): Point2D | undefined} determineBestRetreatPoint Determines the best pathable retreat point for the unit.
 * @property {function(World, Unit, Unit[]): Point2D | undefined} retreat Determines the retreat point for a given unit based on surrounding threats and conditions.
 * @property {function(World, Unit, Unit, boolean, number): boolean} shouldRetreatToCombatRally Determines whether the unit should retreat to the combat rally point.
 */
module.exports = {};

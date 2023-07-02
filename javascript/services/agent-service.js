//@ts-check
"use strict"

const { UnitType } = require("@node-sc2/core/constants");
const { Race, Attribute } = require("@node-sc2/core/constants/enums");

const agentService = {
  /** @type {number | null} */
  difficulty: null,
  /** @type {Map<number, boolean>} */
  hasTechFor: new Map(),
  /**
   * @param {Agent} agent
   * @param {SC2APIProtocol.UnitTypeData} unitTypeData
   * @returns {boolean}
   */
  requiresPylon: (agent, unitTypeData) => {
    // return false immediately if agent race is not protoss
    if (agent.race !== Race.PROTOSS) return false;

    // Nexus, assimilator, pylon do not require pylon
    const { attributes, unitId } = unitTypeData;
    if (attributes === undefined || unitId === undefined) return false;

    const isStructure = attributes.includes(Attribute.STRUCTURE);
    const requiresPylon = [UnitType.NEXUS, UnitType.ASSIMILATOR, UnitType.PYLON].every(unitType => unitId !== unitType);

    return isStructure && requiresPylon;
  },
  /**
   * @description Cache the result of agent.hasTechFor() to avoid unnecessary calls to the game.
   * @param {Agent} agent
   * @param {number} unitType
   * @returns {boolean | undefined}
   **/
  checkTechFor: (agent, unitType) => {
    if (agentService.hasTechFor.has(unitType)) {
      return agentService.hasTechFor.get(unitType);
    }
    const hasTechFor = agent.hasTechFor(unitType);
    agentService.hasTechFor.set(unitType, hasTechFor);
    return hasTechFor;
  }
}

module.exports = agentService;
//@ts-check
"use strict"

const agentService = {
  /** @type {number | null} */
  difficulty: null,
  /** @type {Map<number, boolean>} */
  hasTechFor: new Map(),
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
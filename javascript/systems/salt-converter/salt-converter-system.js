//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const plans = require("../../builds/plans");
const planService = require("../../services/plan-service");
const { convertPlan } = require("./salt-converter");

module.exports = createSystem({
  name: 'SaltConverterSystem',
  type: 'agent',
  async onGameStart(world) {
    const race = world.agent.race;
    this.getBuild(race);
  },
  /**
   * 
   * @param {SC2APIProtocol.Race} race 
   * @returns {void|any}
   */
  getBuild(race) {
    const racePlans = plans[race];
    const selectedPlan = racePlans['138658'];
    if (selectedPlan.buildType === 'two variable') {
      planService.scouts = selectedPlan.scouts;
      planService.wallOff = selectedPlan.wallOff;
      convertPlan(selectedPlan, race);
    } else {
      return selectedPlan;
    }
  },
});
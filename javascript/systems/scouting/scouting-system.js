//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const planService = require("../../services/plan-service");
const worldService = require("../../services/world-service");
const { setOutsupplied, setEnemyCombatSupply } = require("./scouting-service");

module.exports = createSystem({
  name: 'ScoutingSystem',
  type: 'agent',
  async onStep({ data }) {
    setEnemyCombatSupply(data);
    setOutsupplied();
    setOutpowered();
  }
});

function setOutpowered() {
  worldService.outpowered = worldService.totalEnemyDPSHealth > worldService.totalSelfDPSHealth;
  if (!planService.dirtyBasePlan && worldService.outpowered) {
    planService.dirtyBasePlan = true;
    console.log('dirtyBasePlan'.toUpperCase());
  }
}
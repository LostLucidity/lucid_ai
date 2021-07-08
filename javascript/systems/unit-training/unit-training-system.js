//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Attribute } = require("@node-sc2/core/constants/enums");
const { getSupply, getTrainingSupply, getLoadedSupply } = require("../../helper");
const shortOnWorkers = require("../../helper/short-on-workers");
const planService = require("../../services/plan-service");
const sharedService = require("../../services/shared-service");
const enemyTrackingService = require("../enemy-tracking/enemy-tracking-service");
const { train } = require("../execute-plan/plan-actions");
const { getSelfCombatSupply } = require("../track-units/track-units-service");
const { workersTrainingTendedTo, haveAvailableProductionUnitsFor } = require("./unit-training-service");
const unitTrainingService = require("./unit-training-service");

module.exports = createSystem({
  name: 'UnitTrainingSystem',
  type: 'agent',
  async onStep(world) {
    const { agent, data, resources } = world;
    const { frame, units } = resources.get();
    const { trainingTypes } = planService;
    sharedService.removePendingOrderBySystemName(units, this.name);
    const selfCombatSupply = getSelfCombatSupply(world);
    const enemyCombatSupply = enemyTrackingService.getEnemyCombatSupply(data);
    const outSupplied = enemyCombatSupply > selfCombatSupply;
    const trainUnitConditions = [
      outSupplied,
      workersTrainingTendedTo(world) && !planService.pauseBuilding,
      !shortOnWorkers(resources) && !planService.pauseBuilding,
    ];
    if (trainUnitConditions.some(condition => condition)) {
      outSupplied ? console.log(frame.timeInSeconds(), 'Scouted higher supply', selfCombatSupply, enemyCombatSupply) : null;
      const foundStep = planService.plan.find(action => action.food >= agent.foodUsed);
      const candidateTypeToBuild = trainingTypes.filter(type => {
        return [
          !data.getUnitTypeData(type).attributes.includes(Attribute.STRUCTURE),
          haveAvailableProductionUnitsFor(world, type),
          agent.hasTechFor(type),
          data.getUnitTypeData(type).foodRequired <= foundStep.food - agent.foodUsed,
        ].every(condition => condition);
      });
      let { selectedTypeToBuild } = unitTrainingService;
      unitTrainingService.selectedTypeToBuild = selectedTypeToBuild ? selectedTypeToBuild : candidateTypeToBuild[Math.floor(Math.random() * candidateTypeToBuild.length)];
      if (selectedTypeToBuild != null) {
        const { totalMineralCost, totalVespeneCost } = manageResources.getResourceDemand(world.data, [foundStep]);
        let { mineralCost, vespeneCost } = data.getUnitTypeData(selectedTypeToBuild);
        if (agent.minerals < (totalMineralCost + mineralCost) || agent.vespene < (totalVespeneCost + vespeneCost)) { return; }
        await train(world, selectedTypeToBuild);
      }
    }
    sharedService.setPendingOrderBySystemName(units, this.name);
  }
});
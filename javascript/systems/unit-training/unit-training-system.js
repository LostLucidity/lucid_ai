//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Attribute } = require("@node-sc2/core/constants/enums");
const shortOnWorkers = require("../../helper/short-on-workers");
const planService = require("../../services/plan-service");
const sharedService = require("../../services/shared-service");
const { train } = require("../execute-plan/plan-actions");
const { getResourceDemand } = require("../manage-resources");
const scoutService = require("../scouting/scouting-service");
const trackUnitsService = require("../track-units/track-units-service");
const { workersTrainingTendedTo, haveAvailableProductionUnitsFor } = require("./unit-training-service");
const unitTrainingService = require("./unit-training-service");

module.exports = createSystem({
  name: 'UnitTrainingSystem',
  type: 'agent',
  async onStep(world) {
    const { agent, data, resources } = world;
    const { frame, units } = resources.get();
    const { trainingTypes } = planService;
    sharedService.removePendingOrders(units);
    const { outsupplied, enemyCombatSupply } = scoutService;
    const trainUnitConditions = [
      outsupplied,
      workersTrainingTendedTo(world) && !planService.isPlanPaused,
      !shortOnWorkers(resources) && !planService.isPlanPaused,
    ];
    if (trainUnitConditions.some(condition => condition)) {
      outsupplied ? console.log(frame.timeInSeconds(), 'Scouted higher supply', trackUnitsService.selfCombatSupply, enemyCombatSupply) : null;
      const { currentStep, plan } = planService;
      const candidateTypeToBuild = trainingTypes.filter(type => {
        return [
          !data.getUnitTypeData(type).attributes.includes(Attribute.STRUCTURE),
          haveAvailableProductionUnitsFor(world, type),
          agent.hasTechFor(type),
          data.getUnitTypeData(type).foodRequired <= plan[currentStep].food - agent.foodUsed,
        ].every(condition => condition);
      });
      let { selectedTypeToBuild } = unitTrainingService;
      unitTrainingService.selectedTypeToBuild = selectedTypeToBuild ? selectedTypeToBuild : candidateTypeToBuild[Math.floor(Math.random() * candidateTypeToBuild.length)];
      if (selectedTypeToBuild != null) {
        const { totalMineralCost, totalVespeneCost } = getResourceDemand(world.data, [currentStep]);
        let { mineralCost, vespeneCost } = data.getUnitTypeData(selectedTypeToBuild);
        if (agent.minerals < (totalMineralCost + mineralCost) || agent.vespene < (totalVespeneCost + vespeneCost)) { return; }
        await train(world, selectedTypeToBuild);
      }
    }
  }
});
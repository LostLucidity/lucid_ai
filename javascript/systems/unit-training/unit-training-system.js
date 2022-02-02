//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { UnitTypeId } = require("@node-sc2/core/constants");
const { Attribute } = require("@node-sc2/core/constants/enums");
const { ZERGLING } = require("@node-sc2/core/constants/unit-type");
const shortOnWorkers = require("../../helper/short-on-workers");
const { getFoodUsed } = require("../../services/plan-service");
const planService = require("../../services/plan-service");
const sharedService = require("../../services/shared-service");
const worldService = require("../../services/world-service");
const { train } = require("../execute-plan/plan-actions");
const { getResourceDemand } = require("../manage-resources");
const { haveAvailableProductionUnitsFor } = require("./unit-training-service");
const unitTrainingService = require("./unit-training-service");

module.exports = createSystem({
  name: 'UnitTrainingSystem',
  type: 'agent',
  async onStep(world) {
    const { agent, data, resources } = world;
    const { foodUsed } = agent;
    const { units } = resources.get();
    const { planMin, trainingTypes } = planService;
    sharedService.removePendingOrders(units);
    const { outpowered } = worldService;
    const trainUnitConditions = [
      outpowered,
      unitTrainingService.workersTrainingTendedTo && !planService.isPlanPaused,
      !shortOnWorkers(resources) && !planService.isPlanPaused,
    ];
    if (trainUnitConditions.some(condition => condition)) {
      outpowered ? console.log('Scouted higher power') : console.log('Free build mode.');
      const { currentStep, plan } = planService;
      const candidateTypesToBuild = trainingTypes.filter(type => {
        return [
          !data.getUnitTypeData(type).attributes.includes(Attribute.STRUCTURE),
          haveAvailableProductionUnitsFor(world, type),
          agent.hasTechFor(type),
          data.getUnitTypeData(type).foodRequired <= plan[currentStep].food - getFoodUsed(foodUsed),
          outpowered ? outpowered : planMin[UnitTypeId[type]] <= getFoodUsed(foodUsed)
        ].every(condition => condition);
      });
      if (candidateTypesToBuild.length > 0) {
        let { selectedTypeToBuild } = unitTrainingService;
        selectedTypeToBuild = selectedTypeToBuild ? selectedTypeToBuild : selectTypeToBuild(world, candidateTypesToBuild);
        if (selectedTypeToBuild !== undefined && selectedTypeToBuild !== null) {
          let { totalMineralCost, totalVespeneCost } = getResourceDemand(world.data, [plan[currentStep]]);
          let { mineralCost, vespeneCost } = data.getUnitTypeData(selectedTypeToBuild);
          if (selectedTypeToBuild === ZERGLING) {
            totalMineralCost += mineralCost;
            totalVespeneCost += vespeneCost;
          }
          const enoughMinerals = agent.minerals >= (totalMineralCost + mineralCost);
          const enoughVespene = (vespeneCost === 0) || (agent.vespene >= (totalVespeneCost + vespeneCost));
          const freeBuildThreshold = enoughMinerals && enoughVespene;
          if (outpowered || freeBuildThreshold) {
            await train(world, selectedTypeToBuild);
          }
        }
        unitTrainingService.selectedTypeToBuild = selectedTypeToBuild;
      }
    }
  }
});

/**
 * @param {World} world 
 * @param {UnitTypeId[]} candidateTypesToBuild 
 * @returns {UnitTypeId}
 */
function selectTypeToBuild(world, candidateTypesToBuild) {
  const { agent, data } = world;
  const filteredTypes = candidateTypesToBuild.filter(type => {
    if (agent.vespene <= 170 && data.getUnitTypeData(type).vespeneCost > 0) {
      return false;
    }
    return true;
  });
  return filteredTypes[Math.floor(Math.random() * filteredTypes.length)];
}
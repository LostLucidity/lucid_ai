//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { UnitTypeId } = require("@node-sc2/core/constants");
const { Attribute } = require("@node-sc2/core/constants/enums");
const { ZERGLING } = require("@node-sc2/core/constants/unit-type");
const planService = require("../../services/plan-service");
const sharedService = require("../../services/shared-service");
const { getUnitTypeCount, getFoodUsed, shortOnWorkers } = require("../../services/world-service");
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
    const { units } = resources.get();
    const { planMin, trainingTypes, unitMax } = planService;
    const { outpowered } = worldService;
    const trainUnitConditions = [
      outpowered,
      unitTrainingService.workersTrainingTendedTo && !planService.isPlanPaused,
      !shortOnWorkers(world) && !planService.isPlanPaused,
    ];
    if (trainUnitConditions.some(condition => condition)) {
      let trainingConditionsLog = outpowered ? 'Scouted higher power' : 'Free build mode.';
      const { currentStep, plan } = planService;
      // if trainingTypes is empty, get currently existing non-structure unitTypes
      const plannedTrainingTypes = trainingTypes.length > 0 ? trainingTypes : getExistingTrainingTypes(units);
      const candidateTypesToBuild = plannedTrainingTypes.filter(type => {
        return [
          !data.getUnitTypeData(type).attributes.includes(Attribute.STRUCTURE),
          haveAvailableProductionUnitsFor(world, type),
          agent.hasTechFor(type),
          data.getUnitTypeData(type).foodRequired <= plan[currentStep].food - getFoodUsed(world),
          outpowered ? outpowered : planMin[UnitTypeId[type]] <= getFoodUsed(world),
          // check if unit type has reached max
          !unitMax[UnitTypeId[type]] || (getUnitTypeCount(world, type) < unitMax[UnitTypeId[type]]),
        ].every(condition => condition);
      });
      trainingConditionsLog += ` currentStep: ${currentStep}`;
      if (candidateTypesToBuild.length > 0) {
        trainingConditionsLog += ` candidateTypesToBuild: ${candidateTypesToBuild}`;
        let { selectedTypeToBuild } = unitTrainingService;
        selectedTypeToBuild = selectedTypeToBuild ? selectedTypeToBuild : selectTypeToBuild(world, candidateTypesToBuild);
        if (selectedTypeToBuild !== undefined && selectedTypeToBuild !== null) {
          trainingConditionsLog += ` selectedTypeToBuild: ${selectedTypeToBuild}`;
          let { totalMineralCost, totalVespeneCost } = getResourceDemand(world.data, [plan[currentStep]]);
          let { mineralCost, vespeneCost } = data.getUnitTypeData(selectedTypeToBuild);
          if (selectedTypeToBuild === ZERGLING) {
            totalMineralCost += mineralCost;
            totalVespeneCost += vespeneCost;
          }
          trainingConditionsLog += ` totalMineralCost: ${totalMineralCost} totalVespeneCost: ${totalVespeneCost}`;
          const enoughMinerals = agent.minerals >= (totalMineralCost + mineralCost);
          const enoughVespene = (vespeneCost === 0) || (agent.vespene >= (totalVespeneCost + vespeneCost));
          const freeBuildThreshold = enoughMinerals && enoughVespene;
          if (outpowered || freeBuildThreshold) {
            await train(world, selectedTypeToBuild);
          }
        }
        unitTrainingService.selectedTypeToBuild = selectedTypeToBuild;
      }
      console.log(trainingConditionsLog);
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
/**
 * @description get currently exiting non-structure unitTypes
 * @param {UnitResource} units
 * @returns {UnitTypeId[]}
 * @example getExistingTrainingTypes(units)
 * @example getExistingTrainingTypes(units).includes(UnitTypeId.ZERGLING)
 */
function getExistingTrainingTypes(units) {
  return units.getAlive().reduce((types, unit) => {
    if (types.includes(unit.unitType)) {
      return types;
    }
    return [...types, unit.unitType];
  }, []);
}
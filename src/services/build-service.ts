export default class BuildService {

  constructor() {
    console.log('BuildService constructed');
  }
  
  async build(supply, options) {
    const placementConfig = placementConfigs[unitType];
    if (this.foodUsed >= supply) {
      if (this.checkBuildingCount(targetCount, placementConfig)) {
        const toBuild = placementConfigs[unitType].toBuild;
        if (GasMineRace[race] === toBuild && this.agent.canAfford(toBuild)) {
          try {
            await actions.buildGasMine();
            this.state.pauseBuilding = false;
          }
          catch(error) {
            console.log(error);
            this.state.pauseBuilding = true;
            this.state.continueBuild = false;
          }
        }
        else if (TownhallRace[race].indexOf(toBuild) > -1 ) { 
          this.collectedActions.push(...await expand(this.agent, this.data, this.resources, this.state)); 
        } 
        else {
          if (candidatePositions.length === 0 ) { candidatePositions = this.findPlacements(placementConfig); }
          await this.buildBuilding(placementConfig, candidatePositions);
        }
      }
    }
  }

  checkBuildingCount(targetCount, placementConfig) {
    const buildAbilityId = this.data.getUnitTypeData(placementConfig.toBuild).abilityId;
    let count = this.units.withCurrentOrders(buildAbilityId).length;
    placementConfig.countTypes.forEach(type => {
      let unitsToCount = this.units.getById(type);
      if (race === Race.TERRAN) {
        unitsToCount = unitsToCount.filter(unit => unit.buildProgress >= 1);
      }
      count += unitsToCount.length;
    });
    return count === targetCount;
  }
}
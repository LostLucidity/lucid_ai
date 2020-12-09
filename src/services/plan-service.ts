import * as abilities from '@node-sc2/core/constants/ability';
import * as unit_types from '@node-sc2/core/constants/unit-type';
import * as upgrades from '@node-sc2/core/constants/upgrade'
import { of } from 'rxjs';

//Remove
import { plans } from './../plans-mock';

export default class PlanService {

  getPlans() {
    return of(plans);
  }

  getPlan(race: string) {
    const racePlans = plans[race];
    var keys = Object.keys(racePlans);
    return racePlans[keys[ keys.length * Math.random() << 0]];
  }

}

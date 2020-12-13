import { Observable, of } from 'rxjs';

//Remove
import { plans } from './../plans-mock';

export default class PlanService {

  getPlans(): Observable<any> {
    return of({plans});
  }

  getPlan(race: string) {
    this.getPlans().subscribe(
      (result) => {
        const racePlans = result.plans[race];
        var keys = Object.keys(racePlans);
        return racePlans[keys[ keys.length * Math.random() << 0]];
      }
    )
    
  }

}

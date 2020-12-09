"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var PlanService = /** @class */ (function () {
    function PlanService() {
        console.log('PlanService Constructed');
    }
    PlanService.prototype.getPlan = function (plans, race) {
        var racePlans = plans[race];
        var keys = Object.keys(racePlans);
        return racePlans[keys[keys.length * Math.random() << 0]];
    };
    return PlanService;
}());
exports.default = PlanService;

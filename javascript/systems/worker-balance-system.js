//@ts-check
"use strict"

const debugDebug = require('debug')('sc2:debug:WorkerBalance');
const debugSilly = require('debug')('sc2:silly:WorkerBalance');
const { createSystem } = require('@node-sc2/core');
const Ability = require('@node-sc2/core/constants/ability');
const { Alliance } = require('@node-sc2/core/constants/enums');
const { gatheringAbilities, rallyWorkersAbilities } = require('@node-sc2/core/constants/groups');
const { balanceResources } = require('./balance-resources');

module.exports = createSystem({
    name: 'WorkerBalanceSystem',
    type: 'agent',
    defaultOptions: {
        stepIncrement: 50,
        state: {},
    },
    async onStep({ resources }) {
        const { units, actions } = resources.get();
        balanceResources(resources);
        const readySelfFilter = { buildProgress: 1, alliance: Alliance.SELF };

        const gatheringWorkers = units.getWorkers().filter(u => u.orders.some(o => [...gatheringAbilities].includes(o.abilityId)));
        const townhalls = units.getAlive(readySelfFilter).filter(u => u.isTownhall());

        const needyTownhall = units.getBases(readySelfFilter).find(base => base.assignedHarvesters < base.idealHarvesters);

        if (needyTownhall) {
            const possibleDonerThs = townhalls.filter(townhall => townhall.assignedHarvesters > needyTownhall.assignedHarvesters + 1);
            // debugSilly('possible ths', possibleDonerThs.map(th => th.tag));
            const [givingTownhall] = units.getClosest(needyTownhall.pos, possibleDonerThs);

            debugSilly('possible doners', gatheringWorkers.map(worker => worker.tag));

            if (givingTownhall && gatheringWorkers.length > 0) {
                debugSilly('chosen closest th', givingTownhall.tag);
                const [donatingWorker] = units.getClosest(givingTownhall.pos, gatheringWorkers);
                debugSilly('chosen worker', donatingWorker.tag);
                const [mineralFieldTarget] = units.getClosest(needyTownhall.pos, units.getMineralFields());
                await actions.gather(donatingWorker, mineralFieldTarget, false);
            }
        }
    },
    async onUnitFinished({ resources }, newBuilding) {
        const collectedActions = [];
        const { actions, units } = resources.get();
        if (newBuilding.isTownhall()) {
            const [mineralFieldTarget] = units.getClosest(newBuilding.pos, units.getMineralFields());
            const rallyAbility = rallyWorkersAbilities.find(ability => newBuilding.abilityAvailable(ability));
            collectedActions.push({
                abilityId: rallyAbility,
                targetUnitTag: mineralFieldTarget.tag,
                unitTags: [newBuilding.tag]
            });
            const bases = units.getBases();
            const expansionsWithExtraWorkers = bases.filter(base => base.assignedHarvesters > base.idealHarvesters);
            const gatheringWorkers = units.getWorkers().filter(u => u.orders.some(o => [...gatheringAbilities].includes(o.abilityId)));
            debugSilly(`expansions with extra workers: ${expansionsWithExtraWorkers.map(ex => ex.tag).join(', ')}`);
            const extraWorkers = expansionsWithExtraWorkers.reduce((workers, base) => {
                return workers.concat(
                    units.getClosest(
                        base.pos,
                        gatheringWorkers,
                        base.assignedHarvesters - base.idealHarvesters
                    )
                );
            }, []);
            debugSilly(`total extra workers: ${extraWorkers.map(w => w.tag).join(', ')}`);
            extraWorkers.forEach(worker => {
                collectedActions.push({
                    abilityId: Ability.SMART,
                    targetUnitTag: mineralFieldTarget.tag,
                    unitTags: [worker.tag],
                });
            })
        }
        await actions.sendAction(collectedActions);
    }
});
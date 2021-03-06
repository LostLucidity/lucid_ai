const debugDebug = require('debug')('sc2:debug:WorkerBalance');
const debugSilly = require('debug')('sc2:silly:WorkerBalance');
const { createSystem } = require('@node-sc2/core');
const { Alliance } = require('@node-sc2/core/constants/enums');
const { gatheringAbilities, returningAbilities } = require('@node-sc2/core/constants/groups');

module.exports = createSystem({
    name: 'WorkerBalanceSystem',
    type: 'agent',
    defaultOptions: {
        stepIncrement: 50,
        state: {},
    },
    async onStep({ resources }) {
        const { units, actions } = resources.get();

        const readySelfFilter = { buildProgress: 1, alliance: Alliance.SELF };

        const workers = units.getWorkers().filter(u => u.orders.some(o => [...gatheringAbilities, ...returningAbilities].includes(o.abilityId)));
        const townhalls = units.getAlive(readySelfFilter).filter(u => u.isTownhall());

        const needyGasMine = units.getGasMines(readySelfFilter).find(u => u.assignedHarvesters < u.idealHarvesters);

        if (needyGasMine) {
            const possibleDonerThs = townhalls.filter(u => u.assignedHarvesters / u.idealHarvesters * 100 > 50);
            debugSilly('possible ths', possibleDonerThs.map(th => th.tag));
            const [givingTownhall] = units.getClosest(needyGasMine.pos, possibleDonerThs);

            const donateableWorkers = workers.filter(w => w.isGathering('minerals'));
            debugSilly('possible doners', donateableWorkers.map(th => th.tag));

            if (givingTownhall && donateableWorkers.length > 0) {
                debugSilly('chosen closest th', givingTownhall.tag);
                const [donatingWorker] = units.getClosest(givingTownhall.pos, donateableWorkers);
                debugSilly('chosen worker', donatingWorker.tag);
                return actions.mine(donatingWorker, needyGasMine, false);
            }
        }

        const needyTownhall = units.getBases(readySelfFilter).find(u => u.assignedHarvesters < u.idealHarvesters);

        if (needyTownhall) {
            const possibleDonerThs = townhalls.filter(u => u.assignedHarvesters / u.idealHarvesters * 100 > 115);
            debugSilly('possible ths', possibleDonerThs.map(th => th.tag));
            const [givingTownhall] = units.getClosest(needyTownhall.pos, possibleDonerThs);

            const donateableWorkers = workers.filter(w => w.isGathering('minerals'));
            debugSilly('possible doners', donateableWorkers.map(th => th.tag));

            if (givingTownhall && donateableWorkers.length > 0) {
                debugSilly('chosen closest th', givingTownhall.tag);
                const [donatingWorker] = units.getClosest(givingTownhall.pos, donateableWorkers);
                debugSilly('chosen worker', donatingWorker.tag);
                const [mineralFieldTarget] = units.getClosest(needyTownhall.pos, units.getMineralFields());
                return actions.gather(donatingWorker, mineralFieldTarget, false);
            }
        }
    },
    async onUnitCreated({ resources }, newUnit) {
        if (newUnit.isWorker()) {
            const { actions } = resources.get();

            return actions.gather(newUnit);
        }
    },
    async onUnitFinished({ resources }, newBuilding) {
        const { units, actions } = resources.get();

        if (newBuilding.isTownhall()) {
            const bases = units.getBases();
            const expansionsWithExtraWorkers = bases.filter(base => base.assignedHarvesters > base.idealHarvesters);
            debugSilly(`expansions with extra workers: ${expansionsWithExtraWorkers.map(ex => ex.tag).join(', ')}`);
            const extraWorkers = expansionsWithExtraWorkers.reduce((workers, base) => {
                return workers.concat(
                    units.getClosest(
                        base.pos,
                        units.getMineralWorkers(),
                        base.assignedHarvesters - base.idealHarvesters
                    )
                );
            }, []);
            debugSilly(`total extra workers: ${extraWorkers.map(w => w.tag).join(', ')}`);
            return Promise.all(extraWorkers.map(worker => actions.gather(worker)));
        }
    },
});
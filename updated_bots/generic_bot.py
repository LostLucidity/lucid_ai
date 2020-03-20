import sc2, random

from basic import build_worker, should_increase_supply, build_supply, should_expand, build_army, send_scout, decide_action, should_build_workers, collect_gas, boost_production, build_upgrade

class GenericBot(sc2.BotAI):
  async def on_step(self, iteration):
    if iteration == 0:
      await self.on_first_step()
      self.actions.extend(send_scout(self))
    if iteration % 10 == 0:
      await self.on_every_step()
      await self.distribute_workers()

  async def on_first_step(self):
    self.abilities = []    
    self.unit_types = []

  async def on_every_step(self):
    random_worker = random.choice(self.workers)
    worker_abilities = await self.get_available_abilities(random_worker)
    if (should_build_workers(self)):
      self.actions.extend(await build_worker(self))
    if (should_increase_supply(self)):
      self.actions.extend(await build_supply(self, worker_abilities))
    self.actions.extend(await boost_production(self))
    if (should_expand(self)):
      await self.expand_now()
    self.actions.extend(await collect_gas(self, worker_abilities))
    self.actions.extend(await build_army(self))
    self.actions.extend(await build_upgrade(self, worker_abilities))

    own_units = self.units + self.structures
    random_unit = random.choice(own_units)
    unit_abilities = await self.get_available_abilities(random_unit)
    for ability in unit_abilities:
      if ability not in self.abilities:
        print('ability', ability)
        self.abilities.append(ability)
  
  async def on_unit_created(self, unit):
    self.actions.extend(decide_action(self, unit))
              
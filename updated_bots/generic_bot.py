import sc2, random

from basic import build_worker, should_increase_supply, build_supply, should_expand, build_army_buildings, send_scout, decide_action, should_build_workers, collect_gas, boost_production, build_upgrade, build_defensive_structure, train_army_units, attack
from behavior import scan_surroundings, check_if_expansion_is_safe
from track_enemy_units import check_and_remove, scan_vision

class GenericBot(sc2.BotAI):
  async def on_step(self, iteration):
    self.iteration = iteration
    if iteration == 0:
      await self.on_first_step()
      self.actions.extend(send_scout(self))
    if iteration % 10 == 0:
      await self.on_ten_steps()
      await self.distribute_workers()
    analyze_units(self)
    await scan_vision(self)
    self.actions.extend(scan_surroundings(self))
    self.previous_enemy_units = self.enemy_units

  async def on_first_step(self):
    self.abilities = []
    self.out_of_vision_units = []

  async def on_ten_steps(self):
    if (self.workers):
      random_worker = random.choice(self.workers)
      worker_abilities = await self.get_available_abilities(random_worker)
      if (should_increase_supply(self)):
        self.actions.extend(await build_supply(self, worker_abilities))
      self.actions.extend(await collect_gas(self, worker_abilities))
      self.actions.extend(await build_upgrade(self, worker_abilities))
      self.actions.extend(await build_defensive_structure(self, worker_abilities))
      self.actions.extend(await build_army_buildings(self))
    if (should_build_workers(self)):
      self.actions.extend(await build_worker(self))
    self.actions.extend(await boost_production(self))
    if should_expand(self):
      await check_if_expansion_is_safe(self)
    self.actions.extend(await train_army_units(self))
    self.actions.extend(await attack(self))

    own_units = self.units + self.structures
    random_unit = random.choice(own_units)
    unit_abilities = await self.get_available_abilities(random_unit)
    for ability in unit_abilities:
      if ability not in self.abilities:
        print('ability', ability)
        self.abilities.append(ability)
  
  async def on_unit_created(self, unit):
    self.actions.extend(decide_action(self, unit))

  async def on_enemy_unit_left_vision(self, unit_tag: int):
    found_index = next((index for (index, d) in enumerate(self.out_of_vision_units) if d.tag == unit_tag), -1)
    if found_index < 0:
      self.out_of_vision_units.append(self._enemy_units_previous_map[unit_tag])

  async def on_enemy_unit_entered_vision(self, unit_tag: int):
    await check_and_remove(self, unit_tag)

  async def on_unit_destroyed(self, unit_tag):
    await check_and_remove(self, unit_tag)          
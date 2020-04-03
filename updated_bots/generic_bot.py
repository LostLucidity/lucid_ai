import sc2, math, random, time
from sc2.ids.unit_typeid import UnitTypeId

from basic import build_worker, should_increase_supply, build_supply, should_expand, build_army_buildings, send_scout, decide_action_on_created, should_build_workers, collect_gas, boost_production, build_upgrade, build_defensive_structure, train_army_units, research_upgrade
from behavior import decide_action, check_if_expansion_is_safe, update_attack_and_retreat, assign_actions_to_idle
from track_enemy_units import check_and_remove, scan_vision
from helper import iteration_adjuster

class GenericBot(sc2.BotAI):
  async def on_step(self, iteration):
    t0 = time.process_time()
    self.iteration = iteration
    self.units_and_structures = self.units + self.structures
    self.units_that_can_attack = self.units_and_structures.filter(lambda unit: unit.can_attack)
    self.enemy_units_and_structures = self.enemy_units + self.enemy_structures
    self.enemy_units_that_can_attack = self.enemy_units_and_structures.filter(lambda unit: unit.can_attack)
    self.under_construction = self.structures.filter(lambda structure: not structure.is_ready)

    if iteration == 0:
      await self.on_first_step()
      self.actions.extend(send_scout(self))
    self.all_enemy_units_and_structures = self.enemy_units_and_structures + self.out_of_vision_units
    # if self.adjusted_iterations():
    self.actions.extend(update_attack_and_retreat(self))
    self.actions.extend(await assign_actions_to_idle(self))

    if iteration % self.on_eight_steps_iteration == 0:
      await self.on_eight_steps()
    scan_vision(self)
    if iteration % self.decide_action_iteration == 0:
      self.actions.extend(decide_action(self))
    self.time_elapse += time.process_time() - t0
    # if iteration % 32 == 0:
    #   print('on_step time', time.process_time() - t0)
    #   print('average frame time', self.time_elapse / (self.iteration + 1) / 8)

  async def on_first_step(self):
    self.abilities = []
    self.out_of_vision_units = []
    self.decide_action_iteration = 1
    self.on_eight_steps_iteration = 1
    self.time_elapse = 0

  async def on_eight_steps(self):
    t0 = time.process_time()
    if (self.workers):
      random_worker = random.choice(self.workers)
      if self.iteration % 32 == 0:
        t0 = time.process_time()      
      worker_abilities = await self.get_available_abilities(random_worker)
      if (should_increase_supply(self)):
        self.actions.extend(await build_supply(self, worker_abilities))
      self.actions.extend(await collect_gas(self, worker_abilities))
      self.actions.extend(await build_upgrade(self, worker_abilities))
      self.actions.extend(await build_army_buildings(self))
      self.actions.extend(await build_defensive_structure(self, worker_abilities))
      self.actions.extend(await research_upgrade(self))
    if should_build_workers(self):
      self.actions.extend(await build_worker(self))
    self.actions.extend(await boost_production(self))
    if should_expand(self):
      await check_if_expansion_is_safe(self)
    self.actions.extend(await train_army_units(self))
    # if self.iteration % 32 == 0:
    #   print('on_eight_steps time', time.process_time() - t0)   
    time_elapse = time.process_time() - t0
    self.on_eight_steps_iteration = iteration_adjuster(time_elapse)

    random_unit = random.choice(self.units_and_structures)
    unit_abilities = await self.get_available_abilities(random_unit)
    for ability in unit_abilities:
      if ability not in self.abilities:
        print('ability', ability)
        self.abilities.append(ability)
  
  # async def on_unit_created(self, unit):
  #   self.actions.extend(decide_action_on_created(self, unit))

  async def on_enemy_unit_left_vision(self, unit_tag: int):
    found_index = next((index for (index, d) in enumerate(self.out_of_vision_units) if d.tag == unit_tag), -1)
    if found_index < 0:
      self.out_of_vision_units.append(self._enemy_units_previous_map[unit_tag])

  async def on_enemy_unit_entered_vision(self, unit_tag: int):
    check_and_remove(self, unit_tag)

  async def on_unit_destroyed(self, unit_tag):
    check_and_remove(self, unit_tag) 
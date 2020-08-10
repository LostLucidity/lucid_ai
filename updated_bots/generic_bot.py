import sc2, math, random, time
from sc2.ids.unit_typeid import UnitTypeId

from basic import build_worker, should_increase_supply, build_supply, should_expand, build_army_buildings, send_scout, decide_action_on_created, should_build_workers, collect_gas, boost_production, build_upgrade, build_defensive_structure, train_army_units, research_upgrade, is_expansion_safe, expand 
from behavior import decide_action, update_attack_and_retreat, assign_actions_to_idle
from helper import iteration_adjuster, set_total_strength_values
from track_enemy_units import check_and_remove, scan_vision

class GenericBot(sc2.BotAI):
  async def on_step(self, iteration):
    t0 = time.process_time()
    self.iteration = iteration
    self.units_and_structures = self.units + self.structures
    self.units_that_can_attack = self.units_and_structures.filter(lambda unit: unit.can_attack)
    self.enemy_units_and_structures = self.enemy_units + self.enemy_structures
    self.enemy_units_that_can_attack = self.enemy_units_and_structures.filter(lambda unit: unit.can_attack)
    if iteration % 32 == 0:
      print('self.enemy_units_that_can_attack', time.process_time() - t0)    
    self.under_construction = self.structures.filter(lambda structure: not structure.is_ready)
    self.reserved_for_task = []
    all_available_abilities = await self.get_available_abilities(self.units_and_structures)
    for unit, abilities in zip(self.units_and_structures, all_available_abilities):
      unit.abilities = abilities
    if iteration % 32 == 0:
      print('unit.abilities', time.process_time() - t0)
    for townhall in self.townhalls:
      townhall.harvester_shortage = townhall.ideal_harvesters - townhall.assigned_harvesters
    if iteration == 0:
      await self.on_first_step()
      self.actions.extend(send_scout(self))
    self.all_enemy_units_and_structures = self.enemy_units_and_structures + self.out_of_vision_units
    self.actions.extend(await boost_production(self))
    self.actions.extend(update_attack_and_retreat(self))
    self.actions.extend(await assign_actions_to_idle(self))

    if iteration % self.decide_action_iteration == 0:
      set_total_strength_values(self)
    actions = await decide_action(self)
    self.actions.extend(actions)
    if iteration % self.on_eight_steps_iteration == 0:
      await self.on_eight_steps()
    scan_vision(self)
    self.time_elapse += time.process_time() - t0
    if iteration % 32 == 0:
      print('on_step time', time.process_time() - t0)
      print('average frame time', self.time_elapse / (self.iteration + 1) / 8)

  async def on_first_step(self):
    self.abilities = []
    self.build_order = []
    self.decide_action_iteration = 1
    self.enemy_start_locations_keys = list(self.expansion_locations.keys())
    self.scout_targets = self.enemy_start_locations_keys
    random.shuffle(self.scout_targets)
    self.scout_targets += self.expansion_locations
    self.on_eight_steps_iteration = 1
    self.out_of_vision_units = []
    self.total_strength_values = []
    self.time_elapse = 0

  async def on_eight_steps(self):
    t0 = time.process_time()
    if should_increase_supply(self):
      action = await build_supply(self)
      if action:
        self.actions.extend(action)
      else:
        return
    if should_build_workers(self):
      action = await build_worker(self)
      if action:
        self.actions.extend(action)
      else:
        return
    if should_expand(self) and await is_expansion_safe(self):
      action = await expand(self)
      if action:
        self.actions.extend(action)
      else:
        return  
    if (self.workers):
      random_worker = random.choice(self.workers)
      if self.iteration % 32 == 0:
        t0 = time.process_time()      
      worker_abilities = random_worker.abilities
      self.actions += (await collect_gas(self, worker_abilities))
      self.actions += (await build_army_buildings(self))
      self.actions += (await build_upgrade(self, worker_abilities))
      self.actions += (await build_defensive_structure(self, worker_abilities))
      self.actions += (await research_upgrade(self))
    self.actions += (await train_army_units(self))
    if self.iteration % 32 == 0:
      print('on_eight_steps time', time.process_time() - t0)   
    time_elapse = time.process_time() - t0
    self.on_eight_steps_iteration = iteration_adjuster(time_elapse)

    random_unit = random.choice(self.units_and_structures)
    if random_unit:
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


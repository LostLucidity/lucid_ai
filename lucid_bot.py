import math
import random
import sc2
from sc2.constants import *

class LucidBot(sc2.BotAI):
  
  async def on_step(self, iteration):
    if iteration == 0:
      self.attack_threshold = 0
      self.food_threshhold = 0
      self.rally_point = self.start_location
      self.enemy_target = self.enemy_start_locations[0]
      self.worker_cap = 31
      probes = self.units(PROBE)
      probes_data = self._game_data.units[PROBE.value]
      print (f"Tag is {probes.first.tag}")
      print (probes.first._type_data._proto)
      # print(vars(probes_data))
      food_required = probes_data._proto.food_required
      name = probes_data._proto.name
      print(f"{name} require {food_required} food.")
    self.ready_nexuses = self.units(NEXUS).ready
    # gather resource
    await self.distribute_workers()
    # build workers, chronoboosting
    await self.nexus_command()
    # build supply
    await self.increase_supply()
    # expand
    await self.expand()
    # build army
    await self.build_army()
    # send army out.
    await self.command_army()
    # scout
    # await self.scout()

  async def nexus_command(self):
    ideal_harvesters = 0
    assigned_harvesters = 0
    for nexus in self.ready_nexuses:
      ideal_harvesters = ideal_harvesters + nexus.ideal_harvesters
      assigned_harvesters = assigned_harvesters + nexus.assigned_harvesters

    for nexus in self.ready_nexuses:
      # build workers when there is a shortage at the nexus.    
      probes = self.units(PROBE)
      if len(probes) <= self.worker_cap:
        if ideal_harvesters > assigned_harvesters:
          if nexus.noqueue:
            if self.supply_left >= 1:
              if self.can_afford(PROBE):
                await self.do(nexus.train(PROBE))
      # use chronoboost
      abilities = await self.get_available_abilities(nexus)
      if AbilityId.EFFECT_CHRONOBOOSTENERGYCOST in abilities:
        # collect nexuses and gateways
        nexuses = self.units(NEXUS).ready
        gateways = self.units(GATEWAY).ready
        merged_buildings = nexuses + gateways
        random_building = random.choice(merged_buildings)
        if not random_building.has_buff(BuffId.CHRONOBOOSTENERGYCOST):
          if not random_building.noqueue:
            await self.do(nexus(AbilityId.EFFECT_CHRONOBOOSTENERGYCOST, random_building))
      # recall army

  async def increase_supply(self):
    if self.supply_left < self.supply_cap * 0.20:
      if self.can_afford(PYLON):     
        if not self.already_pending(PYLON):
          nexuses = self.units(NEXUS)
          nexus = random.choice(nexuses)
          location = await self.find_placement(PYLON, nexus.position, 28, False, 6)
          await self.build(PYLON, near=location)

  async def build_army(self):
    # build zealots
    if self.supply_left >= 2:
      await self.build_zealots()
    # build when resource are available, time point or supply
    # resouces available for now.
    # if self.units(PYLON).ready.exists:
    #   if self.can_afford(GATEWAY):
    #     if not self.already_pending(GATEWAY):
    #       pylons = self.units(PYLON)
    #       await self.build(GATEWAY, near=random.choice(pylons))
        
  async def expand(self):
    # collect all ideal and assigned harvesters.
    ideal_harvesters = 0
    assigned_harvesters = 0
    for nexus in self.ready_nexuses:
      ideal_harvesters = ideal_harvesters + nexus.ideal_harvesters
      assigned_harvesters = assigned_harvesters + nexus.assigned_harvesters

    for nexus in self.ready_nexuses:
      if ideal_harvesters <= assigned_harvesters:
        if self.can_afford(NEXUS):
          if not self.already_pending(NEXUS):
            await self.expand_now()
      
  async def build_zealots(self):
    total_harvesters = 0
    for nexus in self.ready_nexuses:
      total_harvesters = total_harvesters + nexus.ideal_harvesters
    gateways = self.units(GATEWAY)
    readyNoQueueGateways = gateways.ready.noqueue
    if readyNoQueueGateways:
      for gateway in readyNoQueueGateways:
        if self.can_afford(ZEALOT) and self.supply_left > 1:
          await self.do(gateway.train(ZEALOT))
    else:
      if self.units(PYLON).ready.exists:
        if len(gateways) < math.floor(total_harvesters / 5):
          if self.can_afford(GATEWAY):
            # if not self.already_pending(GATEWAY):
            pylons = self.units(PYLON)
            await self.build(GATEWAY, near=random.choice(pylons))


  async def command_army(self):
    self.rally_point = self.ready_nexuses.closest_to(self.enemy_target).position
    total_size_of_enemy_fighters = len(self.known_enemy_units) - len(self.known_enemy_structures)
    no_structure_enemy_units = [unit for unit in self.known_enemy_units if unit not in set(self.known_enemy_structures)]
    total_enemy_food_cost = self.get_food_cost(no_structure_enemy_units)
    # print (total_enemy_food_cost)
    if total_size_of_enemy_fighters > self.attack_threshold:
      self.attack_threshold = total_size_of_enemy_fighters
      print(f"Attack Threshold {self.attack_threshold}")
    if total_enemy_food_cost > self.food_threshhold:
      self.food_threshhold = total_enemy_food_cost
      print(f"Food Threshold {self.food_threshhold}")
    # If army meets threshhold, attack.
    zealots = self.units(ZEALOT)
    total_army_food_cost = self.get_food_cost(zealots)
    groupedZealots = zealots.closer_than(10, self.rally_point)
    if total_army_food_cost >= self.food_threshhold:
      if self.known_enemy_structures: 
        if not self.enemy_target == self.known_enemy_structures.closest_to(self.rally_point).position:
          print('new enemy_target')
          self.enemy_target = self.known_enemy_structures.closest_to(self.rally_point).position
          for zealot in zealots:
            if len(zealot.orders) > 0:
              if zealot.orders[0].ability.id in [AbilityId.PATROL]:
                await self.do(zealot(AbilityId.PATROL, self.enemy_target))
      # attack when mass at rally point
      grouped_zealots_cost = self.get_food_cost(groupedZealots)
      if grouped_zealots_cost >= self.food_threshhold:
        for zealot in zealots:
          # if zealot is idle or on move, wait until mass, then patrol
          if zealot.is_idle:
            await self.do(zealot(AbilityId.PATROL, self.enemy_target))
          if len(zealot.orders) > 0:
            if not zealot.orders[0].ability.id in [AbilityId.PATROL]:
              await self.do(zealot(AbilityId.PATROL, self.enemy_target))

    else:
      # got to rally point.
      for zealot in zealots:
        if len(zealot.orders) > 0:
          if not zealot.orders[0].ability.id in [AbilityId.MOVE]:
            await self.do(zealot(AbilityId.MOVE, self.rally_point))
    for zealot in zealots:
      if zealot.position.distance_to(self.rally_point) > 5:
        if zealot.is_idle:         
          await self.do(zealot(AbilityId.MOVE, self.rally_point))

  def get_food_cost(self, no_structure_units):
    food_count = 0
    if len(no_structure_units) > 0:
      for unit in no_structure_units:
        food_count += unit._type_data._proto.food_required
    return food_count
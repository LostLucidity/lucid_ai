import math
import random
import sc2
from sc2.constants import *

class LucidBot(sc2.BotAI):
  
  async def on_step(self, iteration):
    if iteration == 0:
      await self.on_first_step()      
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
    await self.scout()

  async def on_first_step(self):
    self.attack_threshold = 0
    self.food_threshhold = 0
    self.rally_point = self.start_location
    self.worker_cap = 34
    self.probe_scout = None
    self.probe_scout_tag = None
    self.probe_scout_targets = self.enemy_start_locations
    self.enemy_target = self.probe_scout_targets[0]
    print(f"enemy_start_locations {self.enemy_start_locations}")
    random.shuffle(self.probe_scout_targets)
    print(f"probe_scout_targets {self.probe_scout_targets}")
    self.scout_number = random.randrange(23)

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
    if self.enemy_target:
      self.rally_point = self.ready_nexuses.closest_to(self.enemy_target).position
      total_size_of_enemy_fighters = len(self.known_enemy_units) - len(self.known_enemy_structures)
      no_structure_enemy_units = [unit for unit in self.known_enemy_units if unit not in set(self.known_enemy_structures)]
      defense_structures = self.get_defense_structures()
      total_enemy_food_cost = self.get_food_cost(no_structure_enemy_units) + defense_structures
      # print (total_enemy_food_cost)
      if total_size_of_enemy_fighters > self.attack_threshold:
        self.attack_threshold = total_size_of_enemy_fighters
      if total_enemy_food_cost > self.food_threshhold:
        self.food_threshhold = total_enemy_food_cost
        print(f"Food Threshold: {self.food_threshhold}")
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
        # get to rally point.
        for zealot in zealots:
          if len(zealot.orders) > 0:
            if not zealot.orders[0].ability.id in [AbilityId.MOVE]:
              await self.do(zealot(AbilityId.MOVE, self.rally_point))
            if zealot.position.distance_to(self.rally_point) < 5:
              if zealot.orders[0].ability.id in [AbilityId.MOVE]:
                await self.do(zealot(AbilityId.STOP))
      # move new zealots to rally point
      for zealot in zealots:
        if zealot.position.distance_to(self.rally_point) > 10:
          if zealot.is_idle:         
            await self.do(zealot(AbilityId.MOVE, self.rally_point))
          if len(zealot.orders) > 0:
            if zealot.position.distance_to(self.rally_point) < 10:
              if zealot.orders[0].ability.id in [AbilityId.MOVE]:
                await self.do(zealot(AbilityId.STOP))

  def get_food_cost(self, no_structure_units):
    food_count = 0
    if len(no_structure_units) > 0:
      for unit in no_structure_units:
        food_count += unit._type_data._proto.food_required
    return food_count

  def get_defense_structures(self):
    defense_structures_count = 0
    for structure in self.known_enemy_structures:
      if structure._type_data._proto.name == 'PhotonCannon':
        defense_structures_count += 4
    return defense_structures_count

  async def scout(self):
    probes = self.units(PROBE)
    # if there are no known enemy structures
    if len(self.known_enemy_structures) == 0:
      # grab random scout and send out to different starting locations.
      if len(probes) >= self.scout_number:
        if not self.probe_scout:
          print(f"Scout number: {self.scout_number}")
          self.probe_scout_tag = random.choice(probes).tag
          self.probe_scout = self.units.find_by_tag(self.probe_scout_tag)
          await self.do(self.probe_scout.move(self.probe_scout_targets[0]))
        else:
          self.probe_scout = self.units.find_by_tag(self.probe_scout_tag)
          # if scout finds nothing at that location, search another 
          if len(self.known_enemy_structures) == 0:
            if self.probe_scout.position.distance_to(self.probe_scout_targets[0]) < 5:
              self.probe_scout_targets.pop(0)
              await self.do(self.probe_scout.move(self.probe_scout_targets[0]))
    else:
      self.enemy_target = self.known_enemy_structures.closest_to(self.rally_point).position

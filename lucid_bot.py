import math
import random
import sc2
from sc2.constants import *

class LucidBot(sc2.BotAI):
  
  async def on_step(self, iteration):
    if iteration == 0:
      await self.on_first_step()
    if iteration % 100 == 0:
      await self.display_data()
    self.ready_nexuses = self.units(NEXUS).ready
    # gather resource
    await self.distribute_workers()
    # collect gas
    await self.collect_gas()
    # build workers, chronoboosting
    await self.nexus_command()
    # build supply
    await self.increase_supply()
    # expand
    await self.expand()
    # scout
    await self.scout()
    # 
    await self.assess_opponent()
    # build army
    await self.build_army()
    # send army out.
    await self.command_army()

  async def on_first_step(self):
    self.assimilator_limit = 0
    self.food_threshold = 0
    self.enemy_flying_max = 0
    self.rally_point = self.start_location
    self.worker_cap = 34
    self.probe_scout = None
    self.probe_scout_tag = None
    self.expansion_locations_keys = list(self.expansion_locations.keys())
    self.probe_scout_targets = self.enemy_start_locations
    random.shuffle(self.probe_scout_targets)
    self.probe_scout_targets += self.expansion_locations
    self.enemy_target = self.probe_scout_targets[0]
    self.no_structure_enemy_units = None
    self.enemy_flying_units = []
    print(f"enemy_start_locations {self.enemy_start_locations}")
    print(f"probe_scout_targets {self.probe_scout_targets}")
    self.scout_number = random.randrange(23)

  async def display_data(self):
    print('self.state.score.collection_rate_minerals', self.state.score.collection_rate_minerals)
    print('self.state.score.collection_rate_vespene', self.state.score.collection_rate_vespene)
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

  async def collect_gas(self):
    assimilators = len(self.units(ASSIMILATOR)) + self.already_pending(ASSIMILATOR)
    # Build Cybernetics Core for Stalker
    cyberneticscore = len(self.units(CYBERNETICSCORE)) + self.already_pending(CYBERNETICSCORE)
    vespene_deposits = []
    if self.assimilator_limit > assimilators:
      for nexus in self.ready_nexuses:
        vespene_deposits += self.state.vespene_geyser.closer_than(20.0, nexus)
      if self.can_afford(ASSIMILATOR):
        vespene_deposit = random.choice(vespene_deposits)
        probe = self.select_build_worker(vespene_deposit.position)
        print('Build assimilator')
        await self.do(probe.build(ASSIMILATOR, vespene_deposit))
    if cyberneticscore < 1 and assimilators > 0:
      if self.can_afford(CYBERNETICSCORE):
        if len(self.units(CYBERNETICSCORE)) < 1:
          pylons = self.units(PYLON)
          print('Build cyberneticscore')
          await self.build(CYBERNETICSCORE, near=random.choice(pylons))

  async def increase_supply(self):
    if self.supply_left < self.supply_cap * 0.20:
      if self.can_afford(PYLON):     
        if not self.already_pending(PYLON):
          nexuses = self.units(NEXUS)
          nexus = random.choice(nexuses)
          location = await self.find_placement(PYLON, nexus.position, 28, False, 6)
          await self.build(PYLON, near=location)

  async def build_army(self):
    # build army units
    # Decide what to build.
    chosen_unit = self.choose_unit()
    if self.supply_left >= self._game_data.units[chosen_unit.value]._proto.food_required:
      await self.build_army_units(chosen_unit)
    # build when resource are available, time point or supply
    # resouces available for now.
    # if self.units(PYLON).ready.exists:
    #   if self.can_afford(GATEWAY):
    #     if not self.already_pending(GATEWAY):
    #       pylons = self.units(PYLON)
    #       await self.build(GATEWAY, near=random.choice(pylons))

  def choose_unit(self):
    chosen_unit = ZEALOT
    stalker_count = len(self.units(STALKER))
    if self._game_data.units[STALKER.value]._proto.food_required * stalker_count < self.enemy_flying_max:
      if self.can_afford(STALKER):
        chosen_unit = STALKER
      else: 
        self.assimilator_limit = len(self.ready_nexuses) * 2
        self.worker_cap = 34 + (self.assimilator_limit * 3)
    return chosen_unit
        
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
      
  async def build_army_units(self, chosen_unit):
    total_harvesters = 0
    for nexus in self.ready_nexuses:
      total_harvesters = total_harvesters + nexus.ideal_harvesters
      gateways = self.units(GATEWAY)
      readyNoQueueGateways = gateways.ready.noqueue
      if readyNoQueueGateways:
        for gateway in readyNoQueueGateways:
          if self.can_afford(chosen_unit):
            print('self._game_data.units[chosen_unit.value].creation_ability.id', self._game_data.units[chosen_unit.value].creation_ability.id)
            ability_id = self._game_data.units[chosen_unit.value].creation_ability.id
            abilities = await self.get_available_abilities(gateway)
            if ability_id in abilities:
              await self.do(gateway.train(chosen_unit))
    else:
      if self.units(PYLON).ready.exists:
        if len(gateways) < math.floor(self.state.score.collection_rate_minerals / 300):
          if self.can_afford(GATEWAY):
            # if not self.already_pending(GATEWAY):
            pylons = self.units(PYLON)
            await self.build(GATEWAY, near=random.choice(pylons))
      


  async def command_army(self):
    if self.enemy_target:
      self.rally_point = self.ready_nexuses.closest_to(self.enemy_target).position
      defense_structures = self.get_defense_structures()
      total_enemy_food_cost = self.get_food_cost(self.no_structure_enemy_units) + defense_structures
      # print (total_enemy_food_cost)
      if total_enemy_food_cost > self.food_threshold:
        self.food_threshold = total_enemy_food_cost
        print(f"Food Threshold: {self.food_threshold}")
      # If army meets threshhold, attack.
      # army = Unit(self.units(ZEALOT) + self.units(STALKER), self._game_data)
      zealots = self.units(ZEALOT)
      stalkers = self.units(STALKER)
      army = zealots + stalkers
      total_army_food_cost = self.get_food_cost(army)
      groupedZealots = zealots.closer_than(10, self.rally_point)
      groupedStalkers = zealots.closer_than(10, self.rally_point)
      groupedArmy = groupedZealots + groupedStalkers
      if total_army_food_cost >= self.food_threshold:
        if self.known_enemy_structures: 
          if not self.enemy_target == self.known_enemy_structures.closest_to(self.rally_point).position:
            print('new enemy_target')
            self.enemy_target = self.known_enemy_structures.closest_to(self.rally_point).position
            for unit in army:
              if len(unit.orders) > 0:
                if unit.orders[0].ability.id in [AbilityId.PATROL]:
                  await self.do(unit(AbilityId.PATROL, self.enemy_target))
        # attack when mass at rally point
        grouped_army_cost = self.get_food_cost(groupedArmy)
        if grouped_army_cost >= self.food_threshold:
          for unit in army:
            # if zealot is idle or on move, wait until mass, then patrol
            if unit.is_idle:
              await self.do(unit(AbilityId.PATROL, self.enemy_target))
            if len(unit.orders) > 0:
              if not unit.orders[0].ability.id in [AbilityId.PATROL]:
                await self.do(unit(AbilityId.PATROL, self.enemy_target))
      else:
        # get to rally point.
        if total_army_food_cost >= self.food_threshold * 0.8: 
          for unit in army:
            if len(unit.orders) > 0:
              if not unit.orders[0].ability.id in [AbilityId.MOVE]:
                await self.do(unit(AbilityId.MOVE, self.rally_point))
              if unit.position.distance_to(self.rally_point) < 5:
                if unit.orders[0].ability.id in [AbilityId.MOVE]:
                  await self.do(unit(AbilityId.STOP))
      # move new army to rally point
      for unit in army:
        if unit.position.distance_to(self.rally_point) > 10:
          if unit.is_idle:         
            await self.do(unit(AbilityId.MOVE, self.rally_point))
          if len(unit.orders) > 0:
            if unit.position.distance_to(self.rally_point) < 10:
              if unit.orders[0].ability.id in [AbilityId.MOVE]:
                await self.do(unit(AbilityId.STOP))

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
        defense_structures_count += 3
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
          print(f"probe_scout", self.probe_scout)
          await self.do(self.probe_scout.move(self.probe_scout_targets[0]))
        else:
          self.probe_scout = self.units.find_by_tag(self.probe_scout_tag)
          # If probe was destroyed.
          if not self.probe_scout:
            print(f"Scout number: {self.scout_number}")
            self.probe_scout_tag = random.choice(probes).tag
            self.probe_scout = self.units.find_by_tag(self.probe_scout_tag)
            print(f"probe_scout", self.probe_scout)
            await self.do(self.probe_scout.move(self.probe_scout_targets[0]))
          # if scout finds nothing at that location, search another 
          if self.probe_scout.position.distance_to(self.probe_scout_targets[0]) < 5:
            self.probe_scout_targets.pop(0)
            print('probe_scout_targets', self.probe_scout_targets)
            await self.do(self.probe_scout.move(self.probe_scout_targets[0]))
    else:
      self.enemy_target = self.known_enemy_structures.closest_to(self.rally_point).position
      self.probe_scout = None

  async def assess_opponent(self):
    self.no_structure_enemy_units = [unit for unit in self.known_enemy_units if unit not in set(self.known_enemy_structures)]
    self.enemy_flying_units = []
    for unit in self.no_structure_enemy_units:
      if unit.is_flying:
        # Add to list of flying units and check food cost.
        self.enemy_flying_units.append(unit)
    flying_enemy_food_cost = self.get_food_cost(self.enemy_flying_units)
    if flying_enemy_food_cost > self.enemy_flying_max:
      self.enemy_flying_max = flying_enemy_food_cost

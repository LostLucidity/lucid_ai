import math
import random
import sc2
import time

from sc2.constants import *

class LucidBot(sc2.BotAI):
  
  async def on_step(self, iteration):
    self.iteration = iteration
    if iteration == 0:
      await self.on_first_step()
    if iteration % 30 == 0:
      await self.display_data()
    await self.on_every_step()
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
    # assess opponent
    await self.assess_opponent()
    # determine army composition
    await self.set_army_composition()
    # build army
    await self.build_army()
    # send army out.
    await self.command_army()
    # combined actions
    await self.execute_actions()
    # track enemy units
    await self.track_enemy_units()

  async def on_first_step(self):
    self.assimilator_limit = 0
    self.attack_units = []
    self.attack_units_tags = []
    self.defending_probes = []
    self.defending_probes_tags = []
    self.defense_mode = False
    self.enemy_defense_structures = []
    self.enemy_units = []
    self.enemy_units_cost = 0
    self.mineral_to_unit_build_rate = 264
    self.non_attack_units = []
    self.non_attack_unit_tags = []
    self.collectedActions = []
    self.food_threshold = 0
    self.enemy_flying_max = 0
    self.rally_point = self.start_location
    self.start_time = time.time()
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
    self.stalkers = []
    self.zealots = []
    await self.chat_send("LucidBot 1.5.2")
  
  async def on_every_step(self):
    self.zealots = self.units(ZEALOT)
    self.stalkers = self.units(STALKER)
    self.army = self.zealots + self.stalkers
    self.collectedActions = []
    self.ready_nexuses = self.units(NEXUS).ready
    self.enemy_units_cost = self.get_food_cost(self.enemy_units) + self.get_food_cost(self.enemy_defense_structures)
    self.enemy_defense_structures = []

  async def display_data(self):
    print('time per step', time.time() - self.start_time)
    self.start_time = time.time()
    print('self.state.score.collection_rate_minerals', self.state.score.collection_rate_minerals)
    print('self.state.score.collection_rate_vespene', self.state.score.collection_rate_vespene)
    print('self.iteration', self.iteration)
    print('zealot count:', len(self.zealots))
    print('stalker count:', len(self.stalkers))
    print('self.enemy_defense_structures', self.enemy_defense_structures)
    print('self.enemy_units', self.enemy_units)
    print('self.known_enemy_structures', self.known_enemy_structures)
    print('self.enemy_units_cost', self.enemy_units_cost)

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
        if probe:
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
          probe = self.select_build_worker(location)
          print('Build pylon')
          if probe:
            await self.do(probe.build(PYLON, location))

  async def build_army(self):
    # build army units
    # Decide what to build.
    chosen_unit = self.choose_unit()
    if self.supply_left >= self._game_data.units[chosen_unit.value]._proto.food_required:
      await self.build_army_units(chosen_unit)


  def choose_unit(self):
    chosen_unit = ZEALOT
    # stalker
    stalker_count = len(self.units(STALKER))
    if self.enemy_flying_max > self.stalker_limit:
      stalker_limit = self.enemy_flying_max
    else:
      stalker_limit = self.stalker_limit
    if self._game_data.units[STALKER.value]._proto.food_required * stalker_count < stalker_limit:
      if self.can_afford(STALKER):
        chosen_unit = STALKER
      else: 
        self.assimilator_limit = len(self.ready_nexuses) * 1
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
    gateways = self.units(GATEWAY)
    # check for idle gateways.
    readyNoQueueGateways = gateways.ready.noqueue
    for gateway in readyNoQueueGateways:
      readyNoQueueGateways = gateways.ready.noqueue
      if self.can_afford(chosen_unit):
        amountOfPendingGateways = len(gateways) - len(readyNoQueueGateways)
        if amountOfPendingGateways < math.floor(self.state.score.collection_rate_minerals / self.mineral_to_unit_build_rate):
          ability_id = self._game_data.units[chosen_unit.value].creation_ability.id
          abilities = await self.get_available_abilities(gateway)
          if ability_id in abilities:
            # print('training unit')
            await self.do(gateway.train(chosen_unit))
    # Build gateways.
    if self.units(PYLON).ready.exists:
      if len(gateways) < math.floor(self.state.score.collection_rate_minerals / self.mineral_to_unit_build_rate):
        if self.can_afford(GATEWAY):
          pylons = self.units(PYLON)
          await self.build(GATEWAY, near=random.choice(pylons))
      
  async def command_army(self):
    if self.enemy_target:
      # Set rally point exists.
      if self.ready_nexuses:
        self.rally_point = self.ready_nexuses.closest_to(self.enemy_target).position
      self.non_attack_units = []
      self.non_attack_unit_tags = []
      self.attack_units = []
      zealots = self.units(ZEALOT)
      stalkers = self.units(STALKER)
      army = zealots + stalkers
      for unit in army:
        found_unit = False
        for tag in self.attack_units_tags:
          if tag == unit.tag:
            found_unit = True
            break
        if found_unit:
          self.attack_units.append(unit)
          # assess group army versus any enemy army.
          grouped_zealots = zealots.closer_than(16, unit.position)
          grouped_stalkers = stalkers.closer_than(16, unit.position)
          grouped_army = grouped_zealots + grouped_stalkers
          grouped_army_cost = self.get_food_cost(grouped_army)
          #  For each enemy unit, assign a enemy army cost.
          #  If unit army cost is larger than closest enemy army continue patrolling.
          total_enemy_units = self.enemy_units + self.enemy_defense_structures
          enemy_army_cost = 0
          if len(total_enemy_units):
            closest_enemy = min(total_enemy_units, key=lambda x: x.position.distance_to(unit))
            close_enemy_units = list(filter(lambda x: x.position.distance_to(closest_enemy) < 12, total_enemy_units))
            close_defense_structures = list(filter(lambda x: x.position.distance_to(closest_enemy) < 12, self.enemy_defense_structures))
            enemy_army_cost = self.get_food_cost(close_enemy_units)
            enemy_army_cost = enemy_army_cost + self.get_food_cost(close_defense_structures)
          if self.iteration % 30 == 0:
            print('grouped_army_cost', grouped_army_cost)
            print('enemy_army_cost', enemy_army_cost)
            print('self.enemy_defense_structures', self.enemy_defense_structures)
          if (grouped_army_cost > enemy_army_cost * .7):
            self.collectedActions.append(unit(AbilityId.PATROL, self.enemy_target))
          else:
            if unit.position.distance_to(closest_enemy) < 20:
              self.collectedActions.append(unit(AbilityId.MOVE, self.rally_point))
            else:
              self.collectedActions.append(unit(AbilityId.PATROL, self.enemy_target))
        else:               
          self.non_attack_units.append(unit)
          self.non_attack_unit_tags.append(unit.tag)

      total_army_food_cost = self.get_food_cost(army)
      if self.iteration % 30 == 0:
        print('*******************')
        print('len(army)', len(army))
        print('len(self.attack_units)', len(self.attack_units))
        print('len(self.attack_units_tags)', len(self.attack_units_tags))
        print('len(self.non_attack_units)', len(self.non_attack_units))
        print('len(self.non_attack_unit_tags)', len(self.non_attack_unit_tags))
        print('total_army_food_cost', total_army_food_cost)
        print('self.food_threshold', self.food_threshold)
        print('self.defense_mode', self.defense_mode)
        print('len(self.defending_probes)', len(self.defending_probes))
        print(f"probe_scout", self.probe_scout)
        # assert(len(army) - len(self.attack_units) - len(self.non_attack_units))
      if self.known_enemy_structures: 
        if not self.enemy_target == self.known_enemy_structures.closest_to(self.rally_point).position:
          print('new enemy_target')
          self.enemy_target = self.known_enemy_structures.closest_to(self.rally_point).position
          for unit in self.attack_units:
            self.collectedActions.append(unit(AbilityId.PATROL, self.enemy_target))
      else:
        self.enemy_target = self.probe_scout_targets[0]

      if not self.defense_mode:
        self.attack_enemy()
      self.defend_base()
      # clean tags.
      self.attack_units_tags = []
      for unit in self.attack_units:
        self.attack_units_tags.append(unit.tag)
    else:
      self.enemy_target = self.probe_scout_targets[0]

  def get_food_cost(self, units):
    food_count = 0
    if len(units) > 0:
      for unit in units:
        if unit._type_data._proto.name == 'PhotonCannon' or unit._type_data._proto.name == 'SpineCrawler':
          food_count += 3
        else:
          food_count += unit._type_data._proto.food_required
    return food_count

  def get_defense_structures(self):
    for structure in self.known_enemy_structures:
      if structure._type_data._proto.name == 'PhotonCannon' or structure._type_data._proto.name == 'SpineCrawler':
        self.enemy_defense_structures.append(structure)

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
          await self.do(self.probe_scout(AbilityId.PATROL, self.probe_scout_targets[0]))
        else:
          self.probe_scout = self.units.find_by_tag(self.probe_scout_tag)
          # If probe was destroyed.
          if not self.probe_scout:
            print(f"Scout number: {self.scout_number}")
            self.probe_scout_tag = random.choice(probes).tag
            self.probe_scout = self.units.find_by_tag(self.probe_scout_tag)
            print(f"probe_scout", self.probe_scout)
            await self.do(self.probe_scout(AbilityId.PATROL, self.probe_scout_targets[0]))
          # if scout finds nothing at that location, search another 
          if self.probe_scout.position.distance_to(self.probe_scout_targets[0]) < 5:
            self.probe_scout_targets.append(self.probe_scout_targets.pop(0))
            self.enemy_target = self.probe_scout_targets[0]
            print('probe_scout_targets', self.probe_scout_targets)
            await self.do(self.probe_scout(AbilityId.PATROL, self.probe_scout_targets[0]))
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

  async def set_army_composition(self):
    # print out army composition
    self.stalker_limit = len(self.army) / 2
    
  async def execute_actions(self):
    await self.do_actions(self.collectedActions)

  def attack_enemy(self):
    # compare enemy threshhold with rallied army.
    zealots = self.units(ZEALOT)
    stalkers = self.units(STALKER)
    grouped_zealots = zealots.closer_than(10, self.rally_point)
    grouped_stalkers = stalkers.closer_than(10, self.rally_point)
    grouped_army = grouped_zealots + grouped_stalkers
    grouped_army_cost = self.get_food_cost(grouped_army)
    if self.iteration % 30 == 0:
      print('grouped_army_cost', grouped_army_cost)
      print('len(grouped_army)', len(grouped_army))
    # if rallied army is larger or pop is max, attack.
    if grouped_army_cost >= self.enemy_units_cost or self.supply_used == 200:
      # print('attack enemy')
      for unit in grouped_army:
        self.attack_units.append(unit)
        self.attack_units_tags.append(unit.tag)
        self.collectedActions.append(unit(AbilityId.PATROL, self.enemy_target))
    else:
      # print('rally non_attack_units home')
      for unit in self.non_attack_units:
        self.collectedActions.append(unit(AbilityId.PATROL, self.rally_point))
    

  def defend_base(self):
    # assess invading enemy
    # check for units near base.
    invaded_nexus = None
    nexuses = self.units(NEXUS)
    forward_enemy_units_by_nexus = []
    for nexus in nexuses:
      forward_enemy_units = {'nexus': nexus, 'units': []}
      for unit in self.no_structure_enemy_units:
        if unit.distance_to(nexus.position) < 10:
          forward_enemy_units['units'].append(unit)
      if forward_enemy_units:
        forward_enemy_units_by_nexus.append(forward_enemy_units)
    if self.iteration % 30 == 0:
      print('forward_enemy_units_by_nexus', forward_enemy_units_by_nexus)
    if len(forward_enemy_units_by_nexus) > 0:
      largest_enemy = 0
      for enemy_units in forward_enemy_units_by_nexus:
        # defend against larget threat
        if len(enemy_units['units']) > 0:
          if self.get_food_cost(enemy_units['units']) > largest_enemy:
            largest_enemy = self.get_food_cost(enemy_units['units'])
            self.defense_rally_point = enemy_units['units'][0].position
            invaded_nexus = enemy_units['nexus']
    if invaded_nexus:
      self.defense_mode = True
      if self.iteration % 30 == 0:
        print('invaded_nexus')
      # assign units to defend.
      stalkers = self.units(STALKER)
      zealots = self.units(ZEALOT)
      grouped_zealots = zealots.closer_than(10, self.rally_point)
      grouped_stalkers = stalkers.closer_than(10, self.rally_point)
      grouped_army = grouped_zealots + grouped_stalkers
      grouped_army_cost = self.get_food_cost(grouped_army) + self.get_food_cost(self.defending_probes)
      if self.iteration % 30 == 0:
        print('len(grouped_army)', len(grouped_army))
        print('largest_enemy', largest_enemy)
        print('grouped_army_cost', grouped_army_cost)
        print('self.defending_probes', self.defending_probes)      
      for unit in grouped_army:
        self.collectedActions.append(unit(AbilityId.PATROL, self.defense_rally_point))
      # pull probes if too few defending.
      if grouped_army_cost < largest_enemy:
        for probe in self.units(PROBE):
          if probe.position.distance_to(invaded_nexus.position) < 10:
            if grouped_army_cost < largest_enemy:
              grouped_army_cost = grouped_army_cost + self.get_food_cost([probe])
              self.defending_probes.append(probe)
              self.defending_probes_tags.append(probe.tag)
              self.collectedActions.append(probe(AbilityId.ATTACK, self.defense_rally_point))
            else:
              break              
    else:
      self.defense_mode = False
      if self.iteration % 30 == 0:
        print('no invaded_nexus')
      # stop attacking probes when threat is gone.
      if len(self.defending_probes) and self.iteration % len(self.defending_probes) == 0:
        for probe in self.defending_probes:
          mineral_field = self.state.mineral_field.closest_to(probe)
          self.collectedActions.append(probe.gather(mineral_field))
          self.collectedActions.append(probe(AbilityId.HARVEST_GATHER, mineral_field))
        self.defending_probes = []
        self.defending_probes_tags = []

  async def track_enemy_units(self):
    self.get_defense_structures()
    # collect enemy units in array.
    # make sure tags aren't repeated.
    for unit in self.no_structure_enemy_units:
      if unit._type_data._proto.name == 'AdeptPhaseShift':
        continue
      found_index = next((index for (index, d) in enumerate(self.enemy_units) if d.tag == unit.tag), -1)
    # found_unit = self.enemy_units.find_by_tag(unit.tag)
      if found_index < 0:
        self.enemy_units.append(unit)
      else:
        # replace found
        self.enemy_units[found_index] = unit
  
  async def on_unit_destroyed(self, unit_tag):
    found_index = next((index for (index, d) in enumerate(self.enemy_units) if d.tag == unit_tag), -1)
    if found_index >= 0:
      del self.enemy_units[found_index]
import math
import random
import sc2
from sc2.constants import *

class LucidBot(sc2.BotAI):
  
  async def on_step(self, iteration):
    if iteration == 0:
      self.attack_threshold = 0
    if len(self.known_enemy_units) > self.attack_threshold:
      self.attack_threshold = len(self.known_enemy_units)
      print(self.attack_threshold)
    self.ready_nexuses = self.units(NEXUS).ready
    # gather resource
    await self.distribute_workers()
    # build workers, chronoboosting
    await self.nexus_command()
    # build supply
    await self.increase_supply()
    # build army
    await self.build_army()
    # send army out.
    await self.command_army()
    # scout
    # await self.scout()

  async def nexus_command(self):
    for nexus in self.ready_nexuses:
      # build workers when there is a shortage at the nexus.    
      ideal_harvesters = nexus.ideal_harvesters
      assigned_harvesters = nexus.assigned_harvesters
      if ideal_harvesters > assigned_harvesters:
        if nexus.noqueue:
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
    await self.build_zealots()
    # build when resource are available, time point or supply
    # resouces available for now.
    # if self.units(PYLON).ready.exists:
    #   if self.can_afford(GATEWAY):
    #     if not self.already_pending(GATEWAY):
    #       pylons = self.units(PYLON)
    #       await self.build(GATEWAY, near=random.choice(pylons))
        
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
    rally_point = self.start_location
    # If army meets threshhold, attack.
    zealots = self.units(ZEALOT)
    if len(zealots) > self.attack_threshold:
      # attack!
      groupedZealots = zealots.closer_than(10, self.start_location)
      if len(groupedZealots) >= len(zealots):
        for zealot in zealots:
          # if zealot is idle or on move, wait until mass, then patrol
          if zealot.is_idle:
            await self.do(zealot(AbilityId.PATROL, self.enemy_start_locations[0]))
          if len(zealot.orders) > 0:
            if not zealot.orders[0].ability.id in [AbilityId.PATROL]:
              await self.do(zealot(AbilityId.PATROL, self.enemy_start_locations[0]))
    else:
      # retreat to rally point.
      for zealot in zealots:
        if zealot.position.distance_to(self.start_location) > 5:
          if zealot.is_idle:         
            await self.do(zealot(AbilityId.MOVE, self.start_location))
          if len(zealot.orders) > 0:
            if not zealot.orders[0].ability.id in [AbilityId.MOVE]:
              await self.do(zealot(AbilityId.MOVE, self.start_location))

# UnitOrder(AbilityData(name=MovePatrol)
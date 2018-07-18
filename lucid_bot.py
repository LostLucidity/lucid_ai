import random
import sc2
from sc2.constants import *

class LucidBot(sc2.BotAI):
  async def on_step(self, iteration):
    # gather resource
    await self.distribute_workers()
    # build workers, chronoboosting
    await self.nexus_command()
    # build supply
    await self.increase_supply()
    # build army
    await self.build_army()
    # scout
    # await self.scout()

  async def nexus_command(self):
    for nexus in self.units(NEXUS).ready:
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
        if not nexus.has_buff(BuffId.CHRONOBOOSTENERGYCOST):
          if not nexus.noqueue:
            await self.do(nexus(AbilityId.EFFECT_CHRONOBOOSTENERGYCOST, nexus))
      # recall army

  async def increase_supply(self):
    if self.supply_left < self.supply_cap * 0.15:
      if self.can_afford(PYLON):
        if not self.already_pending(PYLON):
          nexuses = self.units(NEXUS)
          nexus = random.choice(nexuses)
          location = await self.find_placement(PYLON, nexus.position, 26, False, 6)
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
    readyNoQueueGateways = self.units(GATEWAY).ready.noqueue
    if readyNoQueueGateways:
      for gateway in readyNoQueueGateways:
        if self.can_afford(ZEALOT) and self.supply_left > 1:
          await self.do(gateway.train(ZEALOT))
    else:
      if self.units(PYLON).ready.exists:
        if self.can_afford(GATEWAY):
          if not self.already_pending(GATEWAY):
            pylons = self.units(PYLON)
            await self.build(GATEWAY, near=random.choice(pylons))

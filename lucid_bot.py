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
    await self.build_pylons()
    # scout
    # await self.scout()

  async def nexus_command(self):
    for nexus in self.units(NEXUS).ready:
      # build workers
      if nexus.noqueue:
        if self.can_afford(PROBE):
          await self.do(nexus.train(PROBE))
      # use chronoboost
      abilities = await self.get_available_abilities(nexus)
      if AbilityId.EFFECT_CHRONOBOOSTENERGYCOST in abilities:
        if not nexus.has_buff(BuffId.CHRONOBOOSTENERGYCOST):
            await self.do(nexus(AbilityId.EFFECT_CHRONOBOOSTENERGYCOST, nexus))

  # async def build_workers(self):
  #   for nexus in self.units(NEXUS).ready.noqueue:
  #     if self.can_afford(PROBE):
  #       await self.do(nexus.train(PROBE))

  # async def chronoboosting(self):
    


  async def build_pylons(self):
    if self.supply_left < self.supply_cap * 0.15:
      if self.can_afford(PYLON):
        if not self.already_pending(PYLON):
          nexuses = self.units(NEXUS)
          await self.build(PYLON, near=random.choice(nexuses))
        

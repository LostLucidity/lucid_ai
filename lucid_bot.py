import random
import sc2
from sc2.constants import *

class LucidBot(sc2.BotAI):
  async def on_step(self, iteration):
    # gather resource
    await self.distribute_workers()
    # build workers
    await self.build_workers()
    # build supply
    await self.build_pylons()
    # scout
    # await self.scout()

  async def build_workers(self):
    for nexus in self.units(NEXUS).ready.noqueue:
      if self.can_afford(PROBE):
        await self.do(nexus.train(PROBE))

  async def build_pylons(self):
    if self.supply_left < self.supply_cap * 0.15:
      if self.can_afford(PYLON):
        if not self.already_pending(PYLON):
          nexuses = self.units(NEXUS)
          await self.build(PYLON, near=random.choice(nexuses))
        

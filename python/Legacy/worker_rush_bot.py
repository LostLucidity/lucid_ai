import sc2
from systems import *

class WorkerRushBot(sc2.BotAI):
	async def on_step(self, iteration: int):
		if iteration == 0:
			for worker in self.workers:
				self.do(worker.attack(self.enemy_start_locations[0]))
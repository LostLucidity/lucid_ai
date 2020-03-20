import sc2, random
from sc2 import run_game, maps, Race, Difficulty
from sc2.player import Bot, Computer

# from lucid_bot import LucidBot
# from worker_rush_bot import WorkerRushBot
# from generic_bot import genericBot
from bots_list import GenericBot, RandomBot
from maps_list import *

run_game(maps.get(random.choice(maps_list)), [
    Bot(Race.Random, GenericBot()),
    Bot(Race.Random, GenericBot())
], realtime=False)
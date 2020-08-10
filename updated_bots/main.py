import cProfile
import sc2, random
from sc2 import run_game, maps, Race, Difficulty
from sc2.player import Bot, Computer

# from lucid_bot import LucidBot
# from worker_rush_bot import WorkerRushBot
# from generic_bot import genericBot
from bots_list import GenericBot, RandomBot, BCMACHINE
from maps_list import *

race_one = 'Random'
race_two = 'Random'
bot_one = GenericBot()
bot_two = GenericBot()
chosen_map = random.choice(maps_list)

run_game(
    maps.get(chosen_map),
    [
        Bot(Race[race_one], bot_one),
        Bot(Race[race_two], bot_two)
    ],
    save_replay_as=f"{race_one}_{type(bot_one).__name__}_vs_{race_two}_{type(bot_two).__name__}_{chosen_map}.SC2Replay",
    realtime=False
)
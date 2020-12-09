from ladder import run_ladder_game
from QLucid import QLucidBot
from sc2.player import Bot
from sc2 import Race

dummy_bot = QLucid()
race = Race.Random
protoss_bot = Bot(race, dummy_bot)


def main():
    # Ladder game started by LadderManager
    print("Starting ladder game...")
    result, opponentid = run_ladder_game(protoss_bot)
    print(result, " against opponent ", opponentid)


if __name__ == '__main__':
    main()

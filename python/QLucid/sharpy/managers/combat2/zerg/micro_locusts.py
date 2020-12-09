"""Micro locusts differently to prevent them from retreating."""

from sharpy.managers.combat2 import Action, MicroStep
from sc2.unit import Unit
from sc2.units import Units


class MicroLocusts(MicroStep):
    def group_solve_combat(self, units: Units, current_command: Action) -> Action:
        if self.closest_group:
            return Action(self.closest_group.center, True)
        return current_command

    def unit_solve_combat(self, unit: Unit, current_command: Action) -> Action:
        return current_command

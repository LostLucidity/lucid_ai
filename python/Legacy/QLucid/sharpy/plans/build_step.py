from typing import Optional, Callable, Union

# Singular step of action
from sharpy.plans.acts import merge_to_act
from sharpy.plans.require import merge_to_require
from sharpy.plans.require.require_base import RequireBase
from sharpy.plans.acts.act_base import ActBase
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sharpy.knowledges import Knowledge


class Step(ActBase):
    def __init__(
        self,
        requirement: Optional[Union[RequireBase, Callable[["Knowledge"], bool]]],
        action: Optional[Union[ActBase, Callable[["Knowledge"], bool]]],
        skip: Optional[Union[RequireBase, Callable[["Knowledge"], bool]]] = None,
        skip_until: Optional[Union[RequireBase, Callable[["Knowledge"], bool]]] = None,
    ):
        assert requirement is None or isinstance(requirement, RequireBase) or isinstance(requirement, Callable)
        assert action is None or isinstance(action, ActBase)
        assert skip is None or isinstance(skip, RequireBase) or isinstance(skip, Callable)
        assert skip_until is None or isinstance(skip_until, RequireBase) or isinstance(skip_until, Callable)
        super().__init__()

        self.requirement = merge_to_require(requirement)
        self.action = merge_to_act(action)
        self.skip = merge_to_require(skip)
        self.skip_until = merge_to_require(skip_until)

    async def debug_draw(self):
        if self.requirement is not None:
            await self.requirement.debug_draw()
        if self.action is not None:
            await self.action.debug_draw()
        if self.skip is not None:
            await self.skip.debug_draw()
        if self.skip_until is not None:
            await self.skip_until.debug_draw()

    async def start(self, knowledge: "Knowledge"):
        if self.requirement is not None:
            await self.requirement.start(knowledge)
        if self.action is not None:
            await self.action.start(knowledge)
        if self.skip is not None:
            await self.skip.start(knowledge)
        if self.skip_until is not None:
            await self.skip_until.start(knowledge)

    async def execute(self) -> bool:
        if self.skip is not None and self.skip.check():
            return True
        if self.skip_until is not None and not self.skip_until.check():
            return True
        if self.requirement is not None and not self.requirement.check():
            return False

        if self.action is None:
            return True

        return await self.action.execute()

# This is a Python type stub file (.pyi).
# It defines the structure and types for the `host` module, which is
# dynamically injected into the Python environment by the host orchestrator.
# This file provides type hinting and autocompletion for developers.
# The actual implementation of these functions is in the host's JavaScript code.

"""
Host API Stub (host.pyi)

This file defines the Python type contract for the `host` module, which is
dynamically injected into the Pyodide sandbox by the host orchestrator. It
provides the fundamental primitives for an Intelligent Contract (ICON) to
interact with the platform's unique economic model.

--- The Overdraft and Clearing House Protocols ---

The APIs defined herein are the agent-facing components of two powerful,
interlocking protocols that govern the platform's economy:

1.  **The Overdraft Protocol:** Unlike traditional systems, an ICON does not
    need to possess capital to execute an operation. For the duration of a
    single, atomic transaction (its `run` method), an ICON is granted an
    implicit, infinite, zero-cost line of credit. It can pay for services
    from other ICONs or the host, allowing its transactional balance to go
    negative.

2.  **The Clearing House Protocol:** The host orchestrator acts as a central
    clearing house, maintaining an in-memory, transactional ledger. At the
    end of an ICON's `run` method, the orchestrator enforces the Law of
    Universal Non-Negativity: the final balance of EVERY participant in the
    transaction's call stack must be zero or greater, and every agent must
    satisfy its own declared guard. If these laws are violated, the entire
    transaction is atomically reverted.

The `TokenAPI` class is the primary interface to this Clearing House. It allows
an agent to become aware of the economic state of its transactional universe
and to transfer value to other agents. This is what enables the emergent,
"self-healing" behavior where profitable agents are incentivized to cover the
minor deficits of their dependencies to ensure the success of the entire,
profitable transaction.

All monetary values are represented as `int` "nanodollars" to guarantee
precision and avoid floating-point errors, a standard practice for robust
financial systems.
"""

from typing import AsyncGenerator, Awaitable, Callable, Dict, List, TypedDict

# --- Core Host Functions ---

class CoreAPI:
    async def get_agent_id() -> Awaitable[str]:
        """Returns the unique identifier for the currently executing agent."""
    ...

    async def call(agent_id: str, **kwargs) -> Awaitable[AsyncGenerator]:
        """
        Initiates a connection with another agent.
        - agent_id: The ID of the agent to call.
        - kwargs: Any static, initial configuration parameters for the callee.

        Returns the callee's output stream (an async generator). The first item
        yielded from this stream is expected to be the "handshake" function.
        """
    ...

class GuardAPI:
    async def set_guard(minimum_net_outcome: int) -> Awaitable[None]:
        """
        Sets an *absolute* economic guardrail for the current transaction.
        This guard specifies the minimum acceptable net_outcome (in nanodollars)
        for the agent. This is a declarative, idempotent operation. Use this for
        agents that perform a single, high-level task per transaction.
        """
        ...

    async def mut_guard(delta: int) -> Awaitable[None]:
        """
        Mutates the economic guardrail by a `delta` (in nanodollars). This is an
        *incremental* operation (guard = current_guard + delta). This is the
        appropriate primitive for utility agents (e.g., a neural network) that
        may be called multiple times within a single transaction, as it allows
        them to correctly accumulate the total value they must be paid.
        """
        ...

    async def get_guard(agent_id: str = None) -> Awaitable[int]:
        """
        Returns the current economic guard for the specified agent in nanodollars.
        This provides a direct, simple way to check an agent's economic intent
        without parsing the entire ledger state. If agent_id is None, returns
        the guard of the calling agent.
        """
        ...

# --- Rich Ledger State Types ---

class LedgerEntry(TypedDict):
    """Represents the full economic state of an agent within a transaction."""
    outcome: int # The delta in real platform balance for this agent
    protect: int # The minimum allowable balance delta for this agent

# --- ERC-20 Inspired Transactional Token API ---

class TokenAPI:
    """
    Provides a more complete ERC-20 inspired interface for interacting
    with the transactional ledger. Note the use of snake_case for Python conventions.
    """
    async def balance_of(self, agent_id: str = None) -> Awaitable[int]:
        """
        Returns the current transactional balance of the specified agent in nanodollars.
        If agent_id is None, returns the balance of the calling agent.
        """
        ...

    async def transfer(self, to_agent_id: str, amount: int) -> Awaitable[None]:
        """
        Transfers an `amount` of nanodollars from the calling agent's transactional
        balance to the target agent's balance. This is a "push" payment.
        """
        ...
        
    async def approve(self, spender_agent_id: str, amount: int) -> Awaitable[None]:
        """
        Approves the `spender_agent_id` to withdraw up to `amount` (in nanodollars)
        from the calling agent's balance. This is the foundation for setting budgets.
        """
        ...

    async def allowance(self, owner_agent_id: str, spender_agent_id: str) -> Awaitable[int]:
        """
        Returns the remaining amount in nanodollars that `spender_agent_id` is still
        allowed to withdraw from `owner_agent_id`.
        """
        ...
        
    async def transfer_from(self, from_agent_id: str, to_agent_id: str, amount: int) -> Awaitable[None]:
        """
        Executes a transfer of `amount` nanodollars on behalf of `from_agent_id`.
        The calling agent (the "spender") must have been previously approved by
        `from_agent_id` for at least `amount`. This is a "pull" payment.
        """
        ...

    async def get_ledger_state(self) -> Awaitable[Dict[str, LedgerEntry]]:
        """
        Returns a snapshot of the entire transactional ledger, showing the
        full economic state of every agent participating in the current transaction.
        """
        ...

token: TokenAPI
import numpy as np
import json
import asyncio
import host

class SimpleAgent:
    # The constructor now accepts the full host capabilities object
    def __init__(self, config, host_capabilities):
        print("[Agent] Initializing with config:", config)
        self.vector = np.array(config.get("vector", [1, 2, 3]))
        self.target_threshold = config.get("target_threshold", 100)
        
        # Store both synchronous and asynchronous host functions
        self.get_host_info = host.getHostInfo
        self.fetch_external_data = host.fetchExternalData
        print(f"[Agent] Host capabilities received: {'Yes' if host else 'No'}")

    # ASYNC CHANGE: The run method is now an async coroutine
    async def run(self, input_tape_path, output_tape_path):
        print(f"[Agent] Reading from input tape: {input_tape_path}")
        with open(input_tape_path, 'r') as f:
            input_data = json.load(f)

        trace_id = input_data.get("trace_id")
        payload = input_data.get("payload", {})
        print(f"[Agent] Received input with Trace ID: {trace_id}")

        # Call the synchronous host function
        host_message = self.get_host_info()
        print(f"[Agent] Sync message from host: '{host_message}'")
        
        # ASYNC CHANGE: Call and await the asynchronous host function
        print("[Agent] Calling async host function... (will pause for 1 sec)")
        # When Python awaits this, Pyodide suspends execution and yields to the Node.js event loop
        # until the JavaScript Promise resolves.
        external_data = await self.fetch_external_data()
        print(f"[Agent] Async data received from host: {external_data.to_py()}")

        if "processed_result" in payload:
            number = payload["processed_result"]
            print(f"[Agent] Received processed result from another agent: {number}")
        else:
            input_vector = np.array(payload.get("vector", []))
            number = np.dot(self.vector, input_vector)
            print(f"[Agent] Initial dot product result: {number}")

        if number >= self.target_threshold:
            print(f"[Agent] Success! Number {number} >= {self.target_threshold}. Completing task.")
            output_data = {
                "trace_id": trace_id,
                "status": "complete",
                "result": float(number)
            }
        else:
            print(f"[Agent] Number {number} < {self.target_threshold}. Requesting multiplier agent.")
            gap = self.target_threshold - number
            if gap > 50:
                factor = 3
            elif gap > 20:
                factor = 5
            else:
                factor = 2
            
            print(f"[Agent] Gap to target: {gap}, using factor: {factor}")
            
            output_data = {
                "trace_id": trace_id,
                "status": "pending",
                "action": {
                    "type": "run_agent",
                    "payload": {
                        "agent_name": "multiplier",
                        "input_data": { 
                            "number": float(number), 
                            "factor": factor,
                            "return_to": "agent",
                            "original_payload": payload
                        }
                    }
                }
            }
        
        print(f"[Agent] Writing to output tape: {output_tape_path}")
        with open(output_tape_path, 'w') as f:
            json.dump(output_data, f)

# The factory function signature remains the same.
# The orchestrator will pass the JS object containing the async function.
def main(config, host_capabilities=None):
    return SimpleAgent(config, host_capabilities)


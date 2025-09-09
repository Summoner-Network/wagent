import numpy as np
import json
import host

class SimpleAgent:
    # The constructor now accepts host capabilities
    def __init__(self, config, host_capabilities):
        print("[Agent] Initializing with config:", config)
        self.vector = np.array(config.get("vector", [1, 2, 3]))
        self.target_threshold = config.get("target_threshold", 100)
        
        # Store the host function for later use from the imported module
        self.get_host_info = host.getHostInfo
        print(f"[Agent] Host capabilities received: {'Yes' if self.get_host_info else 'No'}")

    def run(self, input_tape_path, output_tape_path):
        print(f"[Agent] Reading from input tape: {input_tape_path}")
        with open(input_tape_path, 'r') as f:
            input_data = json.load(f)

        trace_id = input_data.get("trace_id")
        payload = input_data.get("payload", {})
        print(f"[Agent] Received input with Trace ID: {trace_id}")

        # Call the host function and print its result
        if self.get_host_info:
            # Call the host function directly via the imported module proxy
            host_message = self.get_host_info()
            print(f"[Agent] Message from host: '{host_message}'")
        else:
            print("[Agent] Host function not available.")

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

# The main factory function now accepts host_capabilities
# and passes them to the agent's constructor.
def main(config, host_capabilities=None):
    # If host_capabilities is None or not provided, create an empty dict
    # to prevent errors when calling .get()
    caps = host_capabilities or {}
    return SimpleAgent(config, caps)


import numpy as np
import json

class SimpleAgent:
    def __init__(self, config):
        print("[Agent] Initializing with config:", config)
        self.vector = np.array(config.get("vector", [1, 2, 3]))

    def run(self, input_tape_path, output_tape_path):
        print(f"[Agent] Reading from input tape: {input_tape_path}")
        with open(input_tape_path, 'r') as f:
            input_data = json.load(f)

        trace_id = input_data.get("trace_id")
        payload = input_data.get("payload", {})
        print(f"[Agent] Received input with Trace ID: {trace_id}")

        input_vector = np.array(payload.get("vector", []))
        number = np.dot(self.vector, input_vector)
        print(f"[Agent] Initial dot product result: {number}")

        # Logic to decide whether to finish or call another agent.
        if number >= 100:
            # If the number is large enough, we are done.
            print("[Agent] Number is large enough. Completing task.")
            output_data = {
                "trace_id": trace_id,
                "status": "complete",
                "result": float(number)
            }
        else:
            # If the number is small, request the host to run the multiplier agent.
            print("[Agent] Number is small. Requesting multiplier agent.")
            output_data = {
                "trace_id": trace_id,
                "status": "pending",
                "action": {
                    "type": "run_agent",
                    "payload": {
                        "agent_name": "multiplier",
                        "input_data": { "number": float(number), "factor": 10 }
                    }
                }
            }
        
        print(f"[Agent] Writing to output tape: {output_tape_path}")
        with open(output_tape_path, 'w') as f:
            json.dump(output_data, f)

def main(config):
    return SimpleAgent(config)

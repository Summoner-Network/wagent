import numpy as np
import json

class SimpleAgent:
    def __init__(self, config):
        print("[Agent] Initializing with config:", config)
        self.vector = np.array(config.get("vector", [1, 2, 3]))
        self.target_threshold = config.get("target_threshold", 100)

    def run(self, input_tape_path, output_tape_path):
        print(f"[Agent] Reading from input tape: {input_tape_path}")
        with open(input_tape_path, 'r') as f:
            input_data = json.load(f)

        trace_id = input_data.get("trace_id")
        payload = input_data.get("payload", {})
        print(f"[Agent] Received input with Trace ID: {trace_id}")

        # Check if this is an initial run or a continuation with processed result
        if "processed_result" in payload:
            # This is a continuation - we got a result back from another agent
            number = payload["processed_result"]
            print(f"[Agent] Received processed result from another agent: {number}")
        else:
            # Initial run - compute dot product
            input_vector = np.array(payload.get("vector", []))
            number = np.dot(self.vector, input_vector)
            print(f"[Agent] Initial dot product result: {number}")

        # Check if we've reached our target
        if number >= self.target_threshold:
            print(f"[Agent] Success! Number {number} >= {self.target_threshold}. Completing task.")
            output_data = {
                "trace_id": trace_id,
                "status": "complete",
                "result": float(number)
            }
        else:
            # Need more processing - call multiplier agent
            print(f"[Agent] Number {number} < {self.target_threshold}. Requesting multiplier agent.")
            
            # Determine factor based on how far we are from target
            gap = self.target_threshold - number
            if gap > 50:
                factor = 3  # Big jump needed
            elif gap > 20:
                factor = 5   # Medium jump
            else:
                factor = 2   # Small jump
            
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
                            "return_to": "agent",  # Important: specify return destination
                            "original_payload": payload  # Pass through original context
                        }
                    }
                }
            }
        
        print(f"[Agent] Writing to output tape: {output_tape_path}")
        with open(output_tape_path, 'w') as f:
            json.dump(output_data, f)

def main(config):
    return SimpleAgent(config)
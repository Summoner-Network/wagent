import json

class MultiplierAgent:
    # The __init__ method doesn't need to change, as this agent
    # does not use any host capabilities.
    def __init__(self, config):
        print("[MultiplierAgent] Initializing with config:", config)
        self.default_factor = config.get("default_factor", 2)

    def run(self, input_tape_path, output_tape_path):
        print(f"[MultiplierAgent] Reading from input tape: {input_tape_path}")
        with open(input_tape_path, 'r') as f:
            input_data = json.load(f)

        trace_id = input_data.get("trace_id")
        payload = input_data.get("payload", {})
        print(f"[MultiplierAgent] Received input with Trace ID: {trace_id}")

        number = payload.get("number", 0)
        factor = payload.get("factor", self.default_factor)
        
        print(f"[MultiplierAgent] Multiplying {number} by {factor}")
        result = number * factor
        print(f"[MultiplierAgent] Result: {result}")

        return_to = payload.get("return_to")
        original_payload = payload.get("original_payload", {})
        
        if return_to:
            print(f"[MultiplierAgent] Returning result to {return_to} for further processing")
            output_data = {
                "trace_id": trace_id,
                "status": "pending",
                "action": {
                    "type": "run_agent",
                    "payload": {
                        "agent_name": return_to,
                        "input_data": {
                            **original_payload,
                            "processed_result": float(result)
                        }
                    }
                }
            }
        else:
            print("[MultiplierAgent] No return agent specified. Completing task.")
            output_data = {
                "trace_id": trace_id,
                "status": "complete",
                "result": float(result)
            }
        
        print(f"[MultiplierAgent] Writing to output tape: {output_tape_path}")
        with open(output_tape_path, 'w') as f:
            json.dump(output_data, f)

# CORRECTED: The factory function now accepts the optional host_capabilities
# argument, even though it doesn't use it. This makes it compatible
# with the orchestrator's call signature.
def main(config, host_capabilities=None):
    return MultiplierAgent(config)

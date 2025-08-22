import json

class MultiplierAgent:
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

        # Always complete - multiplier is a simple operation
        output_data = {
            "trace_id": trace_id,
            "status": "complete",
            "result": float(result)
        }
        
        print(f"[MultiplierAgent] Writing to output tape: {output_tape_path}")
        with open(output_tape_path, 'w') as f:
            json.dump(output_data, f)

def main(config):
    return MultiplierAgent(config)
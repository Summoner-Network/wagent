import json

class MultiplierAgent:
    def __init__(self, config):
        print("[MultiplierAgent] Initializing.")
        # This agent doesn't need any config, but the main function provides it.
        pass

    def run(self, input_tape_path, output_tape_path):
        print(f"[MultiplierAgent] Reading from input tape: {input_tape_path}")
        with open(input_tape_path, 'r') as f:
            input_data = json.load(f)

        trace_id = input_data.get("trace_id")
        payload = input_data.get("payload", {})
        print(f"[MultiplierAgent] Received input with Trace ID: {trace_id}")

        number = payload.get("number", 0)
        factor = payload.get("factor", 1)
        result = number * factor
        
        print(f"[MultiplierAgent] Calculation: {number} * {factor} = {result}")

        # This agent's job is simple, so it always returns a "complete" status.
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

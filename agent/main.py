import numpy as np

class SimpleAgent:
    def __init__(self, config):
        print("[Agent] Initializing with config:", config)
        self.vector = np.array(config.get("vector", [1, 2, 3]))

    def run(self, input_data):
        print(f"[Agent] Received input: {input_data}")
        input_vector = np.array(input_data["vector"])
        result = np.dot(self.vector, input_vector)
        print(f"[Agent] Dot product result: {result}")
        return {"result": float(result)}

def main(config):
    return SimpleAgent(config)
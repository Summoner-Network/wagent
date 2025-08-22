# guest.py
# Write normal Python. The packager will translate a restricted subset.
#
# Supported in this demo:
#   - log("literal")                -> host import env.log(ptr, len)
#   - log(config)                   -> logs the config string passed from host
#   - sleep_ms(positive_int)        -> host import env.sleep_ms(ms)
#   - return <small positive int>   -> i32 result
#
# Signature contract:
#   def run(config: str) -> int
#
# Example behavior:
#   - logs "start"
#   - sleeps 200 ms
#   - logs the provided config
#   - returns 42

def run(config: str) -> int:
    log("start")
    sleep_ms(200)
    log(config)
    return 42


# The following are just *markers* for the packager.
# They never execute at runtime; the host provides the actual implementations.
def log(_s: str) -> None:  # marker
    raise RuntimeError("markers are not callable")

def sleep_ms(_n: int) -> None:  # marker
    raise RuntimeError("markers are not callable")

"""
Configuration and constants.
"""

import os
from dotenv import load_dotenv

load_dotenv(".env.local")

# Convex configuration
CONVEX_URL = os.getenv("CONVEX_URL") or os.getenv("NEXT_PUBLIC_CONVEX_URL")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY")

# Kernel timeouts
KERNEL_IDLE_TIMEOUT = 30 * 60  # 30 minutes of idle time
KERNEL_MAX_TIMEOUT = 4 * 60 * 60  # 4 hours max lifetime

# GPU types supported by Modal
GPU_TYPES = [
    "T4",
    "L4",
    "A10",
    "A100",
    "A100-40GB",
    "A100-80GB",
    "L40S",
    "H100",
    "H200",
    "B200",
]

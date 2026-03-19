"""Environment-based configuration for the RPA agent."""

import os
from dotenv import load_dotenv

load_dotenv()

PRIME_WINDOW_TITLE = os.getenv(
    "PRIME_WINDOW_TITLE",
    "Prime Software - OCEAN FAST FERRIES CORPORATION Build 20231109E",
)
RPA_AUTH_TOKEN = os.getenv("RPA_AUTH_TOKEN", "")
RPA_PORT = int(os.getenv("RPA_PORT", "8080"))
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
PRIME_TIMEOUT_SEC = int(os.getenv("PRIME_TIMEOUT_SEC", "30"))

"""Slack notifications for the RPA agent."""

import logging
import urllib.request
import json

from agent.config import SLACK_WEBHOOK_URL

logger = logging.getLogger("rpa-agent")


def send_slack(text: str) -> None:
    """Send a message to the configured Slack webhook."""
    if not SLACK_WEBHOOK_URL:
        logger.warning("SLACK_WEBHOOK_URL not configured, skipping notification")
        return
    try:
        data = json.dumps({"text": text}).encode("utf-8")
        req = urllib.request.Request(
            SLACK_WEBHOOK_URL,
            data=data,
            headers={"Content-Type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        logger.error(f"Failed to send Slack notification: {e}")


def notify_booking_error(reference: str, error_code: str, detail: str) -> None:
    """Alert Slack about a booking-level RPA error."""
    message = (
        ":warning: *RPA Booking Error*\n"
        f"*Reference:* {reference}\n"
        f"*Error:* `{error_code}`\n"
        f"*Details:* {detail}"
    )
    send_slack(message)

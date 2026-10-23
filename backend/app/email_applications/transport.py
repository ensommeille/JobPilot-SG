"""Fail-closed SMTP pilot: numeric loopback only, fixed sender and .test recipient."""

import contextlib
import ipaddress
import os
import re
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from uuid import uuid4


class TransportConfigurationError(ValueError):
    pass


class DeliveryError(Exception):
    def __init__(self, code: str, *, ambiguous: bool = False) -> None:
        self.code = code
        self.ambiguous = ambiguous


def safe_email(value: str) -> bool:
    return bool(
        re.fullmatch(
            r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}",
            value,
        )
    )


@dataclass(frozen=True)
class MailConfig:
    mode: str = "disabled"
    host: str = "127.0.0.1"
    port: int = 1025
    recipient: str | None = None
    sender: str = "jobpilot@jobpilot.test"

    @classmethod
    def from_env(cls) -> "MailConfig":
        mode = os.getenv("JOBPILOT_EMAIL_MODE", "disabled")
        if mode == "disabled":
            return cls()
        if mode != "test_smtp":
            raise TransportConfigurationError("Only disabled or test_smtp mode is supported")
        host = os.getenv("JOBPILOT_TEST_SMTP_HOST", "127.0.0.1")
        host = "127.0.0.1" if host == "localhost" else host
        try:
            address = ipaddress.ip_address(host)
            port = int(os.getenv("JOBPILOT_TEST_SMTP_PORT", "1025"))
        except ValueError as exc:
            raise TransportConfigurationError(
                "Test SMTP requires a numeric loopback host and valid port"
            ) from exc
        recipient = os.getenv("JOBPILOT_TEST_SMTP_RECIPIENT", "applications@jobpilot.test")
        if not address.is_loopback or not 1 <= port <= 65535:
            raise TransportConfigurationError("Test SMTP must use a loopback endpoint")
        if not safe_email(recipient) or not recipient.casefold().endswith(".test"):
            raise TransportConfigurationError("Test recipient must use the reserved .test domain")
        return cls(mode=mode, host=str(address), port=port, recipient=recipient)


def deliver(
    config: MailConfig, *, subject: str, body: str, reply_to: str, filename: str, content: bytes
) -> dict:
    """Only an empty refusal map after DATA counts as accepted by the test SMTP server."""
    if config != MailConfig.from_env() or config.mode != "test_smtp" or config.recipient is None:
        raise DeliveryError("transport_disabled_or_changed")
    if not safe_email(reply_to):
        raise DeliveryError("invalid_reply_to")
    message = EmailMessage()
    message["From"] = config.sender
    message["To"] = config.recipient
    message["Reply-To"] = reply_to
    message["Subject"] = subject
    message_id = f"<{uuid4()}@jobpilot.test>"
    message["Message-ID"] = message_id
    message.set_content(body)
    message.add_attachment(content, maintype="application", subtype="pdf", filename=filename)
    smtp = None
    data_started = False
    try:
        smtp = smtplib.SMTP(config.host, config.port, timeout=5)
        data_started = True
        refused = smtp.send_message(message, from_addr=config.sender, to_addrs=[config.recipient])
        if refused:
            raise DeliveryError("smtp_recipient_rejected")
        # QUIT/disconnect failure after successful DATA does not erase SMTP acceptance.
        return {
            "transport": "test_smtp",
            "accepted_by": "loopback_test_mailbox",
            "actual_recipient": config.recipient,
            "message_id": message_id,
            "smtp_accepted": True,
            "employer_delivery_confirmed": False,
        }
    except (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused, smtplib.SMTPDataError) as exc:
        raise DeliveryError("smtp_rejected") from exc
    except (smtplib.SMTPException, OSError) as exc:
        raise DeliveryError(
            "smtp_acceptance_unknown" if data_started else "smtp_connection_failed",
            ambiguous=data_started,
        ) from exc
    finally:
        if smtp is not None:
            with contextlib.suppress(OSError, smtplib.SMTPException):
                smtp.close()

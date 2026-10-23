"""A stdlib-only, loopback SMTP sink. No relay, forwarding, authentication or outbound mail.

Run: python scripts/local_test_mailbox.py --directory <new/local/mailbox> --port 1025
Each accepted DATA message is persisted as .eml with a matching JSON envelope receipt.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import ipaddress
import json
import re
import socket
import socketserver
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

MAX_MESSAGE_BYTES = 4 * 1024 * 1024


class MailboxHandler(socketserver.StreamRequestHandler):
    def handle(self) -> None:
        self.connection.settimeout(20)
        self.reply(b"220 jobpilot.test local test mailbox")
        sender = None
        recipients = []
        try:
            while line := self.rfile.readline(8193):
                if len(line) > 8192:
                    self.reply(b"500 Line too long")
                    return
                command, _, argument = line.rstrip(b"\r\n").partition(b" ")
                command = command.upper()
                if command == b"EHLO":
                    self.wfile.write(b"250-jobpilot.test\r\n250 SIZE 4194304\r\n")
                    self.wfile.flush()
                elif command in (b"HELO", b"NOOP"):
                    self.reply(b"250 OK")
                elif command == b"RSET":
                    sender, recipients = None, []
                    self.reply(b"250 Reset")
                elif command == b"MAIL":
                    value = self.address(argument, b"FROM")
                    sender, recipients = value, []
                    self.reply(
                        b"250 Sender OK"
                        if value
                        else b"550 Only reserved .test envelope addresses accepted"
                    )
                elif command == b"RCPT":
                    value = self.address(argument, b"TO")
                    if sender and value:
                        recipients.append(value)
                        self.reply(b"250 Recipient OK")
                    else:
                        self.reply(b"550 Only reserved .test envelope addresses accepted")
                elif command == b"DATA":
                    if not sender or not recipients:
                        self.reply(b"503 MAIL and RCPT required")
                        continue
                    self.reply(b"354 End data with <CRLF>.<CRLF>")
                    raw = bytearray()
                    while True:
                        part = self.rfile.readline(65537)
                        if not part:
                            return
                        if part in (b".\r\n", b".\n"):
                            break
                        if part.startswith(b".."):
                            part = part[1:]
                        raw.extend(part)
                        if len(raw) > MAX_MESSAGE_BYTES or len(part) > 65536:
                            self.reply(b"552 Message too large")
                            return
                    message_id = uuid4().hex
                    directory = self.server.mailbox_directory
                    message_path = directory / f"{message_id}.eml"
                    receipt_path = directory / f"{message_id}.json"
                    message_path.write_bytes(bytes(raw))
                    receipt_path.write_text(
                        json.dumps(
                            {
                                "kind": "jobpilot-loopback-smtp-receipt-v1",
                                "envelope_from": sender,
                                "envelope_to": recipients,
                                "received_at": datetime.now(UTC).isoformat(),
                                "size_bytes": len(raw),
                                "sha256": hashlib.sha256(raw).hexdigest(),
                                "message_file": message_path.name,
                                "employer_delivery_confirmed": False,
                            },
                            indent=2,
                        ),
                        encoding="utf-8",
                    )
                    self.reply(b"250 Accepted by local test mailbox")
                    sender, recipients = None, []
                elif command == b"QUIT":
                    self.reply(b"221 Bye")
                    return
                else:
                    self.reply(b"502 Not supported")
        except (TimeoutError, ConnectionError, OSError):
            return

    @staticmethod
    def address(argument: bytes, label: bytes) -> str | None:
        match = re.fullmatch(
            label + rb":\s*<([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.test)>(?: SIZE=\d+)?",
            argument,
            flags=re.IGNORECASE,
        )
        return match[1].decode("ascii") if match else None

    def reply(self, message: bytes) -> None:
        self.wfile.write(message + b"\r\n")
        self.wfile.flush()


class LocalMailbox(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, host: str, port: int, directory: Path) -> None:
        address = ipaddress.ip_address(host)
        if not address.is_loopback:
            raise ValueError("Mailbox must bind a numeric loopback address")
        self.address_family = socket.AF_INET6 if address.version == 6 else socket.AF_INET
        self.mailbox_directory = directory.resolve()
        self.mailbox_directory.mkdir(parents=True, exist_ok=True)
        super().__init__((str(address), port), MailboxHandler)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=1025)
    parser.add_argument("--directory", type=Path, required=True)
    arguments = parser.parse_args()
    with LocalMailbox(arguments.host, arguments.port, arguments.directory) as server:
        print(
            f"Local test mailbox listening at {arguments.host}:{server.server_address[1]}; no relay",
            flush=True,
        )
        with contextlib.suppress(KeyboardInterrupt):
            server.serve_forever(poll_interval=0.2)


if __name__ == "__main__":
    main()

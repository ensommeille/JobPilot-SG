"""The offline review runner must retain safe direct mappings without a model."""

import os
import subprocess
import sys
from pathlib import Path


def test_review_workspace_blocks_live_provider_but_preserves_direct_mapping(tmp_path):
    root = Path(__file__).resolve().parents[2]
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            """
import asyncio
from pathlib import Path
import sys
from scripts.local_review_workspace import configure_process
configure_process(Path(sys.argv[1]), 'http://127.0.0.1:15522')
from app.assistant.mapping import ProfileFormMappingService
from app.assistant.schemas import FormSnapshotField
from app.llm.config import build_live_provider
from app.llm.contracts import ProviderCapabilityError
try:
    build_live_provider()
except ProviderCapabilityError:
    pass
else:
    raise AssertionError('Live provider must be unavailable')
fields = [
    FormSnapshotField(field_id='name', label='Full name', type='text'),
    FormSnapshotField(field_id='experience', label='Relevant experience', type='textarea'),
]
draft = asyncio.run(ProfileFormMappingService(provider_factory=build_live_provider).map_fields(
    form_snapshot=fields,
    profile_data={'full_name': 'Fictional Applicant', 'experience': 'Fictional class project'},
))
assert len(draft.mapping) == 1
assert draft.mapping[0].value == 'Fictional Applicant'
assert draft.unmapped_fields == ['experience']
print('offline-direct-mapping-preserved')
""",
            str(tmp_path),
        ],
        cwd=root,
        env={**os.environ, "PYTHONPATH": str(root)},
        text=True,
        capture_output=True,
        timeout=15,
        check=True,
    )
    assert result.stdout.strip() == "offline-direct-mapping-preserved"

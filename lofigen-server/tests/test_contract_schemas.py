from __future__ import annotations

from importlib import resources
import json
import unittest

from lofigen_server.schemas import DRAIN_REASON_CODES


EXPECTED_REQUIRED_FIELDS = {
    "health.response.schema.json": {
        "batchCeiling",
        "device",
        "draining",
        "freeDisk",
        "freeStagingBytes",
        "jobsInFlight",
        "lmBackend",
        "modelId",
        "modelRevision",
        "protocolVersion",
        "status",
        "uptimeSeconds",
        "vaeChunk",
        "workerId",
    },
    "capabilities.response.schema.json": {
        "batchCeiling",
        "device",
        "durationSeconds",
        "engine",
        "generationAvailable",
        "lmBackend",
        "modelId",
        "modelLoaded",
        "modelRevision",
        "protocolVersion",
        "referenceAudio",
        "vaeChunk",
        "workerId",
    },
    "drain.request.schema.json": set(),
    "drain.response.schema.json": {
        "acceptingJobs",
        "draining",
        "jobsInFlight",
        "protocolVersion",
        "status",
    },
}


class PublicContractSchemaTests(unittest.TestCase):
    def load_schema(self, filename: str) -> dict[str, object]:
        resource = resources.files("lofigen_server").joinpath("contracts", filename)
        return json.loads(resource.read_text(encoding="utf-8"))

    def test_v1_contracts_are_strict_and_package_visible(self) -> None:
        schemas = {
            filename: self.load_schema(filename)
            for filename in EXPECTED_REQUIRED_FIELDS
        }

        for filename, required_fields in EXPECTED_REQUIRED_FIELDS.items():
            with self.subTest(filename=filename):
                schema = schemas[filename]
                self.assertEqual("object", schema["type"])
                self.assertFalse(schema["additionalProperties"])
                self.assertEqual(required_fields, set(schema.get("required", [])))

        drain_reason_schema = schemas["drain.request.schema.json"]["properties"]["reason"]
        self.assertEqual(DRAIN_REASON_CODES, frozenset(drain_reason_schema["enum"]))


if __name__ == "__main__":
    unittest.main()

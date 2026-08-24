from __future__ import annotations

from pathlib import Path
import unittest


SERVER_ROOT = Path(__file__).resolve().parents[1]


class UpstreamCacheContractTests(unittest.TestCase):
    def test_modelscope_1_34_paths_are_declared_under_lofigen_before_upstream_boot(self) -> None:
        example = (SERVER_ROOT / "lofigen.example.env").read_text(encoding="utf-8")
        cache_line = "MODELSCOPE_CACHE=/Users/<user>/lofigen/modelscope-cache"
        credentials_line = (
            "MODELSCOPE_CREDENTIALS_PATH="
            "/Users/<user>/lofigen/modelscope-credentials/credentials"
        )

        self.assertIn(cache_line, example)
        self.assertIn(credentials_line, example)
        upstream_section = example.index("# Pinned ACE-Step process")
        self.assertLess(example.index(cache_line), upstream_section)
        self.assertLess(example.index(credentials_line), upstream_section)

    def test_modelscope_semantics_rollback_and_future_jobs_gate_are_documented(self) -> None:
        readme = (SERVER_ROOT / "README.md").read_text(encoding="utf-8")

        self.assertIn("ModelScope 1.34.0", readme)
        self.assertIn("MODELSCOPE_CACHE", readme)
        self.assertIn("MODELSCOPE_CREDENTIALS_PATH", readme)
        self.assertIn("before importing `modelscope`", readme)
        self.assertIn("$HOME/.modelscope/credentials", readme)
        self.assertIn("G-JOBS", readme)
        self.assertIn("future gate", readme)


if __name__ == "__main__":
    unittest.main()

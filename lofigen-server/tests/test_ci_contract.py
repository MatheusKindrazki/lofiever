from __future__ import annotations

from pathlib import Path
import unittest


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
WORKFLOW_PATH = REPOSITORY_ROOT / ".github" / "workflows" / "ci.yml"


class LofigenCiContractTests(unittest.TestCase):
    def test_ci_builds_and_installs_the_wheel_on_each_supported_python(self) -> None:
        workflow = WORKFLOW_PATH.read_text(encoding="utf-8")
        lofigen_job = workflow.split("  lofigen-contract:\n", maxsplit=1)[1]

        self.assertIn("python-version: ['3.11', '3.12']", lofigen_job)
        self.assertIn("python-version: ${{ matrix.python-version }}", lofigen_job)
        self.assertIn("python -m pip wheel --no-deps", lofigen_job)
        self.assertIn("python -m pip install --force-reinstall", lofigen_job)
        self.assertNotIn("PYTHONPATH:", lofigen_job)

    def test_ci_smokes_packaged_schemas_and_console_config(self) -> None:
        workflow = WORKFLOW_PATH.read_text(encoding="utf-8")
        lofigen_job = workflow.split("  lofigen-contract:\n", maxsplit=1)[1]

        self.assertIn("importlib import resources", lofigen_job)
        self.assertIn('schemas packaged: 4', lofigen_job)
        self.assertIn("lofigen-server --check-config", lofigen_job)
        self.assertIn("--run-dir", lofigen_job)


if __name__ == "__main__":
    unittest.main()

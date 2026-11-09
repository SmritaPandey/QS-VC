import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from shared.model_security import model_path, MANIFEST


class ModelIntegrityTests(unittest.TestCase):
    def test_integrity_and_file_inventory(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict('os.environ', {'NODE_ENV': 'production'}):
            root = Path(directory)
            (root / 'config.json').write_text('{}')
            digest = hashlib.sha256(b'{}').hexdigest()
            (root / MANIFEST).write_text(json.dumps({'files': {'config.json': digest}}))
            self.assertEqual(model_path(directory), str(root.resolve()))
            (root / 'config.json').write_text('tampered')
            with self.assertRaises(ValueError): model_path(directory)
            (root / 'config.json').write_text('{}')
            (root / 'unexpected.py').write_text('unreviewed code')
            with self.assertRaises(ValueError): model_path(directory)

    def test_rejects_unreviewed_downloads_and_escaping_symlinks(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict('os.environ', {'NODE_ENV': 'production', 'QSVC_ALLOW_UNVERIFIED_MODELS': 'true'}):
            root = Path(directory)
            with self.assertRaises(ValueError): model_path('some/model-on-the-hub')
            with self.assertRaises(ValueError): model_path(directory)
            model = root / 'model'; model.mkdir()
            (root / 'outside.py').write_text('outside')
            (model / 'code.py').symlink_to(root / 'outside.py')
            (model / MANIFEST).write_text(json.dumps({'files': {'code.py': hashlib.sha256(b'outside').hexdigest()}}))
            with self.assertRaises(ValueError): model_path(str(model))


if __name__ == '__main__': unittest.main()

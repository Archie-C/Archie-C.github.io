"""Rebuild the student ZIP: python path/to/build_download.py."""
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parent
FILES = (
    "README.md",
    "requirements.txt",
    "Neural_Network_Exercises_2026.pdf",
    "physics.pdf",
    "train.ipynb",
    "model.py",
    "landings.csv",
    "rocket_closed_loop.py",
    "rocket_runtime.py",
    "rocket_physics.py",
    "rocket_calibration.py",
    "rocket_scoring.py",
    "rocket_wind.py",
    "rocket_sampling.py",
)


def build():
    # An explicit list keeps trained weights, alternative models and server files out.
    contents = {name: (ROOT / name).read_bytes() for name in FILES}
    notebook = json.loads(contents["train.ipynb"])
    for cell in notebook["cells"]:
        if cell["cell_type"] == "code":
            cell["outputs"] = []
            cell["execution_count"] = None
        cell.get("metadata", {}).pop("execution", None)
    notebook.get("metadata", {}).pop("widgets", None)
    contents["train.ipynb"] = (json.dumps(notebook, ensure_ascii=False, indent=1) + "\n").encode("utf-8")

    archive = ROOT / "rocket-control-materials.zip"
    with ZipFile(archive, "w", compression=ZIP_DEFLATED, compresslevel=9) as bundle:
        for name, data in contents.items():
            entry = ZipInfo(f"rocket-control/{name}", date_time=(2026, 1, 1, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            bundle.writestr(entry, data, compresslevel=9)
    print(f"Built {archive.name}: {len(FILES)} files, {archive.stat().st_size / 1024**2:.1f} MiB")


if __name__ == "__main__":
    build()

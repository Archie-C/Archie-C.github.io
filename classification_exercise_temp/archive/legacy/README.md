# Archived experiment tooling

These historical comparison, dataset and release scripts are preserved for reproducing frozen experiments. They are not part of the supported expert evaluation workflow. Their local `rocket_expert.py` is the unmodified v0.5 source; other frozen teachers remain in `../../versions`. Run from this directory with the project directory on the import path, for example:

```sh
cd archive/legacy
PYTHONPATH=../.. python3 -m unittest test_expert_versions test_release_artifacts
```

The former documentation and original commands are preserved in `../README-historical.md`; paths in those commands refer to the pre-archive layout. Frozen datasets, reports, manifests and replays remain in their original locations.

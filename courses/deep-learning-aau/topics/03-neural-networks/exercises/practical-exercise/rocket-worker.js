'use strict';
// Each evaluation has its own worker and virtual filesystem. Termination cancels
// runaway controllers and releases Python's memory without blocking the page.
const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.28.3/full/';
const files = ['rocket_physics.py', 'rocket_calibration.py', 'rocket_scoring.py',
  'rocket_runtime.py', 'rocket_closed_loop.py', 'run_uploaded_controller.py'];

self.onmessage = async ({data}) => {
  const {id, source, weights, weightsName} = data;
  const progress = message => self.postMessage({id, progress: message});
  try {
    progress('Loading Python and NumPy (first load can take a while)…');
    importScripts(PYODIDE_URL + 'pyodide.js');
    const pyodide = await loadPyodide({indexURL: PYODIDE_URL});
    await pyodide.loadPackage(['numpy', 'scipy']);
    progress('Loading the flight simulator…');
    pyodide.FS.mkdirTree('/exercise');
    await Promise.all(files.map(async path => {
      const response = await fetch(new URL(path, self.location.href));
      if (!response.ok) throw Error(`Could not load ${path} (${response.status})`);
      pyodide.FS.writeFile('/exercise/' + path, new Uint8Array(await response.arrayBuffer()));
    }));
    pyodide.FS.writeFile('/exercise/uploaded_controller.py', source, {encoding: 'utf8'});
    let weightsPath = null;
    if (weights) {
      // Preserve the extension for controllers that use it to select a format.
      const match = /\.[a-zA-Z0-9]{1,24}$/.exec(weightsName || '');
      weightsPath = '/exercise/uploaded_weights' + (match ? match[0] : '');
      pyodide.FS.writeFile(weightsPath, new Uint8Array(weights));
    }
    if (weightsPath === null) pyodide.runPython('weights_path = None');
    else pyodide.globals.set('weights_path', weightsPath);
    progress('Evaluating controller on validation flights…');
    const result = await pyodide.runPythonAsync(`
import sys, json
sys.path.insert(0, '/exercise')
from run_uploaded_controller import main
json.dumps(main('/exercise/uploaded_controller.py', weights_path), allow_nan=False)
`);
    self.postMessage({id, result: JSON.parse(result)});
  } catch (error) {
    self.postMessage({id, error: error.message || String(error)});
  }
};

// The scorer is shared with the local tests and never returns private labels.
export function score(predictions, rows) {
  if (!Array.isArray(predictions) || !predictions.length ||
      predictions.some(x => !Number.isInteger(x) || x < 0 || x > 9)) {
    throw new Error('predictions must be a nonempty array of actions from 0 to 9');
  }
  if (rows.length !== predictions.length || rows.some((r, i) =>
      r.row_index !== i || !Number.isInteger(r.action) || r.action < 0 || r.action > 9)) {
    throw new Error('test labels do not match the prediction sequence');
  }
  let correct = 0, macroF1 = 0, count = 0;
  for (let label = 0; label < 10; label++) {
    let tp = 0, fp = 0, fn = 0;
    for (let i = 0; i < rows.length; i++) {
      const target = rows[i].action, predicted = predictions[i];
      if (label === 0 && target === predicted) correct++;
      if (target === label && predicted === label) tp++;
      else if (predicted === label) fp++;
      else if (target === label) fn++;
    }
    if (2 * tp + fp + fn) { macroF1 += 2 * tp / (2 * tp + fp + fn); count++; }
  }
  return {accuracy: correct / rows.length, macro_f1: macroF1 / count, sample_count: rows.length};
}

import { listCommunications } from './query.js';
import { buildThreads } from '../threading/build-threads.js';

/**
 * Builds threads over whatever set of datasets is currently selected
 * (empty/omitted datasetIds means all datasets) -- threading is
 * recomputed on demand rather than persisted, so it always reflects the
 * investigator's current dataset selection, including messages with
 * identical content imported via separate datasets.
 */
export function getThreadsForDatasets(db, datasetIds) {
  const communications = listCommunications(db, { datasetIds });
  return buildThreads(communications);
}

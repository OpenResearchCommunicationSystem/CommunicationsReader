// The Focus Set has no stable row id of its own -- it's a live, editable
// working set the investigator curates, not a persisted entity like a
// thread or a dataset. Collection-level AI results (summary, extracted
// entities, Q&A history) need SOME fixed key to be stored/looked up
// under, so this constant plays the same role for the Focus Set that a
// real threadId plays for one thread's rows. Analyze Collection reuses
// src/threading/summarize-thread.js's thread_summaries table directly
// with this as the threadId; entity extraction and Q&A below use it the
// same way against their own tables.
export const FOCUS_SET_SCOPE = 'focus-set';

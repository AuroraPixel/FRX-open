/* Memory recall as the old page does it before a turn (step 4 of the prompt): the page's own
 * prepareVectorContext and getVectorContext with their dependencies, run by host.cjs.
 *
 *   node apps/engine/recall.cjs < input.json > output.json
 *
 * Input: assemble.cjs's input (without recall), plus
 *   vectors  the memory records the page could see (scope global, or this save's archiveId)
 *   answers  network answers by request key, from earlier passes
 * Output, when the search still needs the network:
 *   { done: false, needs: [{key, method, url, body}] }   texts to embed, documents to rerank, or
 *                                                          the keyword analysis of a model-led search
 * and when it is finished:
 *   { done: true, text, context, variables, log }        the text searched with, the block the
 *                                                          prompt gets, the page's variables and
 *                                                          the page's own account of the search
 * The caller fetches what `needs` lists, adds the answers under their keys and runs again.
 */
'use strict';

const { openSession } = require('./assemble.cjs');

const FUNCTIONS = ['getVectorContext', 'frxLocalSearchQueries', 'fetchEmbedding', 'fetchRerank', 'cosineSimilarity',
  'getFolderConfig', 'genericApiCall'];

// Step 4 of sendMessageUnguarded on its own: the same text, the page's search, and what it hands
// to the prompt and to the variables.
async function frxRecall(turn) {
  const { cleanMessageTextForAI } = await frxMessageText(turn);
  if (!cleanMessageTextForAI) return { text: null, context: '', log: latestVectorInjectionLogs };
  const search = getVectorContext;
  let text = null;
  getVectorContext = async inputText => {
    text = inputText;
    return search(inputText);
  };
  try {
    const archive = await db.archives.get(currentArchiveName);
    const context = await prepareVectorContext(cleanMessageTextForAI, archive);
    return { text, context, log: latestVectorInjectionLogs };
  } finally {
    getVectorContext = search;
  }
}

async function recall(input, { discover = false } = {}) {
  const { run } = await openSession(input, { functions: FUNCTIONS, glue: [frxRecall], discover });
  const result = await run.call('frxRecall', input.action || {});
  if (!result.done) return { done: false, needs: run.needs.map(({ key, method, url, body }) => ({ key, method, url, body })) };
  return {
    done: true, ...result.value, variables: { ...run.variables }, errors: run.errors,
    ...(discover ? { missing: run.missing } : {}),
  };
}

// All passes at once, for callers in Node: `answer(need)` returns {status, body} for a request.
async function recallPasses(input, answer, limit = 5) {
  const answers = { ...(input.answers || {}) };
  for (let pass = 0; pass < limit; pass += 1) {
    const result = await recall({ ...input, answers });
    if (result.done) return { ...result, answers };
    for (const need of result.needs) answers[need.key] = await answer(need);
  }
  throw new Error('记忆召回在限定的轮次内没有完成');
}

module.exports = { recall, recallPasses };

if (require.main === module) {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { buffer += chunk; });
  process.stdin.on('end', async () => {
    try {
      const input = JSON.parse(buffer);
      process.env.TZ = input.timeZone || 'Asia/Shanghai';
      process.stdout.write(JSON.stringify(await recall(input, { discover: process.argv.includes('--discover') })));
    } catch (error) {
      process.stdout.write(JSON.stringify({ errors: [error.message] }));
      process.exitCode = 1;
    }
  });
}

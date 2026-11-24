/* Reading a model's reply: the story, the state block, the options, the world-book links and
 * the page's light markdown.
 *
 * Copied from the old page script (js/app.js of the old interface at 137f3a8, which rebuild
 * item 55 deleted: git show 137f3a8 has it; the comment above each
 * declaration gives its line there). The functions are page functions: they run in a page
 * context (../host.cjs), whose globals are the page's variables and the browser stand-ins, and
 * are installed there by their source text. The file is in sloppy mode, as the page script is, and
 * keeps the page's indentation, which the template literals depend on.
 */

// app.js 9711
        function convertSimpleMarkdown(text) {
if (!text) return '';
let processedText = text;

processedText = processedText.replace(/~~(.*?)~~/g, (match, p1) => `<del>${p1}</del>`);


processedText = processedText.replace(/\*\*(.*?)\*\*/g, (match, p1) => `<strong>${p1}</strong>`);
processedText = processedText.replace(/\b__(.*?)__\b/g, (match, p1) => `<strong>${p1}</strong>`);


processedText = processedText.replace(/\*([^\*]+?)\*/g, (match, p1) => `<em>${p1}</em>`);
processedText = processedText.replace(/\b_([^_]+?)_\b/g, (match, p1) => `<em>${p1}</em>`);

processedText = processedText.replace(/`([^`]+?)`/g, (match, p1) => `<code>${p1}</code>`);

return processedText;
}

// app.js 28156
        function extractHtmlFromAiResponse(rawContent) {
          if (!rawContent || typeof rawContent !== 'string') {
            return null;
          }

          const markdownMatch = rawContent.match(/```html([\s\S]*?)```/);
          if (markdownMatch && markdownMatch[1]) {
            return markdownMatch[1].trim();
          }

          const doctypeIndex = rawContent.lastIndexOf('<!DOCTYPE html>');
          if (doctypeIndex !== -1) {
            return rawContent.substring(doctypeIndex).trim();
          }

          const containerIndex = rawContent.lastIndexOf('<div class="daily-paper-container">');
          if (containerIndex !== -1) {
            return rawContent.substring(containerIndex).trim();
          }

          return null;
        }

// app.js 28179
        function parseAIResponse(rawResponse) {
          let processedResponse = rawResponse;
          const result = {
            thinkingContent: '',
            tableThinkContent: '',
            tableEditCommands: '',
            storyContent: '',
            branchContent: '',
            newsReferenceContent: '',
            branchOptions: [],
            hasStoreTag: false,
            rawResponse: rawResponse,
          };

          if (
            processedResponse &&
            processedResponse.includes('</thinking>') &&
            !processedResponse.includes('<thinking>')
          ) {
            processedResponse = '<thinking>' + processedResponse;
          }
          if (
            processedResponse &&
            processedResponse.includes('<thinking>') &&
            !processedResponse.includes('</thinking>')
          ) {
            const lastContentIndex = processedResponse.lastIndexOf('<content>');
            if (lastContentIndex !== -1) {
              const part1 = processedResponse.substring(0, lastContentIndex);
              const part2 = processedResponse.substring(lastContentIndex);
              processedResponse = part1 + '</thinking>' + part2;
            }
          }

          const thinkingMatch = processedResponse.match(/<thinking>([\s\S]*?)<\/thinking>/);
          const tableThinkMatch = processedResponse.match(/<tableThink>([\s\S]*?)<\/tableThink>/);
          const storeMatch = processedResponse.match(/<upstore>([\s\S]*?)<\/upstore>/);
          const branchMatch = processedResponse.match(/<branches>([\s\S]*?)<\/branches>/);
          const newsRefMatch = processedResponse.match(/<news_ref>([\s\S]*?)<\/news_ref>/);
          const contentMatch = processedResponse.match(/<content>([\s\S]*?)<\/content>/);

          result.thinkingContent = thinkingMatch ? thinkingMatch[1].trim() : '';
          result.tableThinkContent = tableThinkMatch ? tableThinkMatch[1].trim() : '';
          result.tableEditCommands = storeMatch ? storeMatch[1].replace(/<!--|-->/g, '').trim() : '';
          result.hasStoreTag = !!storeMatch;
          result.branchContent = branchMatch ? branchMatch[0] : '';
          result.newsReferenceContent = newsRefMatch ? newsRefMatch[1].trim() : '';

          if (contentMatch) {
            result.storyContent = contentMatch[1].trim();
          } else {
            result.storyContent = processedResponse
              .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
              .replace(/<tableThink>[\s\S]*?<\/tableThink>/g, '')
              .replace(/<upstore>[\s\S]*?<\/upstore>/g, '')
              .replace(/<branches>[\s\S]*?<\/branches>/g, '')
              .replace(/<news_ref>[\s\S]*?<\/news_ref>/g, '')
              .replace(/<Tag_think>[\s\S]*?<\/Tag_think>/g, '')
              .replace(/<content>[\s\S]*/g, '')
              .trim();
          }

          if (result.branchContent) {
            result.branchOptions = parseBranchOptions(result.branchContent);
          }

          return result;
        }

// app.js 28248
        function parseBranchOptions(content) {
          const body = String(content || '').replace(/^\s*<branches>([\s\S]*)<\/branches>\s*$/i, '$1');
          const starts = [];
          let depth = 0;
          for (let i = 0; i < body.length; i++) {
            if (body[i] === '[') {
              if (depth === 0 && /^\[\s*[A-D](?:[.．、:：]|\s*\])/i.test(body.slice(i))) starts.push(i);
              depth++;
            } else if (body[i] === ']') depth = Math.max(0, depth - 1);
          }
          if (!starts.length) return (body.match(/\[([^\]]+)\]/g) || []).map(s => s.slice(1, -1));
          return starts.map((start, index) => {
            const segment = body.slice(start, starts[index + 1] ?? body.length).trim();
            let level = 0, end = -1;
            for (let i = 0; i < segment.length; i++) {
              if (segment[i] === '[') level++;
              else if (segment[i] === ']' && --level === 0) { end = i; break; }
            }
            if (end === -1) return segment.slice(1).trim();
            return [segment.slice(1, end).trim(), segment.slice(end + 1).trim()].filter(Boolean).join(' ');
          });
        }

// app.js 28271
        function extractStoryForOptimization(response) {
          response = response.replace(/<(thinking|think|tableThink|Tag_think)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
          const content = response.match(/<content>[\s\S]*?<\/content>/i);
          if (content) return content[0].trim();
          return response
            .replace(/<(thinking|think|tableThink|upstore|branches|news_ref|Tag_think)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
            .replace(/<(thinking|think|tableThink|upstore|branches|news_ref|Tag_think)\b[^>]*>[\s\S]*$/gi, '')
            .trim();
        }

// app.js 30790
        function processWorldBookEntries(text) {
          if (!text || typeof text !== 'string') return text;

          return text.replace(/```worldbook\s*([\s\S]*?)\s*```/g, (match, jsonContent) => {
            try {
              const data = JSON.parse(jsonContent.trim());
              if (data && data.title) {
                const span = document.createElement('span');
                span.className = 'world-book-entry-link';
                span.textContent = data.title;
                span.style.color = '#ffd700';
                span.style.cursor = 'pointer';
                span.style.textDecoration = 'underline';
                span.dataset.worldbookJson = JSON.stringify(data);
                return span.outerHTML;
              }
            } catch (e) {
              console.error('解析世界书JSON失败:', e, jsonContent);
            }
            return `[世界书条目: ${jsonContent}]`; // 解析失败时回退
          });
        }

module.exports = {
  convertSimpleMarkdown,
  extractHtmlFromAiResponse,
  parseAIResponse,
  parseBranchOptions,
  extractStoryForOptimization,
  processWorldBookEntries,
};
